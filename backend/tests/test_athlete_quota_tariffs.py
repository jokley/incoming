"""JPN-sized synthetic roster; real HTTP review/confirm, disposable PostgreSQL only."""
import json
from copy import deepcopy
from types import SimpleNamespace
import pytest
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_safe_reimport import upload, review, run
from app import app
from models import db, Athlete, ImportApproval, ImportSession, ImportSessionEvent, RoomBooking
from athlete_quota_tariffs import validate_tariff_selection
from accommodation_rates import rate_projection

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.quota_rule_lifecycle]
CODES = [str(9300000+i) for i in range(40)]


def genders(rows):
    for i,p in enumerate(rows):p['Gender']='M' if i<23 else 'F'


def get_task(payload):
    return next(a for a in payload.get('session',payload)['approvals'] if a['decision']=='PENDING' and a['quotaDetails'].get('decisionKind')=='ATHLETE_QUOTA')


def decide(payload, task, keys, extent=None, effect='SPECIAL_SELECTED'):
    return app.test_client().patch(f"/api/import/sessions/{payload['session']['id']}/approvals/{task['id']}",json={
        'decision':'APPROVED','approvalType':'NATION_APPROVED','approvalBy':'FIS contact',
        'approvalMethod':'EMAIL','approvalDate':'2026-10-26T12:00:00Z',
        'approvedExtent':extent or task['quotaDetails']['uncoveredExtent'],
        'approvedPersonKeys':keys,'tariffEffect':effect,'costCoverage':'Amount to be agreed'})


def detail(payload):
    response=app.test_client().get(f"/api/import/sessions/{payload['session']['id']}")
    assert response.status_code==200,response.json
    return response.json['preview']


def test_japan_40_23_explicit_union_persists_and_reimport_preserves(events):
    a,b=events;bind(a)
    payload=upload(a,codes=CODES,changed=genders);task=get_task(payload)
    assert task['quotaDetails']['uncoveredExtent']=={'total':4,'M':3,'F':0}
    keys=CODES[:3]+[CODES[23]]
    response=decide(payload,task,keys)
    assert response.status_code==200,response.json
    decision_id=int(next(a['id'] for a in response.json['approvals'] if a['decision']=='APPROVED'))
    saved_evidence=db.session.get(ImportApproval,decision_id).quota_details_json
    projected=detail(payload)
    special=[p for p in projected['people'] if p['accommodationRateCategory']=='SPECIAL']
    assert {p['matchKey'] for p in special}==set(keys)
    assert all(p['accommodationRateSource']=='APPROVAL' and p['accommodationRateApprovalId']==decision_id for p in special)
    assert all('offen' in p['accommodationRateExplanation'] for p in special)
    run(payload,a)
    people=Athlete.query.all()
    assert len(people)==40 and sum(p.accommodation_rate_category=='SPECIAL' for p in people)==4
    assert all(p.single_room_status!='APPROVED_EXTRA' for p in people)
    assert RoomBooking.query.count()==0
    assert ImportSessionEvent.query.filter_by(event_type='ACCOMMODATION_RATE_APPROVAL').count()==4
    repeated=upload(a,codes=CODES,changed=genders)
    assert repeated['athleteQuotaChecks'][0]['decisionStatus']=='APPROVED'
    run(repeated,a)
    assert Athlete.query.count()==40
    assert sum(p.accommodation_rate_category=='SPECIAL' for p in Athlete.query.all())==4
    assert db.session.get(ImportApproval,decision_id).quota_details_json==saved_evidence
    assert Athlete.query.filter_by(event_id=b.id).count()==0


def test_partial_approval_requires_different_people_and_blocks_confirm(events):
    a,_=events;bind(a);payload=upload(a,codes=CODES,changed=genders)
    response=decide(payload,get_task(payload),CODES[:2],{'total':2,'M':2,'F':0})
    assert response.status_code==200,response.json
    assert review(payload,a).status_code==409
    pending=get_task(response.json)
    duplicate=decide(payload,pending,[CODES[0],CODES[23]])
    assert duplicate.status_code==400
    assert len([p for p in detail(payload)['people'] if p['accommodationRateCategory']=='SPECIAL'])==2
    done=decide(payload,pending,[CODES[2],CODES[23]])
    assert done.status_code==200,done.json
    run(payload,a)
    assert Athlete.query.filter_by(accommodation_rate_source='APPROVAL').count()==4


