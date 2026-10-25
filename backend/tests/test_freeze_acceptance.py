"""Real PostgreSQL acceptance for additive history, active rules and title links."""
import json
from copy import deepcopy
import pytest
from app import app
from models import db,Event,EventQuotaRevision,WorldChampion,WorldChampionRecognition,Athlete,ImportApproval,ImportSession,ImportSessionVersion,RoomBooking
from quota_rules import rule_projection,standard_rules
from test_event_accommodation_isolation import inventory,snapshot
from test_import_event_identity import events,session
from test_safe_reimport import upload
from imports.workflow import require_review,refresh_plan
from athlete_quota import quota_rows

pytestmark=pytest.mark.explicit_event_ownership


def activate(event,mutate,world=True):
    app.config['OPERATIONAL_EVENT_ID']=str(event.id)
    config=json.loads(event.quota_rules_json);mutate(config)
    payload=dict(config=config,isWorldChampionship=world,reason='Reviewed correction',expectedDigest=rule_projection(event)['digest'],expectedRevision=event.quota_rules_revision)
    client=app.test_client();base=f'/api/admin/events/{event.id}/quota-rules/'
    preview=client.post(base+'revision-preview',json=payload)
    assert preview.status_code==200,preview.json
    return client.post(base+'revisions',json={**payload,'confirm':True,'confirmationDigest':preview.json['confirmationDigest']})


def test_revision_keeps_people_bookings_and_all_approval_evidence(inventory):
    a,b,*_=inventory;s=session(a)
    approval=ImportApproval(session_id=s.id,version_id=s.current_version_id,nation='JPN',approval_type='NATION_APPROVED',decision='APPROVED',description='Historical evidence',username='test',quota_details_json='{"untouched": true}')
    db.session.add(approval);db.session.commit()
    before={model.__name__:snapshot(model) for model in (Athlete,ImportApproval,ImportSession,ImportSessionVersion,RoomBooking,WorldChampion)}
    result=activate(a,lambda c:c['athletes']['Snowboard'].update(totalLimit=40,genderLimit=22))
    assert result.status_code==200,result.json
    assert db.session.get(Event,a.id).quota_rules_revision==2
    assert db.session.get(Event,b.id).quota_rules_revision==1
    for model in (Athlete,ImportApproval,ImportSession,ImportSessionVersion,RoomBooking,WorldChampion):assert snapshot(model)==before[model.__name__]
    assert [r.revision for r in EventQuotaRevision.query.filter_by(event_id=a.id).order_by(EventQuotaRevision.revision)]==[1,2]
    old=db.session.get(EventQuotaRevision,(a.id,1));old.reason='tampered'
    with pytest.raises(ValueError,match='append-only'):db.session.flush()
    db.session.rollback()


@pytest.mark.parametrize('limit,expected',[(40,0),(2,2)])
def test_active_quota_limits_are_current_without_reusing_old_grant(inventory,limit,expected):
    a,*_=inventory
    people=[dict(matchKey=str(i),firstname='Person',lastname=str(i),function='Athlete',nationCode='JPN',gender='M' if i%2 else 'W',athleteQuotaFamilies=['Snowboard'],competitionIds=['1','2']) for i in range(4)]
    before=quota_rows(people,standard_rules(),a.id,revision=1)[0]
    assert activate(a,lambda c:c['athletes']['Snowboard'].update(totalLimit=limit,genderLimit=min(20,limit))).status_code==200
    row=quota_rows(people,json.loads(a.quota_rules_json),a.id,revision=2)[0]
    assert row['athleteQuotaUsed']==4 and row['requiredExtent']['total']==expected
    assert row['evidence']['scopeDigest']!=before['evidence']['scopeDigest']


def test_stale_open_review_requires_recheck_but_history_is_not_rewritten(inventory):
    a,*_=inventory;app.config['OPERATIONAL_EVENT_ID']=str(a.id)
    payload=upload(a);s=db.session.get(ImportSession,int(payload['session']['id']));before=s.current_version.preview_json;old_id=s.current_version_id
    assert activate(a,lambda c:c['officials'].update(allowance=3)).status_code==200
    with pytest.raises(Exception,match='Quotenregeln wurden geändert'):require_review(s)
    assert db.session.get(ImportSessionVersion,old_id).preview_json==before
    # Existing explicit recheck workflow forks a version; direct refresh is not a GET.
    response=app.test_client().post(f'/api/import/sessions/{s.id}/recheck');assert response.status_code==200,response.json
    db.session.expire_all()
    assert s.current_version_id!=old_id
    assert json.loads(s.current_version.preview_json)['quotaRulesRevision']==2
    assert db.session.get(ImportSessionVersion,old_id).preview_json==before


