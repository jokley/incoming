"""PR8 real PostgreSQL/HTTP acceptance; one app, no mutable event configuration."""
import json
from concurrent.futures import ThreadPoolExecutor
import pytest
from app import app
from models import db, EventAccess, Athlete, RoomBooking, AuditEvent, ImportApproval
from test_import_event_identity import events, session
from test_event_accommodation_isolation import inventory, snapshot

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.explicit_event_access]
HEADER = 'X-Championship-Event-ID'


@pytest.fixture
def workspace(inventory, monkeypatch):
    a,b,*_ = inventory
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', None)
    monkeypatch.setitem(app.config, 'AUTH_DEV_USER', '')
    monkeypatch.setitem(app.config, 'AUTH_PROXY_SECRET', 'pr8-test-secret')
    db.session.add_all([EventAccess(username='both',event_id=a.id,can_write=True),
        EventAccess(username='both',event_id=b.id,can_write=True),
        EventAccess(username='only-a',event_id=a.id,can_write=True),
        EventAccess(username='reader',event_id=a.id,can_write=False)])
    db.session.commit()
    return inventory


def headers(user='both', owner=None, role='incoming-admin'):
    result={'X-Auth-Proxy-Secret':'pr8-test-secret','X-Authenticated-User':user,'X-Authenticated-Groups':role}
    if owner is not None: result[HEADER]=str(owner)
    return result


def test_bootstrap_grants_are_explicit_even_for_admin(workspace):
    a,b,*_=workspace; client=app.test_client()
    for user, ids in [('both',[a.id,b.id]),('only-a',[a.id]),('reader',[a.id]),('ungranted',[])]:
        result=client.get('/api/active-event-context',headers=headers(user)).json
        assert {e['id'] for e in result['events']}==set(map(str,ids))
        assert result['switchingAllowed']==(len(ids)>1)
        if user=='reader': assert not result['events'][0]['canWrite']
    assert client.get('/api/active-event-context',headers=headers('only-a',b.id)).status_code==403


@pytest.mark.parametrize('path',['/api/athletes','/athletes/','/api/audit-events','/api/import/sessions',
    '/api/hotels','/api/events','/api/room-bookings/grouped','/api/quota-rules',
    '/api/analytics/room-availability'])
def test_missing_foreign_and_revoked_contexts_fail_closed(workspace,path):
    a,b,*_=workspace; client=app.test_client()
    assert client.get(path,headers=headers()).status_code==409
    assert client.get(path,headers=headers('only-a',b.id)).status_code==403
    assert client.get(path,headers=headers('ungranted',a.id)).status_code==403
    assert client.get(path,headers=headers('both',a.id)).status_code==200
    db.session.query(EventAccess).filter_by(username='both',event_id=a.id).delete();db.session.commit()
    assert client.get(path,headers=headers('both',a.id)).status_code==403


def test_a_b_a_and_concurrent_users_use_request_owner(workspace):
    a,b,_,_,people,*_=workspace
    def read(owner):
        with app.test_client() as client:
            response=client.get('/api/athletes',headers=headers('only-a' if owner==a.id else 'both',owner))
            assert response.status_code==200
            return {r['id'] for r in response.json}
    for owner,index in [(a.id,0),(b.id,1),(a.id,0)]:
        assert read(owner)=={str(p.id) for p in people[index]}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(read,[a.id,b.id]*4))
    assert results==[{str(p.id) for p in people[i%2]} for i in range(8)]
    assert app.config['OPERATIONAL_EVENT_ID'] is None


