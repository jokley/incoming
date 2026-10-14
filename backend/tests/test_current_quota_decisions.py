"""Current recalculated requirements cannot reuse decisions from another scope."""
import json
from datetime import datetime
from types import SimpleNamespace

import pytest

from test_real_workbook_import import database, preview, add_session
import excel_import as imports
from models import db, Competition, ImportApproval, Athlete, RoomBooking, ImportRun
from competitions import resolve_quota_memberships


def add_decision(session, issue, decision='APPROVED'):
    approval = ImportApproval(session_id=session.id, version_id=session.current_version_id,
        nation=session.nation, approval_type='NATION_APPROVED' if decision == 'APPROVED' else issue['code'],
        decision=decision, description=issue['message'],
        quota_details_json=json.dumps(issue['details']),
        approved_person_keys_json=json.dumps([p['personKey'] for p in issue['details'].get('singleRoomCandidates', [])][:issue['details'].get('excessCount', 0)]) if decision == 'APPROVED' else None,
        username='regression')
    db.session.add(approval)
    return approval


def setup_remap(event, monkeypatch):
    mapping = {m.import_code: m.competition for m in event.competition_mappings if m.competition.code in {'8180','8184'}}
    assert len(mapping) == 2
    people = []
    for gender in ('M', 'W'):
        for index in range(5):
            key = f'{gender}{index}'
            codes = [code for code,c in mapping.items() if c.gender == gender]
            people.append(resolve_quota_memberships(dict(matchKey=key, fisCode=key, firstname=key,
                lastname='Person', nationCode='AUT', gender=gender, forGender=gender,
                function='Athlete' if index == 0 else 'Official', competitionImportCodes=codes), mapping))
    raw = dict(createdAt=datetime.utcnow(), eventId=event.id, people=people,
        rooms=[dict(person1Key=p['matchKey'], roomType='Single') for p in people if p['function']=='Official'],
        errors=[], warnings=[])
    imports.recalculate_fis_import_preview(raw)
    imports.PREVIEW_STORE['remap-token'] = raw
    result = json.loads(json.dumps(raw, default=str)); result['previewToken'] = 'remap-token'
    session, version, first = add_session(result, nation='AUT')
    first.decision = 'APPROVED'; first.approval_type = 'NATION_APPROVED'
    details = json.loads(first.quota_details_json)
    first.approved_person_keys_json = json.dumps([p['personKey'] for p in details['singleRoomCandidates']][:details['excessCount']])
    issues = [w for w in result['warnings'] if w['code'] == 'QUOTA_SINGLE_ROOMS_EXCEEDED']
    for issue in issues[1:]: add_decision(session, issue)
    db.session.commit()
    frozen = {a.id: (a.quota_details_json, a.approved_person_keys_json, a.decision, a.created_at)
              for a in session.current_approvals}
    for c in mapping.values(): c.quota_discipline = 'Snowboard Alpine'
    db.session.commit()
    return result, session, version, first, frozen


def assert_history_unchanged(frozen):
    for approval_id, evidence in frozen.items():
        approval = db.session.get(ImportApproval, approval_id)
        assert (approval.quota_details_json, approval.approved_person_keys_json,
                approval.decision, approval.created_at) == evidence


def assert_requirements(response):
    payload = response.get_json()
    assert payload['error'] == 'QUOTA_REQUIREMENTS_UNREVIEWED'
    assert {(e['details']['nationCode'], e['details']['discipline'], e['details']['gender'],
             e['details']['requirementType']) for e in payload['validationErrors']} == {
        ('AUT', 'Snowboard Alpine', 'M', 'QUOTA_SINGLE_ROOMS_EXCEEDED')}


def test_new_alpine_requirements_block_all_workflow_boundaries(database, monkeypatch):
    import app as routes
    app, event = database
    result, session, version, first, frozen = setup_remap(event, monkeypatch)
    snapshot = version.preview_json
    current = routes._current_session_preview(session)
    assert not current['errors']
    assert [(w['details']['importedOfficials'], w['details']['officialQuota'])
            for w in current['warnings'] if w['code']=='QUOTA_SINGLE_ROOMS_EXCEEDED'] == [(8, 3)]
    with app.test_request_context(json={'decision': 'APPROVED'}):
        response, status = routes.decide_import_approval(session.id, first.id)
        assert status == 409; assert_requirements(response)
        response, status = routes.approve_import_session(session.id)
        assert status == 409; assert_requirements(response)
    session.status = 'APPROVED'; session.approved_at = datetime.utcnow()
    db.session.commit()
    with app.test_request_context():
        response, status = routes.import_approved_session(session.id)
        assert status == 409; assert_requirements(response)
    with app.test_request_context(json={'previewToken': result['previewToken']}):
        response = routes.confirm_previewed_fis_import()
        assert response.status_code == 409; assert_requirements(response)
    with pytest.raises(imports.ImportValidationError) as caught:
        imports.confirm_fis_import(result['previewToken'])
    assert caught.value.code == 'QUOTA_REQUIREMENTS_UNREVIEWED'
    assert len(caught.value.details['requirements']) == 1
    db.session.rollback()
    assert_history_unchanged(frozen)
    assert version.preview_json == snapshot
    assert Athlete.query.count() == RoomBooking.query.count() == ImportRun.query.count() == 0


