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


@pytest.fixture(autouse=True)
def operational_test_context(events, monkeypatch):
    # Production stays single-event. Tests select their deployment owner explicitly.
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(events[0].id))


def upload(event,codes=('9300953','9300954'),changed=None,session_id=None,room_data=None,*,valid=True):
    people=[dict(Firstname='Person'+str(i),Lastname='Snapshot',Nationcode='JPN',Function='Athlete',Gender='M',
        Fiscode=c,**{'Competitorid/Staff ID':'s'+c},WSC_PGS_M_6170='YES',Room_type='Double shared',Arrival_date='03.03.2027',Departure_date='09.03.2027') for i,c in enumerate(codes)]
    if changed:changed(people)
    a,b=io.BytesIO(),io.BytesIO()
    pd.DataFrame(people,columns=list(dict.fromkeys(key for row in people for key in row)) if people else ['Firstname','Lastname','Nationcode','Function','Gender','Fiscode','Competitorid/Staff ID','WSC_PGS_M_6170','Room_type','Arrival_date','Departure_date']).to_excel(a,index=False,sheet_name='Data');(pd.DataFrame(room_data,columns=['Firstname','Lastname','Nationcode','Room_type','Arrival_date','Departure_date','Shared with Name']) if room_data is not None else pd.DataFrame(columns=['no data available'])).to_excel(b,index=False,sheet_name='Data');a.seek(0);b.seek(0)
    response=app.test_client().post('/api/import/fis/preview',data=dict(eventId=str(event.id),createSession='true',**({'sessionId':str(session_id)} if session_id else {}),entriesList=(a,'entries.xlsx'),roomListDetailed=(b,'rooms.xlsx')))
    assert response.status_code==200,response.json
    assert response.json['isValid'] is valid,response.json
    return response.json


def review(payload,event,destructive=False):
    sid=payload['session']['id']
    response=app.test_client().get(f'/api/import/sessions/{sid}?eventId={event.id}')
    assert response.status_code==200,response.json
    p=response.json['preview']
    return app.test_client().post(f'/api/import/sessions/{sid}/approve?eventId={event.id}',json=dict(snapshotScope=p['changePlan']['snapshotScope'],planDigest=p['changePlan']['digest'],confirmDestructiveChanges=destructive))


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
        with patch.dict(app.config, OPERATIONAL_EVENT_ID=str(event.id)):
            first=upload(event);PREVIEW_STORE.clear();result=run(first,event)
            assert result['summary']['peopleCreated']==2
            ids=[p.id for p in Athlete.query.filter_by(event_id=event.id).order_by(Athlete.id)]
            again=upload(event);assert again['session']['version']==2
            assert len(again['changePlan']['people']['unchanged'])==2
            repeated=run(again,event)
            assert repeated['summary']['peopleCreated']==0 and repeated['summary']['peopleUpdated']==0
            assert [p.id for p in Athlete.query.filter_by(event_id=event.id).order_by(Athlete.id)]==ids
            queue = app.test_client().get('/api/import/sessions?view=queue').json
            assert [(row['id'], row['version'], row['status'], row['pendingDecisions']) for row in queue] == [
                (again['session']['id'], 2, 'IMPORTED', 0),
            ]
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
            snapshotScope=current.json['preview']['changePlan']['snapshotScope'], planDigest=current.json['preview']['changePlan']['digest'],
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
    with patch.dict(app.config, OPERATIONAL_EVENT_ID=str(b.id)):
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
    a,b=events;run(upload(a),a)
    with patch.dict(app.config, OPERATIONAL_EVENT_ID=str(b.id)):
        run(upload(b),b)
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
        response=client.patch(f"/api/import/sessions/{sid}/approvals/{approval['id']}?eventId={a.id}",json=dict(decision='APPROVED',approvalType='NATION_APPROVED',approvalMethod='EMAIL',approvalBy='JPN test',approvalDate='2026-10-22T12:00:00Z',approvedPersonKeys=keys,**({'approvedExtent':details['uncoveredExtent']} if details.get('decisionKind')=='ATHLETE_QUOTA' else {})))
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


def test_regular_snapshot_needs_plan_consent_not_a_scope_checkbox(events):
    a,_=events;c=app.test_client()
    first=upload(a);sid=first['session']['id']
    plan=c.get(f'/api/import/sessions/{sid}').json['preview']['changePlan']
    assert c.post(f'/api/import/sessions/{sid}/approve',json={'planDigest':plan['digest']}).status_code==200
    assert c.post(f'/api/import/sessions/{sid}/import',json={'versionId':db.session.get(ImportSession,int(sid)).current_version_id}).status_code==200
    assert Athlete.query.filter_by(event_id=a.id,nation_code='JPN').count()==2
    second=upload(a,codes=('9300953',));sid=second['session']['id']
    plan=c.get(f'/api/import/sessions/{sid}').json['preview']['changePlan']
    assert len(plan['people']['remove'])==1
    assert Athlete.query.filter_by(event_id=a.id,nation_code='JPN').count()==2
    assert c.post(f'/api/import/sessions/{sid}/approve',json={'planDigest':plan['digest']}).status_code==409
    assert Athlete.query.filter_by(event_id=a.id,nation_code='JPN').count()==2
    assert c.post(f'/api/import/sessions/{sid}/approve',json={'planDigest':plan['digest'],'confirmDestructiveChanges':True}).status_code==200
    assert c.post(f'/api/import/sessions/{sid}/import',json={'versionId':db.session.get(ImportSession,int(sid)).current_version_id}).status_code==200
    assert Athlete.query.filter_by(event_id=a.id,nation_code='JPN').count()==1


