"""Regression evidence from the four real Entries/Room-List pairs.

Fixtures retain the original import-relevant cells, including names and roles,
but omit contact information and unrelated transport/TV-picture fields.
"""
import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pandas as pd
import pytest
from flask import Flask

import excel_import as imports
from competitions import COMPETITIONS
from models import db, Competition, Event, EventCompetition, ImportSession, ImportSessionVersion, ImportApproval


@pytest.fixture
def database():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        event = Event(name='Exact real-workbook regression catalogue')
        db.session.add(event)
        for definition in COMPETITIONS:
            competition = Competition(**definition._asdict())
            db.session.add(EventCompetition(event=event, competition=competition,
                import_code=definition.import_code, fis_codex=definition.code, official_name=definition.name))
        db.session.commit()
        yield app, event
        db.session.remove()
        db.drop_all()
    imports.PREVIEW_STORE.clear()


def preview(nation, event, monkeypatch):
    fixture = json.loads((Path(__file__).parent / 'fixtures' / 'real_entries' / f'{nation}.json').read_text())
    monkeypatch.setattr(imports, 'load_first_sheet', lambda path: pd.DataFrame(fixture[path]))
    return imports.create_fis_import_preview('entries', 'rooms', event)


@pytest.mark.parametrize('nation,yes,athletes,rooms,singles,decisions', [
    ('USA', 131, 28, 28, 9, 4), ('AUS', 422, 19, 21, 8, 6),
    ('KOR', 75, 15, 16, 7, 1), ('FIN', 8, 4, 7, 1, 0)])
def test_real_pairs_through_initial_and_saved_preview(database, monkeypatch, nation, yes, athletes, rooms, singles, decisions):
    _, event = database
    result = preview(nation, event, monkeypatch)
    assert sum(len(p['affirmativeWscColumns']) for p in result['people']) == yes
    assert sum(len(p['competitionMemberships']) for p in result['people']) == yes
    assert sum(len(p['competitionIds']) for p in result['people']) == yes
    assert result['athleteQuotaChecks'][0]['athleteQuotaUsed'] == athletes
    assert result['athleteQuotaChecks'][0]['athleteQuotaStatus'] == 'WITHIN_BASE_LIMITS'
    assert result['summary']['rooms']['total'] == rooms
    assert result['summary']['rooms']['singles'] == singles
    assert len([w for w in result['warnings'] if w['code'] == 'INFO_OFFICIALS_OVER_BASIS']) == decisions
    assert result['quotaChecks']
    assert all(q['gender'] in {'M', 'W'} for q in result['quotaChecks'])
    assert not any(e['code'].startswith('ENTRY_WSC_MEMBERSHIP') for e in result['errors'])
    for person in result['people']:
        if person['function'] == 'Athlete':
            assert person['quotaDisciplines']
            assert person['athleteTopLevelDisciplines'] == ['Freestyle' if nation == 'FIN' else 'Snowboard']
    if nation == 'AUS':
        room = next(r for r in result['rooms'] if r['person1Name'] == 'Luca MEYLAN')
        assert room['person2Name'] == 'Karel VAN GOOR'
        assert not any(w['code'] == 'ROOM_PARTNER_NOT_FOUND' for w in result['warnings'] + result['errors'])
        assert len({key for r in result['rooms'] for key in [r['person1Key'], r['person2Key']] if key}) == 34
    if nation == 'USA':
        assert {(q['discipline'], q['gender'], q['officials'], q['officialQuota'])
            for q in result['quotaChecks'] if q['officialsExceeded']} == {
                ('Snowboard Cross', 'M', 9, 6), ('Snowboard Cross', 'W', 9, 6),
                ('Snowboard Park & Pipe', 'M', 11, 10), ('Snowboard Park & Pipe', 'W', 11, 10)}
    if nation == 'KOR':
        assert [(w['details']['discipline'], w['details']['gender']) for w in result['warnings']] == [('Snowboard Alpine', 'W')]
    if nation == 'FIN':
        assert not result['isValid']
        officials = [p for p in result['people'] if p['function'] != 'Athlete']
        assert len(officials) == 3 and all(p['quotaDisciplines'] == [] for p in officials)
        single = next(p for p in officials if p['lastname'] == 'HAUTSALO')
        assert single['singleRoomEntitlement'] == 'APPROVAL_REQUIRED'
        assert single['singleRoomAllocation']['context'] is None
        assert [e['code'] for e in result['errors']] == ['ENTRY_SINGLE_ROOM_CONTEXT_UNRESOLVED']
        with pytest.raises(ValueError, match='blocking validation errors'):
            imports.confirm_fis_import(result['previewToken'])
    else:
        assert result['isValid'] and not result['errors']
        assert sum(q['singleRooms'] for q in result['quotaChecks']) == singles
    saved = json.loads(json.dumps(result))
    imports.recalculate_fis_import_preview(saved)
    assert saved['isValid'] == result['isValid']
    assert saved['quotaChecks'] == result['quotaChecks']
    assert saved['errors'] == result['errors']
    assert saved['summary']['rooms']['singles'] == singles


