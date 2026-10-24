"""PR7 lifecycle, isolation and admission approvals against disposable PostgreSQL."""
import json
from copy import deepcopy
from datetime import datetime
import pytest
from test_import_event_identity import events
from test_safe_reimport import upload,review,run
from app import app
from models import db,Event,Athlete,ImportSession,ImportApproval,RoomBooking,AuditEvent
from quota_rules import standard_rules,validate_rules,rules_for_event
from quota_service import evaluate_athlete_quota_usage,evaluate_quota_usage

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


def bind(event,config=None):
    event.quota_rules_json=json.dumps(config or standard_rules())
    event.quota_rules_fixed_at=datetime(2026,10,23);event.quota_rules_revision=1
    event.quota_rules_fixed_by='explicit-test';db.session.commit()
    app.config['OPERATIONAL_EVENT_ID']=str(event.id)


def endpoint(event):return f'/api/admin/events/{event.id}/quota-rules'


def draft(event,config=None):
    app.config['OPERATIONAL_EVENT_ID']=str(event.id)
    client=app.test_client();data=client.get(endpoint(event)).json
    result=client.put(endpoint(event),json={'config':config or standard_rules(),'expectedDigest':data['digest'],'isWorldChampionship':True})
    assert result.status_code==200,result.json
    return result.json


def fix(event,state):
    return app.test_client().post(endpoint(event)+'/fix',json={'confirm':True,'expectedDigest':state['digest'],'preflightFingerprint':state['preflight']['fingerprint']})


def test_draft_fix_and_immutable_api_orm(events):
    a,b=events;state=draft(a)
    assert app.test_client().get('/api/quota-rules').json['status']=='DRAFT'
    assert fix(a,state).status_code==200
    assert rules_for_event(a.id)==standard_rules()
    assert app.test_client().put(endpoint(a),json={'config':standard_rules(),'expectedDigest':state['digest']}).status_code==409
    assert fix(a,state).status_code==409
    assert app.test_client().put(f'/api/admin/events/{a.id}',json={'quotaRules':{}}).status_code==400
    a.quota_rules_revision=2
    with pytest.raises(ValueError):db.session.flush()
    db.session.rollback()
    assert db.session.get(Event,b.id).quota_rules_fixed_at is None
    assert AuditEvent.query.filter_by(entity_type='event-quota-rules').count()==2


@pytest.mark.parametrize('mutate',[
    lambda c:c.update(schemaVersion=2),lambda c:c.update(extra=True),
    lambda c:c['athletes']['Snowboard'].update(totalLimit=-1),
    lambda c:c['athletes']['Snowboard'].update(enabled='true'),
    lambda c:c['officials'].update(allowance=True),lambda c:c['officials'].update(model='eval'),
    lambda c:c.update(singleRooms=[]),lambda c:c['singleRooms'][1].update(upTo=2),
    lambda c:c['singleRooms'][0].update(upTo=None),lambda c:c['singleRooms'][-1].update(upTo=9)])
def test_strict_schema(mutate):
    config=standard_rules();mutate(config)
    with pytest.raises(ValueError):validate_rules(config)


def test_missing_fixed_rules_block_import_and_live(events):
    a,b=events;app.config['OPERATIONAL_EVENT_ID']=str(a.id)
    with pytest.raises(Exception,match='Quotenregeln'):upload(a)
    assert app.test_client().get('/api/fis/official-quotas').status_code==409
    assert app.test_client().get('/api/fis/athlete-quotas').status_code==409


def test_stale_fix_and_unsafe_legacy_approvals_block_without_delete(events):
    a,b=events;state=draft(a)
    from test_import_event_identity import session
    s=session(a);approval=ImportApproval(session_id=s.id,version_id=s.current_version_id,nation='JPN',approval_type='NATION_APPROVED',decision='APPROVED',description='Historical',username='test')
    db.session.add(approval);db.session.commit()
    assert fix(a,state).status_code==409
    current=app.test_client().get(endpoint(a)).json
    assert current['preflight']['blockers']
    assert fix(a,current).json['error']=='QUOTA_INITIALIZATION_BLOCKED'
    assert ImportApproval.query.count()==1 and ImportSession.query.count()==1


def test_different_event_parameters_preserve_zero_athlete_semantics(events):
    a,b=events;config=standard_rules();config['officials']['allowance']=5;config['singleRooms']=[{'upTo':None,'rooms':7}]
    bind(a);bind(b,config)
    p={'personId':1,'matchKey':'p','nationCode':'JPN','function':'Athlete','gender':'M','quotaDisciplines':['Snowboard Alpine','Snowboard Cross']}
    first=evaluate_quota_usage([p],rules=rules_for_event(a.id));second=evaluate_quota_usage([p],rules=rules_for_event(b.id))
    assert all(r['officialQuota']==3 and r['singleRoomsAllowed']==1 for r in first)
    assert all(r['officialQuota']==6 and r['singleRoomsAllowed']==7 for r in second)
    assert evaluate_quota_usage([],rules=config)==[]
    p['quotaDisciplines'].append('Freestyle')
    assert [r['athleteQuotaUsed'] for r in evaluate_athlete_quota_usage([p,p],config)]==[1,1]


