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


def upload(owner,part,data=None,scope=None,expected=200,session_id=None,room_data=None):
    records=rows(part) if data is None else data
    a,b=io.BytesIO(),io.BytesIO()
    pd.DataFrame(records,columns=list(records[0]) if records else list(rows(part)[0])).to_excel(a,index=False,sheet_name='Data')
    (pd.DataFrame(room_data,columns=['Firstname','Lastname','Nationcode','Room_type','Arrival_date','Departure_date','Shared with Name']) if room_data is not None else pd.DataFrame(columns=['no data available'])).to_excel(b,index=False,sheet_name='Data');a.seek(0);b.seek(0)
    payload=dict(eventId=str(owner.id),files=[(a,'same-uninformative-name.xlsx'),(b,'rooms.xlsx')])
    payload.update({'sessionId':str(session_id)} if session_id else {'createSession':'true'})
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
@pytest.mark.parametrize('selected',[False,True])
def test_union_in_both_orders_with_unchanged_foreign_data_and_identical_reimport(owner,first,second,selected):
    initial=upload(owner,first);run(initial,owner)
    original=Athlete.query.all();before=snapshot(original)
    room=booking(original[:2]);room_id=room.id
    following=upload(owner,second,session_id=initial['session']['id'] if selected else None);plan=following['session']['preview']['changePlan']
    assert following['session']['id']==initial['session']['id']  # One nation session, two partial-file versions.
    assert following['session']['currentVersionId']!=initial['session']['currentVersionId']
    assert following['session']['version']==2
    assert following['replacementScope']=={'kind':'SPORT_FAMILY','family':'Snowboard' if second=='SB' else 'Freestyle'}
    assert len(plan['people']['create'])==len(rows(second))
    assert not following['dispositionAnalysis']['categories']['removedAthletes']['records']
    assert plan['snapshotScope']=='SPORT_FAMILY' and not plan['people']['remove']
    assert len(plan['people']['unchanged'])==len(original)
    fresh=app.test_client().get(f"/api/import/sessions/{following['session']['id']}?eventId={owner.id}").json
    assert not fresh['preview']['planStale']
    run(following,owner)
    assert Athlete.query.count()==11
    assert Athlete.query.filter_by(function='Athlete').count()==7
    assert snapshot(Athlete.query.filter(Athlete.id.in_(before)).all())==before
    assert db.session.get(type(room),room_id) is not None
    current=app.test_client().get(f"/api/import/sessions/{following['session']['id']}?eventId={owner.id}").json
    assert not current['preview']['planStale']
    assert len(current['preview']['people'])==len(rows(second))  # Dateivorschau, not the combined nation roster.
    assert current['preview']['changePlan']['digest']==plan['digest']
    assert not current['preview']['dispositionAnalysis']['categories']['removedAthletes']['records']
    again=upload(owner,first,session_id=following['session']['id'] if selected else None);assert not again['session']['preview']['changePlan']['people']['remove']
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
    records[0]['Lastupdate']='01.11.2026 12:00'  # A different source export timestamp is not a housing conflict.
    return records


def test_shared_identity_unions_memberships_and_partial_withdrawal_keeps_person(owner):
    run(upload(owner,'SB'),owner)
    joined=upload(owner,'FS',shared_fs());assert not joined['session']['preview']['changePlan']['memberships']['remove']
    assert {r['topLevelDiscipline']:r['athleteQuotaUsed'] for r in joined['athleteQuotaChecks']}=={'Freestyle':5,'Snowboard':2}  # Full effective SB roster, not just its shared athlete.
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