def test_foreign_ids_and_writes_do_not_change_data_or_audit(workspace):
    a,b,_,_,people,bookings,_=workspace; client=app.test_client()
    foreign=session(b)
    decision=ImportApproval(session_id=foreign.id,version_id=foreign.current_version_id,nation='JPN',
        approval_type='NATION_APPROVED',description='B',decision='APPROVED',username='test')
    db.session.add(decision);db.session.commit()
    before=snapshot(Athlete)+snapshot(RoomBooking)+snapshot(AuditEvent)
    for path in [f'/api/athletes/{people[1][0].id}',f'/api/import/sessions/{foreign.id}',f'/api/import/approvals/{decision.id}']:
        assert client.get(path,headers=headers(owner=a.id)).status_code in {404,409}
    assert client.post(f'/api/assignments/bookings/{bookings[1].id}/unassign',headers=headers(owner=a.id),json={}).status_code in {404,409}
    for user,role in [('reader','incoming-admin'),('both','incoming-viewer')]:
        assert client.put(f'/api/athletes/{people[0][0].id}',headers=headers(user,a.id,role),json={'internalNote':'forbidden'}).status_code==403
    assert snapshot(Athlete)+snapshot(RoomBooking)+snapshot(AuditEvent)==before


def test_own_write_and_audit_follow_event_not_deployment(workspace):
    a,b,_,_,people,*_=workspace; client=app.test_client()
    for owner,index in [(a,0),(b,1)]:
        response=client.put(f'/api/athletes/{people[index][0].id}',headers=headers(owner=owner.id),json={'internalNote':f'event-{owner.id}'})
        assert response.status_code==200,response.json
    for owner in (a,b,a):
        rows=client.get('/api/audit-events',headers=headers(owner=owner.id)).json['items']
        assert len(rows)==1
        assert rows[0]['entityRefs']['championshipEventId']==str(owner.id)


def test_request_fields_and_admin_target_must_match(workspace):
    a,b,*_=workspace;client=app.test_client()
    for path in ['/api/athletes','/api/import/sessions']:
        assert client.get(path,headers=headers(owner=a.id),query_string={'eventId':b.id}).status_code==409
    assert client.post('/api/import/fis/preview',headers=headers(owner=a.id),data={'eventId':b.id}).status_code==409
    assert client.get(f'/api/admin/events/{b.id}/quota-rules',headers=headers(owner=a.id)).status_code==409
    assert client.get('/api/admin/events',headers=headers('only-a',a.id)).json[0]['id']==str(a.id)
    assert len(client.get('/api/admin/events',headers=headers('only-a',a.id)).json)==2


def test_operator_cli_grants_and_revokes_without_implicit_admin_access(workspace):
    a,*_=workspace;client=app.test_client();runner=app.test_cli_runner()
    assert client.get('/api/athletes',headers=headers('cli-user',a.id)).status_code==403
    result=runner.invoke(args=['event-access','grant','cli-user',str(a.id)])
    assert result.exit_code==0,result.output
    assert client.get('/api/athletes',headers=headers('cli-user',a.id)).status_code==200
    assert client.post('/api/hotels',headers=headers('cli-user',a.id),json={'name':'Denied'}).status_code==403
    assert runner.invoke(args=['event-access','revoke','cli-user',str(a.id)]).exit_code==0
    assert client.get('/api/athletes',headers=headers('cli-user',a.id)).status_code==403


def test_pinned_bootstrap_operator_recovery_is_explicit_and_repeatable(workspace, monkeypatch):
    a,b,*_=workspace
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(a.id))
    client=app.test_client(); runner=app.test_cli_runner()
    user='Actual.Authelia-User'
    identity=client.get('/api/auth/me',headers=headers(user))
    assert identity.status_code==200
    assert identity.json['username']==user
    denied=client.get('/api/active-event-context',headers=headers(user))
    assert denied.status_code==403
    assert denied.json['error']=='EVENT_ACCESS_DENIED'
    before={(r.username,r.event_id):r.can_write for r in db.session.query(EventAccess).all()}
    for mode in ['--read-only','--read-only','--write','--write','--read-only']:
        result=runner.invoke(args=['event-access','grant',user,str(a.id),mode])
        assert result.exit_code==0,result.output
        assert db.session.query(EventAccess).filter_by(username=user,event_id=a.id).count()==1
        response=client.get('/api/active-event-context',headers=headers(user))
        assert response.status_code==200
        assert response.json['selectedEventId']==str(a.id)
        assert response.json['switchingAllowed'] is False
        assert [r['id'] for r in response.json['events']]==[str(a.id)]
        assert response.json['events'][0]['canWrite']==(mode=='--write')
        # Nonexistent person: write grant passes authorization to 404; reader stops at 403.
        assert client.put('/api/athletes/999999',headers=headers(user),json={}).status_code==(404 if mode=='--write' else 403)
    assert client.get('/api/active-event-context',headers=headers(user.lower())).status_code==403
    assert client.get('/api/active-event-context',headers=headers('ungranted')).status_code==403
    assert client.get('/api/athletes',headers=headers(user,b.id)).status_code==409
    for _ in range(2):
        assert runner.invoke(args=['event-access','revoke',user,str(a.id)]).exit_code==0
        assert client.get('/api/active-event-context',headers=headers(user)).status_code==403
    assert {(r.username,r.event_id):r.can_write for r in db.session.query(EventAccess).all()}==before


