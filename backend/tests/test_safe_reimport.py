"""PR3 HTTP and transaction acceptance; isolated PostgreSQL only."""
import io,json
from datetime import date
from unittest.mock import patch
import pandas as pd
import pytest
from test_import_event_identity import events
from app import app
from models import db,Athlete,RoomBooking,RoomBookingOccupant,Hotel,RoomType,ImportSession,ImportSessionVersion,ImportSessionEvent,ImportRun,ImportApproval
from excel_import import PREVIEW_STORE
pytestmark=pytest.mark.explicit_event_ownership


def upload(event,codes=('9300953','9300954'),changed=None,session_id=None):
    people=[dict(Firstname='Person'+str(i),Lastname='Snapshot',Nationcode='JPN',Function='Athlete',Gender='M',
        Fiscode=c,**{'Competitorid/Staff ID':'s'+c},WSC_PGS_M_6170='YES',Room_type='Double shared',Arrival_date='03.03.2027',Departure_date='09.03.2027') for i,c in enumerate(codes)]
    if changed:changed(people)
    a,b=io.BytesIO(),io.BytesIO()
    pd.DataFrame(people,columns=list(people[0]) if people else ['Firstname','Lastname','Nationcode','Function','Gender','Fiscode','Competitorid/Staff ID','WSC_PGS_M_6170','Room_type','Arrival_date','Departure_date']).to_excel(a,index=False,sheet_name='Data');pd.DataFrame(columns=['no data available']).to_excel(b,index=False,sheet_name='Data');a.seek(0);b.seek(0)
    response=app.test_client().post('/api/import/fis/preview',data=dict(eventId=str(event.id),createSession='true',**({'sessionId':str(session_id)} if session_id else {}),entriesList=(a,'entries.xlsx'),roomListDetailed=(b,'rooms.xlsx')))
    assert response.status_code==200,response.json
    assert response.json['isValid'],response.json
    return response.json


def review(payload,event,destructive=False):
    sid=payload['session']['id']
    response=app.test_client().get(f'/api/import/sessions/{sid}?eventId={event.id}')
    assert response.status_code==200,response.json
    p=response.json['preview']
    return app.test_client().post(f'/api/import/sessions/{sid}/approve?eventId={event.id}',json=dict(snapshotScope='FULL_NATION',planDigest=p['changePlan']['digest'],confirmDestructiveChanges=destructive))


def run(payload,event,destructive=False):
    approved=review(payload,event,destructive);assert approved.status_code==200,approved.json
    response=app.test_client().post(f"/api/import/sessions/{payload['session']['id']}/import?eventId={event.id}",json={'versionId':payload['session']['currentVersionId']})
    assert response.status_code==200,response.json
    return response.json


def booking(people,counts=False):
    h=Hotel(name='Snapshot hotel');r=RoomType(name='Snapshot DZ',max_persons=2);db.session.add_all([h,r]);db.session.flush()
    b=RoomBooking(event_id=people[0].event_id,hotel_id=h.id,room_type_id=r.id,counts_as_single=counts,check_in_date=date(2027,3,3),check_out_date=date(2027,3,9))
    db.session.add(b);db.session.flush()
    for p in people:db.session.add(RoomBookingOccupant(room_booking_id=b.id,athlete_id=p.id))
    db.session.commit();return b


def test_first_import_reimport_durable_and_two_events(events):
    for event in events:
        first=upload(event);PREVIEW_STORE.clear();result=run(first,event)
        assert result['summary']['peopleCreated']==2
        ids=[p.id for p in Athlete.query.filter_by(event_id=event.id).order_by(Athlete.id)]
        again=upload(event);assert again['session']['version']==2
        assert len(again['changePlan']['people']['unchanged'])==2
        repeated=run(again,event)
        assert repeated['summary']['peopleCreated']==0 and repeated['summary']['peopleUpdated']==0
        assert [p.id for p in Athlete.query.filter_by(event_id=event.id).order_by(Athlete.id)]==ids
    assert Athlete.query.count()==4