@pytest.mark.parametrize('nation', ['USA', 'AUS', 'KOR'])
def test_mixed_parallel_memberships_follow_affirmative_staff_source_columns(database, monkeypatch, nation):
    _, event = database
    result = preview(nation, event, monkeypatch)
    fixture = json.loads((Path(__file__).parent / 'fixtures' / 'real_entries' / f'{nation}.json').read_text())
    codes = {'WSC_PSL_W_6178', 'WSC_PSL_M_6177', 'WSC_PRT_A_6180',
             'WSC_PGS_W_6172', 'WSC_PGS_M_6170'}
    matching = [row for row in fixture['entries'] if all(row.get(code) == 'YES' for code in codes)]
    assert matching
    for row in matching:
        person = next(p for p in result['people'] if p['firstname'] == row['Firstname']
                      and p['lastname'] == row['Lastname'])
        assert person['function'] != 'Athlete'
        assert person['forGender'] == 'A'
        affirmative = {code for code, value in row.items() if code.startswith('WSC_') and value == 'YES'}
        assert set(person['competitionImportCodes']) == affirmative
        assert set(person['affirmativeWscColumns']) == affirmative
        assert len(person['competitionIds']) == len(affirmative)
        assert codes <= {membership['importCode'] for membership in person['competitionMemberships']}


def add_session(result, nation='USA'):
    session = ImportSession(nation=nation, status='PROFESSIONALLY_REVIEWED')
    db.session.add(session); db.session.flush()
    version = ImportSessionVersion(session_id=session.id, version=1,
        preview_json=json.dumps(result), preview_token=result['previewToken'], uploaded_by='regression')
    db.session.add(version); db.session.flush(); session.current_version = version
    issue = next((w for w in result['warnings'] if w['code'] == 'QUOTA_SINGLE_ROOMS_EXCEEDED'), None) or next((w for w in result['warnings'] if w['code'] == 'INFO_OFFICIALS_OVER_BASIS'), None)
    approval = ImportApproval(session_id=session.id, version_id=version.id, nation=nation,
        approval_type=issue['code'] if issue and issue['code']=='QUOTA_SINGLE_ROOMS_EXCEEDED' else 'REVIEW',
        description=issue['message'] if issue and issue['code']=='QUOTA_SINGLE_ROOMS_EXCEEDED' else 'Review', decision='PENDING', username='regression',
        quota_details_json=json.dumps(issue['details'] if issue else {}))
    db.session.add(approval); db.session.flush()
    from imports.workflow import refresh_plan
    refresh_plan(session)
    db.session.commit()
    return session, version, approval


@pytest.mark.parametrize('failure', ['missing_group', 'inactive_mapping', 'partial_extraction', 'inactive_event'])
def test_stale_saved_preview_is_checked_at_workflow_boundaries(database, monkeypatch, failure):
    from app import get_import_session, get_import_approval, decide_import_approval, approve_import_session, import_approved_session
    app, event = database
    result = preview('USA', event, monkeypatch)
    if failure == 'partial_extraction':
        person = next(p for p in result['people'] if p['lastname'] == 'BAUMGARTNER')
        person['competitionImportCodes'].remove('WSC_BXT_A_6193')
    session, version, approval = add_session(result)
    frozen_preview, frozen_approval = version.preview_json, approval.quota_details_json
    if failure == 'missing_group':
        Competition.query.filter_by(import_code='WSC_BXT_A_6193').one().quota_discipline = ''
    elif failure == 'inactive_mapping':
        EventCompetition.query.filter_by(import_code='WSC_BXT_A_6193').one().active = False
    elif failure == 'inactive_event':
        event.active = False
    db.session.commit()
    with app.test_request_context():
        payload = get_import_session(session.id).get_json()
        assert payload['status'] == 'DRAFT' and not payload['preview']['isValid']
        assert payload['preview']['errors'] and 'quotaChecks' in payload['preview']
        decision = get_import_approval(approval.id).get_json()
        assert not decision['isValid'] and decision['validationErrors']
        assert decision['discipline'] == json.loads(approval.quota_details_json)['discipline']
        response, status = approve_import_session(session.id)
        assert status == 409 and response.get_json()['validationErrors']
    with app.test_request_context(json={'decision': 'APPROVED'}):
        response, status = decide_import_approval(session.id, approval.id)
        assert status == 409 and response.get_json()['validationErrors']
    session.status = 'APPROVED'; session.approved_at = datetime.utcnow(); db.session.commit()
    with app.test_request_context(json={'versionId':session.current_version_id}):
        response, status = import_approved_session(session.id)
        assert status == 409 and response.get_json()['error'] in {'STALE_PREVIEW','IMPORT_REVIEW_REQUIRED'}
    if failure == 'partial_extraction':
        raw_person = next(p for p in imports.PREVIEW_STORE[result['previewToken']]['people'] if p['lastname'] == 'BAUMGARTNER')
        raw_person['competitionImportCodes'].remove('WSC_BXT_A_6193')
    with pytest.raises(ValueError):
        imports.confirm_fis_import(result['previewToken'])
    db.session.rollback()
    assert version.preview_json == frozen_preview
    assert approval.quota_details_json == frozen_approval and approval.decision == 'PENDING'


