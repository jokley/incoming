"""PR5 acceptance: event-pure inputs, immutable reads, bounded SQL."""
from datetime import datetime, timedelta
import json
import pytest
import sqlalchemy as sa
from sqlalchemy import event as sql_event
from test_event_accommodation_isolation import inventory, snapshot
from test_import_event_identity import events
from models import (db, Athlete, ImportRun, ImportSession, ImportSessionVersion,
    ImportApproval, AuditEvent, Competition, WorldChampion, RoomBooking)
from app import app
from accommodation_scope import event_audit_refs

pytestmark = pytest.mark.explicit_event_ownership


@pytest.mark.parametrize('path', ['/api/athletes', '/api/athletes/', '/athletes', '/athletes/'])
def test_people_and_export_sources_are_event_pure(inventory, monkeypatch, path):
    a,b,_,_,people,_,_=inventory
    client=app.test_client()
    # Reuse the same ORM session and switch A/B/A explicitly, never through query args.
    for owner,index in ((a,0),(b,1),(a,0)):
        monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(owner.id))
        rows=client.get(path).json
        assert {r['id'] for r in rows}=={str(p.id) for p in people[index]}
        assert len(rows)==4
        assert all(r['lastname']==f'Event{owner.id}' for r in rows)
        assert all(r['nationCode']=='LAT' for r in rows)
        assert client.get(f'/api/athletes/{people[1-index][0].id}').status_code==404


def test_import_timestamps_ignore_foreign_and_unknown_runs(inventory):
    a,b,_,_,people,_,_=inventory
    now=datetime(2027,3,1)
    for p in people[0]:p.athletes_last_seen_at=now;p.roomlist_last_seen_at=now
    db.session.add_all([ImportRun(event_id=a.id,import_type='athletes',started_at=now),
        ImportRun(event_id=b.id,import_type='athletes',started_at=now+timedelta(days=1)),
        ImportRun(event_id=None,import_type='athletes',started_at=now+timedelta(days=2))])
    db.session.commit()
    # PR1 default intentionally assigns new unowned runs; emulate nullable legacy history directly.
    db.session.execute(sa.update(ImportRun).where(ImportRun.started_at==now+timedelta(days=2)).values(event_id=None))
    db.session.commit()
    rows=app.test_client().get('/api/athletes').json
    assert all(not p['missingFromLatestAthletesImport'] for p in rows)


def approval_session(owner, foreign_candidate=True):
    session=ImportSession(event_id=owner.id,nation='LAT',status='ARCHIVED')
    db.session.add(session);db.session.flush()
    version=ImportSessionVersion(session_id=session.id,version=1,preview_token=f'token-{owner.id}',
        uploaded_by='test',preview_json=json.dumps({'eventId':owner.id,'people':[]}))
    db.session.add(version);db.session.flush();session.current_version_id=version.id
    decision=ImportApproval(session_id=session.id,version_id=version.id,nation='LAT',
        approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED',description='Single Rooms',decision='PENDING',
        quota_details_json=json.dumps({'eventId':owner.id,'singleRoomCandidates':[]}),username='test')
    db.session.add(decision);db.session.commit()
    return session,version,decision


@pytest.mark.parametrize('path',['/api/fis/official-quotas','/api/official-quotas','/fis/official-quotas/'])
def test_quota_inputs_and_history_are_event_scoped(inventory,monkeypatch,path):
    a,b,_,_,people,_,_=inventory
    competition=Competition.query.filter_by(gender='M').first()
    for roster in people:
        for p in roster:p.competitions=[competition]
    db.session.commit()
    client=app.test_client();before=client.get(path).json
    assert before and before[0]['peopleTotal']==4
    foreign_session,_,foreign_approval=approval_session(b)
    for i in range(8):
        db.session.add(Athlete(event_id=b.id,firstname='Foreign',lastname=str(i),nation_code='LAT',
            function='Athlete',gender='M',competitions=[competition]))
    db.session.commit()
    assert client.get(path).json==before
    assert foreign_approval.id not in before[0]['unresolvedHistoricalApprovalIds']
    # Own history is still visible, even when unresolved: no blanket hiding approvals.
    own_session,_,own_approval=approval_session(a)
    after=client.get(path).json
    assert own_approval.id in after[0]['unresolvedHistoricalApprovalIds']
    assert client.get(f'/api/import/sessions/{foreign_session.id}').status_code==409
    assert client.get(f'/api/import/approvals/{foreign_approval.id}').status_code in {404,409}
    before_state=snapshot(Athlete)+snapshot(ImportApproval)+snapshot(RoomBooking)
    for _ in range(2):assert client.get(path).status_code==200
    assert snapshot(Athlete)+snapshot(ImportApproval)+snapshot(RoomBooking)==before_state


