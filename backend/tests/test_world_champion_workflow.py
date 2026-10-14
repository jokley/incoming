"""Event recognition, persistent crown commands, and residual person decisions."""
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from flask import current_app
from test_physical_single_room_allocation import database, event_roster
from models import Athlete, AuditEvent, Event, ImportSession, ImportSessionVersion, ImportSessionEvent, WorldChampion, db
from excel_import import apply_single_room_quota_exemptions, recalculate_fis_import_preview, quota_requirement_errors, PREVIEW_STORE, confirm_fis_import


def reference(event_id, **extra):
    row = WorldChampion(event_id=event_id, fis_code='M', name='M Person', nation='AUT', gender='M',
        discipline='SX', event_group='Ski Cross', championship='Engadin', championship_year=2025,
        title_type='INDIVIDUAL', entitlement_enabled=True, active=True, source='verified test evidence')
    for key, value in extra.items():
        setattr(row, key, value)
    db.session.add(row); db.session.commit()
    return row


@pytest.mark.parametrize('variant', ['match', 'other_event', 'inactive', 'team', 'no_code', 'different_code', 'official'])
def test_exact_event_scoped_recognition(database, variant):
    preview = event_roster(genders=('M',), officials=())
    event_id = preview['eventId']
    if variant == 'other_event':
        other = Event(name='Future WSC'); db.session.add(other); db.session.commit(); event_id = other.id
    reference(event_id, **({'active': False} if variant == 'inactive' else
        {'title_type': 'TEAM', 'entitlement_enabled': False} if variant == 'team' else {}))
    person = preview['people'][0]
    if variant == 'no_code': person['fisCode'] = None
    if variant == 'different_code': person['fisCode'] = 'different'
    if variant == 'official': person['function'] = 'Official'
    apply_single_room_quota_exemptions([person], event_id=preview['eventId'])
    assert (person['singleRoomQuotaExemptReason'] == 'WORLD_CHAMPION') == (variant == 'match')
    assert WorldChampion.query.count() == 1


@pytest.mark.parametrize('reason, source', [('WORLD_CHAMPION', 'MANUAL_SET'), (None, 'MANUAL_REMOVE')])
def test_manual_command_survives_reimport_with_audit(database, monkeypatch, reason, source):
    import app as routes
    preview = event_roster(genders=('M',), officials=())
    reference(preview['eventId'])
    person = preview['people'][0]
    athlete = Athlete(fis_code='M', firstname='M', lastname='Person', nation_code='AUT', function='Athlete', gender='M')
    db.session.add(athlete); db.session.commit()
    monkeypatch.setattr(routes, 'current_user', lambda: SimpleNamespace(username='reviewer'))
    with current_app.test_request_context(json={'singleRoomQuotaExemptReason': reason}):
        response = routes._update_athlete_operations(athlete, {'singleRoomQuotaExemptReason': reason})
        assert response.status_code == 200
    apply_single_room_quota_exemptions([person], event_id=preview['eventId'])
    assert person['singleRoomQuotaExemptReason'] == reason
    assert person['singleRoomExemptionSource'] == source
    audit = AuditEvent.query.one()
    assert json.loads(audit.changes_json)['source'] == source


def test_other_is_preserved_and_new_direct_assignment_rejected(database, monkeypatch):
    import app as routes
    preview = event_roster(genders=('M',), officials=())
    reference(preview['eventId'])
    athlete = Athlete(fis_code='M', firstname='M', lastname='Person', nation_code='AUT', function='Athlete',
        gender='M', single_room_quota_exempt_reason='OTHER')
    db.session.add(athlete); db.session.commit()
    apply_single_room_quota_exemptions(preview['people'], event_id=preview['eventId'])
    assert preview['people'][0]['singleRoomQuotaExemptReason'] == 'OTHER'
    with current_app.test_request_context(json={}):
        _, status = routes._update_athlete_operations(athlete, {'singleRoomQuotaExemptReason': 'OTHER'})
        assert status == 400
        _, status = routes._update_athlete_operations(athlete, {'singleRoomQuotaExemptReason': None})
        assert status == 409
    assert athlete.single_room_quota_exempt_reason == 'OTHER'


def session_for(preview):
    session = ImportSession(nation='AUT', status='WAITING_FOR_NATION')
    db.session.add(session); db.session.flush()
    version = ImportSessionVersion(session_id=session.id, version=1, preview_token='review-token',
        preview_json=json.dumps(preview, default=str), uploaded_by='reviewer')
    db.session.add(version); db.session.flush(); session.current_version_id = version.id
    db.session.commit()
    PREVIEW_STORE['review-token'] = deepcopy(preview)
    return session