def nn_review(payload,event,total):
    client=app.test_client();sid=payload['session']['id']
    current=client.get(f'/api/import/sessions/{sid}?eventId={event.id}').json
    row=next(r for r in current['nnPlanning']['rows'] if r['editable'])
    plan=current['preview']['changePlan']
    return client.post(f'/api/import/sessions/{sid}/approve?eventId={event.id}',json=dict(
        snapshotScope=plan['snapshotScope'],planDigest=plan['digest'],confirmDestructiveChanges=False,
        nnPlanning=[dict(areaId=row['areaId'],baseToken=row['baseToken'],expectedTotal=total)]))


def test_nn_preview_rejects_stale_selection_and_cross_nation_scope(events,monkeypatch):
    from models import AthleteArrivalForecast
    event,_=events;client=app.test_client();current=upload(event)
    sid=current['session']['id'];state=client.get(f'/api/import/sessions/{sid}').json
    row=state['nnPlanning']['rows'][0];plan=state['preview']['changePlan']
    for choice in [dict(areaId=row['areaId'],baseToken='outdated',expectedTotal=1),dict(areaId='foreign-nation',baseToken=row['baseToken'],expectedTotal=1),dict(areaId=row['areaId'],baseToken=row['baseToken'])]:
        response=client.post(f'/api/import/sessions/{sid}/approve',json=dict(snapshotScope=plan['snapshotScope'],planDigest=plan['digest'],confirmDestructiveChanges=False,nnPlanning=[choice]))
        assert response.status_code==409,response.json
        assert AthleteArrivalForecast.query.count()==Athlete.query.count()==0
    run(current,event)
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS','incoming-viewer')
    denied=client.post(f'/api/import/sessions/{sid}/nn-planning',json=dict(versionId=current['session']['currentVersionId'],nnPlanning=[]))
    assert denied.status_code==403,denied.json
    assert AthleteArrivalForecast.query.count()==0


def test_nn_import_preview_keeps_multiple_memberships_unique_and_ambiguity_visible(events):
    event,_=events;client=app.test_client()
    def memberships(people):
        people[0]['WSC_PSL_M_6177']='YES'  # Same Snowboard Alpine area.
        people[0]['WSC_HP_M_6174']='NO'
        people[1]['WSC_HP_M_6174']='YES'  # Second event group: clarification only.
    current=upload(event,changed=memberships)
    rows=client.get(f"/api/import/sessions/{current['session']['id']}").json['nnPlanning']['rows']
    assert sum(row['reportedCount'] for row in rows)==2
    normal=next(row for row in rows if row['editable']);unclear=next(row for row in rows if not row['editable'])
    assert normal['reportedCount']==1 and unclear['reportedCount']==1 and unclear['conflict']
    assert unclear['virtualPlaces']==0 and unclear['replacedPersonIds']==[]


def test_provisional_selection_uses_confirmed_entry_order_and_protects_bookings(events):
    from arrival_planning import project, operative_projection, operational_athlete_basis
    event=events[0]
    codes=tuple(str(9400000+i) for i in range(8))
    pending=upload(event,codes)
    assert project('JPN')['reportedCount']==0
    run(pending,event)
    people={p.fis_code:p for p in Athlete.query.all()}
    row=project('JPN')['rows'][0]
    assert set(row['provisionalPersonIds'])=={str(people[c].id) for c in codes[:4]}
    assert set(row['replacedPersonIds'])=={str(people[c].id) for c in codes[4:]}
    assert row['selectedCount']==4 and Athlete.query.count()==8
    assert list(operational_athlete_basis(project('JPN')).values())==[4]
    # An uploaded correction cannot change live selection until confirmed.
    corrected=upload(event,tuple(reversed(codes)),session_id=pending['session']['id'])
    assert project('JPN')['rows'][0]['selectedPersonIds']==row['selectedPersonIds']
    run(corrected,event)
    row=project('JPN')['rows'][0]
    assert set(row['provisionalPersonIds'])=={str(people[c].id) for c in codes[4:]}
    booking([people[codes[0]],people[codes[1]]])
    row=project('JPN')['rows'][0]
    assert row['selectedCount']==4
    assert len(row['provisionalPersonIds'])==2
    assert row['selectionWarnings'] and row['reasons']
    assert not ({str(people[codes[0]].id),str(people[codes[1]].id)} & set(row['replacedPersonIds']))
    plan=operative_projection(project('JPN'))
    assert plan['virtualPlaces']==0 and plan['conflicts']==0
    assert RoomBookingOccupant.query.count()==2


@pytest.mark.parametrize('count', [0,3,4,8])
def test_provisional_selection_only_available_unique_real_people(events,count):
    from arrival_planning import project
    event=events[0]
    if count:
        run(upload(event,tuple(str(9400000+i) for i in range(count))),event)
        row=project('JPN')['rows'][0]
        assert row['selectedCount']==min(4,count)
        assert len(set(row['selectedPersonIds']))==min(4,count)
        assert row['virtualPlaces']==0
    else:
        assert project('JPN')['rows']==[]


