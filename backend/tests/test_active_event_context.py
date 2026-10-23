"""PR6 capability bootstrap and explicit UI-header boundary, real PG/test HTTP."""
import json
import pytest
from test_import_event_identity import events, session
from test_event_accommodation_isolation import inventory, snapshot
from models import db, Athlete, RoomBooking, ImportApproval
from app import app

pytestmark = pytest.mark.explicit_event_ownership
HEADER = 'X-Championship-Event-ID'


def test_only_configured_operational_event_is_offered(inventory):
    a,b,*_=inventory
    response=app.test_client().get('/api/active-event-context')
    assert response.status_code==200,response.json
    assert response.json=={'events':[{**a.to_dict(),'canRead':True,'canWrite':True}],
        'selectedEventId':str(a.id),'switchingAllowed':False}
    assert b.name not in json.dumps(response.json)


@pytest.mark.parametrize('role,write',[('incoming-viewer',False),('incoming-editor',True),('incoming-admin',True)])
def test_capabilities_reuse_existing_permissions(inventory,monkeypatch,role,write):
    monkeypatch.setitem(app.config,'AUTH_DEV_USER','')
    monkeypatch.setitem(app.config,'AUTH_PROXY_SECRET','context-test-secret')
    response=app.test_client().get('/api/active-event-context',headers={
        'X-Auth-Proxy-Secret':'context-test-secret','X-Authenticated-User':'context-user','X-Authenticated-Groups':role})
    assert response.status_code==200,response.json
    assert response.json['events'][0]['canWrite']==write
    assert response.json['events'][0]['canRead'] is True


def test_bootstrap_is_authenticated_and_missing_configuration_never_chooses_first(inventory,monkeypatch):
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',None)
    assert app.test_client().get('/api/active-event-context').status_code==409
    monkeypatch.setitem(app.config,'AUTH_DEV_USER','')
    assert app.test_client().get('/api/active-event-context',headers={HEADER:'not-an-id'}).status_code==401


def test_inactive_context_is_not_offered_after_earlier_request(inventory):
    a,*_=inventory;client=app.test_client()
    assert client.get('/api/active-event-context').status_code==200
    a.active=False;db.session.commit()
    assert client.get('/api/active-event-context').status_code==409


@pytest.mark.parametrize('path',['/api/athletes','/athletes/','/api/fis/official-quotas',
    '/api/import/sessions','/api/room-bookings/grouped','/api/hotels','/api/events',
    '/api/analytics/room-availability','/api/analytics/occupancy-timeline','/api/audit-events','/api/active-event-context'])
def test_foreign_header_is_rejected_on_every_workspace_source(inventory,path):
    a,b,*_=inventory;client=app.test_client()
    assert client.get(path,headers={HEADER:str(a.id)}).status_code==200
    assert client.get(path,headers={HEADER:str(b.id)}).status_code==409


@pytest.mark.parametrize('value',['','0','1.0','true','-1'])
def test_invalid_explicit_header_never_falls_back(inventory,value):
    assert app.test_client().get('/api/athletes',headers={HEADER:value}).status_code==409


def test_foreign_objects_remain_blocked_under_valid_header(inventory):
    a,b,hotel,rt,people,bookings,_=inventory;client=app.test_client();headers={HEADER:str(a.id)}
    foreign=session(b)
    approval=ImportApproval(session_id=foreign.id,version_id=foreign.current_version_id,nation='JPN',
        approval_type='NATION_APPROVED',description='Foreign',decision='APPROVED',username='test')
    db.session.add(approval);db.session.commit()
    before=snapshot(Athlete)+snapshot(RoomBooking)+snapshot(ImportApproval)
    for path in [f'/api/athletes/{people[1][0].id}',f'/api/import/sessions/{foreign.id}',f'/api/import/approvals/{approval.id}']:
        assert client.get(path,headers=headers).status_code in {404,409}
    assert client.post(f'/api/assignments/bookings/{bookings[1].id}/unassign',headers=headers,json={}).status_code in {404,409}
    assert snapshot(Athlete)+snapshot(RoomBooking)+snapshot(ImportApproval)==before
    assert client.get('/api/room-types',headers=headers).status_code==200
    assert client.get('/api/competitions',headers=headers).status_code==200