def test_identity_cannot_be_obtained_through_untrusted_proxy_headers(workspace):
    client=app.test_client()
    for secret in [None, 'wrong-secret']:
        supplied=headers()
        if secret is None: supplied.pop('X-Auth-Proxy-Secret')
        else: supplied['X-Auth-Proxy-Secret']=secret
        for path in ['/api/auth/me','/api/active-event-context']:
            assert client.get(path,headers=supplied).status_code==401


def test_global_backups_use_administrative_authority_not_individual_event_grants(workspace):
    a,b,*_=workspace;client=app.test_client()
    for path in ['/api/admin/scenarios','/api/import/fis/mock-files']:
        assert client.get(path,headers=headers('only-a',b.id)).status_code==403
    assert client.get('/api/admin/database/backups',headers=headers('only-a',b.id)).status_code==200
    assert client.get('/api/admin/database/backups',headers=headers('reader',a.id,'incoming-viewer')).status_code==403
    assert client.post('/api/admin/database/restore',headers=headers('both',a.id),json={}).status_code==400


def test_every_registered_api_method_rejects_unauthorized_explicit_event(workspace):
    """Inventory the actual route map, including aliases, uploads and downloads."""
    import re
    a,b,*_=workspace; client=app.test_client(); checked=[]
    canonical={rule.rule for rule in app.url_map.iter_rules() if rule.rule.startswith('/api/')}
    for rule in app.url_map.iter_rules():
        if rule.rule not in canonical and '/api'+rule.rule not in canonical:
            continue
        if rule.rule in {'/api/auth/me','/api/active-event-context'}:
            continue
        path=re.sub(r'<(?:[^:>]+:)?[^>]+>', '1', rule.rule)
        for method in sorted(rule.methods-{'OPTIONS','HEAD'}):
            response=client.open(path,method=method,headers=headers('only-a',b.id,'incoming-editor'),json={})
            assert response.status_code==403,(method,path,response.status_code,response.get_json(silent=True))
            checked.append((method,path))
    assert len(checked)>100


def test_grants_do_not_allow_reassigning_world_champion_or_import_evidence(workspace):
    from flask import g
    from auth import load_user_from_request
    from event_ownership_runtime import bind_request_event, OperationalEventError
    from models import WorldChampion, ImportSessionVersion
    a,b,*_=workspace
    foreign=session(b)
    with app.test_request_context('/api/import/test',method='POST',headers=headers(owner=a.id)):
        g.current_user=load_user_from_request();g.api_path='/api/import/test';g.authorized_event_id=None
        bind_request_event()
        db.session.add(ImportSessionVersion(session_id=foreign.id,version=2,uploaded_by='both'))
        with pytest.raises(OperationalEventError):db.session.flush()
        db.session.rollback()
        db.session.add(WorldChampion(event_id=b.id,fis_code='100',name='Foreign',nation='JPN',gender='M',discipline='Snowboard',event_group='Snowboard Cross',championship='Test',championship_year=2025,title_type='INDIVIDUAL',source='test'))
        with pytest.raises(OperationalEventError):db.session.flush()
        db.session.rollback()