@pytest.mark.parametrize('limit',[0,3,4])
@pytest.mark.parametrize('position',[0,6,(0,6)])
def test_verified_current_entry_champion_is_additional_without_arrival_confirmation(events,monkeypatch,position,limit):
    from arrival_planning import project
    event=events[0]
    from models import Event
    db.session.execute(db.update(Event).where(Event.id==event.id).values(is_world_championship=True,year=2027));db.session.commit();db.session.refresh(event)
    from test_event_quota_rules import housing_revision
    housing_revision(event,{'Snowboard Alpine':limit})
    codes=tuple(str(9500000+i) for i in range(8))
    positions=position if isinstance(position,tuple) else (position,)
    titles=[dict(fisCode=codes[i],nation='JPN',gender='M',discipline='PGS',eventGroup='Snowboard Alpine',championship='Engadin',championshipYear=2025,titleType='INDIVIDUAL',entitlementEnabled=True,sourceVerified=True,source='https://example.test/verified-result') for i in positions]
    monkeypatch.setattr('sport_entry_plausibility.verified_titles',lambda:titles+titles)
    pending=upload(event,codes);run(pending,event)
    row=project('JPN')['rows'][0]
    people={p.fis_code:p for p in Athlete.query.all()}
    champion_codes=[codes[i] for i in positions]
    regular=[c for c in codes if c not in champion_codes][:limit]
    assert set(row['selectedPersonIds'])=={str(people[c].id) for c in regular+champion_codes}
    assert row['selectedCount']==limit+len(positions) and row['selectedWorldChampionCount']==len(positions)
    context=app.test_client().get(f"/api/import/sessions/{pending['session']['id']}").json['nnPlanning']['operationalQuota']['rows'][0]
    assert context['expectedAthletes']==limit+len(positions) and context['officialQuota']==limit+2+len(positions)
    assert all(p.single_room_quota_exempt_reason is None for p in people.values())
    for title in titles:title['sourceVerified']=False
    row=project('JPN')['rows'][0]
    assert row['selectedCount']==limit and row['selectedWorldChampionCount']==0
    assert set(row['selectedPersonIds'])=={str(people[c].id) for c in codes[:limit]}
    # Historical title evidence cannot add a person absent from the new list.
    for title in titles:title['sourceVerified']=True
    corrected=upload(event,tuple(c for c in codes if c not in champion_codes),session_id=pending['session']['id'])
    run(corrected,event,destructive=True)
    row=project('JPN')['rows'][0]
    assert row['selectedCount']==limit and row['selectedWorldChampionCount']==0
    assert not (set(champion_codes) & {p.fis_code for p in Athlete.query.all()})


def test_retired_nn_forecasts_preserved_but_never_override_person_selection(events):
    from models import AthleteArrivalForecast
    from arrival_planning import project
    event=events[0]
    codes=tuple(str(9600000+i) for i in range(8))
    run(upload(event,codes),event)
    forecast=AthleteArrivalForecast(event_id=event.id,nation_code='JPN',discipline='Snowboard Alpine',gender='M',expected_total=0,revision=7,roster_digest='historical',updated_by='tester')
    db.session.add(forecast);db.session.commit()
    row=project('JPN')['rows'][0]
    assert row['legacyForecastInactive'] and row['expectedTotal']==0
    assert row['selectedCount']==4 and row['virtualPlaces']==0
    assert db.session.get(AthleteArrivalForecast,forecast.id).revision==7
    pending=upload(event,codes)
    rejected=nn_review(pending,event,2)
    assert rejected.status_code==409 and rejected.json['error']=='NN_PLANNING_RETIRED'
    assert Athlete.query.count()==8 and forecast.expected_total==0


@pytest.mark.parametrize('change',['gender','groups','order'])
def test_unclear_selection_never_hides_real_tasks_or_claims_valid_override(events,change):
    from arrival_planning import project,operative_projection,operational_athlete_basis
    from models import Competition
    event=events[0]
    run(upload(event,tuple(str(9700000+i) for i in range(8))),event)
    people=Athlete.query.all()
    if change=='gender':
        for p in people:p.gender=None
    elif change=='groups':
        other=Competition.query.filter_by(quota_discipline='Snowboard Cross',gender='M').first()
        for p in people:p.competitions.append(other)
    else:
        for version in ImportSessionVersion.query.all():
            data=json.loads(version.preview_json)
            for p in data.get('people',[]):p.pop('rowNumber',None);p.pop('sourceRowNumber',None)
            version.preview_json=json.dumps(data)
    db.session.commit()
    overview=project('JPN');plan=operative_projection(overview)
    assert plan['replacedPersonIds']==[] and plan['provisionalPersonIds']==[]
    assert plan['conflicts'] and not operational_athlete_basis(overview)
    assert plan['virtualPlaces']==0 and Athlete.query.count()==8