@pytest.mark.parametrize('explicit_event', [False, True])
def test_string_configured_event_approval_has_no_operational_writes(events, monkeypatch, explicit_event):
    from sqlalchemy import event as sql_event
    from sqlalchemy.orm import Session
    a, _ = events
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(a.id))
    pending = upload(a)
    sid = pending['session']['id']
    suffix = f'?eventId={a.id}' if explicit_event else ''
    client = app.test_client()
    current = client.get(f'/api/import/sessions/{sid}{suffix}')
    assert current.status_code == 200, current.json
    writes = []
    def capture(session, *_):
        writes.extend(type(obj).__name__ for obj in session.new.union(session.dirty).union(session.deleted)
                      if isinstance(obj, (Athlete, RoomBooking, RoomBookingOccupant, ImportRun)))
    sql_event.listen(Session, 'before_flush', capture, insert=True)
    try:
        approved = client.post(f'/api/import/sessions/{sid}/approve{suffix}', json=dict(
            snapshotScope='FULL_NATION', planDigest=current.json['preview']['changePlan']['digest'],
            confirmDestructiveChanges=False))
    finally:
        sql_event.remove(Session, 'before_flush', capture)
    assert approved.status_code == 200, approved.json
    assert writes == []
    assert Athlete.query.count() == RoomBooking.query.count() == ImportRun.query.count() == 0
    imported = client.post(f'/api/import/sessions/{sid}/import{suffix}',
                           json={'versionId': pending['session']['currentVersionId']})
    assert imported.status_code == 200, imported.json
    assert imported.json['summary']['peopleCreated'] == 2
    assert {p.event_id for p in Athlete.query.all()} == {a.id}
    assert {r.event_id for r in ImportRun.query.all()} == {a.id}


def test_configured_operational_event_blocks_foreign_import_reads_and_writes(events, monkeypatch):
    a, b = events
    pending = upload(b)
    sid = pending['session']['id']
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(a.id))
    client = app.test_client()
    for method, path, kwargs in [
        ('get', f'/api/import/sessions/{sid}?eventId={b.id}', {}),
        ('get', f'/api/import/sessions?eventId={b.id}', {}),
        ('post', f'/api/import/sessions/{sid}/approve?eventId={b.id}', {'json': {}}),
        ('post', f'/api/import/sessions/{sid}/import?eventId={b.id}', {'json': {}}),
        ('post', '/api/import/fis/preview', {'data': {'eventId': str(b.id)}}),
    ]:
        denied = getattr(client, method)(path, **kwargs)
        assert denied.status_code == 409, denied.json
        assert denied.json['error'] == 'OPERATIONAL_EVENT_REQUIRED'
    assert Athlete.query.count() == RoomBooking.query.count() == ImportRun.query.count() == 0
    assert db.session.get(ImportSession, sid).status != 'APPROVED'


def test_explicit_deletion_retains_shared_booking_and_other_event(events):
    a,b=events;run(upload(a),a);run(upload(b),b)
    people=Athlete.query.filter_by(event_id=a.id).order_by(Athlete.id).all();shared=booking(people);bid=shared.id
    removed=people[1];removed.accommodation_rate_category='SPECIAL';removed.accommodation_rate_source='MANUAL';db.session.commit()
    current=upload(a,('9300953',));plan=current['changePlan']
    assert [p['personId'] for p in plan['people']['remove']]==[removed.id]
    assert plan['operations']['deleteEmptyBookingIds']==[]
    denied=review(current,a);assert denied.status_code==409 and denied.json['error']=='IMPORT_DELETION_CONFIRMATION_REQUIRED'
    result=run(current,a,True)
    assert result['summary']['peopleRemoved']==1 and result['summary']['occupantsRemoved']==1 and result['summary']['dispositionsChanged']==1
    db.session.expire_all();retained=db.session.get(RoomBooking,bid)
    assert retained and not retained.counts_as_single and len(retained.occupants)==1
    assert Athlete.query.filter_by(event_id=b.id).count()==2
    evidence=ImportSessionEvent.query.filter_by(event_type='IMPORTED').order_by(ImportSessionEvent.id.desc()).first()
    assert json.loads(evidence.description)['removedPeople'][0]['before']['accommodation_rate_category']=='SPECIAL'


def test_empty_booking_only_deleted_as_reviewed(events):
    a,_=events;run(upload(a),a)
    removed=Athlete.query.filter_by(fis_code='9300954').one();b=booking([removed],True);bid=b.id
    current=upload(a,('9300953',));assert current['changePlan']['operations']['deleteEmptyBookingIds']==[bid]
    assert run(current,a,True)['summary']['bookingsRemoved']==1
    assert db.session.get(RoomBooking,bid) is None


