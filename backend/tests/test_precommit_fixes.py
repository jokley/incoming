"""Regressions limited to the six final pre-commit review issues."""
from test_support import import_review_payload

import io
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from flask import current_app
from test_physical_single_room_allocation import database, event_roster, book_officials
from test_world_champion_workflow import reference, session_for
from models import Athlete, AuditEvent, ImportApproval, RoomBooking, db
from excel_import import PREVIEW_STORE, confirm_fis_import, recalculate_fis_import_preview, quota_requirement_errors


def replace_upload(routes, monkeypatch, session, preview):
    incoming = deepcopy(preview)
    incoming['singleRoomQuotaExemptOverrides'] = {}
    incoming['carriedSingleRoomQuotaExemptKeys'] = []
    incoming['_currentApprovalIds'] = []
    recalculate_fis_import_preview(incoming)
    PREVIEW_STORE['replacement'] = incoming
    response = json.loads(json.dumps(incoming, default=str))
    response['previewToken'] = 'replacement'
    monkeypatch.setattr(routes, 'create_fis_import_preview', lambda *args, **kwargs: deepcopy(response))
    with current_app.test_request_context(method='POST', data={'eventId':str(preview['eventId']),
            'sessionId':str(session.id), 'entriesList':(io.BytesIO(b'replacement entries'), 'entries.xlsx'),
            'roomListDetailed':(io.BytesIO(b'replacement rooms'), 'rooms.xlsx')}):
        result, status = routes.preview_fis_import()
        assert status == 200
    return result.get_json()


@pytest.mark.parametrize('old, new', [('AUTO_REFERENCE',None), ('WORLD_CHAMPION',None), (None,'WORLD_CHAMPION')])
def test_newer_persisted_manual_decision_wins_over_imported_preview(database, monkeypatch, old, new):
    import app as routes
    preview = event_roster(genders=('M',), officials=())
    reference(preview['eventId'])
    recalculate_fis_import_preview(preview)
    session = session_for(preview)
    monkeypatch.setattr(routes, 'current_user', lambda: SimpleNamespace(username='reviewer'))
    if old != 'AUTO_REFERENCE':
        with current_app.test_request_context(json={'reason':old}):
            assert routes.stage_single_room_quota_exemption(session.id,'M').status_code == 200
    confirm_fis_import('review-token', confirmer='first-confirmer')
    session.status='IMPORTED'; db.session.commit()
    athlete = Athlete.query.filter_by(fis_code='M').one()
    with current_app.test_request_context(json={}):
        assert routes._update_athlete_operations(athlete,{'singleRoomQuotaExemptReason':new}).status_code == 200
    result = replace_upload(routes,monkeypatch,session,preview)
    assert result['people'][0]['singleRoomQuotaExemptReason'] == new
    confirm_fis_import('replacement',confirmer='second-confirmer')
    athlete = Athlete.query.filter_by(fis_code='M').one()
    assert athlete.single_room_quota_exempt_reason == new
    assert athlete.single_room_exemption_source == ('MANUAL_SET' if new else 'MANUAL_REMOVE')


def retained_preview():
    preview=event_roster(genders=('M',),officials=('A','B','C'))
    preview['rooms']=[]
    recalculate_fis_import_preview(preview)
    PREVIEW_STORE['initial']=deepcopy(preview)
    confirm_fis_import('initial')
    book_officials()
    recalculate_fis_import_preview(preview)
    return preview


def approve_next(routes, session, keys):
    pending=next(a for a in session.current_approvals if a.decision=='PENDING')
    with current_app.test_request_context(json={'decision':'APPROVED','approvalType':'NATION_APPROVED',
            'approvalBy':'Team','approvalDate':'2026-10-14T10:00:00Z','approvedPersonKeys':keys}):
        response=routes.decide_import_approval(session.id,pending.id)
        assert response.status_code==200
    return response.get_json()['preview'], pending


def test_retained_singles_partial_approval_resolves_only_selected_people(database, monkeypatch):
    import app as routes
    preview=retained_preview()
    assert sum(q['singleRoomsPending'] for q in preview['quotaChecks'])==2
    session=session_for(preview)
    monkeypatch.setattr(routes,'current_user',lambda:SimpleNamespace(username='confirmer'))
    with current_app.test_request_context():
        routes.reconcile_single_room_tasks(session); db.session.commit()
    current,first=approve_next(routes,session,['A'])
    frozen=(first.quota_details_json, first.approved_person_keys_json)
    fields=first.to_dict()['quotaDetails']
    assert (fields['decisionKind'],fields['ezRequested'],fields['ezEntitlement'],fields['ezExcess'])==('SINGLE_ROOM',3,1,2)
    assert sum(q['singleRoomsPending'] for q in current['quotaChecks'])==1
    assert next(p for p in current['people'] if p['matchKey']=='A')['singleRoomEntitlement']=='APPROVED_EXTRA'
    remaining=next(a for a in session.current_approvals if a.decision=='PENDING')
    assert 'A' not in {p['personKey'] for p in json.loads(remaining.quota_details_json)['singleRoomCandidates']}
    with current_app.test_request_context():
        assert routes.approve_import_session(session.id)[1]==409
    current,second=approve_next(routes,session,['B'])
    assert sum(q['singleRoomsPending'] for q in current['quotaChecks'])==0
    assert not quota_requirement_errors(current,session.current_approvals)
    assert (first.quota_details_json,first.approved_person_keys_json)==frozen
    with current_app.test_request_context(json=import_review_payload(session)):
        assert routes.approve_import_session(session.id).status_code==200
    before=[(b.id,b.counts_as_single) for b in RoomBooking.query.all()]
    confirm_fis_import('review-token',{'A':first.id,'B':second.id},confirmer='confirmer')
    assert [(b.id,b.counts_as_single) for b in RoomBooking.query.all()]==before
    assert Athlete.query.filter_by(single_room_status='APPROVED_EXTRA').count()==2
    db.session.commit()  # Low-level apply no longer owns the transaction.
    # A persisted valid approval covers retained demand even with no incoming Single.
    recalculate_fis_import_preview(preview)
    assert sum(q['singleRoomsPending'] for q in preview['quotaChecks'])==0
    # Removing physical demand leaves the immutable decisions, without demand credit.
    for booking in RoomBooking.query.all(): booking.counts_as_single=False
    db.session.commit()
    recalculate_fis_import_preview(preview)
    assert sum(q['singleRoomsRequested'] for q in preview['quotaChecks'])==0
    assert db.session.get(ImportApproval,first.id).quota_details_json==frozen[0]