def select_submission(payload,event,source):
    return app.test_client().post(f"/api/import/sessions/{payload['session']['id']}/recheck?eventId={event.id}",json={'sourceVersionId':str(source)})


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
def test_collect_select_and_cancel_drafts_before_any_import(owner,first,second):
    a=upload(owner,first);b=upload(owner,second)
    sid=int(a['session']['id']);session=db.session.get(ImportSession,sid)
    original={v.id:v.preview_json for v in session.versions}
    assert Athlete.query.count()==0
    assert {r['family']:r['people'] for r in b['session']['submissions']}=={'Snowboard':4,'Freestyle':7}
    chosen=select_submission(b,owner,a['session']['currentVersionId'])
    assert chosen.status_code==200,chosen.json
    assert len(chosen.json['preview']['people'])==len(rows(first))
    assert all(db.session.get(type(session.current_version),key).preview_json==value for key,value in original.items())
    cancel=app.test_client().post(f'/api/import/sessions/{sid}/cancel?eventId={owner.id}',json={'versionId':chosen.json['currentVersionId']})
    assert cancel.status_code==200,cancel.json
    assert len(cancel.json['preview']['people'])==len(rows(second))
    assert Athlete.query.count()==0


def test_new_invalid_correction_is_visible_and_superseded_source_cannot_be_selected(owner):
    a=upload(owner,'SB');b=upload(owner,'FS')
    invalid=rows('SB');invalid[0]['Arrival_date']='not a date'
    latest=upload(owner,'SB',invalid)
    source=next(r for r in latest['session']['submissions'] if r['family']=='Snowboard')
    assert source['versionId']==latest['session']['currentVersionId'] and source['errors']>0
    assert select_submission(latest,owner,a['session']['currentVersionId']).status_code==409
    assert next(r for r in latest['session']['submissions'] if r['family']=='Freestyle')['versionId']==b['session']['currentVersionId']


def test_partial_import_keeps_the_other_unimported_draft(owner):
    a=upload(owner,'SB');b=upload(owner,'FS')
    selected=select_submission(b,owner,a['session']['currentVersionId'])
    assert selected.status_code==200,selected.json
    run({'session':selected.json},owner)
    current=app.test_client().get(f"/api/import/sessions/{a['session']['id']}?eventId={owner.id}").json
    statuses={p['family']:p['status'] for p in current['submissions']}
    assert statuses=={'Snowboard':'IMPORTED','Freestyle':'PROFESSIONALLY_REVIEWED'}
    selected=select_submission(b,owner,b['session']['currentVersionId'])
    assert selected.status_code==200,selected.json
    run({'session':selected.json},owner)
    assert Athlete.query.count()==11


def compose(payload,event,ids=None):
    current=app.test_client().get(f"/api/import/sessions/{payload['session']['id']}?eventId={event.id}").json
    return app.test_client().post(f"/api/import/sessions/{payload['session']['id']}/recheck?eventId={event.id}",json={'sourceVersionIds':ids or [s['versionId'] for s in current['submissions']]})


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
def test_composed_review_uses_current_sources_and_one_atomic_confirm(owner,first,second):
    a=upload(owner,first);b=upload(owner,second)
    combined=compose(b,owner)
    assert combined.status_code==200,combined.json
    assert combined.json['status']=='PROFESSIONALLY_REVIEWED'
    preview=combined.json['preview']
    assert len(preview['people'])==11 and len(preview['submissionSources'])==2
    assert preview['changePlan']['snapshotScope']=='SPORT_FAMILY'
    assert not preview['changePlan']['people']['remove']
    assert Athlete.query.count()==0
    run({'session':combined.json},owner)
    assert Athlete.query.count()==11 and Athlete.query.filter_by(function='Athlete').count()==7
    current=app.test_client().get(f"/api/import/sessions/{b['session']['id']}?eventId={owner.id}").json
    assert len(current['submissions'])==2 and all(s['status']=='IMPORTED' for s in current['submissions'])


@pytest.mark.parametrize('female_alias',[False,True])
def test_composed_shared_person_is_one_person_with_both_memberships(owner,female_alias):
    sb=rows('SB');fs=shared_fs()
    if female_alias:
        sb[0].update(Gender='W',WSC_HP_M_6174='',WSC_HP_W_6175='YES')
        fs[0].update(Gender='F',WSC_HP_M_8171='',WSC_HP_W_8172='YES')
    upload(owner,'SB',sb);b=upload(owner,'FS',fs)
    result=compose(b,owner);assert result.status_code==200,result.json
    assert len(result.json['preview']['people'])==10
    shared=next(p for p in result.json['preview']['people'] if p['fisCode']==rows('SB')[0]['Fiscode'])
    assert len(shared['sourceRows'])==2 and len(shared['competitionIds'])==2
    run({'session':result.json},owner)
    assert Athlete.query.count()==10
    assert len(Athlete.query.filter_by(fis_code=shared['fisCode']).one().competitions)==2