@pytest.mark.parametrize('mutation',['person','booking','membership','mapping','approval'])
def test_stale_state_rejects_approval(events,mutation):
    a,_=events;run(upload(a),a);current=upload(a);p=Athlete.query.order_by(Athlete.id).first()
    if mutation=='person':p.phone='new'
    elif mutation=='booking':booking([p])
    elif mutation=='membership':p.competitions=[]
    elif mutation=='mapping':a.competition_mappings[0].official_name='changed'
    else:
        session=ImportSession.query.one();db.session.add(ImportApproval(session_id=session.id,version_id=session.current_version_id,nation='JPN',approval_type='NATION_APPROVED',description='New evidence',decision='APPROVED',username='test'))
    db.session.commit();response=review(current,a)
    assert response.status_code==409 and response.json['error']=='STALE_PREVIEW',response.json


def test_atomic_rollback_and_idempotent_retry(events):
    a,_=events;current=upload(a);assert review(current,a).status_code==200
    sid=current['session']['id']
    with patch.object(db.session,'commit',side_effect=RuntimeError('fault at completion')):
        response=app.test_client().post(f'/api/import/sessions/{sid}/import?eventId={a.id}',json={'versionId':current['session']['currentVersionId']});assert response.status_code==400
    db.session.expire_all()
    assert Athlete.query.count()==0 and ImportRun.query.count()==0 and db.session.get(ImportSession,int(sid)).status=='APPROVED'
    first=app.test_client().post(f'/api/import/sessions/{sid}/import?eventId={a.id}',json={'versionId':current['session']['currentVersionId']});assert first.status_code==200,first.json
    again=app.test_client().post(f'/api/import/sessions/{sid}/import?eventId={a.id}',json={'versionId':current['session']['currentVersionId']});assert again.status_code==200 and again.json['idempotent']
    assert Athlete.query.count()==2 and ImportRun.query.count()==1


def test_cancel_followup_preserves_imported_version(events):
    a,_=events;first=upload(a);run(first,a);sid=first['session']['id'];v1=first['session']['currentVersionId'];newer=upload(a,('9300953',))
    response=app.test_client().post(f'/api/import/sessions/{sid}/cancel?eventId={a.id}',json={'versionId':newer['session']['currentVersionId']})
    assert response.status_code==200 and response.json['currentVersionId']==v1 and response.json['status']=='IMPORTED',response.json
    assert len(response.json['versions'])==2 and Athlete.query.count()==2
    invalid=app.test_client().post('/api/import/fis/confirm',json={'eventId':a.id,'previewToken':newer['previewToken']});assert invalid.status_code!=200


def test_recheck_creates_version_without_person_changes(events):
    a,_=events;first=upload(a);run(first,a);sid=first['session']['id']
    p=Athlete.query.first();p.accommodation_rate_category='SPECIAL';p.accommodation_rate_source='MANUAL';db.session.commit()
    response=app.test_client().post(f'/api/import/sessions/{sid}/recheck?eventId={a.id}')
    assert response.status_code==200 and response.json['version']==2,response.json
    assert Athlete.query.count()==2 and ImportRun.query.count()==1
    assert response.json['preview']['people'][0]['accommodationRateCategory']=='SPECIAL'


def test_confirm_stale_after_approval_and_new_version(events):
    a,_=events;first=upload(a);run(first,a);current=upload(a);assert review(current,a).status_code==200
    p=Athlete.query.first();p.internal_note='edited after approval';db.session.commit()
    sid=current['session']['id']
    denied=app.test_client().post(f'/api/import/sessions/{sid}/import?eventId={a.id}',json={'versionId':current['session']['currentVersionId']})
    assert denied.status_code==409 and denied.json['error']=='STALE_PREVIEW'
    newer=upload(a)
    old=app.test_client().post('/api/import/fis/confirm',json={'eventId':a.id,'previewToken':current['previewToken']})
    assert old.status_code!=200
    assert newer['session']['currentVersionId']!=current['session']['currentVersionId']
    assert ImportRun.query.count()==1