def decision(session_id,approval_id,extent,keys=None):
    return app.test_client().patch(f'/api/import/sessions/{session_id}/approvals/{approval_id}',json={
        'decision':'APPROVED','approvalType':'NATION_APPROVED','approvalBy':'FIS test',
        'approvalMethod':'EMAIL','approvalDate':'2026-10-23T12:00:00Z','approvedExtent':extent,
        'approvedPersonKeys':keys or [],'costCoverage':'Evidence only'})


def test_partial_overlapping_approval_confirm_and_identical_reimport(events):
    a,b=events;bind(a)
    codes=[str(9000000+i) for i in range(40)]
    def genders(people):
        for i,p in enumerate(people):p['Gender']='M' if i<21 else 'F'
    current=upload(a,codes=codes,changed=genders);s=current['session'];sid=s['id']
    q=current['athleteQuotaChecks'][0]
    assert q['requiredExtent']=={'total':4,'M':1,'F':0}
    task=next(p for p in s['approvals'] if p['quotaDetails'].get('decisionKind')=='ATHLETE_QUOTA')
    assert task['approvedPersonKeys']==[]
    assert 'QUOTA_PASSED' not in {event['type'] for event in s['history']}
    assert 'QUOTA_VIOLATION' in {event['type'] for event in s['history']}
    assert review(current,a).status_code==409
    partial=decision(sid,task['id'],{'total':2,'M':1,'F':0})
    assert partial.status_code==200,partial.json
    remaining=next(p for p in partial.json['approvals'] if p['decision']=='PENDING')
    assert remaining['quotaDetails']['uncoveredExtent']=={'total':2,'M':0,'F':0}
    assert review(current,a).status_code==409
    done=decision(sid,remaining['id'],{'total':2,'M':0,'F':0},[codes[0]])
    assert done.status_code==200,done.json
    result=run(current,a);assert result['summary']['peopleCreated']==40
    assert not RoomBooking.query.count()
    assert all(p.accommodation_rate_category=='STANDARD' and p.single_room_status!='APPROVED_EXTRA' for p in Athlete.query.all())
    repeated=upload(a,codes=codes,changed=genders)
    assert repeated['athleteQuotaChecks'][0]['decisionStatus']=='APPROVED'
    run(repeated,a)
    assert Athlete.query.count()==40 and Athlete.query.filter_by(event_id=b.id).count()==0
    def replacement(people):
        genders(people);people[-1]['Firstname']='Replacement'
    replaced=upload(a,codes=codes[:-1]+['9999999'],changed=replacement)
    assert replaced['athleteQuotaChecks'][0]['decisionStatus']=='PENDING'
    assert review(replaced,a,True).status_code==409
    assert ImportApproval.query.filter_by(decision='APPROVED').count()==2


@pytest.mark.parametrize('m,f,status',[(20,16,'WITHIN_BASE_LIMITS'),(21,15,'EXCEEDED'),(20,17,'EXCEEDED'),(20,20,'EXCEEDED')])
def test_boundary_counts_distinct_and_tariffs_irrelevant(m,f,status):
    config=standard_rules()
    people=[dict(personId=i,nationCode='JPN',function='Athlete',gender='M' if i<m else 'F',
        quotaDisciplines=['Snowboard Alpine','Snowboard Cross'],accommodationRequirement='NO_ROOM',
        accommodationRateCategory='SPECIAL',countsAsSingle=False) for i in range(m+f)]
    before=deepcopy(people)
    row=evaluate_athlete_quota_usage(people+deepcopy(people),config)[0]
    assert row['athleteQuotaUsed']==m+f and row['athleteQuotaStatus']==status
    assert people==before


@pytest.mark.parametrize('extent',[{'total':-1,'M':0,'F':0},{'total':True,'M':0,'F':0},{'total':5,'M':0,'F':0},{'total':0,'M':0,'F':0},{'total':1}])
def test_invalid_exception_extent_is_rejected(extent):
    from athlete_quota import validated_extent
    with pytest.raises(ValueError):validated_extent({'uncoveredExtent':{'total':4,'M':1,'F':0},'candidates':[]},{'approvedExtent':extent})