def audit_row(refs,label):
    row=AuditEvent(username='test',action='update',entity_type='athletes',entity_id='1',
        request_id=label,method='PUT',path='/api/athletes/1',entity_label=label,entity_refs_json=refs)
    db.session.add(row);db.session.flush();return row


def test_audit_is_paginated_after_scoping_and_legacy_is_untouched(inventory,monkeypatch):
    a,b,*_=inventory
    own=audit_row(event_audit_refs({'personId':'1'},a.id),'own')
    audit_row(event_audit_refs({'personId':'1'},b.id),'foreign')
    audit_row('{"personId":"1"}','unknown legacy')
    audit_row('{"eventId":"1"}','unverified legacy')
    audit_row('not-json','malformed legacy')
    audit_row(event_audit_refs({},a.id).replace('"_scope"','"Xscope"'),'unverified marker')
    db.session.commit();before=snapshot(AuditEvent)
    client=app.test_client()
    for owner,label in ((a,'own'),(b,'foreign'),(a,'own')):
        monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(owner.id))
        result=client.get('/api/audit-events?perPage=1').json
        assert result['total']==1 and result['pages']==1
        assert [r['entityLabel'] for r in result['items']]==[label]
    assert snapshot(AuditEvent)==before
    assert client.get('/api/audit-events',query_string={'eventId':b.id}).status_code==409


def test_new_mutation_activity_is_visible_only_to_its_event(inventory,monkeypatch):
    a,b,_,_,people,_,_=inventory;client=app.test_client()
    response=client.put(f'/api/athletes/{people[0][0].id}',json={'internalNote':'Own operational decision'})
    assert response.status_code==200,response.json
    assert client.get('/api/audit-events').json['total']==1
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(b.id))
    assert client.get('/api/audit-events').json['total']==0


def test_import_audit_detail_shapes_preserve_evidence_and_event_isolation(inventory, monkeypatch):
    a, b, *_ = inventory
    expected = {}
    for owner in (a, b):
        expected[owner.id] = []
        for canonical in (False, True):
            refs = (event_audit_refs({'importSessionId': '95'}, owner.id) if canonical else
                    json.dumps({'eventId': str(owner.id), 'importSessionId': '95'}, separators=(',', ':')))
            details = {'peopleUnchanged': 4, 'bookingsRemoved': 0} if not canonical else ['Version 2']
            row = audit_row(refs, f'import-{owner.id}-{canonical}')
            row.entity_type = 'import'
            row.action = 'import'
            row.method = 'POST'
            row.path = '/api/import/sessions/95/import'
            row.activity = 'Import durchgeführt'
            row.category = 'Import'
            row.details_json = json.dumps(details)
            expected[owner.id].append((str(row.id), details))
    db.session.commit()
    before = snapshot(AuditEvent)
    client = app.test_client()
    for owner in (a, b, a):
        monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(owner.id))
        response = client.get('/api/audit-events', headers={'X-Championship-Event-ID': str(owner.id)})
        assert response.status_code == 200
        assert response.json['total'] == 2
        assert {r['id']: r['details'] for r in response.json['items']} == dict(expected[owner.id])
    assert snapshot(AuditEvent) == before


def test_world_champion_catalogue_is_admin_global_but_recognition_is_event_scoped(inventory,monkeypatch):
    a,b,*_=inventory;refs=[]
    from models import Event
    db.session.execute(db.update(Event).where(Event.id.in_([a.id,b.id])).values(is_world_championship=True));db.session.commit()
    for owner in (a,b):
        row=WorldChampion(event_id=owner.id,fis_code='100',name=f'Title {owner.id}',nation='LAT',gender='M',
            discipline='Snowboard',event_group='Snowboard Cross',championship='Worlds',championship_year=2025,
            title_type='INDIVIDUAL',entitlement_enabled=True,source='Test')
        db.session.add(row);refs.append(row)
    db.session.commit();client=app.test_client()
    for owner,index in ((a,0),(b,1),(a,0)):
        monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(owner.id))
        assert {r['id'] for r in client.get('/api/admin/world-champions').json}=={str(r.id) for r in refs}
        assert client.get(f'/api/admin/world-champions/{refs[1-index].id}').status_code==200
        from world_champions import recognize
        person=dict(matchKey='100',fisCode='100',function='Athlete')
        recognize(person,None,{},owner.id)
        assert [r['id'] for r in person['worldChampionReferences']]==[str(refs[index].id)]