@pytest.mark.parametrize('field,value',[('Arrival_date','02.03.2027'),('Room_type','No room')])
def test_shared_draft_conflicts_cannot_be_bypassed_by_individual_import(owner,field,value):
    upload(owner,'SB');fs=shared_fs();fs[0][field]=value
    b=upload(owner,'FS',fs)
    assert compose(b,owner).status_code==409
    assert review(b,owner).status_code==409
    assert Athlete.query.count()==0


@pytest.mark.parametrize('part',['SB','FS'])
def test_source_correction_invalidates_composed_release_and_does_not_replace_other_draft(owner,part):
    a=upload(owner,'SB');b=upload(owner,'FS');combined=compose(b,owner)
    assert combined.status_code==200,combined.json
    assert review({'session':combined.json},owner).status_code==200
    corrected=rows(part)[1:];c=upload(owner,part,corrected)
    assert next(s for s in c['session']['submissions'] if s['family']==('Freestyle' if part=='SB' else 'Snowboard'))['versionId']==(b if part=='SB' else a)['session']['currentVersionId']
    response=app.test_client().post(f"/api/import/sessions/{b['session']['id']}/import?eventId={owner.id}",json={'versionId':combined.json['currentVersionId']})
    assert response.status_code==409 and Athlete.query.count()==0
    combined=compose(c,owner);assert combined.status_code==200,combined.json
    run({'session':combined.json},owner);assert Athlete.query.count()==10


def test_composed_confirm_rolls_back_every_source_on_failure(owner,monkeypatch):
    import app as application
    from imports.event_context import ImportValidationError
    from models import ImportRun
    upload(owner,'SB');b=upload(owner,'FS');combined=compose(b,owner)
    assert review({'session':combined.json},owner).status_code==200
    original=application.confirm_fis_import
    def fail_after_writes(*args,**kwargs):
        original(*args,**kwargs)
        assert Athlete.query.count()==11
        raise ImportValidationError('SYNTHETIC_FAILURE','Rollback acceptance')
    monkeypatch.setattr(application,'confirm_fis_import',fail_after_writes)
    response=app.test_client().post(f"/api/import/sessions/{b['session']['id']}/import?eventId={owner.id}",json={'versionId':combined.json['currentVersionId']})
    assert response.status_code==409
    assert Athlete.query.count()==ImportRun.query.count()==0
    monkeypatch.setattr(application,'confirm_fis_import',original)
    run({'session':combined.json},owner);assert Athlete.query.count()==11


def test_mixed_empty_roomlist_does_not_clear_other_source_room_state(owner):
    run(upload(owner,'SB'),owner)
    person=Athlete.query.filter_by(fis_code=rows('SB')[0]['Fiscode']).one()
    person.room_type='Double shared';person.shared_with_name='Historical partner';db.session.commit()
    request=rows('SB')
    for row in request:row['Room_type']=''
    upload(owner,'SB',request);fs=upload(owner,'FS',room_data=rows('FS'))
    combined=compose(fs,owner);assert combined.status_code==200,combined.json
    assert sum(p['roomListHasNoData'] for p in combined.json['preview']['people'])==4
    assert not combined.json['preview']['roomListHasNoData']
    run({'session':combined.json},owner);db.session.refresh(person)
    assert person.room_type=='Double shared' and person.shared_with_name=='Historical partner'