def test_saved_wsc_preview_without_source_or_exact_evidence_requires_reupload(database, monkeypatch):
    _, event = database
    result = preview('USA', event, monkeypatch)
    person = result['people'][0]
    for key in ('affirmativeWscColumns', 'competitionImportCodes', 'competitionIds', 'competitionMemberships'):
        person.pop(key)
    imports.recalculate_fis_import_preview(result)
    assert not result['isValid']
    assert any(error['code'] == 'ENTRY_WSC_SOURCE_EVIDENCE_MISSING' for error in result['errors'])
    # Repeated review cannot make missing provenance disappear.
    imports.recalculate_fis_import_preview(result)
    assert any(error['code'] == 'ENTRY_WSC_SOURCE_EVIDENCE_MISSING' for error in result['errors'])


@pytest.mark.parametrize('code_shape', ['absent', 'empty'])
def test_legacy_saved_exact_ids_resolve_within_active_event_mapping(database, monkeypatch, code_shape):
    _, event = database
    result = preview('USA', event, monkeypatch)
    person = next(p for p in result['people'] if p['lastname'] == 'BAUMGARTNER')
    ids = list(person['competitionIds'])
    person.pop('affirmativeWscColumns'); person.pop('competitionImportCodes')
    if code_shape == 'empty':
        person['competitionImportCodes'] = []
    for _ in range(2):
        imports.recalculate_fis_import_preview(result)
        assert result['isValid']
        assert person['competitionIds'] == ids
        assert person['quotaDisciplines'] == ['Snowboard Cross']
        assert set(person['competitionImportCodes']) == {'WSC_SBX_M_6191', 'WSC_BXT_A_6193'}


@pytest.mark.parametrize('code_shape', ['absent', 'empty'])
def test_legacy_saved_ids_cannot_partially_disappear_on_repeated_review(database, monkeypatch, code_shape):
    _, event = database
    result = preview('USA', event, monkeypatch)
    person = next(p for p in result['people'] if p['lastname'] == 'BAUMGARTNER')
    person.pop('affirmativeWscColumns'); person.pop('competitionImportCodes')
    if code_shape == 'empty':
        person['competitionImportCodes'] = []
    EventCompetition.query.filter_by(import_code='WSC_BXT_A_6193').one().active = False
    db.session.commit()
    for _ in range(2):
        imports.recalculate_fis_import_preview(result)
        assert not result['isValid']
        errors = [error for error in result['errors'] if error['details'].get('personKey') == person['matchKey']]
        assert any(member['reason'] == 'SAVED_COMPETITION_UNRESOLVED'
                   for error in errors for member in error['details'].get('unresolvedMemberships', []))


def test_fin_single_without_context_cannot_be_released(database, monkeypatch):
    from app import approve_import_session
    app, event = database
    result = preview('FIN', event, monkeypatch)
    # A stale saved version claiming validity must not bypass the current check.
    result['errors'] = []; result['isValid'] = True
    session, _, _ = add_session(result, 'FIN')
    with app.test_request_context():
        response, status = approve_import_session(session.id)
        assert status == 409
        assert response.get_json()['validationErrors'][0]['code'] == 'ENTRY_SINGLE_ROOM_CONTEXT_UNRESOLVED'


def test_missing_or_ambiguous_room_partner_is_not_a_single(database, monkeypatch):
    _, event = database
    result = preview('AUS', event, monkeypatch)
    people = deepcopy(imports.PREVIEW_STORE[result['previewToken']]['people'])
    row = dict(Lastname='MEYLAN', Firstname='Luca', Nationcode='AUS',
        Arrival_date='14.03.2027', Departure_date='22.03.2027', Room_type='Double shared',
        **{'Shared with Name': 'VAN GOOR Karel', 'Shared with Nationcode': 'AUS'})
    partner = next(p for p in people if p['lastname'] == 'VAN GOOR')
    for candidates in ([p for p in people if p is not partner], [*people, {**partner, 'matchKey': 'other'}]):
        parsed = imports.parse_room_list(pd.DataFrame([row]), candidates)
        assert parsed['warnings'][0]['code'] == 'ROOM_PARTNER_NOT_FOUND'
        assert parsed['rooms'][0]['person2Key'] is None
        assert parsed['rooms'][0]['roomType'] == 'Double shared'
    assert imports._match_room_partner('VAN GOOR Karel', 'USA', people) is None