@pytest.mark.parametrize('path',['/api/athletes','/api/fis/official-quotas','/api/audit-events',
    '/api/analytics/occupancy-timeline','/api/analytics/room-availability'])
def test_context_cannot_be_switched_by_query(inventory,path):
    _,b,*_=inventory
    assert app.test_client().get(path,query_string={'eventId':b.id}).status_code==409


def test_person_query_budget_is_independent_of_foreign_population(inventory):
    a,b,_,_,people,_,_=inventory
    counts=[]
    def collect(*args):counts.append(args[2])
    client=app.test_client()
    sql_event.listen(db.engine,'before_cursor_execute',collect)
    try:
        assert client.get('/api/athletes').status_code==200
        baseline=len(counts);counts.clear()
        for i in range(60):db.session.add(Athlete(event_id=b.id,firstname='Hidden',lastname=str(i),nation_code='LAT'))
        db.session.commit();counts.clear()
        assert client.get('/api/athletes').status_code==200
        assert len(counts)<=baseline  # A warm identity map may save the Event SELECT.
        assert baseline<=8
    finally:sql_event.remove(db.engine,'before_cursor_execute',collect)


def test_dashboard_session_summary_never_recalculates_nations(inventory, monkeypatch):
    a,b,*_=inventory
    own,_,_=approval_session(a);foreign,_,_=approval_session(b)
    own.status='IMPORTED';db.session.commit()
    def forbidden(*args, **kwargs):
        raise AssertionError('Summary reads must not reevaluate imported nations')
    monkeypatch.setattr('app.recalculate_fis_import_preview',forbidden)
    before=snapshot(ImportApproval)+snapshot(ImportSessionVersion)+snapshot(Athlete)
    response=app.test_client().get('/api/import/sessions')
    assert response.status_code==200,response.json
    assert [r['id'] for r in response.json]==[str(own.id)]
    assert response.json[0]['status']=='IMPORTED'
    assert snapshot(ImportApproval)+snapshot(ImportSessionVersion)+snapshot(Athlete)==before


def test_multiple_memberships_do_not_multiply_accommodation_people(inventory):
    _,_,_,_,people,_,_=inventory
    same_group=Competition.query.filter_by(quota_discipline='Snowboard Alpine',gender='M').limit(2).all()
    assert len(same_group)==2
    for p in people[0]:p.competitions=[same_group[0]]
    db.session.commit();client=app.test_client()
    before=client.get('/api/fis/official-quotas').json
    for p in people[0]:p.competitions=same_group
    db.session.commit()
    assert client.get('/api/fis/official-quotas').json==before
    assert len(client.get('/api/athletes').json)==4
    assert all(len(row['competitions'])==2 for row in client.get('/api/athletes').json)


def test_manual_tariff_requirement_and_single_flags_survive_all_readmodels(inventory):
    a,b,_,_,people,bookings,_=inventory
    comp=Competition.query.filter_by(gender='M').first()
    for p in people[0]:p.competitions=[comp]
    p=people[0][2];p.accommodation_requirement='NO_ROOM';p.accommodation_requirement_source='MANUAL'
    p.accommodation_rate_category='SPECIAL';p.accommodation_rate_source='MANUAL'
    p.single_room_status='APPROVED_EXTRA'
    db.session.commit();before=snapshot(Athlete)+snapshot(RoomBooking)
    client=app.test_client()
    for path in ['/api/athletes','/api/fis/official-quotas','/api/assignments/planning-view',
                 '/api/analytics/room-availability','/api/analytics/occupancy-timeline']:
        response=client.get(path);assert response.status_code==200,response.json
    row=client.get(f'/api/athletes/{p.id}').json
    assert row['accommodationRequirement']=='NO_ROOM' and row['accommodationRateCategory']=='SPECIAL'
    assert row['single_room_status']=='APPROVED_EXTRA'
    assert client.get('/api/fis/official-quotas').json[0]['accommodationPeopleRequired']==3
    assert snapshot(Athlete)+snapshot(RoomBooking)==before


