"""Final global-admin boundary, edition selection and snapshot contracts."""
import json
from unittest.mock import patch,MagicMock
import pytest
from app import app
from models import db,Event,WorldChampion,WorldChampionRecognition,Athlete,ImportApproval,ImportSession,AuditEvent
from test_import_event_identity import events,session
from test_event_accommodation_isolation import inventory
from test_multi_event_access import workspace,headers
from world_champions import recognize

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.explicit_event_access]

@pytest.fixture
def admin(workspace,monkeypatch):
    a,b,*_=workspace
    monkeypatch.setitem(app.config,'SUPERADMIN_USERNAME','owner')
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(a.id))
    monkeypatch.setitem(app.config,'DATABASE_MAINTENANCE_MODE',False)
    return workspace

@pytest.mark.parametrize('user,role',[('owner','unknown'),('global-admin','incoming-admin')])
def test_global_backup_authority_never_grants_operative_event_access(admin,user,role):
    a,b,*_=admin;c=app.test_client();h=headers(user,role=role)
    h['X-Request-ID']='x'*100  # App trace IDs may exceed the audit column width.
    upstream=MagicMock(status=202);upstream.read.return_value=b'{"status":"accepted"}'
    with patch('database_admin.urllib.request.urlopen') as remote:
        remote.return_value.__enter__.return_value=upstream
        assert c.post('/api/admin/database/backup',headers=h).status_code==202
        assert c.post('/api/admin/database/restore',headers=h,json={'token':'x','confirmation':'RESTORE DATABASE'}).status_code==202
        assert remote.call_count==2
    assert c.get('/api/athletes',headers=headers(user,b.id,role)).status_code==409
    assert AuditEvent.query.filter_by(entity_type='global-database').count()==1

@pytest.mark.parametrize('user,role',[('owner','unknown'),('global-admin','incoming-admin')])
def test_configure_other_championship_without_switch_or_data_grants(admin,user,role):
    a,b,*_=admin;c=app.test_client();h=headers(user,b.id,role)
    b.active=False;db.session.commit()
    assert c.get(f'/api/admin/events/{b.id}',headers=h).status_code==200
    assert c.put(f'/api/admin/events/{b.id}',headers=h,json={'name':'Future configured'}).status_code==200
    assert c.get(f'/api/admin/events/{b.id}/quota-rules',headers=h).status_code==200
    assert c.get(f'/api/admin/events/{b.id}/quota-rules/revisions',headers=h).status_code==200
    assert len(c.get('/api/admin/events',headers=headers(user,a.id,role)).json)==2
    assert c.get(f'/api/admin/events/{b.id}',headers=headers(user,a.id,role)).status_code==409
    assert c.get('/api/athletes',headers=h).status_code==409
    assert c.get('/api/import/sessions',headers=h).status_code==409
    assert app.config['OPERATIONAL_EVENT_ID']==str(a.id)
    assert c.get(f'/api/admin/events/{b.id}',headers=headers('reader',b.id,'incoming-editor')).status_code==403


def test_restore_requires_confirmation_but_delegates_automatic_maintenance(admin,monkeypatch):
    c=app.test_client();h=headers('owner',role='unknown')
    with patch('database_admin.delegate',return_value=({'state':'QUEUED','operationId':'job'},202)) as delegate:
        assert c.post('/api/admin/database/restore',headers=h,json={'token':'x'}).status_code==400
        delegate.assert_not_called()
        assert c.post('/api/admin/database/restore',headers=h,json={'token':'x','confirmation':'RESTORE DATABASE'}).status_code==202
        assert delegate.call_args.args[0]=='/restore-jobs'
        assert json.loads(delegate.call_args.args[1])['actor']=='owner'
    assert c.post('/api/admin/test-data/reset',headers=h,json={'scope':'assignments','confirmed':True}).status_code==200


def title_list(owner):
    rows=[WorldChampion(event_id=owner.id,fis_code=str(9000000+i),name=f'Title {i}',nation='JPN',gender='M',discipline=f'Competition {i}',event_group='Snowboard Cross',championship='Engadin',championship_year=2025,title_type='INDIVIDUAL',entitlement_enabled=True,active=True,source='verified synthetic fixture') for i in range(35)]
    db.session.add_all(rows);db.session.commit();return rows