@pytest.mark.parametrize('official_count',[3,10])
def test_operational_selection_preview_matches_live_and_uses_existing_ez_tiers(events,official_count):
    from arrival_planning import project
    from quota_rules import rules_for_event
    from quota_service import compute_single_room_entitlement
    event=events[0];client=app.test_client()
    def officials(rows):
        template=dict(rows[0])
        for i in range(official_count):rows.append(dict(template,Firstname='Official'+str(i),Fiscode=str(9800100+i),**{'Competitorid/Staff ID':'o'+str(i)},Function='Coach'))
    pending=upload(event,tuple(str(9800000+i) for i in range(8)),changed=officials)
    sid=pending['session']['id']
    projected=client.get(f'/api/import/sessions/{sid}').json['nnPlanning']
    context=projected['operationalQuota']['rows'][0]
    assert context['athletesEntered']==8 and context['expectedAthletes']==4
    assert context['officialQuota']==6 and context['singleRoomOfficialBasis']==min(official_count,6)
    assert context['singleRoomsAllowed']==compute_single_room_entitlement(min(official_count,6),rules_for_event(event.id)['singleRooms'])
    assert Athlete.query.count()==0
    run(pending,event)
    live=client.get(f'/api/import/sessions/{sid}').json['nnPlanning']['operationalQuota']['rows'][0]
    for field in ('expectedAthletes','officialQuota','singleRoomOfficialBasis','singleRoomsAllowed'):
        assert live[field]==context[field]
    usage=client.get('/api/fis/official-quotas?includePeople=true').json
    assert usage['personSummary']['accommodationPeopleRequired']==8+official_count  # All real people with an open accommodation requirement.
    assert usage['personSummary']['unassigned']==8+official_count
    assert len(project('JPN')['rows'][0]['replacedPersonIds'])==4


def test_source_rows_preserve_original_selection_when_flat_row_fields_are_absent(events):
    from arrival_planning import project
    event=events[0]
    codes=tuple(str(9900000+i) for i in range(8))
    run(upload(event,codes),event)
    expected=project('JPN')['rows'][0]['selectedPersonIds']
    for version in ImportSessionVersion.query.all():
        snapshot=json.loads(version.preview_json)
        for record in snapshot.get('people',[]):
            row=record.pop('sourceRowNumber',None) or record['rowNumber']
            record.pop('rowNumber',None)
            record['sourceRows']=[dict(versionId=version.id,row=row)]
        version.preview_json=json.dumps(snapshot)
    db.session.commit()
    row=project('JPN')['rows'][0]
    assert row['selectedPersonIds']==expected and not row['conflict']


@pytest.mark.parametrize('limit',[3,4])
@pytest.mark.parametrize('resolution',['paid','exemption'])
def test_operative_ez_requirement_blocks_http_release_until_existing_decision(events,resolution,limit):
    event=events[0];client=app.test_client()
    from test_event_quota_rules import housing_revision
    housing_revision(event,{'Freeski Park & Pipe':limit})
    def staff(rows):
        template=dict(rows[0])
        for i in range(10):rows.append(dict(template,Firstname='Official'+str(i),Fiscode=str(9910100+i),**{'Competitorid/Staff ID':'official'+str(i)},Function='Coach',Room_type='Single' if i<3 else 'Double shared'))
        for p in rows:p['Nationcode']='FIN';p['WSC_HP_M_8171']=p.pop('WSC_PGS_M_6170')
        if resolution=='exemption':
            rows[0]['Room_type']='Single'
            rows[9]['Room_type']='Double shared'
    rooms=[dict(Firstname='Official'+str(i),Lastname='Snapshot',Nationcode='FIN',Room_type='Single',Arrival_date='03.03.2027',Departure_date='09.03.2027') for i in range(3)]
    if resolution=='exemption':rooms[0]['Firstname']='Person0'
    current=upload(event,tuple(str(9910000+i) for i in range(9)),changed=staff,room_data=rooms)
    sid=current['session']['id']
    state=client.get(f'/api/import/sessions/{sid}').json
    row=state['nnPlanning']['operationalQuota']['rows'][0]
    assert (row['expectedAthletes'],row['officialQuota'],row['singleRoomOfficialBasis'],row['singleRoomsAllowed'],row['singleRoomsRequested'],row['singleRoomsPending'])==(limit,limit+2,limit+2,2,3,1)
    check=state['preview']['quotaChecks'][0]
    assert (check['athletesEntered'],check['expectedAthletes'],check['registeredOfficials'],check['officialsDeviation'])==(9,limit,10,10-limit-2)
    assert (check['singleRoomsAllowed'],check['singleRoomsRequested'],check['singleRoomsPending'])==(2,3,1)
    denied=review(current,event)
    assert denied.status_code==409,denied.json
    task=next(a for a in state['approvals'] if a['decision']=='PENDING' and a['quotaDetails'].get('singleRoomCandidates'))
    if resolution=='paid':
        details=task['quotaDetails'];key=details['singleRoomCandidates'][0]['personKey']
        decision=client.patch(f"/api/import/sessions/{sid}/approvals/{task['id']}",json=dict(decision='APPROVED',approvalType='NATION_APPROVED',approvalMethod='EMAIL',approvalBy='Synthetic nation',approvalDate='2026-11-20T12:00:00Z',approvedPersonKeys=[key]))
    else:
        key=next(p['matchKey'] for p in state['preview']['people'] if p.get('fisCode')=='9910000')
        decision=client.patch(f'/api/import/sessions/{sid}/single-room-exemptions/{key}',json={'reason':'WORLD_CHAMPION'})
    assert decision.status_code==200,decision.json
    state=client.get(f'/api/import/sessions/{sid}').json
    row=state['nnPlanning']['operationalQuota']['rows'][0]
    assert row['singleRoomsPending']==0
    assert row['approvedExtraSingleRooms']==(1 if resolution=='paid' else 0)
    assert row['quotaExemptSingleRooms']==(1 if resolution=='exemption' else 0)
    run(current,event)
    state=client.get(f'/api/import/sessions/{sid}').json
    row=state['nnPlanning']['operationalQuota']['rows'][0]
    assert row['singleRoomsAllowed']==2 and row['singleRoomsPending']==0
    assert Athlete.query.count()==19 and RoomBooking.query.count()==0
    # Requested rooms are not physical single-room usage until disposition.
    live=client.get('/api/fis/official-quotas?nationCode=FIN').json[0]
    assert (live['expectedAthletes'],live['officialQuota'],live['singleRoomsAllowed'],live['singleRoomsRequested'],live['singleRoomsPending'])==(limit,limit+2,2,0,0)
    official=Athlete.query.filter_by(function='Coach').first()
    retained=booking([official],counts=True)
    live=client.get('/api/fis/official-quotas?nationCode=FIN').json[0]
    assert live['singleRoomsRequested']==1 and live['singleRoomsPending']==0
    assert db.session.get(RoomBooking,retained.id).counts_as_single
    if resolution=='paid':
        from approval_projection import projected_approval_groups
        paid=Athlete.query.filter_by(single_room_decision_id=int(task['id'])).one()
        approval=db.session.get(ImportApproval,int(task['id']))
        evidence=(approval.quota_details_json,approval.approved_person_keys_json,approval.decision)
        assert projected_approval_groups(approval,paid,roster=Athlete.query.all())
        housing_revision(event,{'Freeski Park & Pipe':limit+1})
        assert not projected_approval_groups(approval,paid,roster=Athlete.query.all())
        assert evidence==(approval.quota_details_json,approval.approved_person_keys_json,approval.decision)
        assert db.session.get(RoomBooking,retained.id).counts_as_single