def test_partial_write_failure_rolls_back_deletions_and_memberships(events):
    import app as routes
    a,_=events;run(upload(a),a)
    b=booking([Athlete.query.filter_by(fis_code='9300954').one()],False);bid=b.id
    current=upload(a,('9300953',));assert review(current,a,True).status_code==200
    original=routes.confirm_fis_import
    def fail(*args,**kwargs):
        original(*args,**kwargs)
        raise RuntimeError('after persistence, before session completion')
    with patch.object(routes,'confirm_fis_import',side_effect=fail):
        response=app.test_client().post(f"/api/import/sessions/{current['session']['id']}/import?eventId={a.id}",json={'versionId':current['session']['currentVersionId']})
        assert response.status_code==400
    db.session.expire_all()
    assert Athlete.query.count()==2 and ImportRun.query.count()==1
    assert db.session.get(RoomBooking,bid) and RoomBookingOccupant.query.count()==1
    assert ImportSession.query.one().status=='APPROVED'


def test_parallel_confirm_has_exactly_one_completion(events):
    from concurrent.futures import ThreadPoolExecutor
    a,_=events;current=upload(a);assert review(current,a).status_code==200
    eid=a.id;sid=current['session']['id']
    db.session.remove()
    def confirm(_):
        with app.test_client() as client:
            response=client.post(f'/api/import/sessions/{sid}/import?eventId={eid}',json={'versionId':current['session']['currentVersionId']})
            return response.status_code,response.json
    with ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(confirm,range(2)))
    assert all(status==200 for status,_ in results),results
    assert sum(bool(result.get('idempotent')) for _,result in results)==1
    assert Athlete.query.count()==2 and ImportRun.query.count()==1
    assert ImportSessionEvent.query.filter_by(event_type='IMPORTED').count()==1


def test_membership_changes_use_reviewed_plan(events):
    a,_=events;run(upload(a),a)
    def change(people):
        for p in people:
            p['WSC_PGS_M_6170']='NO';p['WSC_SS_M_6188']='YES'
    current=upload(a,changed=change)
    assert len(current['changePlan']['memberships']['remove'])==2
    assert len(current['changePlan']['memberships']['add'])==2
    denied=review(current,a);assert denied.status_code==409
    result=run(current,a,True)
    assert result['summary']['membershipsRemoved']==2
    assert all({c.import_code for c in p.competitions}=={'WSC_SS_M_6188'} for p in Athlete.query.all())


def test_manual_values_and_false_single_flag_survive(events):
    a,_=events;run(upload(a),a)
    people=Athlete.query.order_by(Athlete.id).all()
    people[0].accommodation_requirement='NO_ROOM';people[0].accommodation_requirement_source='MANUAL'
    people[0].accommodation_rate_category='SPECIAL';people[0].accommodation_rate_source='MANUAL'
    people[0].single_room_quota_exempt_reason='OTHER'
    b=booking([people[1]],False);bid=b.id
    current=upload(a);run(current,a)
    db.session.expire_all()
    p=Athlete.query.order_by(Athlete.id).first()
    assert (p.accommodation_requirement,p.accommodation_requirement_source,p.accommodation_rate_category,p.single_room_quota_exempt_reason)==('NO_ROOM','MANUAL','SPECIAL','OTHER')
    assert db.session.get(RoomBooking,bid).counts_as_single is False


def test_real_jpn_durable_workflow_and_same_file_recheck(events):
    import os
    from pathlib import Path
    entries=os.environ.get('JPN_ENTRIES_FILE');rooms=os.environ.get('JPN_ROOMS_FILE')
    if not entries or not rooms:pytest.skip('Real JPN workbooks supplied via environment')
    a,_=events;client=app.test_client()
    def load():
        response=client.post('/api/import/fis/preview',data={'eventId':str(a.id),'createSession':'true',
            'entriesList':(io.BytesIO(Path(entries).read_bytes()),Path(entries).name),
            'roomListDetailed':(io.BytesIO(Path(rooms).read_bytes()),Path(rooms).name)})
        assert response.status_code==200,response.json
        return response.json
    current=load();sid=current['session']['id']
    for approval in current['session']['approvals']:
        if approval['decision']=='APPROVED':continue
        details=approval['quotaDetails'];keys=[p['personKey'] for p in details.get('singleRoomCandidates',[])][:details.get('excessCount',0)]
        response=client.patch(f"/api/import/sessions/{sid}/approvals/{approval['id']}?eventId={a.id}",json=dict(decision='APPROVED',approvalType='NATION_APPROVED',approvalMethod='EMAIL',approvalBy='JPN test',approvalDate='2026-10-22T12:00:00Z',approvedPersonKeys=keys))
        assert response.status_code==200,response.json
    PREVIEW_STORE.clear()
    result=run(current,a);assert result['summary']['peopleCreated']==64
    again=load();assert again['knownFiles']
    run(again,a)
    assert Athlete.query.count()==64