def test_world_champion_recognition_uses_only_explicit_target_event(inventory):
    from world_champions import recognize
    a,b,*_=inventory
    from models import Event
    db.session.execute(db.update(Event).where(Event.id.in_([a.id,b.id])).values(is_world_championship=True));db.session.commit()
    ref=WorldChampion(event_id=b.id,fis_code='100',name='Foreign title',nation='LAT',gender='M',
        discipline='Snowboard',event_group='Snowboard Cross',championship='Worlds',championship_year=2025,
        title_type='INDIVIDUAL',entitlement_enabled=True,source='Test')
    db.session.add(ref);db.session.commit()
    person={'matchKey':'100','fisCode':'100','function':'Athlete'}
    recognize(person,None,{},a.id)
    assert person['singleRoomQuotaExemptReason'] is None
    assert person['worldChampionReferences']==[]
    recognize(person,None,{},b.id)
    assert person['singleRoomQuotaExemptReason']=='WORLD_CHAMPION'
    assert [r['id'] for r in person['worldChampionReferences']]==[str(ref.id)]


def test_session_summary_query_budget_does_not_grow_per_nation(inventory):
    a,*_=inventory
    # Existing catalogue contains 28 mappings. Both mapping and session collections
    # must be bulk-loaded rather than one SELECT per Competition or nation.
    approval_session(a)
    def count_request():
        queries=[]
        def collect(*args):queries.append(args[2])
        sql_event.listen(db.engine,'before_cursor_execute',collect)
        try:
            with app.app_context():
                response=app.test_client().get('/api/import/sessions')
                assert response.status_code==200,response.json
            return len(queries)
        finally:sql_event.remove(db.engine,'before_cursor_execute',collect)
    small=count_request()
    for nation in ('JPN','USA','GER','FIN','AUS'):
        session=ImportSession(event_id=a.id,nation=nation,status='IMPORTED')
        db.session.add(session);db.session.flush()
        version=ImportSessionVersion(session_id=session.id,version=1,preview_token=nation,
            uploaded_by='test',preview_json=json.dumps({'eventId':a.id,'errors':[],'warnings':[]}))
        db.session.add(version);db.session.flush();session.current_version_id=version.id
    db.session.commit()
    large=count_request()
    assert large<=small and large<=9


def test_planning_inference_and_legacy_requirement_candidates_are_scoped(inventory):
    from datetime import date
    from excel_import import infer_discipline_from_events
    from accommodation_requirements import legacy_candidates
    from models import AccommodationEvent
    a,b,_,_,people,_,_=inventory
    db.session.add_all([
        AccommodationEvent(championship_event_id=a.id,discipline='Own',start_date=date(2027,3,4),end_date=date(2027,3,5)),
        AccommodationEvent(championship_event_id=b.id,discipline='Foreign',start_date=date(2027,3,1),end_date=date(2027,3,20))])
    for p in (people[0][2],people[1][2]):p.room_type='No room'
    db.session.commit()
    assert infer_discipline_from_events([{'arrivalDate':date(2027,3,3),'departureDate':date(2027,3,9)}])=='Own'
    assert [p['personId'] for p in legacy_candidates()]==[people[0][2].id]


def test_legacy_atomic_imports_keep_their_explicit_event_evidence(inventory):
    a,b,*_=inventory
    for owner in (a,b):
        row=audit_row(json.dumps({'eventId':str(owner.id),'importSessionId':'7'},sort_keys=True,separators=(',',':')),f'Confirmed {owner.id}')
        row.entity_type='import';row.action='import';row.method='POST';row.path='/api/import/sessions/7/import'
    # Planning eventId is never treated as a championship owner.
    row=audit_row(json.dumps({'eventId':str(a.id),'personId':'8'},separators=(',',':')),'Unknown planning')
    row.entity_type='events'
    db.session.commit();before=snapshot(AuditEvent)
    payload=app.test_client().get('/api/audit-events').json
    assert payload['total']==1
    assert [r['entityLabel'] for r in payload['items']]==[f'Confirmed {a.id}']
    assert snapshot(AuditEvent)==before


@pytest.mark.parametrize('path',['/api/athletes','/api/fis/official-quotas','/api/audit-events','/api/import/sessions'])
def test_explicit_query_cannot_replace_missing_operational_configuration(inventory, monkeypatch, path):
    a,*_=inventory
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',None)
    response=app.test_client().get(path,query_string={'eventId':a.id})
    assert response.status_code==409,response.json