@pytest.mark.parametrize('changed',[False,True])
def test_source_approval_is_reused_only_through_existing_person_context_evidence(owner,changed):
    data=rows('SB')
    for row in data:row['Room_type']='Single'
    a=upload(owner,'SB',data,room_data=data);sid=a['session']['id']
    while True:
        current=app.test_client().get(f'/api/import/sessions/{sid}?eventId={owner.id}').json
        task=next((a for a in current['approvals'] if a['decision']=='PENDING'),None)
        if not task:break
        details=task['quotaDetails'];keys=[p['personKey'] for p in details['singleRoomCandidates'][:details['excessCount']]]
        response=app.test_client().patch(f"/api/import/sessions/{sid}/approvals/{task['id']}?eventId={owner.id}",json={'decision':'APPROVED','approvalType':'NATION_APPROVED','approvalMethod':'EMAIL','approvalBy':'Synthetic evidence','approvalDate':'2026-11-02T12:00:00Z','approvedPersonKeys':keys})
        assert response.status_code==200,response.json
    evidence={a.id:a.to_dict() for a in ImportApproval.query.all()}
    assert evidence
    b=upload(owner,'FS')
    if changed:
        for row in data:row.pop(CODES['SB']);row['WSC_BA_M_6182']='YES'
        b=upload(owner,'SB',data,room_data=data)
    combined=compose(b,owner);assert combined.status_code==200,combined.json
    if changed:
        assert any(a['decision']=='PENDING' for a in combined.json['approvals'])
        assert review({'session':combined.json},owner).status_code==409
        assert all(db.session.get(ImportApproval,key).to_dict()==value for key,value in evidence.items())
        return
    assert not any(a['decision']=='PENDING' for a in combined.json['approvals'])
    run({'session':combined.json},owner)
    assert Athlete.query.count()==11
    assert all(db.session.get(ImportApproval,key).to_dict()==value for key,value in evidence.items())
    assert any(p.single_room_decision_id in evidence for p in Athlete.query.all())


def test_unimported_other_draft_cannot_supply_quota_and_unrelated_errors_do_not_block(owner):
    sb=rows('SB')
    for row in sb:row['Room_type']='Single'
    a=upload(owner,'SB',sb,room_data=sb)
    fs=rows('FS');shared=sb[2]
    for key in ('Firstname','Fiscode','Competitorid/Staff ID','Room_type'):fs[5][key]=shared[key]
    b=upload(owner,'FS',fs,room_data=fs)
    selected=select_submission(b,owner,a['session']['currentVersionId'])
    assert selected.status_code==200,selected.json
    assert {q['discipline'] for q in selected.json['preview']['quotaChecks']}=={'Snowboard Park & Pipe'}
    assert any(q['singleRoomsPending'] for q in selected.json['preview']['quotaChecks'])
    assert review({'session':selected.json},owner).status_code==409


def test_unrelated_invalid_other_draft_remains_open_after_individual_import(owner):
    a=upload(owner,'SB');bad=rows('FS');bad[0]['Arrival_date']='bad date'
    b=upload(owner,'FS',bad)
    selected=select_submission(b,owner,a['session']['currentVersionId'])
    assert selected.status_code==200,selected.json
    run({'session':selected.json},owner);assert Athlete.query.count()==4
    current=app.test_client().get(f"/api/import/sessions/{a['session']['id']}?eventId={owner.id}").json
    assert next(s for s in current['submissions'] if s['family']=='Freestyle')['status']=='DRAFT'


@pytest.mark.parametrize('conflict',[False,True])
def test_common_room_request_is_counted_once_or_conflicts(owner,conflict):
    sb=rows('SB');fs=shared_fs()
    upload(owner,'SB',sb,room_data=sb)
    room_rows=[dict(p) for p in fs]
    if conflict:room_rows[0]['Room_type']='Single'
    b=upload(owner,'FS',fs,room_data=room_rows)
    combined=compose(b,owner)
    if conflict:
        assert combined.status_code==409
        assert review(b,owner).status_code==409
        return
    assert combined.status_code==200,combined.json
    assert len(combined.json['preview']['people'])==10 and len(combined.json['preview']['rooms'])==10
    shared=next(r for r in combined.json['preview']['rooms'] if len(r['sourceRows'])==2)
    assert {r['version'] for r in shared['sourceRows']}=={1,2}
    run({'session':combined.json},owner);assert Athlete.query.count()==10