def test_aus_fixture_actual_session_performance(events,monkeypatch):
    from pathlib import Path
    from sqlalchemy import event as sql_event
    import excel_import
    a,_=events
    fixture=json.loads((Path(__file__).parent/'fixtures/real_entries/AUS.json').read_text())
    frames=[pd.DataFrame(fixture['entries']),pd.DataFrame(fixture['rooms'])]
    monkeypatch.setattr(excel_import,'load_first_sheet',lambda path:frames[0] if path==paths[0] else frames[1])
    # Upload saves two temporary paths; collect them without changing parser behavior.
    original=__import__('app')._save_uploaded_excel;paths=[]
    def save(file):
        path=original(file);paths.append(path);return path
    monkeypatch.setattr('app._save_uploaded_excel',save)
    def invoke():
        paths.clear()
        return app.test_client().post('/api/import/fis/preview',data={'eventId':str(a.id),'createSession':'true','entriesList':(io.BytesIO(b'fixture'),'entries.xlsx'),'roomListDetailed':(io.BytesIO(b'fixture'),'rooms.xlsx')})
    statements=[]
    def counted(*args):statements.append(args[2])
    sql_event.listen(db.engine,'before_cursor_execute',counted)
    try:
        first=invoke();assert first.status_code==200,first.json
        preview_count=len(statements);statements.clear()
        run(first.json,a)
        statements.clear()
        again=invoke();assert again.status_code==200,again.json
        repeat_preview_count=len(statements)
        approved=review(again.json,a);assert approved.status_code==200,approved.json
        statements.clear()
        result=app.test_client().post(f"/api/import/sessions/{again.json['session']['id']}/import?eventId={a.id}",json={'versionId':again.json['session']['currentVersionId']})
        confirm_count=len(statements)
        assert result.status_code==200,result.json
        assert Athlete.query.count()==58
        print('AUS HTTP SQL counts: preview=',preview_count,'repeat preview=',repeat_preview_count,'confirm=',confirm_count)
        assert preview_count<80 and repeat_preview_count<80 and confirm_count<160
    finally:sql_event.remove(db.engine,'before_cursor_execute',counted)


def test_source_updates_and_new_people_follow_plan(events):
    a,_=events;run(upload(a),a)
    first=Athlete.query.filter_by(fis_code='9300953').one();pid=first.id
    def changed(people):people[0]['Firstname']='Changed'
    current=upload(a,('9300953','9300954','9300955'),changed)
    assert len(current['changePlan']['people']['create'])==1
    assert current['changePlan']['people']['update'][0]['personId']==pid
    result=run(current,a)
    assert result['summary']['peopleCreated']==1 and result['summary']['peopleUpdated']==1
    assert db.session.get(Athlete,pid).firstname=='Changed'


def test_scope_digest_and_exact_version_are_mandatory(events):
    a,_=events;current=upload(a);sid=current['session']['id'];client=app.test_client()
    for body in ({}, {'snapshotScope':'FULL_NATION','planDigest':'wrong'},
                 {'snapshotScope':'SNOWBOARD','planDigest':current['changePlan']['digest']}):
        denied=client.post(f'/api/import/sessions/{sid}/approve?eventId={a.id}',json=body)
        assert denied.status_code==409 and denied.json['error']=='IMPORT_SCOPE_CONFIRMATION_REQUIRED'
    assert review(current,a).status_code==200
    denied=client.post(f'/api/import/sessions/{sid}/import?eventId={a.id}')
    assert denied.status_code==409 and denied.json['error']=='IMPORT_VERSION_REQUIRED'
    assert Athlete.query.count()==0


def test_cache_tampering_cannot_replace_durable_facts(events):
    a,_=events;current=upload(a)
    PREVIEW_STORE[current['previewToken']]['people'][0]['firstname']='Unreviewed cache edit'
    run(current,a)
    assert Athlete.query.filter_by(fis_code='9300953').one().firstname=='Person0'