def test_header_query_form_and_session_must_agree(inventory):
    a,b,*_=inventory;client=app.test_client();headers={HEADER:str(a.id)}
    assert client.get('/api/import/sessions',headers=headers,query_string={'eventId':b.id}).status_code==409
    assert client.post('/api/import/fis/preview',headers=headers,data={'eventId':b.id}).status_code==409
    response=client.post('/api/import/fis/preview',headers=headers,data={})
    assert response.status_code==400
    assert response.json['error']!='EVENT_REQUIRED'  # Canonical header alone supplies context.


def test_explicit_deployment_switch_does_not_cache_previous_capabilities(inventory,monkeypatch):
    a,b,*_=inventory;client=app.test_client()
    for owner in (a,b,a):
        monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(owner.id))
        assert client.get('/api/active-event-context',headers={HEADER:str(owner.id)}).json['selectedEventId']==str(owner.id)
        assert client.get('/api/athletes',headers={HEADER:str(owner.id)}).json[0]['lastname']==f'Event{owner.id}'


def test_foreign_header_rejects_mutations_before_write_or_audit(inventory):
    from models import AuditEvent
    a,b,_,_,people,bookings,_=inventory;client=app.test_client()
    before=snapshot(Athlete)+snapshot(RoomBooking)+snapshot(AuditEvent)
    response=client.put(f'/api/athletes/{people[0][0].id}',headers={HEADER:str(b.id)},json={'internalNote':'forbidden'})
    assert response.status_code==409,response.json
    assert snapshot(Athlete)+snapshot(RoomBooking)+snapshot(AuditEvent)==before


def test_real_jpn_full_http_workflow_with_central_header(events, monkeypatch):
    """Same real-workbook PR3 acceptance with the PR6 header on every HTTP step."""
    from test_safe_reimport import test_real_jpn_durable_workflow_and_same_file_recheck
    from models import AthleteCompetition, ImportSession, ImportSessionVersion
    a, b = events
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(a.id))
    original_client = app.test_client
    observed = []

    def scoped_client(*args, **kwargs):
        client = original_client(*args, **kwargs)
        client.environ_base['HTTP_X_CHAMPIONSHIP_EVENT_ID'] = str(a.id)
        original_open = client.open

        def recorded_open(*args, **kwargs):
            response = original_open(*args, **kwargs)
            observed.append((response.request.path, response.request.headers.get(HEADER), response.status_code))
            return response

        client.open = recorded_open
        return client

    monkeypatch.setattr(app, 'test_client', scoped_client)
    test_real_jpn_durable_workflow_and_same_file_recheck(events)
    assert all(owner == str(a.id) and status == 200 for _, owner, status in observed)
    assert any(path.endswith('/approve') for path, _, _ in observed)
    assert any('/approvals/' in path for path, _, _ in observed)
    assert sum(path.endswith('/import') for path, _, _ in observed) == 2
    assert Athlete.query.filter_by(event_id=a.id).count() == 64
    assert Athlete.query.filter_by(event_id=b.id).count() == 0
    assert {row.event_id for row in ImportSession.query.all()} == {a.id}
    for version in ImportSessionVersion.query.all():
        assert str(json.loads(version.preview_json)['eventId']) == str(a.id)
    memberships = [(row.athlete_id, row.competition_id) for row in AthleteCompetition.query.all()]
    assert len(memberships) == len(set(memberships))
    print('PR6 JPN HTTP: explicit header on all', len(observed), 'requests; 64 people; confirm + reimport; no duplicate memberships')