@pytest.mark.parametrize('limit',[0,3,4])
def test_booked_athlete_overhang_does_not_raise_regular_official_entitlement(events,limit):
    from arrival_planning import project,operational_athlete_basis
    event=events[0]
    run(upload(event,tuple(str(9920000+i) for i in range(8))),event)
    people=Athlete.query.all()[:5];first=booking([people[0]])
    for i,person in enumerate(people[1:],2):
        room=RoomBooking(event_id=event.id,hotel_id=first.hotel_id,room_type_id=first.room_type_id,room_number=str(i),counts_as_single=False,check_in_date=first.check_in_date,check_out_date=first.check_out_date)
        db.session.add(RoomBookingOccupant(athlete_id=person.id,room_booking=room))
    db.session.commit()
    from test_event_quota_rules import housing_revision
    housing_revision(event,{'Snowboard Alpine':limit})
    overview=project('JPN');row=overview['rows'][0]
    assert row['bookedPeopleCount']==5 and row['selectedCount']==5 and row['selectionWarnings']
    assert list(operational_athlete_basis(overview).values())==[limit]
    quotas=app.test_client().get('/api/fis/official-quotas?nationCode=JPN').json
    assert quotas[0]['officialQuota']==(limit+2 if limit else 0) and quotas[0]['expectedAthletes']==limit
    assert RoomBooking.query.count()==RoomBookingOccupant.query.count()==5


def test_no_dispo_is_staged_persisted_and_releases_the_next_regular_place(events):
    from arrival_planning import project
    event = events[0]
    codes = tuple(str(9400000 + index) for index in range(5))
    def add_officials(rows):
        rows.extend({**rows[0], 'Function': 'Coach', 'Firstname': f'Official{index}',
                     'Fiscode': str(9400100 + index), 'Competitorid/Staff ID': f'official-{index}'}
                    for index in range(2))

    pending = upload(event, codes, changed=add_officials)
    sid = pending['session']['id']
    client = app.test_client()
    staged = client.patch(f'/api/import/sessions/{sid}/accommodation-requirements/{codes[0]}',
                          json={'accommodationRequirement': 'NO_DISPO'})
    assert staged.status_code == 200, staged.json
    row = staged.json['nnPlanning']['rows'][0]
    assert set(row['selectedPersonIds']) == {'preview:' + code for code in codes[1:]}
    assert 'preview:' + codes[0] in row['replacedPersonIds']
    staged_official = client.patch(f'/api/import/sessions/{sid}/accommodation-requirements/9400100',
                                   json={'accommodationRequirement': 'NO_DISPO'})
    assert staged_official.status_code == 200, staged_official.json
    quota = staged_official.json['nnPlanning']['operationalQuota']['rows'][0]
    assert (quota['athletesEntered'], quota['expectedAthletes'], quota['registeredOfficials']) == (5, 4, 1)

    run(pending, event)
    person = Athlete.query.filter_by(fis_code=codes[0]).one()
    assert (person.accommodation_requirement, person.accommodation_requirement_source) == ('NO_DISPO', 'MANUAL')
    assert person.competitions
    assert Athlete.query.count() == 7
    assert str(person.id) in project('JPN')['rows'][0]['replacedPersonIds']
    official = Athlete.query.filter_by(fis_code='9400100').one()
    from app import _build_room_booking_units
    units, _ = _build_room_booking_units()
    pending_ids = {p['athleteId'] for unit in units for p in unit['occupants']}
    assert str(person.id) not in pending_ids
    assert str(official.id) not in pending_ids
    repeated = upload(event, tuple(reversed(codes)), session_id=sid, changed=add_officials)
    assert next(p for p in repeated['people'] if p['fisCode'] == codes[0])['accommodationRequirement'] == 'NO_DISPO'
    run(repeated, event)
    assert person.accommodation_requirement == 'NO_DISPO'


