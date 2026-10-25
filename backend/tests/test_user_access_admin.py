"""PR9: actual PostgreSQL and proxy-authenticated users, two championships."""
import json
import pytest
from app import app
from models import db, Event, EventAccess, UserReference, AuditEvent
from test_multi_event_access import workspace, headers, inventory, events
from user_access import grant_revision, grant_state
pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.explicit_event_access]

@pytest.fixture
def admin(workspace,monkeypatch):
    monkeypatch.setitem(app.config,'SUPERADMIN_USERNAME','owner')
    return workspace

def test_superadmin_sees_future_events_and_keeps_a_b_a_isolated(admin):
    a,b,_,_,people,*_=admin;c=app.test_client()
    for event,index in [(a,0),(b,1),(a,0)]:
        assert {p['id'] for p in c.get('/api/athletes',headers=headers('owner',event.id,'unknown')).json}=={str(p.id) for p in people[index]}
        assert c.put(f'/api/athletes/{people[index][0].id}',headers=headers('owner',event.id,'unknown'),json={'internalNote':'PR9'}).status_code==200
    created=c.post('/api/admin/events',headers=headers('owner',role='unknown'),json={'name':'Future event'})
    assert created.status_code==201
    context=c.get('/api/active-event-context',headers=headers('owner',role='unknown')).json
    assert {e['id'] for e in context['events']}=={str(a.id),str(b.id),created.json['id']}
    assert context['switchingAllowed'] and all(e['canWrite'] for e in context['events'])
    assert EventAccess.query.filter_by(username='owner').count()==0
    assert c.get('/api/athletes',headers=headers('ungranted',a.id)).status_code==403

def test_exact_verified_identity_pin_and_inactive_events(admin,monkeypatch):
    a,b,*_=admin;c=app.test_client();bad=headers('owner',a.id);bad['X-Auth-Proxy-Secret']='wrong'
    assert c.get('/api/active-event-context',headers=bad).status_code==401
    assert c.get('/api/athletes',headers=headers('Owner',a.id)).status_code==403
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(a.id))
    context=c.get('/api/active-event-context',headers=headers('owner')).json
    assert [e['id'] for e in context['events']]==[str(a.id)] and not context['switchingAllowed']
    assert c.get('/api/athletes',headers=headers('owner',b.id)).status_code==409
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',None);b.active=False;db.session.commit()
    assert c.get('/api/athletes',headers=headers('owner',b.id)).status_code==403
    assert c.get(f'/api/admin/events/{b.id}',headers=headers('owner',b.id)).status_code==200
    monkeypatch.setitem(app.config,'AUTH_PROXY_SECRET','');monkeypatch.setitem(app.config,'AUTH_DEV_USER','owner')
    assert c.get('/api/auth/me').json['isSuperadmin'] is False

def test_global_database_operations_stay_separately_guarded(admin,monkeypatch,tmp_path):
    a,b,*_=admin;c=app.test_client()
    monkeypatch.setitem(app.config,'BACKUP_DIR',str(tmp_path))
    monkeypatch.setitem(app.config,'DATABASE_MAINTENANCE_MODE',False)
    for user,role in [('owner','unknown'),('ungranted','incoming-admin')]:
        supplied=headers(user,role=role)
        assert c.get('/api/admin/database/backups',headers=supplied).status_code==200
        status=c.get('/api/admin/database/status',headers=supplied)
        assert status.status_code in {200,503}
        assert status.json['capabilities']['create'] and status.json['capabilities']['download']
        assert not status.json['capabilities']['restore'] and not status.json['capabilities']['reset']
        assert c.get('/api/admin/database/backups/manual/test.dump.gz',headers=supplied).status_code==404
        assert c.post('/api/admin/database/restore',headers=supplied,json={'confirmation':'RESTORE DATABASE','token':'x'}).status_code==409
        assert c.post('/api/admin/test-data/reset',headers=headers(user,a.id,role),json={'scope':'all','confirmation':'RESET EVENT DATA'}).status_code==409
    for role in ('unknown','incoming-viewer','incoming-editor'):
        for path,method in [('/api/admin/database/backups','GET'),('/api/admin/database/backup','POST'),('/api/admin/database/restore','POST'),('/api/admin/test-data/reset','POST')]:
            assert c.open(path,method=method,headers=headers('reader',a.id,role)).status_code==403
    assert c.get('/api/admin/database/backups').status_code==401


def test_directory_hints_and_manual_references_never_grant_rights(admin):
    a,*_=admin;c=app.test_client()
    assert c.get('/api/auth/me',headers=headers('new-viewer',role='incoming-viewer')).status_code==200
    assert db.session.get(UserReference,'new-viewer') is None
    assert c.post('/api/auth/me',headers=headers('new-viewer',role='incoming-viewer')).status_code==200
    assert db.session.get(UserReference,'new-viewer').last_seen_at
    assert grant_state('new-viewer')=={}
    response=c.post('/api/admin/users',headers=headers('owner',a.id),json={'username':'manual','displayName':'Name'})
    assert response.status_code==201 and grant_state('manual')=={}
    assert db.session.get(UserReference,'manual').groups_json is None
    assert c.post('/api/admin/users',headers=headers('owner',a.id),json={'username':'bad','permissions':['*']}).status_code==400
    db.session.get(UserReference,'manual').groups_json='["admin"]';db.session.commit()
    assert c.get('/api/auth/me',headers=headers('manual',role='unknown')).json['permissions']==[]