def test_unrelated_stale_tariff_command_in_other_draft_does_not_block(owner):
    run(upload(owner,'FS'),owner)
    draft=upload(owner,'FS');sid=draft['session']['id'];key=rows('FS')[0]['Fiscode']
    staged=app.test_client().patch(f'/api/import/sessions/{sid}/accommodation-rates/{key}?eventId={owner.id}',json={'accommodationRateCategory':'SPECIAL'})
    assert staged.status_code==200,staged.json
    person=Athlete.query.filter_by(fis_code=key).one();person.accommodation_rate_category='SPECIAL';person.accommodation_rate_source='MANUAL';db.session.commit()
    sb=upload(owner,'SB');run(sb,owner)
    assert Athlete.query.count()==11
    db.session.refresh(person);assert person.accommodation_rate_category=='SPECIAL'


def test_room_partner_aliases_use_existing_exact_parser_matches(owner):
    sb=rows('SB');fs=rows('FS')
    for i in (0,1):
        for key in ('Firstname','Fiscode','Competitorid/Staff ID'):fs[i][key]=sb[i][key]
        sb[i]['Shared_with_name']=f"Partial {sb[1-i]['Firstname']}"
        fs[i]['Shared_with_name']=f"{sb[1-i]['Firstname']} Partial"
    sb_rooms=[dict(p,**{'Shared with Name':p.get('Shared_with_name')}) for p in sb]
    fs_rooms=[dict(p,**{'Shared with Name':p.get('Shared_with_name')}) for p in fs]
    upload(owner,'SB',sb,room_data=sb_rooms);b=upload(owner,'FS',fs,room_data=fs_rooms)
    combined=compose(b,owner);assert combined.status_code==200,combined.json
    assert len(combined.json['preview']['people'])==9 and len(combined.json['preview']['rooms'])==8
    run({'session':combined.json},owner);assert Athlete.query.count()==9


def test_existing_mirrored_room_rows_keep_occupant_specific_dates(owner):
    sb=rows('SB')
    sb[1]['Arrival_date']='05.03.2027'
    for i in (0,1):sb[i]['Shared with Name']=f"Partial {sb[1-i]['Firstname']}"
    a=upload(owner,'SB',sb,room_data=sb)
    assert len(a['rooms'])==4
    run(a,owner);assert Athlete.query.count()==4


def test_legacy_imported_other_family_is_in_nation_total_without_reclassifying_history(owner):
    a=upload(owner,'SB');run(a,owner)
    session=db.session.get(ImportSession,int(a['session']['id']))
    old=json.loads(session.current_version.preview_json);old.pop('replacementScope')
    session.current_version.preview_json=json.dumps(old);db.session.commit()
    frozen=session.current_version.preview_json;before=snapshot(Athlete.query.all())
    b=upload(owner,'FS')
    assert len(b['session']['submissions'])==1
    assert b['session']['submissionTotal']=={'people':11,'athletes':7,'retainedPeople':4}
    run(b,owner)
    assert snapshot(Athlete.query.filter(Athlete.id.in_(before)).all())==before
    assert Athlete.query.count()==11
    assert db.session.get(type(session.current_version),int(a['session']['currentVersionId'])).preview_json==frozen


def test_changed_source_facts_invalidate_current_composed_review(owner):
    a=upload(owner,'SB');b=upload(owner,'FS');combined=compose(b,owner)
    assert review({'session':combined.json},owner).status_code==200
    from models import ImportSessionVersion
    source=db.session.get(ImportSessionVersion,int(a['session']['currentVersionId']))
    value=json.loads(source.preview_json);value['people'][0]['arrivalDate']='2027-03-05'
    source.preview_json=json.dumps(value);db.session.commit()  # Simulate out-of-band modification, not a supported write path.
    response=app.test_client().post(f"/api/import/sessions/{b['session']['id']}/import?eventId={owner.id}",json={'versionId':combined.json['currentVersionId']})
    assert response.status_code==409 and response.json['error']=='STALE_PREVIEW'
    assert Athlete.query.count()==0