def test_partial_batch_and_final_resolution_use_canonical_projection(database, monkeypatch):
    import app as routes
    preview = event_roster(genders=('M',), officials=('A','B','C','D','E'))
    recalculate_fis_import_preview(preview)
    session = session_for(preview)
    monkeypatch.setattr(routes, 'current_user', lambda: SimpleNamespace(username='reviewer'))
    with current_app.test_request_context():
        routes.reconcile_single_room_tasks(session); db.session.commit()
    expected_pending = sum(q['singleRoomsPending'] for q in preview['quotaChecks'])
    assert expected_pending == 4
    frozen = {}
    for count in (1, 2, 1):
        pending = next(a for a in session.current_approvals if a.decision == 'PENDING')
        details = json.loads(pending.quota_details_json)
        keys = [p['personKey'] for p in details['singleRoomCandidates']][:count]
        with current_app.test_request_context(json={'decision':'APPROVED', 'approvalType':'NATION_APPROVED',
                'approvalBy':'Team', 'approvalDate':'2026-10-14T10:00:00Z', 'approvedPersonKeys':keys}):
            response = routes.decide_import_approval(session.id, pending.id)
            assert response.status_code == 200
        frozen[pending.id] = (pending.quota_details_json, pending.approved_person_keys_json)
        expected_pending -= count
        canonical = response.get_json()['preview']
        assert sum(q['singleRoomsPending'] for q in canonical['quotaChecks']) == expected_pending
        assert sum(p['singleRoomEntitlement'] == 'APPROVED_EXTRA' for p in canonical['people']) == 4 - expected_pending
        assert bool(quota_requirement_errors(canonical, session.current_approvals)) == bool(expected_pending)
        for decision_id, evidence in frozen.items():
            from models import ImportApproval
            row = db.session.get(ImportApproval, decision_id)
            assert (row.quota_details_json, row.approved_person_keys_json) == evidence
    assert session.status == 'EXCEPTION_APPROVED'
    assert ImportSessionEvent.query.filter_by(event_type='SINGLE_ROOM_PERSON_APPROVED').count() == 4
    with current_app.test_request_context():
        assert routes.approve_import_session(session.id).status_code == 200
    approved = {key: a.id for a in session.current_approvals for key in json.loads(a.approved_person_keys_json or '[]')}
    confirm_fis_import('review-token', approved)
    assert Athlete.query.filter_by(single_room_status='APPROVED_EXTRA').count() == 4
    session.status = 'IMPORTED'; db.session.commit()
    completed = routes._current_session_payload(session, include_preview=True)
    assert completed['status'] == 'IMPORTED'
    assert sum(q['singleRoomsPending'] for q in completed['preview']['quotaChecks']) == 0
    assert sum(p['singleRoomEntitlement']=='APPROVED_EXTRA' for p in completed['preview']['people']) == 4


def test_officials_over_basis_without_extra_single_rooms_needs_no_decision(database):
    preview = event_roster(genders=('M',), officials=tuple('ABCDEFGHI'))
    preview['rooms'] = preview['rooms'][:1]
    recalculate_fis_import_preview(preview)
    row = preview['quotaChecks'][0]
    assert row['officials'] > row['officialQuota']
    assert row['singleRoomsPending'] == 0 and row['athletes'] == 1
    assert row['singleRoomsRequested'] == 1
    assert not quota_requirement_errors(preview, [])
    assert not any(w['code'] == 'QUOTA_OFFICIALS_EXCEEDED' for w in preview['warnings'])


def test_verified_seed_reconciliation_is_idempotent_and_preserves_edits(database):
    from world_champions import reconcile_verified_titles
    preview = event_roster(genders=('M',), officials=())
    data = dict(fisCode='M', name='M', nation='AUT', gender='M', discipline='SX', eventGroup='Ski Cross',
        championship='Engadin', championshipYear=2025, titleType='INDIVIDUAL', source='verified test', sourceVerified=True)
    assert reconcile_verified_titles(preview['eventId'], [data]) == 1
    row = WorldChampion.query.one(); row.name = 'Maintained'; db.session.commit()
    assert reconcile_verified_titles(preview['eventId'], [data]) == 0
    assert row.name == 'Maintained'
    with pytest.raises(ValueError): reconcile_verified_titles(preview['eventId'], [{**data, 'sourceVerified':False}])


def test_crown_set_remove_returns_fresh_preview_quota_and_history(database, monkeypatch):
    import app as routes
    preview = event_roster(genders=('M',), officials=('A','B'))
    # The crown belongs to an athlete, including an athlete requesting a single.
    preview['rooms'].append(dict(person1Key='M', roomType='Single'))
    recalculate_fis_import_preview(preview)
    session = session_for(preview)
    monkeypatch.setattr(routes, 'current_user', lambda: SimpleNamespace(username='reviewer'))
    initial = sum(q['singleRoomsPending'] for q in preview['quotaChecks'])
    for reason, expected in [('WORLD_CHAMPION', initial - 1), (None, initial)]:
        with current_app.test_request_context(json={'reason':reason}):
            response = routes.stage_single_room_quota_exemption(session.id, 'M')
            assert response.status_code == 200
        canonical = response.get_json()['preview']
        person = next(p for p in canonical['people'] if p['matchKey']=='M')
        assert person['singleRoomQuotaExemptReason'] == reason
        assert sum(q['singleRoomsPending'] for q in canonical['quotaChecks']) == expected
        assert PREVIEW_STORE['review-token']['quotaChecks'] == canonical['quotaChecks']
    assert ImportSessionEvent.query.filter_by(event_type='WORLD_CHAMPION_MANUAL').count() == 2
    assert {json.loads(a.changes_json)['source'] for a in AuditEvent.query.all()} == {'MANUAL_SET','MANUAL_REMOVE'}