def test_unknown_family_and_invalid_gender_block_preview(events,monkeypatch):
    from test_import_event_identity import preview,rows
    from models import Competition
    a,_=events;bind(a)
    data=rows();data.loc[0,'Gender']='A'
    result=preview(a,monkeypatch,data)
    assert not result['isValid']
    assert any(e['code']=='ENTRY_QUOTA_GENDER_INVALID' for e in result['errors'])
    competition=Competition.query.filter_by(import_code='WSC_BA_M_6182').one()
    competition.sport='Unsupported';competition.quota_discipline='Unsupported';db.session.commit()
    result=preview(a,monkeypatch,rows())
    assert not result['isValid']
    assert any(e['code']=='ATHLETE_QUOTA_FAMILY_UNKNOWN' for e in result['errors'])


def test_disabled_family_and_http_event_isolation(events):
    from test_import_event_identity import person
    from models import Competition
    a,b=events;config=standard_rules();config['athletes']['Snowboard']['enabled']=False;config['officials']['allowance']=9
    bind(a);bind(b,config)
    c=Competition.query.filter_by(import_code='WSC_PGS_M_6170').one()
    person(a,competitions=[c],function='Athlete',gender='M');person(b,competitions=[c],function='Athlete',gender='M')
    app.config['OPERATIONAL_EVENT_ID']=str(a.id)
    client=app.test_client()
    assert client.get('/api/fis/athlete-quotas').json[0]['athleteQuotaUsed']==1
    assert client.get('/api/fis/official-quotas').json[0]['officialQuota']==3
    assert client.get('/api/fis/athlete-quotas',headers={'X-Championship-Event-ID':str(b.id)}).status_code==409
    app.config['OPERATIONAL_EVENT_ID']=str(b.id)
    assert client.get('/api/fis/athlete-quotas').json==[]
    assert client.get('/api/fis/official-quotas').json[0]['officialQuota']==10
    app.config['OPERATIONAL_EVENT_ID']=str(a.id)
    assert client.get('/api/fis/official-quotas').json[0]['officialQuota']==3
    assert Athlete.query.count()==2


def test_stale_preflight_requires_reconfirmation_without_deletion(events):
    from test_import_event_identity import person
    a,_=events;state=draft(a)
    person(a)
    result=fix(a,state)
    assert result.status_code==409 and result.json['error']=='QUOTA_FIX_CONFIRMATION_REQUIRED'
    assert Athlete.query.count()==1
    current=app.test_client().get(endpoint(a)).json
    assert fix(a,current).status_code==200


def test_readonly_editor_cannot_fix_rules(events):
    a,_=events;draft(a)
    from unittest.mock import patch
    with patch.dict(app.config,AUTH_DEV_USER='',AUTH_PROXY_SECRET='test-rules-secret'):
        headers={'X-Auth-Proxy-Secret':'test-rules-secret','X-Authenticated-User':'editor','X-Authenticated-Groups':'incoming-editor'}
        assert app.test_client().post(endpoint(a)+'/fix',headers=headers,json={'confirm':True}).status_code==403
    assert a.quota_rules_fixed_at is None


def test_completed_extent_revision_forks_version_and_retains_original_evidence(events):
    a,_=events;bind(a)
    current=upload(a,codes=[str(9400000+i) for i in range(37)])
    task=current['session']['approvals'][0];sid=current['session']['id']
    assert decision(sid,task['id'],{'total':1,'M':17,'F':0}).status_code==200
    run(current,a)
    session=db.session.get(ImportSession,int(sid));old_version=session.current_version
    old_json=old_version.preview_json;old_decision=db.session.get(ImportApproval,int(task['id']))
    old_evidence=old_decision.quota_details_json
    changed=decision(sid,task['id'],{'total':1,'M':10,'F':0})
    assert changed.status_code==200,changed.json
    db.session.expire_all()
    assert old_decision.quota_details_json==old_evidence
    assert old_version.preview_json==old_json
    assert session.current_version_id!=old_version.id
    assert changed.json['preview']['athleteQuotaChecks'][0]['uncoveredExtent']=={'total':0,'M':7,'F':0}
    assert any(a['decision']=='PENDING' for a in changed.json['approvals'])
    assert Athlete.query.count()==37
    assert review({'session':changed.json},a).status_code==409


def test_parallel_fixation_has_exactly_one_winner(events):
    from concurrent.futures import ThreadPoolExecutor
    a,_=events;state=draft(a);owner=a.id
    payload={'confirm':True,'expectedDigest':state['digest'],'preflightFingerprint':state['preflight']['fingerprint']}
    def submit(_):
        with app.test_client() as client:
            return client.post(f'/api/admin/events/{owner}/quota-rules/fix',json=payload).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:statuses=list(executor.map(submit,range(2)))
    assert sorted(statuses)==[200,409]
    db.session.expire_all()
    assert db.session.get(Event,owner).quota_rules_revision==1
    assert AuditEvent.query.filter_by(activity='Quotenregeln verbindlich fixiert').count()==1