@pytest.mark.parametrize('warm_cache', [False, True])
def test_requirement_patch_reuses_calculated_preview_and_rolls_back_failed_plan(events, monkeypatch, warm_cache):
    import app as routes
    import excel_import as imports
    from imports.event_context import ImportValidationError

    event = events[0]
    first = upload(event)
    run(first, event)
    draft = upload(event, session_id=first['session']['id'])
    token = draft['previewToken']
    if not warm_cache:
        PREVIEW_STORE.pop(token, None)
    client = app.test_client()
    sid = draft['session']['id']
    endpoint = f'/api/import/sessions/{sid}/accommodation-requirements/9300953'
    recalculate = imports.recalculate_fis_import_preview
    with patch.object(imports, 'recalculate_fis_import_preview', wraps=recalculate) as plan_calculation, \
         patch.object(routes, 'recalculate_fis_import_preview', wraps=recalculate) as route_calculation:
        for requirement in ('NO_DISPO', 'REQUIRED'):
            result = client.patch(endpoint, json={'accommodationRequirement': requirement})
            assert result.status_code == 200, result.json
            target = next(p for p in result.json['preview']['people'] if p['fisCode'] == '9300953')
            assert target['accommodationRequirement'] == requirement
        assert plan_calculation.call_count == 0
        assert route_calculation.call_count == (6 if warm_cache else 4)

    session = db.session.get(ImportSession, int(sid))
    pending = ImportApproval(session_id=session.id, version_id=session.current_version_id,
        nation='JPN', approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED', description='Single Rooms',
        decision='PENDING', username='test')
    db.session.add(pending)
    db.session.commit()
    with patch.object(imports, 'recalculate_fis_import_preview', wraps=recalculate) as plan_calculation:
        result = client.patch(endpoint, json={'accommodationRequirement': 'REQUIRED'})
        assert result.status_code == 200, result.json
        assert plan_calculation.call_count == 1
    assert result.json['approvals'] == []
    saved = session.current_version.preview_json
    raw_before = PREVIEW_STORE.get(token)
    history_count = ImportSessionEvent.query.filter_by(session_id=session.id).count()
    refresh = routes.refresh_plan

    def reject_plan(*args, **kwargs):
        refresh(*args, **kwargs)
        raise ImportValidationError('STALE_PREVIEW', 'Änderungsplan erneut prüfen.')

    with monkeypatch.context() as patcher:
        patcher.setattr(routes, 'refresh_plan', reject_plan)
        rejected = client.patch(endpoint, json={'accommodationRequirement': 'NO_DISPO'})
    assert rejected.status_code == 409 and rejected.json['error'] == 'STALE_PREVIEW'
    assert session.current_version.preview_json == saved
    assert ImportSessionEvent.query.filter_by(session_id=session.id).count() == history_count
    assert PREVIEW_STORE.get(token) is raw_before

    booked = booking([Athlete.query.filter_by(fis_code='9300953').one()])
    rejected = client.patch(endpoint, json={'accommodationRequirement': 'NO_ROOM'})
    assert rejected.status_code == 409 and rejected.json['reasonCode'] == 'NO_ROOM_HAS_BOOKINGS'
    assert db.session.get(RoomBooking, booked.id) is not None
    assert session.current_version.preview_json == saved


def test_no_dispo_preserves_booking_and_recalculates_recommendation(events):
    from arrival_planning import project
    from models import HotelRoomInventory

    event = events[0]
    codes = tuple(str(9400300 + index) for index in range(6))
    # Use the existing five-person quota for this fixture's planning area.
    from test_event_quota_rules import housing_revision
    housing_revision(event, {'Snowboard Alpine': 5})
    pending = upload(event, codes)
    run(pending, event)
    people = [Athlete.query.filter_by(fis_code=code).one() for code in codes]
    person = people[1]
    existing = booking([person])
    booking_id = existing.id
    db.session.add(HotelRoomInventory(hotel_id=existing.hotel_id, room_type_id=existing.room_type_id,
        available_from=existing.check_in_date, available_until=existing.check_out_date, room_count=10))
    db.session.commit()
    client = app.test_client()
    assert str(people[5].id) not in project('JPN')['rows'][0]['selectedPersonIds']
    change = client.patch(f'/api/athletes/{person.id}', json={'accommodationRequirement': 'NO_DISPO'})
    assert change.status_code == 200, change.json
    assert change.json['accommodationCoverage']['openIntervals'] == []
    assert change.json['accommodationCoverage']['conflicts'][0]['code'] == 'NO_DISPO_HAS_BOOKINGS'
    row = project('JPN')['rows'][0]
    assert str(people[5].id) in row['selectedPersonIds']
    assert str(person.id) not in row['selectedPersonIds']
    assert any('Buchung bleibt erhalten' in warning for warning in row['selectionWarnings'])
    corrected = upload(event, codes, session_id=pending['session']['id'])
    assert next(row for row in corrected['people'] if row['fisCode'] == person.fis_code)['accommodationRequirement'] == 'NO_DISPO'
    run(corrected, event)
    assert RoomBookingOccupant.query.filter_by(athlete_id=person.id).one().room_booking_id == booking_id
    assert client.patch(f'/api/athletes/{person.id}', json={'accommodationRequirement': 'REQUIRED'}).status_code == 200
    assert str(people[5].id) not in project('JPN')['rows'][0]['selectedPersonIds']
    plan = client.get('/api/assignments/planning-view?includeValidations=false').json
    assert str(people[5].id) in {p['athleteId'] for u in plan['units']['unassigned'] for p in u['occupants']}
    assert str(people[5].id) in plan['athletePlanning']['replacedPersonIds']  # Forecast only.
    for number, extra in enumerate([people[5], people[0], *people[2:5]], 2):
        assigned = client.post(f'/api/assignments/persons/{extra.id}/segments', json={
            'hotelId': str(existing.hotel_id), 'roomTypeId': str(existing.room_type_id), 'roomNumber': f'Zimmer {number:02}',
            'checkInDate': '2027-03-03', 'checkOutDate': '2027-03-09',
        })
        assert assigned.status_code == 201, assigned.json
    overview = client.get('/api/fis/official-quotas?nationCode=JPN&includePeople=true').json
    assert overview['personSummary']['fullyAssigned'] == 6
    assert overview['personSummary']['planningConflicts'] == 0
    assert any('Mehr reguläre Athleten untergebracht' in reason
               for group in overview['personPlanning']['groups'] for reason in group['reasons'])