@pytest.mark.parametrize('evidence', ['exact','no_event','wrong_event','no_competition'])
def test_legacy_decision_event_compatibility_requires_exact_evidence(database, evidence):
    import app as routes
    preview=event_roster(genders=('M',),officials=('A','B'))
    recalculate_fis_import_preview(preview)
    session=session_for(preview)
    issue=next(w for w in preview['warnings'] if w['code']=='QUOTA_SINGLE_ROOMS_EXCEEDED')
    details=deepcopy(issue['details']); details.pop('eventId')
    if evidence=='no_competition':
        for p in details['singleRoomCandidates']:
            p.pop('competitionIds'); p.pop('competitionImportCodes')
    if evidence in {'no_event','wrong_event'}:
        saved=json.loads(session.current_version.preview_json)
        if evidence=='no_event': saved.pop('eventId')
        else: saved['eventId']=preview['eventId']+100
        session.current_version.preview_json=json.dumps(saved)
    decision=ImportApproval(session_id=session.id,version_id=session.current_version_id,nation='AUT',
        approval_type='NATION_APPROVED',description='Legacy EZ',decision='APPROVED',username='original',
        quota_details_json=json.dumps(details),approved_person_keys_json='["A"]')
    db.session.add(decision); db.session.commit()
    frozen=(decision.quota_details_json,decision.approved_person_keys_json,decision.created_at)
    assert bool(quota_requirement_errors(preview,[decision])) == (evidence not in {'exact','no_event'})
    if evidence=='exact':
        current=routes._current_session_preview(session)
        assert sum(q['singleRoomsPending'] for q in current['quotaChecks'])==0
    assert (decision.quota_details_json,decision.approved_person_keys_json,decision.created_at)==frozen


def test_confirmation_audit_records_confirmer_not_uploader(database, monkeypatch):
    import app as routes
    preview=event_roster(genders=('M',),officials=())
    reference(preview['eventId'])
    recalculate_fis_import_preview(preview)
    session=session_for(preview)
    session.current_version.uploaded_by='different-uploader'; db.session.commit()
    monkeypatch.setattr(routes,'current_user',lambda:SimpleNamespace(username='actual-confirmer'))
    with current_app.test_request_context(json=import_review_payload(session)):
        released=routes.approve_import_session(session.id)
        assert not isinstance(released,tuple), released[0].get_json() if isinstance(released,tuple) else ''
        assert released.status_code==200
        result=routes.import_approved_session(session.id)
        assert result.status_code==200
    status_audits=AuditEvent.query.filter_by(entity_type='world-champion-status').all()
    assert status_audits and {a.username for a in status_audits}=={'actual-confirmer'}
    assert session.current_version.uploaded_by=='different-uploader'


def test_new_review_command_survives_upload_until_a_newer_live_edit(database, monkeypatch):
    import app as routes
    preview=event_roster(genders=('M',),officials=())
    reference(preview['eventId'])
    recalculate_fis_import_preview(preview)
    session=session_for(preview)
    confirm_fis_import('review-token',confirmer='original')
    monkeypatch.setattr(routes,'current_user',lambda:SimpleNamespace(username='reviewer'))
    athlete=Athlete.query.filter_by(fis_code='M').one()
    with current_app.test_request_context(path=f'/api/athletes/{athlete.id}',json={}):
        routes._update_athlete_operations(athlete,{'singleRoomQuotaExemptReason':'WORLD_CHAMPION'})
    with current_app.test_request_context(path=f'/api/import/sessions/{session.id}/single-room-exemptions/M',json={'reason':None}):
        assert routes.stage_single_room_quota_exemption(session.id,'M').status_code==200
    replacement=replace_upload(routes,monkeypatch,session,preview)
    assert replacement['people'][0]['singleRoomQuotaExemptReason'] is None
    # Even a reaffirmation of the earlier live value is a newer deliberate edit.
    with current_app.test_request_context(path=f'/api/athletes/{athlete.id}',json={}):
        routes._update_athlete_operations(athlete,{'singleRoomQuotaExemptReason':'WORLD_CHAMPION'})
    current=routes._current_session_preview(session)
    assert current['people'][0]['singleRoomQuotaExemptReason']=='WORLD_CHAMPION'