def test_manual_tariff_overrides_win_and_reimport_keeps_manual_standard(events):
    a,_=events;bind(a);payload=upload(a,codes=CODES,changed=genders)
    target=next(p for p in payload['people'] if p['matchKey']==CODES[0])
    # Use the real import-review manual override endpoint.
    sid=payload['session']['id']
    response=app.test_client().patch(f"/api/import/sessions/{sid}/accommodation-rates/{target['matchKey']}",json={'accommodationRateCategory':'STANDARD'})
    assert response.status_code==200,response.json
    response=decide(payload,get_task(payload),CODES[:4]);assert response.status_code==200,response.json
    manual=next(p for p in detail(payload)['people'] if p['matchKey']==CODES[0])
    assert manual['accommodationRateCategory']=='STANDARD' and manual['accommodationRateSource']=='MANUAL'
    assert 'bleibt erhalten' in manual['accommodationRateExplanation']
    run(payload,a)
    person=Athlete.query.filter_by(fis_code=CODES[0]).one()
    assert rate_projection(person)=={'accommodationRateCategory':'STANDARD','accommodationRateSource':'MANUAL'}
    repeated=upload(a,codes=CODES,changed=genders);run(repeated,a)
    assert person.accommodation_rate_category=='STANDARD'
    assert person.accommodation_rate_approval_id is None


def test_historical_quantity_approval_has_no_retroactive_tariff_effect(events):
    a,_=events;bind(a);payload=upload(a,codes=CODES,changed=genders)
    response=decide(payload,get_task(payload),[],effect='NONE');assert response.status_code==200,response.json
    approval=ImportApproval.query.filter_by(decision='APPROVED').one()
    historical=json.loads(approval.quota_details_json);historical.pop('tariffEffect')
    approval.quota_details_json=json.dumps(historical);db.session.commit()
    original=approval.quota_details_json
    projected=detail(payload)
    assert all(p['accommodationRateCategory']=='STANDARD' for p in projected['people'])
    assert any(w['code']=='ATHLETE_TARIFF_UNRESOLVED' for w in projected['warnings'])
    assert approval.quota_details_json==original


@pytest.mark.parametrize('keys,extent,valid',[
    (['m1','m2','m3','f1'],{'total':4,'M':3,'F':0},True),
    (['m1','m2','m3','f1'],{'total':4,'M':2,'F':2},False),
    (['m1','m2','m3'],{'total':4,'M':3,'F':0},False),
    (['m1','m2','f1','f2'],{'total':4,'M':3,'F':0},False),
    (['m1','m2','m3','f1','f2'],{'total':4,'M':3,'F':2},True),
])
def test_overlapping_boundaries(keys,extent,valid):
    evidence={'candidates':[dict(personKey=k,gender='M' if k.startswith('m') else 'F') for k in ['m1','m2','m3','f1','f2']]}
    if valid:validate_tariff_selection(evidence,extent,keys,'SPECIAL_SELECTED')
    else:
        with pytest.raises(ValueError):validate_tariff_selection(evidence,extent,keys,'SPECIAL_SELECTED')


def test_additive_migration_preserves_rows_and_guards_downgrade(events):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import sqlalchemy as sa
    a,_=events;bind(a)
    # Existing unrelated operational values survive enum/FK addition unchanged.
    p=Athlete(event_id=a.id,firstname='Before',lastname='Migration',nation_code='JPN',accommodation_rate_category='SPECIAL',accommodation_rate_source='MANUAL')
    db.session.add(p);db.session.commit()
    path=Path(__file__).parents[1]/'migrations/versions/20261026_01_athlete_quota_tariffs.py'
    spec=importlib.util.spec_from_file_location('tariff_migration',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    with db.engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection,opts={'target_metadata':db.metadata})):
            module.downgrade()  # Build the immediately preceding schema locally.
            before=dict(connection.execute(sa.text('SELECT * FROM athlete')).mappings().one())
            module.upgrade()
            after=dict(connection.execute(sa.text('SELECT * FROM athlete')).mappings().one())
            assert after.pop('accommodation_rate_approval_id') is None
            assert after==before
            # A real reference remains traceable; downgrade refuses data loss.
            s=connection.execute(sa.text("INSERT INTO import_session (event_id,nation,status,created_at,updated_at) VALUES (:event,'MIG','NEW',now(),now()) RETURNING id"),{'event':a.id}).scalar_one()
            approval=connection.execute(sa.text("INSERT INTO import_approval (session_id,nation,approval_type,description,decision,username,created_at) VALUES (:s,'MIG','NATION_APPROVED','Evidence','APPROVED','test',now()) RETURNING id"),{'s':s}).scalar_one()
            connection.execute(sa.text("UPDATE athlete SET accommodation_rate_source='APPROVAL',accommodation_rate_approval_id=:a"),{'a':approval})
            with pytest.raises(RuntimeError,match='refusing destructive'):module.downgrade()
    db.session.expire_all()