def test_whole_35_title_list_selection_no_copy_wm_gate_and_historical_protection(admin):
    a,b,*_=admin;rows=title_list(a);c=app.test_client()
    endpoint=lambda owner:f'/api/admin/events/{owner.id}/world-champion-list'
    for owner in (a,b):
        h=headers('owner',owner.id,'unknown');current=c.get(endpoint(owner),headers=h).json
        response=c.put(endpoint(owner),headers=h,json={'listId':'2025:Engadin','digest':current['digest']})
        assert response.status_code==200,response.json
        assert WorldChampion.query.count()==35
        assert WorldChampionRecognition.query.filter_by(event_id=owner.id,active=True).count()==35
    def crown(owner,index=0):
        p={'matchKey':rows[index].fis_code,'fisCode':rows[index].fis_code,'function':'Athlete'}
        recognize(p,None,{},owner.id);return p['singleRoomQuotaExemptReason']
    assert crown(a) is None and crown(b) is None
    db.session.execute(db.update(Event).where(Event.id==a.id).values(is_world_championship=True));db.session.commit()
    assert crown(a)=='WORLD_CHAMPION' and crown(b) is None
    rows[0].active=False;rows[1].entitlement_enabled=False;db.session.commit()
    assert crown(a,0) is None and crown(a,1) is None and crown(a,2)=='WORLD_CHAMPION'
    # Historical import evidence blocks destructive list changes; no auto status rewrite.
    session(a);before=WorldChampionRecognition.query.filter_by(event_id=a.id,active=True).count()
    h=headers('owner',a.id,'unknown');current=c.get(endpoint(a),headers=h).json
    assert c.put(endpoint(a),headers=h,json={'listId':None,'digest':current['digest']}).status_code==409
    assert WorldChampionRecognition.query.filter_by(event_id=a.id,active=True).count()==before
    assert WorldChampion.query.count()==35


def test_partial_existing_links_are_not_presented_as_a_complete_list(admin):
    a,b,*_=admin;rows=title_list(a)
    db.session.add(WorldChampionRecognition(event_id=b.id,title_id=rows[0].id,active=True));db.session.commit()
    c=app.test_client();h=headers('owner',b.id,'unknown')
    state=c.get(f'/api/admin/events/{b.id}/world-champion-list',headers=h).json
    assert state['partial'] and state['listId'] is None
    assert WorldChampionRecognition.query.count()==1


def test_whole_list_keeps_team_titles_as_references_not_ez_exemptions(admin):
    a,b,*_=admin;rows=title_list(a)
    for title in rows[-9:]:title.title_type='TEAM';title.entitlement_enabled=False
    db.session.commit();c=app.test_client();h=headers('owner',b.id,'unknown')
    lists=c.get('/api/admin/world-champion-lists',headers=h).json
    assert lists[0]['titleCount']==35 and lists[0]['eligibleCount']==26
    endpoint=f'/api/admin/events/{b.id}/world-champion-list'
    state=c.get(endpoint,headers=h).json
    assert c.put(endpoint,headers=h,json={'listId':'2025:Engadin','digest':state['digest']}).status_code==200
    assert WorldChampion.query.count()==35
    assert WorldChampionRecognition.query.filter_by(event_id=b.id,active=True).count()==35
    db.session.execute(db.update(Event).where(Event.id==b.id).values(is_world_championship=True));db.session.commit()
    person={'matchKey':rows[-1].fis_code,'fisCode':rows[-1].fis_code,'function':'Athlete'}
    recognize(person,None,{},b.id)
    assert person['singleRoomQuotaExemptReason'] is None


def test_reset_is_explicit_maintenance_scoped_and_keeps_foreign_bookings(admin,monkeypatch):
    from models import RoomBooking
    a,b,*_=admin;c=app.test_client()
    monkeypatch.setitem(app.config,'DATABASE_MAINTENANCE_MODE',True)
    h=headers('both',a.id,'incoming-admin')  # functional admin plus explicit EventAccess write grant
    original=RoomBooking.query.count()
    assert c.post('/api/admin/test-data/reset',headers=h,json={'scope':'assignments'}).status_code==400
    assert c.post('/api/admin/test-data/reset',headers=headers('global-admin',b.id),json={'scope':'assignments','confirmation':'RESET EVENT DATA'}).status_code==409
    assert RoomBooking.query.count()==original
    blocked=c.post('/api/admin/test-data/reset',headers=h,json={'scope':'activities','confirmation':'RESET EVENT DATA'})
    assert blocked.status_code==200
    assert blocked.json['counts']['workflowEvents']==0
    response=c.post('/api/admin/test-data/reset',headers=h,json={'scope':'assignments','confirmation':'RESET EVENT DATA'})
    assert response.status_code==200,response.json
    assert RoomBooking.query.filter_by(event_id=a.id).count()==0
    assert RoomBooking.query.filter_by(event_id=b.id).count()==1
    assert Athlete.query.filter_by(event_id=a.id).count()==4
    assert Athlete.query.filter_by(event_id=b.id).count()==4
