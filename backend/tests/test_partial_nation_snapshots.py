"""Synthetic SB/FS source pairs: scoped replacement through the real workflow."""
import io
import json
import pandas as pd
import pytest
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_safe_reimport import run, review, booking
from app import app
from models import db, Athlete, ImportSession, ImportApproval
from imports.change_plan import input_fingerprint
pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]
CODES={'SB':'WSC_HP_M_6174','FS':'WSC_HP_M_8171'}


def rows(part):
    count,athletes,base=(4,2,9000100) if part=='SB' else (7,5,9000200)
    return [dict(Firstname=f'Synthetic{part}{i}',Lastname='Partial',Nationcode='ARG',
        Function='Athlete' if i<athletes else 'NSA Coach',Gender='M',Fiscode=str(base+i),
        **{'Competitorid/Staff ID':f'staff{base+i}',CODES[part]:'YES'},Room_type='Double shared',
        Arrival_date='04.03.2027',Departure_date='22.03.2027') for i in range(count)]


def upload(owner,part,data=None,scope=None,expected=200):
    records=rows(part) if data is None else data
    a,b=io.BytesIO(),io.BytesIO()
    pd.DataFrame(records,columns=list(records[0]) if records else list(rows(part)[0])).to_excel(a,index=False,sheet_name='Data')
    pd.DataFrame(columns=['no data available']).to_excel(b,index=False,sheet_name='Data');a.seek(0);b.seek(0)
    payload=dict(eventId=str(owner.id),createSession='true',entriesList=(a,'same-uninformative-name.xlsx'),roomListDetailed=(b,'rooms.xlsx'))
    if scope:payload['snapshotScope']=scope
    response=app.test_client().post('/api/import/fis/preview',data=payload)
    assert response.status_code==expected, response.json
    return response.json


@pytest.fixture
def owner(events,monkeypatch):
    event,_=events;bind(event);monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(event.id))
    return event


def snapshot(people):
    return {p.id:({c.name:getattr(p,c.name) for c in Athlete.__table__.columns},sorted(c.id for c in p.competitions)) for p in people}


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
def test_union_in_both_orders_with_unchanged_foreign_data_and_identical_reimport(owner,first,second):
    initial=upload(owner,first);run(initial,owner)
    original=Athlete.query.all();before=snapshot(original)
    room=booking(original[:2]);room_id=room.id
    following=upload(owner,second);plan=following['session']['preview']['changePlan']
    assert plan['snapshotScope']=='SPORT_FAMILY' and not plan['people']['remove']
    assert len(plan['people']['unchanged'])==len(original)
    run(following,owner)
    assert Athlete.query.count()==11
    assert Athlete.query.filter_by(function='Athlete').count()==7
    assert snapshot(Athlete.query.filter(Athlete.id.in_(before)).all())==before
    assert db.session.get(type(room),room_id) is not None
    again=upload(owner,first);assert not again['session']['preview']['changePlan']['people']['remove']
    run(again,owner);assert Athlete.query.count()==11


def test_corrected_sb_only_removes_sb_and_preserves_fs_columns_memberships_and_approvals(owner):
    run(upload(owner,'SB'),owner);run(upload(owner,'FS'),owner)
    fs=Athlete.query.filter(Athlete.fis_code.in_([r['Fiscode'] for r in rows('FS')])).all();before=snapshot(fs)
    corrected=rows('SB')[1:];corrected[0]['Arrival_date']='05.03.2027'
    changed=upload(owner,'SB',corrected);plan=changed['session']['preview']['changePlan']
    assert len(plan['people']['remove'])==1
    assert plan['people']['remove'][0]['fisCode']==rows('SB')[0]['Fiscode']
    assert review(changed,owner).status_code==409
    run(changed,owner,destructive=True)
    assert Athlete.query.count()==10
    assert snapshot(Athlete.query.filter(Athlete.id.in_(before)).all())==before


def test_explicit_full_nation_replacement_keeps_existing_destructive_protection(owner):
    run(upload(owner,'SB'),owner);run(upload(owner,'FS'),owner)
    full=upload(owner,'FS',scope='FULL_NATION');plan=full['session']['preview']['changePlan']
    assert plan['snapshotScope']=='FULL_NATION' and len(plan['people']['remove'])==4
    assert review(full,owner).status_code==409
    run(full,owner,destructive=True);assert Athlete.query.count()==7


def shared_fs():
    records=rows('FS');base=rows('SB')[0]
    for key in ('Firstname','Fiscode','Competitorid/Staff ID'):
        records[0][key]=base[key]
    return records


def test_shared_identity_unions_memberships_and_partial_withdrawal_keeps_person(owner):
    run(upload(owner,'SB'),owner)
    joined=upload(owner,'FS',shared_fs());assert not joined['session']['preview']['changePlan']['memberships']['remove']
    assert {r['topLevelDiscipline'] for r in joined['athleteQuotaChecks']}=={'Freestyle'}  # No incomplete SB quota from the shared athlete.
    run(joined,owner);assert Athlete.query.count()==10
    shared=Athlete.query.filter_by(fis_code=rows('SB')[0]['Fiscode']).one();identity=shared.id
    before={c.code for c in shared.competitions};assert before=={'6174','8171'}
    withdrawn=upload(owner,'SB',rows('SB')[1:]);plan=withdrawn['session']['preview']['changePlan']
    assert not plan['people']['remove']
    assert any(m['personId']==identity for m in plan['memberships']['remove'])
    run(withdrawn,owner,destructive=True);db.session.expire_all()
    assert {c.code for c in db.session.get(Athlete,identity).competitions}=={'8171'}
    assert Athlete.query.count()==10