@pytest.mark.parametrize('legacy_approved', [False, True])
@pytest.mark.parametrize('shape', ['room_gap', 'source_gap', 'partner'])
def test_unrepresentable_stays_block_approval_and_confirm(events, monkeypatch, shape, legacy_approved):
    import accommodation_requirements

    event = events[0]
    def entry_dates(rows):
        rows[0]['Departure_date'] = '13.03.2027' if shape == 'room_gap' else '06.03.2027'
        rows[1]['Arrival_date'] = '06.03.2027'
        rows[1]['Departure_date'] = '13.03.2027'

    def room(start, end, partner=None):
        return {'Firstname': 'Person0', 'Lastname': 'Snapshot', 'Nationcode': 'JPN',
                'Room_type': 'Double shared' if partner else 'Double',
                'Arrival_date': start, 'Departure_date': end, 'Shared with Name': partner}

    if shape == 'room_gap':
        rooms = [room('03.03.2027', '06.03.2027'), room('09.03.2027', '13.03.2027')]
    elif shape == 'source_gap':
        rooms = [room('09.03.2027', '13.03.2027')]
    else:
        rooms = [room('06.03.2027', '13.03.2027', 'Snapshot, Person1')]

    if legacy_approved:
        # Simulate a version reviewed before enforcement, then use real Confirm.
        with monkeypatch.context() as previous:
            previous.setattr(accommodation_requirements, '_stay_review', lambda *_: None)
            payload = upload(event, changed=entry_dates, room_data=rooms)
            approved = review(payload, event)
            assert approved.status_code == 200, approved.json
    else:
        payload = upload(event, changed=entry_dates, room_data=rooms, valid=False)
        expected = ('ACCOMMODATION_REQUIREMENT_PARTNER_STAY' if shape == 'partner'
                    else 'ACCOMMODATION_REQUIREMENT_SEPARATE_STAYS')
        assert any(error['code'] == expected for error in payload['errors'])
        assert review(payload, event).status_code == 409

    if shape == 'partner':
        assert payload['rooms'][0]['person2Key'] == '9300954'
        stays = {p['fisCode']: (p['arrivalDate'], p['departureDate']) for p in payload['people']}
        assert stays == {'9300953': ('2027-03-03', '2027-03-06'), '9300954': ('2027-03-06', '2027-03-13')}
        assert payload['rooms'][0]['checkInDate'] == '2027-03-06'
        assert payload['rooms'][0]['checkOutDate'] == '2027-03-13'

    response = app.test_client().post(
        f"/api/import/sessions/{payload['session']['id']}/import?eventId={event.id}",
        json={'versionId': payload['session']['currentVersionId']})
    assert response.status_code == 409, response.json
    if legacy_approved:
        assert response.json['error'] == 'IMPORT_VALIDATION_FAILED'
    assert Athlete.query.count() == 0
    assert RoomBooking.query.count() == 0
    assert ImportRun.query.filter_by(import_type='fis_confirm').count() == 0


def test_excel_analytics_reads_current_draft_before_confirm_without_writes(events):
    first, other = events
    upload(first, ('9300953', '9300954'))
    draft = upload(first, ('9300954', '9300955'))
    session_id = draft['session']['id']
    client = app.test_client()
    staged = client.patch(f'/api/import/sessions/{session_id}/accommodation-requirements/9300955',
                          json={'accommodationRequirement': 'NO_DISPO'})
    assert staged.status_code == 200, staged.json
    version = db.session.get(ImportSessionVersion, int(draft['session']['currentVersionId']))
    before = version.preview_json
    db.session.add(ImportSession(event_id=first.id, nation='CZE', status='DRAFT'))
    db.session.commit()
    with patch.dict(app.config, OPERATIONAL_EVENT_ID=str(other.id)):
        assert client.get('/api/analytics/import-demand').json == []
    response = client.get('/api/analytics/import-demand')
    assert response.status_code == 200, response.json
    nations = {item['nation']: item for item in response.json}
    assert set(nations) == {'CZE', 'JPN'}
    assert nations['CZE']['importStatus'] == 'NO_PREVIEW'
    assert nations['CZE']['provisional'] and nations['CZE']['roomStatus'] == 'missing'
    nation = nations['JPN']
    assert nation['importStatus'] != 'IMPORTED'
    people = {p['matchKey']: p for p in nation['people']}
    assert set(people) == {'9300954', '9300955'}
    assert people['9300954']['arrivalDate'] == '2027-03-03'
    assert people['9300955']['accommodationRequirement'] == 'NO_DISPO'
    assert 'preview:9300955' in nation['excludedIds']
    assert Athlete.query.count() == 0
    db.session.expire_all()
    assert version.preview_json == before