def test_reference_admin_crud_and_team_default(database):
    from routes.world_champions import champions, champion
    preview = event_roster(genders=('M',), officials=())
    payload = dict(eventId=preview['eventId'], fisCode='1234567', name='Verified athlete', nation='AUT',
        gender='M', discipline='SX', eventGroup='Ski Cross', championship='Engadin', championshipYear=2025,
        titleType='TEAM', entitlementEnabled=False, active=True, source='verified evidence')
    with current_app.test_request_context(method='POST', json=payload):
        response, status = champions(); assert status == 201
    row_id = int(response.get_json()['id'])
    with current_app.test_request_context(method='PUT', json={'active':False}):
        response, status = champion(row_id); assert status == 200
    assert not response.get_json()['active']
    assert not response.get_json()['entitlementEnabled']
    with current_app.test_request_context(method='PUT', json={'entitlementEnabled':True}):
        _, status = champion(row_id); assert status == 400


def test_excel_fis_integer_format_is_exact_identity(database):
    preview = event_roster(genders=('M',), officials=())
    reference(preview['eventId'], fis_code='1234567')
    person = preview['people'][0]; person['fisCode']='1234567.0'
    apply_single_room_quota_exemptions([person], event_id=str(preview['eventId']))
    assert person['singleRoomQuotaExemptReason'] == 'WORLD_CHAMPION'
    person['fisCode']='1234568.0'
    apply_single_room_quota_exemptions([person], event_id=str(preview['eventId']))
    assert person['singleRoomQuotaExemptReason'] is None


def test_automatic_status_and_manual_removal_survive_actual_confirmation(database, monkeypatch):
    import app as routes
    preview = event_roster(genders=('M',), officials=())
    preview['rooms'] = [dict(person1Key='M', roomType='Single')]
    reference(preview['eventId'])
    recalculate_fis_import_preview(preview)
    PREVIEW_STORE['auto'] = deepcopy(preview)
    confirm_fis_import('auto')
    athlete = Athlete.query.filter_by(fis_code='M').one()
    assert athlete.single_room_quota_exempt_reason == 'WORLD_CHAMPION'
    assert athlete.single_room_exemption_source == 'AUTO_REFERENCE'
    automatic = AuditEvent.query.filter_by(entity_type='world-champion-status').one()
    evidence = json.loads(automatic.changes_json)
    assert evidence['fisCode'] == 'M' and evidence['references'][0]['championshipYear'] == 2025
    monkeypatch.setattr(routes, 'current_user', lambda: SimpleNamespace(username='reviewer'))
    for reason, source in [(None,'MANUAL_REMOVE'),('WORLD_CHAMPION','MANUAL_SET')]:
        with current_app.test_request_context(json={}):
            assert routes._update_athlete_operations(athlete, {'singleRoomQuotaExemptReason':reason}).status_code == 200
        incoming = deepcopy(preview)
        recalculate_fis_import_preview(incoming)
        PREVIEW_STORE['again'] = incoming
        confirm_fis_import('again')
        athlete = Athlete.query.filter_by(fis_code='M').one()
        assert athlete.single_room_quota_exempt_reason == reason
        assert athlete.single_room_exemption_source == source


def test_staged_manual_removal_survives_replacement_upload(database, monkeypatch):
    import io
    import app as routes
    preview = event_roster(genders=('M',), officials=())
    reference(preview['eventId'])
    recalculate_fis_import_preview(preview)
    session = session_for(preview)
    monkeypatch.setattr(routes, 'current_user', lambda: SimpleNamespace(username='reviewer'))
    with current_app.test_request_context(json={'reason':None}):
        assert routes.stage_single_room_quota_exemption(session.id, 'M').status_code == 200
    replacement = json.loads(json.dumps(preview, default=str))
    replacement['previewToken'] = 'replacement'
    PREVIEW_STORE['replacement'] = deepcopy(preview)
    monkeypatch.setattr(routes, 'create_fis_import_preview', lambda *args: deepcopy(replacement))
    with current_app.test_request_context(method='POST', data={'eventId':str(preview['eventId']),
            'sessionId':str(session.id), 'entriesList':(io.BytesIO(b'new entries'), 'entries.xlsx'),
            'roomListDetailed':(io.BytesIO(b'new rooms'), 'rooms.xlsx')}):
        response, status = routes.preview_fis_import()
        assert status == 200
    assert response.get_json()['people'][0]['singleRoomQuotaExemptReason'] is None
    assert response.get_json()['people'][0]['singleRoomExemptionSource'] == 'MANUAL_REMOVE'
    assert PREVIEW_STORE['replacement']['singleRoomQuotaExemptOverrides'] == {'M':None}