def test_matching_current_decisions_allow_processing_release_and_import(database, monkeypatch):
    import app as routes
    app, event = database
    _, session, _, _, frozen = setup_remap(event, monkeypatch)
    current = routes._current_session_preview(session)
    alpine = [w for w in current['warnings'] if w['code']=='QUOTA_SINGLE_ROOMS_EXCEEDED']
    pending = add_decision(session, alpine[0], 'PENDING')
    db.session.commit()
    monkeypatch.setattr(routes, 'current_user', lambda: SimpleNamespace(username='regression'))
    with app.test_request_context():
        response, status = routes.approve_import_session(session.id)
        assert status == 409
        assert response.get_json()['validationErrors'][0]['details']['discipline'] == 'Snowboard Alpine'
    with app.test_request_context(json={'decision': 'APPROVED', 'approvalType': 'NATION_APPROVED',
            'approvalBy': 'AUT Team', 'approvalDate': '2026-10-13T10:00:00Z',
            'approvedPersonKeys': [p['personKey'] for p in alpine[0]['details']['singleRoomCandidates']][:alpine[0]['details']['excessCount']]}):
        response = routes.decide_import_approval(session.id, pending.id)
        assert response.status_code == 200
    with app.test_request_context():
        response = routes.approve_import_session(session.id)
        assert response.status_code == 200
        response = routes.import_approved_session(session.id)
        assert response.status_code == 200 and response.get_json()['success']
    assert Athlete.query.count() == 10
    assert_history_unchanged(frozen)


@pytest.mark.parametrize('evidence_failure', ['missing', 'wrong_competition', 'wrong_event', 'wrong_gender'])
def test_current_decisions_require_exact_competition_event_and_gender_evidence(database, monkeypatch, evidence_failure):
    import app as routes
    app, event = database
    _, session, _, _, _ = setup_remap(event, monkeypatch)
    current = routes._current_session_preview(session)
    for issue in current['warnings']:
        if issue['code'] == 'QUOTA_SINGLE_ROOMS_EXCEEDED':
            approval = add_decision(session, issue)
            details = json.loads(approval.quota_details_json)
            if evidence_failure == 'missing':
                for person in details['singleRoomCandidates']:
                    person.pop('competitionIds', None); person.pop('competitionImportCodes', None)
            elif evidence_failure == 'wrong_competition':
                for person in details['singleRoomCandidates']:
                    person['competitionIds'] = ['999999']
            elif evidence_failure == 'wrong_event':
                details['eventId'] = event.id + 1
            else:
                details['gender'] = 'A'
            approval.quota_details_json = json.dumps(details)
    db.session.commit()
    with app.test_request_context():
        response, status = routes.approve_import_session(session.id)
        assert status == 409; assert_requirements(response)


@pytest.mark.parametrize('preserved', [False, True])
def test_single_decision_coverage_is_distinct_and_does_not_credit_preserved_people_twice(database, monkeypatch, preserved):
    _, event = database
    result = preview('USA', event, monkeypatch)
    group = 'Snowboard Park & Pipe'
    people = [p for p in result['people'] if p['function'] != 'Athlete' and group in p['quotaDisciplines']][:2]
    candidates = [{'personKey': p['matchKey'], 'competitionIds': [c['competitionId']
        for c in p['competitionMemberships'] if c['quotaDiscipline'] == group]} for p in people]
    details = dict(eventId=event.id, quotaMembershipVersion=2, nationCode='USA', discipline=group, gender='M',
        singleRoomCandidates=candidates, excessCount=2, openExcessCount=1 if preserved else 2,
        preservedApprovedPeople=[candidates[0]] if preserved else [])
    requirement = {'code': 'QUOTA_SINGLE_ROOMS_EXCEEDED', 'details': details}
    result['warnings'] = [requirement]
    approvals = [ImportApproval(nation='USA', decision='APPROVED',
        quota_details_json=json.dumps(details), approved_person_keys_json=json.dumps([candidate['personKey']]))
        for candidate in candidates]
    frozen = approvals[0].quota_details_json
    assert imports.quota_requirement_errors(result, approvals[:1])
    assert not imports.quota_requirement_errors(result, approvals)
    assert approvals[0].quota_details_json == frozen