def test_legacy_partner_cleanup_is_explicit_and_retains_survivors(events):
    from models import RoomAssignment,FisRoomAssignment
    a,_=events;run(upload(a),a)
    keep,removed=Athlete.query.order_by(Athlete.id).all();shared=booking([keep,removed],False)
    keep.shared_with_name=f'{removed.lastname}, {removed.firstname}'
    legacy=RoomAssignment(athlete_id=keep.id,shared_with_athlete_id=removed.id,hotel_id=shared.hotel_id,room_type_id=shared.room_type_id)
    fis=FisRoomAssignment(source_row_key='reviewed-legacy',room_type='Double',person1_id=removed.id,person2_id=keep.id)
    db.session.add_all([legacy,fis]);db.session.commit();lid,fid,kid=legacy.id,fis.id,keep.id
    current=upload(a,('9300953',));ops=current['changePlan']['operations']
    assert ops['legacy']==[{'id':lid,'action':'CLEAR_PARTNER'}]
    assert ops['fis']==[{'id':fid,'action':'RETAIN_SURVIVOR','survivorId':kid}]
    assert ops['clearPartnerFields']==[kid]
    run(current,a,True);db.session.expire_all()
    assert db.session.get(RoomAssignment,lid).shared_with_athlete_id is None
    assert (db.session.get(FisRoomAssignment,fid).person1_id,db.session.get(FisRoomAssignment,fid).person2_id)==(kid,None)
    assert db.session.get(Athlete,kid).shared_with_name is None


def test_cancel_retains_historical_approval_and_booking(events):
    a,_=events;first=upload(a);run(first,a)
    session=ImportSession.query.one();p=Athlete.query.first();b=booking([p],False)
    approval=ImportApproval(session_id=session.id,version_id=session.current_version_id,nation='JPN',
        approval_type='NATION_APPROVED',description='Immutable historical evidence',decision='APPROVED',username='earlier-reviewer',quota_details_json='{"evidence":"original"}')
    db.session.add(approval);db.session.commit();aid,bid,pid=approval.id,b.id,p.id
    before=approval.to_dict();v1=session.current_version.preview_json
    current=upload(a,('9300953',))
    response=app.test_client().post(f"/api/import/sessions/{session.id}/cancel?eventId={a.id}",json={'versionId':current['session']['currentVersionId']})
    assert response.status_code==200,response.json
    db.session.expire_all()
    assert db.session.get(ImportApproval,aid).to_dict()==before
    assert db.session.get(RoomBooking,bid).counts_as_single is False
    assert db.session.get(Athlete,pid) and Athlete.query.count()==2
    assert db.session.get(ImportSessionVersion,int(first['session']['currentVersionId'])).preview_json==v1


def test_empty_full_snapshot_requires_explicit_session_and_deletion_review(events):
    a,_=events;first=upload(a);run(first,a)
    current=upload(a,(),session_id=first['session']['id'])
    assert current['changePlan']['nation']=='JPN'
    assert len(current['changePlan']['people']['remove'])==2
    assert review(current,a).status_code==409
    run(current,a,True)
    assert Athlete.query.count()==0


def test_cancel_restores_legacy_import_from_existing_history(events):
    a,_=events;first=upload(a);run(first,a);session=ImportSession.query.one()
    prior=session.current_version
    legacy=json.loads(prior.preview_json);legacy.pop('_workflow');prior.preview_json=json.dumps(legacy);db.session.commit()
    current=upload(a,('9300953',))
    response=app.test_client().post(f"/api/import/sessions/{session.id}/cancel?eventId={a.id}",json={'versionId':current['session']['currentVersionId']})
    assert response.status_code==200,response.json
    assert response.json['currentVersionId']==first['session']['currentVersionId']
    assert response.json['status']=='IMPORTED' and Athlete.query.count()==2


@pytest.mark.parametrize('kind',['supersession','historical_preview'])
def test_historical_decision_evidence_changes_invalidate_plan(events,kind):
    a,_=events;first=upload(a);run(first,a);current=upload(a)
    if kind=='supersession':
        session=ImportSession.query.one()
        db.session.add(ImportSessionEvent(session_id=session.id,version_id=session.current_version_id,
            event_type='QUOTA_DECISION_REVISED_FROM',title='Decision revision',username='other-reviewer'))
    else:
        version=db.session.get(ImportSessionVersion,int(first['session']['currentVersionId']))
        facts=json.loads(version.preview_json);facts['people'][0]['firstname']='Historical evidence edited'
        version.preview_json=json.dumps(facts)
    db.session.commit();response=review(current,a)
    assert response.status_code==409 and response.json['error']=='STALE_PREVIEW',response.json