def test_existing_approval_is_explicitly_revised_without_rewriting_history(events):
    a,_=events;bind(a);payload=upload(a,codes=CODES,changed=genders)
    response=decide(payload,get_task(payload),[],effect='NONE');assert response.status_code==200,response.json
    old=ImportApproval.query.filter_by(decision='APPROVED').one();old_id=old.id
    # Simulate a legacy approval with optional selection and no tariff effect.
    evidence=json.loads(old.quota_details_json);evidence.pop('tariffEffect');old.quota_details_json=json.dumps(evidence);db.session.commit()
    old_json=old.quota_details_json
    from imports.workflow import refresh_plan
    refresh_plan(db.session.get(ImportSession,int(payload['session']['id'])));db.session.commit()
    run(payload,a)
    assert Athlete.query.filter_by(accommodation_rate_category='SPECIAL').count()==0
    done=next(t for t in response.json['approvals'] if t['decision']=='APPROVED')
    response=decide(payload,done,CODES[:4],{'total':4,'M':3,'F':0})
    assert response.status_code==200,response.json
    assert db.session.get(ImportApproval,old_id).quota_details_json==old_json
    assert Athlete.query.filter_by(accommodation_rate_category='SPECIAL').count()==0  # No writes before confirm.
    new_session=app.test_client().get(f"/api/import/sessions/{payload['session']['id']}").json
    revised={'session':new_session}
    run(revised,a)
    assert Athlete.query.filter_by(accommodation_rate_source='APPROVAL').count()==4
    assert db.session.get(ImportApproval,old_id).quota_details_json==old_json


def test_changed_roster_does_not_inherit_approval_but_preserves_existing_tariffs(events):
    a,_=events;bind(a);payload=upload(a,codes=CODES,changed=genders)
    assert decide(payload,get_task(payload),CODES[:4]).status_code==200
    run(payload,a)
    def changed(rows):
        genders(rows);rows[-1]['Firstname']='Replacement'
    replacement=upload(a,codes=CODES[:-1]+['9399999'],changed=changed)
    assert replacement['athleteQuotaChecks'][0]['decisionStatus']=='PENDING'
    assert review(replacement,a,True).status_code==409
    assert next(p for p in replacement['people'] if p['matchKey']=='9399999')['accommodationRateCategory']=='STANDARD'
    assert all('Anwendbarkeit' in p['accommodationRateExplanation'] for p in replacement['people'] if p['accommodationRateSource']=='APPROVAL')


def test_same_nation_other_event_cannot_inherit_tariff_approval(events):
    a,b=events;bind(a);payload=upload(a,codes=CODES,changed=genders)
    assert decide(payload,get_task(payload),CODES[:4]).status_code==200
    run(payload,a)
    bind(b)
    other=upload(b,codes=CODES,changed=genders)
    assert other['athleteQuotaChecks'][0]['decisionStatus']=='PENDING'
    assert all(p['accommodationRateCategory']=='STANDARD' for p in other['people'])


def test_projection_does_not_change_ez_or_duplicate_tariff_across_families():
    from athlete_quota_tariffs import project_tariffs
    evidence={'tariffEffect':'SPECIAL_SELECTED','approvedExtent':{'total':1,'M':1,'F':0},'candidates':[{'personKey':'p','gender':'M'}]}
    approvals=[SimpleNamespace(id=i,quota_details_json=json.dumps(evidence),approved_person_keys_json='["p"]') for i in (1,2)]
    person={'matchKey':'p','countsAsSingle':False,'singleRoomStatus':'APPROVED_EXTRA','accommodationRequirement':'NO_ROOM','accommodationRateCategory':'STANDARD','accommodationRateSource':'DEFAULT'}
    preview={'people':[person],'athleteQuotaChecks':[{'approvalIds':[1]},{'approvalIds':[2]}]}
    project_tariffs(preview,approvals)
    assert person['accommodationRateCategory']=='SPECIAL' and person['accommodationRateApprovalIds']==[1,2]
    assert person['accommodationRateApprovalId']==1
    assert person['countsAsSingle'] is False and person['singleRoomStatus']=='APPROVED_EXTRA' and person['accommodationRequirement']=='NO_ROOM'
    bad={'people':[dict(matchKey='p',accommodationRateCategory='STANDARD',accommodationRateSource='DEFAULT')],'athleteQuotaChecks':[{'approvalIds':[1]}]}
    approvals[0].approved_person_keys_json='["p", "p"]'
    project_tariffs(bad,approvals[:1])
    assert bad['isValid'] is False and bad['errors'][0]['code']=='ATHLETE_TARIFF_EVIDENCE_INVALID'
    assert bad['people'][0]['accommodationRateCategory']=='STANDARD'


def test_partial_decisions_overlap_across_boundaries_without_extra_paid_people(events):
    a,_=events;bind(a);payload=upload(a,codes=CODES,changed=genders)
    first=decide(payload,get_task(payload),CODES[:2],{'total':2,'M':0,'F':0})
    assert first.status_code==200,first.json
    task=get_task(first.json)
    # Three male exceptions overlap the first two total exceptions. Reusing one
    # selected person for a different boundary yields four paid people, not five.
    inflated=decide(payload,task,CODES[2:5],{'total':2,'M':3,'F':0})
    assert inflated.status_code==400
    second=decide(payload,task,[CODES[0],CODES[2],CODES[3]],{'total':2,'M':3,'F':0})
    assert second.status_code==200,second.json
    projected=detail(payload)
    assert len([p for p in projected['people'] if p['accommodationRateCategory']=='SPECIAL'])==4
    run(payload,a)
    assert Athlete.query.filter_by(accommodation_rate_source='APPROVAL').count()==4