def test_title_links_are_event_specific_and_no_title_is_copied(inventory):
    from world_champions import recognize
    a,b,*_=inventory;app.config['OPERATIONAL_EVENT_ID']=str(a.id)
    title=WorldChampion(event_id=a.id,fis_code='9300953',name='Reference',nation='JPN',gender='M',discipline='Snowboard',event_group='Snowboard Cross',championship='Source Championship',championship_year=2025,title_type='INDIVIDUAL',entitlement_enabled=True,active=True,source='verified fixture')
    db.session.add(title);db.session.flush();db.session.add(WorldChampionRecognition(event_id=a.id,title_id=title.id,active=True));db.session.commit()
    def reason(owner):
        person=dict(matchKey='9300953',function='Athlete',fisCode='9300953');recognize(person,None,{},owner);return person['singleRoomQuotaExemptReason']
    assert reason(a.id)=='WORLD_CHAMPION' and reason(b.id) is None
    app.config['OPERATIONAL_EVENT_ID']=str(b.id)
    response=app.test_client().post(f'/api/admin/events/{b.id}/world-champions',json={'titleId':title.id,'active':True})
    assert response.status_code==200,response.json
    assert reason(b.id)=='WORLD_CHAMPION' and WorldChampion.query.count()==1
    s=session(b)
    assert app.test_client().post(f'/api/admin/events/{b.id}/world-champions',json={'titleId':title.id,'active':False}).status_code==409
    assert reason(b.id)=='WORLD_CHAMPION'


@pytest.mark.parametrize('minority',['M','W'])
def test_minority_gender_does_not_imply_a_pricing_or_ez_exemption(inventory,minority):
    from test_event_accommodation_isolation import payload
    from models import RoomBookingOccupant
    a,b,_,room,people,*_=inventory
    person=people[0][2]
    for other in people[0]:other.gender=minority if other==person else ('W' if minority=='M' else 'M')
    person.single_room_status='NONE';person.room_type='Double shared';db.session.commit()
    response=app.test_client().post('/api/room-assignments',json=payload(inventory,[person]))
    assert response.status_code==201,response.json
    booking=RoomBooking.query.filter_by(event_id=a.id,room_number='02').one()
    assert room.max_persons==2 and len(booking.occupants)==1
    assert booking.counts_as_single is False
    assert person.single_room_quota_exempt_reason is None
    assert person.single_room_status=='NONE'
    assert person.accommodation_rate_category=='STANDARD'
    assert person.single_room_decision_id is None


def test_revision_confirmation_cas_and_normal_editor_protection(inventory):
    from test_multi_event_access import headers
    a,*_=inventory;app.config['OPERATIONAL_EVENT_ID']=str(a.id)
    client=app.test_client();config=json.loads(a.quota_rules_json);config['officials']['allowance']=3
    data=dict(config=config,isWorldChampionship=True,reason='Reviewed correction',expectedDigest=rule_projection(a)['digest'],expectedRevision=1)
    base=f'/api/admin/events/{a.id}/quota-rules/'
    # Dev test identity has explicit legacy write grants but lacks admin functions.
    original=app.config['AUTH_DEV_GROUPS'];app.config['AUTH_DEV_GROUPS']='incoming-editor'
    try:assert client.post(base+'revision-preview',json=data).status_code==403
    finally:app.config['AUTH_DEV_GROUPS']=original
    proposal=client.post(base+'revision-preview',json=data).json
    assert client.post(base+'revisions',json={**data,'confirm':True,'confirmationDigest':'tampered'}).status_code==409
    assert a.quota_rules_revision==1
    assert client.post(base+'revisions',json={**data,'confirm':True,'confirmationDigest':proposal['confirmationDigest']}).status_code==200
    assert client.post(base+'revisions',json={**data,'confirm':True,'confirmationDigest':proposal['confirmationDigest']}).status_code==409
    assert EventQuotaRevision.query.filter_by(event_id=a.id).count()==2


def test_legacy_title_fallback_does_not_disappear_when_another_event_recognizes_it(inventory):
    from world_champions import recognize
    a,b,*_=inventory
    title=WorldChampion(event_id=a.id,fis_code='9876543',name='Legacy source',nation='JPN',gender='M',discipline='Snowboard',event_group='Snowboard Cross',championship='Source',championship_year=2025,title_type='INDIVIDUAL',entitlement_enabled=True,active=True,source='fixture')
    db.session.add(title);db.session.commit()
    def crown(owner):
        p=dict(matchKey='9876543',function='Athlete',fisCode='9876543');recognize(p,None,{},owner);return p['singleRoomQuotaExemptReason']
    assert crown(a.id)=='WORLD_CHAMPION' and crown(b.id) is None
    db.session.add(WorldChampionRecognition(event_id=b.id,title_id=title.id,active=True));db.session.commit()
    assert crown(a.id)=='WORLD_CHAMPION' and crown(b.id)=='WORLD_CHAMPION'