@pytest.mark.parametrize('field,value',[('Arrival_date','02.03.2027'),('Firstname','Contradictory person')])
def test_shared_identity_conflicts_stop_without_changes(owner,field,value):
    run(upload(owner,'SB'),owner);before=snapshot(Athlete.query.all())
    incoming=shared_fs();incoming[0][field]=value
    response=upload(owner,'FS',incoming,expected=422)
    assert response['error'] in {'IMPORT_SHARED_PERSON_CONFLICT','IMPORT_IDENTITY_CONFLICT'}
    assert snapshot(Athlete.query.all())==before


def test_mixed_or_missing_source_family_requires_explicit_scope(owner):
    run(upload(owner,'SB'),owner);before=snapshot(Athlete.query.all())
    mixed=rows('SB')
    for person in mixed:person[CODES['FS']]=''
    assert upload(owner,'SB',mixed,expected=422)['error']=='IMPORT_SNAPSHOT_SCOPE_REQUIRED'
    assert snapshot(Athlete.query.all())==before
    full=upload(owner,'SB',mixed,scope='FULL_NATION');assert full['session']['preview']['changePlan']['snapshotScope']=='FULL_NATION'
    legacy={'people':[]}
    frozen=input_fingerprint(legacy)
    legacy['unrelatedDisplay']='same historical fingerprint'
    assert input_fingerprint(legacy)==frozen
    legacy['replacementScope']={'kind':'SPORT_FAMILY','family':'Snowboard'}
    assert input_fingerprint(legacy)!=frozen


def test_scope_is_frozen_in_review(owner):
    payload=upload(owner,'SB');session=db.session.get(ImportSession,int(payload['session']['id']))
    parsed=json.loads(session.current_version.preview_json)
    parsed['replacementScope']['family']='Freestyle';session.current_version.preview_json=json.dumps(parsed);db.session.commit()
    assert review(payload,owner).status_code==409
    assert Athlete.query.count()==0


def test_other_event_identity_and_unassigned_source_do_not_expand_replacement(owner,events):
    from models import Competition
    other=events[1]
    foreign=Athlete(event_id=other.id,firstname='Other',lastname='Event',nation_code='ARG',fis_code=rows('SB')[0]['Fiscode'],function='Athlete',gender='M')
    foreign.competitions=[Competition.query.filter_by(code='8171').one()];db.session.add(foreign);db.session.commit()
    before=snapshot([foreign]);run(upload(owner,'SB'),owner)
    assert Athlete.query.filter_by(event_id=owner.id).count()==4 and snapshot([foreign])==before
    missing=rows('SB')
    for person in missing:person.pop(CODES['SB']);person['Function']='NSA Coach'
    assert upload(owner,'SB',missing,expected=422)['error']=='IMPORT_SNAPSHOT_SCOPE_REQUIRED'
    assert Athlete.query.filter_by(event_id=owner.id).count()==4 and snapshot([foreign])==before


def test_shared_existing_approval_tariff_and_room_state_are_not_rewritten(owner):
    first=upload(owner,'SB');run(first,owner)
    session=db.session.get(ImportSession,int(first['session']['id']))
    person=Athlete.query.filter_by(fis_code=rows('SB')[0]['Fiscode']).one()
    approval=ImportApproval(session_id=session.id,version_id=session.current_version_id,nation='ARG',approval_type='NATION_APPROVED',description='Historical synthetic evidence',decision='APPROVED',username='reviewer',quota_details_json='{}')
    db.session.add(approval);db.session.flush()
    person.single_room_decision_id=approval.id;person.single_room_status='APPROVED_EXTRA'
    person.accommodation_rate_category='SPECIAL';person.accommodation_rate_source='MANUAL';db.session.commit()
    original=snapshot([person]);evidence=approval.to_dict()
    run(upload(owner,'FS',shared_fs()),owner);db.session.expire_all()
    assert snapshot([db.session.get(Athlete,person.id)])[person.id][0]==original[person.id][0]
    assert db.session.get(ImportApproval,approval.id).to_dict()==evidence
    withdrawn=upload(owner,'SB',rows('SB')[1:],expected=422)
    assert withdrawn['error']=='IMPORT_SHARED_PERSON_CONFLICT'
    assert db.session.get(ImportApproval,approval.id).to_dict()==evidence


def test_old_implicit_full_plan_cannot_delete_other_family_but_explicit_full_still_works(owner):
    from imports.change_plan import digest
    run(upload(owner,'SB'),owner)
    old=upload(owner,'FS',scope='FULL_NATION')
    session=db.session.get(ImportSession,int(old['session']['id']))
    preview=json.loads(session.current_version.preview_json);preview.pop('replacementScope')
    plan=preview['_workflow']['plan'];plan['inputFingerprint']=input_fingerprint(preview)
    plan.pop('digest');plan['digest']=digest(plan)
    session.current_version.preview_json=json.dumps(preview);db.session.commit()
    frozen=session.current_version.preview_json
    response=review(old,owner,destructive=True)
    assert response.status_code==409 and response.json['error']=='IMPORT_SNAPSHOT_SCOPE_REQUIRED'
    assert session.current_version.preview_json==frozen and Athlete.query.count()==4
    explicit=upload(owner,'FS',scope='FULL_NATION');run(explicit,owner,destructive=True)
    assert Athlete.query.count()==7