@pytest.mark.parametrize(('room_type', 'conflict', 'expected'), [
    ('No room', False, 'zero'),
    ('Double', False, 'missing'),
    ('No room', True, 'conflict'),
])
def test_excel_analytics_distinguishes_sui_room_evidence(events, room_type, conflict, expected):
    event = events[0]

    def swiss(rows):
        for row in rows:
            row.update(Nationcode='SUI', Room_type=room_type)

    rooms = [dict(Firstname='Person0', Lastname='Snapshot', Nationcode='SUI', Room_type='Double',
                  Arrival_date='20.03.2027', Departure_date='22.03.2027')] if conflict else None
    preview = upload(event, changed=swiss, room_data=rooms, valid=not conflict)
    response = app.test_client().get('/api/analytics/import-demand')
    assert response.status_code == 200, response.json
    swiss_demand, = response.json
    assert swiss_demand['nation'] == 'SUI'
    assert swiss_demand['roomStatus'] == expected
    if expected != 'zero':
        assert swiss_demand['provisional']
    if conflict:
        assert any(error['code']=='ACCOMMODATION_REQUIREMENT_SOURCE_CONFLICT' for error in preview['errors'])
        assert review(preview, event).status_code == 409
    assert Athlete.query.count() == 0


def test_compact_import_queue_scopes_metadata_and_preserves_workflow(events):
    from test_import_performance import sql_count

    owner, other_event = events
    target_id = None
    for i in range(24):
        status = ('IMPORTED', 'DRAFT', 'ARCHIVED', 'CANCELLED')[i % 4]
        session = ImportSession(event_id=owner.id, nation=f'N{i:02}', status=status)
        db.session.add(session)
        db.session.flush()
        for revision in range(1, 7):
            preview = {
                'eventId': owner.id, 'replacementScope': {'kind': 'SPORT_FAMILY',
                    'family': 'Snowboard' if revision % 2 else 'Freestyle'},
                '_workflow': {'state': 'IMPORTED' if revision < 6 else 'REVIEW'},
                'errors': [{}] if revision == 6 else [], 'warnings': [{}, {}],
                'people': [{'matchKey': str(person), 'function': 'Athlete'} for person in range(30)],
            }
            version = ImportSessionVersion(session_id=session.id, version=revision,
                uploaded_by='queue tester', preview_json=json.dumps(preview))
            db.session.add(version)
            db.session.flush()
            approval = ImportApproval(session_id=session.id, version_id=version.id, nation=session.nation,
                approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED', description='Single Rooms',
                decision='PENDING', username='queue tester', quota_details_json='{"candidate":"PRIVATE_MARKER"}')
            db.session.add(approval)
            db.session.flush()
            if i == 0 and revision == 1:
                target_id = approval.id
            db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id, event_type='NOTE',
                title='History entry', description='PRIVATE_MARKER' * 100, username='queue tester'))
        session.current_version = version
    hidden = ImportSession(event_id=other_event.id, nation='OTHER', status='DRAFT')
    db.session.add(hidden)
    db.session.flush()
    hidden_approval = ImportApproval(session_id=hidden.id, nation=hidden.nation, approval_type='NATION_APPROVED',
        description='Other event', decision='APPROVED', username='queue tester')
    db.session.add(hidden_approval)
    db.session.commit()
    hidden_id = hidden_approval.id

    client = app.test_client()
    with sql_count() as statements, patch('app.recalculate_fis_import_preview', side_effect=AssertionError('preview recalculated')):
        response = client.get(f'/api/import/sessions?view=queue&decisionId={target_id}')
    assert response.status_code == 200, response.json
    assert len(statements) <= 9
    assert b'PRIVATE_MARKER' not in response.data
    assert len(response.data) < 10000
    rows = response.json
    assert len(rows) == 24 and {row['status'] for row in rows} == {'IMPORTED', 'ARCHIVED', 'DRAFT', 'CANCELLED'}
    assert not any({'versions', 'history', 'preview', 'approvals'} & row.keys() for row in rows)
    assert [row['nation'] for row in rows if row.get('matchesDecision')] == ['N00']
    assert not any(row.get('matchesDecision') for row in client.get(f'/api/import/sessions?view=queue&decisionId={hidden_id}').json)
    previous = {row['id']: row for row in client.get('/api/import/sessions').json}
    for row in rows:
        old = previous[row['id']]
        assert (row['version'], row['errors'], row['warnings']) == (old['version'], old['errors'], old['warnings'])
        assert row['pendingDecisions'] == sum(a['decision'] == 'PENDING' for a in old['approvals'])
        assert row['hasOpenSubmissions'] == (old['status'] not in {'ARCHIVED', 'CANCELLED'}
                                             and any(item['status'] != 'IMPORTED' for item in old['submissions']))