def test_normal_admin_cannot_escalate_and_superadmin_cannot_self_lock(admin):
    a,*_=admin;c=app.test_client()
    for user in ['both','reader','ungranted']:
        supplied=headers(user,a.id);supplied['X-Superadmin']='true'
        assert c.get('/api/admin/users',headers=supplied).status_code==403
        assert c.put('/api/admin/users/grants',headers=headers(user,a.id),json={}).status_code==403
    assert c.put('/api/admin/users/grants',headers=headers('owner',a.id),json={'username':'owner','expectedRevision':grant_revision('owner'),'grants':{str(a.id):'NONE'}}).status_code==400
    assert c.get('/api/athletes',headers=headers('owner',a.id)).status_code==200

def test_superadmin_cannot_deactivate_last_or_pinned_workspace(admin,monkeypatch):
    a,b,*_=admin;c=app.test_client()
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(a.id))
    assert c.put(f'/api/admin/events/{a.id}',headers=headers('owner',a.id),json={'active':False}).status_code==409
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',None)
    b.active=False;db.session.commit()
    assert c.put(f'/api/admin/events/{a.id}',headers=headers('owner',a.id),json={'active':False}).status_code==409
    assert db.session.get(Event,a.id).active

def test_grants_atomic_audited_cas_and_immediate_revocation(admin):
    a,b,*_=admin;c=app.test_client();old=grant_revision('reader')
    def save(grants,revision=old):
        return c.put('/api/admin/users/grants',headers=headers('owner',a.id),json={'username':'reader','expectedRevision':revision,'grants':grants})
    assert save({str(a.id):'WRITE',str(b.id):'READ'}).status_code==200
    assert c.put('/api/athletes/99999',headers=headers('reader',a.id),json={}).status_code==404
    assert c.put('/api/athletes/99999',headers=headers('reader',a.id,'incoming-viewer'),json={}).status_code==403
    assert c.put('/api/athletes/99999',headers=headers('reader',b.id),json={}).status_code==403
    assert save({str(a.id):'NONE'}).status_code==409
    before=grant_state('reader');count=AuditEvent.query.count()
    assert save({str(a.id):'NONE','999999':'WRITE'},grant_revision('reader')).status_code==400
    assert grant_state('reader')==before and AuditEvent.query.count()==count
    assert save({str(a.id):'NONE'},grant_revision('reader')).status_code==200
    assert c.get('/api/athletes',headers=headers('reader',a.id)).status_code==403
    audits=AuditEvent.query.filter_by(entity_type='event_access').all();assert len(audits)==3
    assert all(json.loads(r.entity_refs_json)['championshipEventId'] in {str(a.id),str(b.id)} for r in audits)

def test_bootstrap_review_preserves_restrictions_idempotence_no_future_wildcard(admin):
    a,b,*_=admin;r=app.test_cli_runner();db.session.add(UserReference(username='new'));db.session.commit()
    args=['event-access','bootstrap','--username','reader','--username','new','--write']
    preview=r.invoke(args=args);assert preview.exit_code==0,preview.output
    plan=json.loads(preview.output);assert grant_state('new')=={}
    assert {c['eventId'] for c in plan['changes'] if c['username']=='new'}=={a.id,b.id}
    applied=r.invoke(args=[*args,'--apply',plan['digest']]);assert applied.exit_code==0,applied.output
    assert grant_state('reader')[str(a.id)]=='READ' and len(grant_state('new'))==2
    assert r.invoke(args=[*args,'--apply',plan['digest']]).exit_code!=0
    repeat=json.loads(r.invoke(args=args).output);assert repeat['changes']==[]
    assert r.invoke(args=[*args,'--apply',repeat['digest']]).exit_code==0
    future=Event(name='Not granted automatically');db.session.add(future);db.session.commit()
    assert str(future.id) not in grant_state('new')
    assert r.invoke(args=['event-access','bootstrap','--username','unknown']).exit_code!=0

def test_audit_failure_rolls_back_grant(admin,monkeypatch):
    import user_access
    a,*_=admin;c=app.test_client();before=grant_state('reader')
    def fail(*args):raise ValueError('Audit unavailable')
    monkeypatch.setattr(user_access,'audit_access',fail)
    result=c.put('/api/admin/users/grants',headers=headers('owner',a.id),json={'username':'reader','expectedRevision':grant_revision('reader'),'grants':{str(a.id):'WRITE'}})
    assert result.status_code==400 and grant_state('reader')==before