@pytest.mark.quota_rule_lifecycle
def test_event_creation_validation_is_visible_and_does_not_clone_operative_data(inventory):
    from models import AthleteCompetition,EventRoomDemand,HotelRoomInventory
    a,*_=inventory;client=app.test_client();header={'X-Championship-Event-ID':str(a.id)}
    protected=(Athlete,AthleteCompetition,ImportSession,ImportApproval,RoomBooking,HotelRoomInventory,EventRoomDemand)
    before={m.__name__:snapshot(m) for m in protected}
    for payload in ({},{'name':123},{'name':'x'*161},{'name':'Bad year','year':'2027'},{'name':'Bad active','active':'yes'},['not-an-object']):
        assert client.post('/api/admin/events',headers=header,json=payload).status_code==400
    duplicate=client.post('/api/admin/events',headers=header,json={'name':a.name})
    assert duplicate.status_code==409 and duplicate.json['error']=='EVENT_NAME_EXISTS'
    result=client.post('/api/admin/events',headers=header,json={'name':'New isolated Championship','active':False,'year':2028})
    assert result.status_code==201
    assert result.json['quotaRules']['status']=='DRAFT' and not result.json['active']
    assert result.json['id']!=str(a.id)
    for m in protected:assert snapshot(m)==before[m.__name__]


def test_event_id_conflict_is_not_misreported_as_duplicate_name(inventory):
    from sqlalchemy import text,func
    a,*_=inventory
    before=snapshot(Event)
    # Explicit failure injection only in the already validated disposable PG fixture.
    try:
        db.session.execute(text("SELECT setval(pg_get_serial_sequence('championship_event','id'),1,false)"));db.session.commit()
        result=app.test_client().post('/api/admin/events',headers={'X-Championship-Event-ID':str(a.id)},json={'name':'Unique name, conflicting sequence'})
        assert result.status_code==409 and result.json['error']=='EVENT_ID_CONFLICT'
        assert snapshot(Event)==before
    finally:
        db.session.rollback()
        maximum=db.session.query(func.max(Event.id)).scalar()
        db.session.execute(text("SELECT setval(pg_get_serial_sequence('championship_event','id'),:n,true)"),{'n':maximum});db.session.commit()


def test_reimport_preserves_existing_ez_price_decision_without_covering_new_quota(inventory):
    from models import Competition
    from excel_import import PREVIEW_STORE,confirm_fis_import
    from quota_history import applicable_approval_groups
    from datetime import datetime
    a,b,_,_,people,*_=inventory
    comp=Competition.query.filter_by(import_code='WSC_PGS_M_6170').one()
    athlete,official=people[0][0],people[0][3]
    for p in people[0]:p.competitions=[comp]
    official.room_type='Single'
    s=session(a);s.nation='LAT'
    decision=ImportApproval(session_id=s.id,version_id=s.current_version_id,nation='LAT',approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED',decision='APPROVED',description='Historical paid EZ',username='test',approved_person_keys_json=json.dumps([official.fis_code]),quota_details_json=json.dumps(dict(eventId=a.id,rulesRevision=1,quotaMembershipVersion=2,nationCode='LAT',discipline=comp.quota_discipline,gender='M',singleRoomCandidates=[dict(personKey=official.fis_code,competitionIds=[str(comp.id)])])))
    db.session.add(decision);db.session.flush()
    official.single_room_status='APPROVED_EXTRA';official.single_room_entitlement='APPROVED_EXTRA';official.single_room_decision_id=decision.id;db.session.commit()
    old=snapshot(ImportApproval)
    assert activate(a,lambda c:c['officials'].update(allowance=3)).status_code==200
    assert not applicable_approval_groups(decision,official)
    assert applicable_approval_groups(decision,official,preserve_historical_rule=True)
    def person(p):
        return dict(matchKey=p.fis_code,fisCode=p.fis_code,firstname=p.firstname,lastname=p.lastname,nationCode='LAT',gender='M',function=p.function,competitionIds=[str(comp.id)],quotaDisciplines=[comp.quota_discipline],athleteQuotaFamilies=['Snowboard'],arrivalDate=p.arrival_date,departureDate=p.departure_date)
    PREVIEW_STORE['freeze-historical-price']=dict(createdAt=datetime.utcnow(),eventId=a.id,errors=[],warnings=[],people=[person(p) for p in people[0]],rooms=[{'person1Key':p.fis_code,'person2Key':None,'roomType':'Single' if p==official else 'Double shared'} for p in people[0]])
    confirm_fis_import('freeze-historical-price')
    assert official.single_room_status=='APPROVED_EXTRA' and official.single_room_decision_id==decision.id
    assert snapshot(ImportApproval)==old


def test_superadmin_can_read_reference_catalogue_without_global_backup_permission(inventory,monkeypatch):
    a,*_=inventory
    monkeypatch.setitem(app.config,'SUPERADMIN_USERNAME','owner')
    monkeypatch.setitem(app.config,'AUTH_PROXY_SECRET','freeze-test-secret')
    monkeypatch.setitem(app.config,'AUTH_DEV_USER','')
    supplied={'X-Authenticated-User':'owner','X-Authenticated-Groups':'unknown','X-Auth-Proxy-Secret':'freeze-test-secret','X-Championship-Event-ID':str(a.id)}
    client=app.test_client()
    assert client.get('/api/admin/world-champion-titles',headers=supplied).status_code==200
    assert client.get('/api/admin/database/backups',headers=supplied).status_code==403
