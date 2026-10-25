"""PR4 event isolation on the dedicated local PostgreSQL database."""
from datetime import date
import json
import pytest
import sqlalchemy as sa
from test_import_event_identity import events
from models import (db, Athlete, Hotel, RoomType, RoomBooking, RoomBookingOccupant,
    HotelRoomInventory, AccommodationEvent, EventRoomDemand, RoomAssignment, FisRoomAssignment)
from app import app
from event_ownership_runtime import OperationalEventError

pytestmark = pytest.mark.explicit_event_ownership


@pytest.fixture
def inventory(events, monkeypatch):
    a,b=events
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(a.id))
    hotel=Hotel(name='Global hotel');room=RoomType(name='Shared DZ',max_persons=2)
    db.session.add_all([hotel,room]);db.session.flush()
    people=[];bookings=[];inventories=[]
    for owner in (a,b):
        rows=[Athlete(event_id=owner.id,firstname=f'Person{i}',lastname=f'Event{owner.id}',nation_code='LAT',
            function='Athlete' if i%2==0 else 'NSA Coach',gender='M',fis_code=str(100+i),
            room_type='Double shared',arrival_date=date(2027,3,3),departure_date=date(2027,3,9)) for i in range(4)]
        inv=HotelRoomInventory(event_id=owner.id,hotel=hotel,room_type=room,room_count=2,
            available_from=date(2027,3,3),available_until=date(2027,3,9),comment=f'Owner {owner.id}')
        booking=RoomBooking(event_id=owner.id,hotel=hotel,room_type=room,room_number='01',
            counts_as_single=False,check_in_date=date(2027,3,3),check_out_date=date(2027,3,9))
        booking.occupants=[RoomBookingOccupant(athlete=p) for p in rows[:2]]
        db.session.add_all([*rows,inv,booking]);people.append(rows);bookings.append(booking);inventories.append(inv)
    db.session.commit()
    return a,b,hotel,room,people,bookings,inventories


def payload(state, ids=None, **changes):
    _,_,hotel,room,people,_,_=state
    return dict(athleteIds=[str(p.id) for p in (ids or people[0][2:])],hotelId=str(hotel.id),
        roomTypeId=str(room.id),roomNumber='02',checkInDate='2027-03-03',checkOutDate='2027-03-09',countsAsSingle=False,**changes)


def snapshot(model, **filters):
    table=model.__table__
    query=sa.select(table)
    for field,value in filters.items():query=query.where(table.c[field]==value)
    return [dict(r) for r in db.session.execute(query.order_by(*table.primary_key.columns)).mappings()]


def test_read_aliases_and_coverage_are_owner_scoped(inventory,monkeypatch):
    a,b,hotel,_,people,bookings,invs=inventory;client=app.test_client()
    for owner,index in ((a,0),(b,1),(a,0)):
        monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(owner.id))
        for path in ['/api/room-bookings/grouped','/api/room-assignments','/room-assignments/']:
            response=client.get(path);assert response.status_code==200,response.json
            assert [r['id'] for r in response.json]==[str(bookings[index].id)]
        response=client.get(f'/api/hotels/{hotel.id}')
        assert response.status_code==200,response.json
        assert [i['id'] for i in response.json['roomInventories']]==[str(invs[index].id)]
        response=client.get('/api/assignments/planning-view')
        assert response.status_code==200,response.json
        assert people[1-index][0].lastname not in json.dumps(response.json)
        response=client.get(f'/api/athletes/{people[1-index][0].id}')
        assert response.status_code==404


@pytest.mark.parametrize('action',['update','unassign','occupant','legacy_update','legacy_delete','split_preview','split'])
def test_foreign_booking_ids_never_mutate(inventory,action):
    _,_,_,_,people,bookings,_=inventory;foreign=bookings[1];client=app.test_client()
    before=snapshot(RoomBooking)+snapshot(RoomBookingOccupant)
    requests={
        'update':('PUT',f'/api/assignments/bookings/{foreign.id}',{}),
        'unassign':('POST',f'/api/assignments/bookings/{foreign.id}/unassign',{}),
        'occupant':('POST',f'/api/assignments/bookings/{foreign.id}/occupants/{people[1][0].id}/unassign',{}),
        'legacy_update':('PUT',f'/api/room-assignments/{foreign.id}',payload(inventory)),
        'legacy_delete':('DELETE',f'/api/room-assignments/{foreign.id}',{}),
        'split_preview':('GET',f'/api/assignments/bookings/{foreign.id}/split-preview?athleteIds={people[1][0].id}&splitDate=2027-03-06',None),
        'split':('POST',f'/api/assignments/bookings/{foreign.id}/split',{'athleteIds':[str(people[1][0].id)],'splitDate':'2027-03-06','previewToken':'not-owner'}),
    }
    method,path,body=requests[action];response=client.open(path,method=method,json=body)
    assert response.status_code in {404,409},response.json
    assert snapshot(RoomBooking)+snapshot(RoomBookingOccupant)==before


@pytest.mark.parametrize('selection',['foreign','mixed'])
def test_foreign_people_cannot_be_assigned(inventory,selection):
    _,_,_,_,people,_,_=inventory
    ids=people[1][2:] if selection=='foreign' else [people[0][2],people[1][2]]
    before=snapshot(RoomBooking)+snapshot(RoomBookingOccupant)
    response=app.test_client().post('/api/room-assignments',json=payload(inventory,ids))
    assert response.status_code in {400,404,409},response.json
    assert snapshot(RoomBooking)+snapshot(RoomBookingOccupant)==before


def test_foreign_join_is_blocked_without_partial_changes(inventory):
    _,_,_,_,people,bookings,_=inventory
    before=snapshot(RoomBooking)+snapshot(RoomBookingOccupant)
    response=app.test_client().post(f'/api/assignments/persons/{people[0][2].id}/segments',json={
        **payload(inventory,[people[0][2]]),'joinBookingId':str(bookings[1].id)})
    assert response.status_code in {404,409},response.json
    assert snapshot(RoomBooking)+snapshot(RoomBookingOccupant)==before


def test_own_capacity_ignores_foreign_same_virtual_room(inventory):
    a,b,_,_,people,bookings,_=inventory
    before=snapshot(RoomBooking,event_id=b.id)
    response=app.test_client().post('/api/room-assignments',json=payload(inventory))
    assert response.status_code==201,response.json
    created=db.session.get(RoomBooking,int(response.json['id']))
    assert created.event_id==a.id and created.counts_as_single is False
    assert snapshot(RoomBooking,event_id=b.id)==before
    removed=app.test_client().delete(f'/api/room-assignments/{created.id}')
    assert removed.status_code==204 and snapshot(RoomBooking,event_id=b.id)==before


def test_foreign_inventory_does_not_supply_missing_dates(inventory):
    _,_,_,_,_,_,invs=inventory
    invs[0].available_from=date(2027,3,4);db.session.commit()
    response=app.test_client().post('/api/room-assignments',json=payload(inventory))
    assert response.status_code==400 and response.json['reasonCode']=='NO_KONTINGENT',response.json


@pytest.mark.parametrize('method',['PUT','DELETE'])
def test_foreign_inventory_write_blocked(inventory,method):
    _,_,hotel,room,_,_,invs=inventory;before=snapshot(HotelRoomInventory)
    response=app.test_client().open(f'/api/hotels/{hotel.id}/inventory/{invs[1].id}',method=method,json={
        'roomTypeId':str(room.id),'roomCount':999,'availableFrom':'2027-03-03','availableUntil':'2027-03-09'})
    assert response.status_code==404,response.json
    assert snapshot(HotelRoomInventory)==before


def test_split_inherits_owner_and_saved_false(inventory):
    a,b,_,_,people,bookings,_=inventory;client=app.test_client();old=bookings[0]
    before=snapshot(RoomBooking,event_id=b.id)
    preview=client.get(f'/api/assignments/bookings/{old.id}/split-preview?athleteIds={people[0][0].id}&splitDate=2027-03-06')
    assert preview.status_code==200,preview.json
    response=client.post(f'/api/assignments/bookings/{old.id}/split',json={
        'athleteIds':[str(people[0][0].id)],'splitDate':'2027-03-06','previewToken':preview.json['previewToken']})
    assert response.status_code==200,response.json
    rows=RoomBooking.query.filter_by(event_id=a.id).all()
    assert len(rows)==2 and all(r.event_id==a.id and r.counts_as_single is False for r in rows)
    assert snapshot(RoomBooking,event_id=b.id)==before


@pytest.mark.parametrize('relation',['occupant','legacy','fis','demand'])
def test_direct_orm_foreign_relationships_and_deletions_are_blocked(inventory,relation):
    a,b,hotel,room,people,bookings,_=inventory
    if relation=='occupant':obj=RoomBookingOccupant(room_booking=bookings[0],athlete=people[1][2])
    elif relation=='legacy':obj=RoomAssignment(athlete=people[0][2],shared_with=people[1][2],hotel=hotel,room_type=room)
    elif relation=='fis':obj=FisRoomAssignment(source_row_key='cross',room_type='Double',person1=people[0][2],person2=people[1][2])
    else:
        plan=AccommodationEvent(championship_event_id=b.id,discipline='Other',start_date=date(2027,3,3),end_date=date(2027,3,9))
        db.session.add(plan);db.session.commit();obj=EventRoomDemand(event=plan,room_type=room,room_count=1)
    with app.test_request_context('/guard',method='POST'):
        db.session.add(obj)
        with pytest.raises(OperationalEventError):db.session.flush()
        db.session.rollback()
    foreign=db.session.get(RoomBooking,bookings[1].id)
    with app.test_request_context('/guard',method='DELETE'):
        db.session.delete(foreign)
        with pytest.raises(OperationalEventError):db.session.flush()
        db.session.rollback()


def test_request_event_cannot_override_configured_owner(inventory):
    a,b,*_=inventory
    denied=app.test_client().get(f'/api/room-bookings/grouped?eventId={b.id}')
    assert denied.status_code==409
    accepted=app.test_client().get(f'/api/room-bookings/grouped?eventId={a.id}')
    assert accepted.status_code==200
    app.config['OPERATIONAL_EVENT_ID']=None
    assert app.test_client().get('/api/room-bookings/grouped').status_code==409


def test_global_master_cannot_delete_or_change_foreign_capacity(inventory):
    _,_,hotel,room,_,_,_=inventory;before=snapshot(HotelRoomInventory)+snapshot(RoomBooking)
    response=app.test_client().delete(f'/api/hotels/{hotel.id}')
    assert response.status_code==409,response.json
    response=app.test_client().put(f'/api/room-types/{room.id}',json={'maxPersons':1})
    assert response.status_code==409,response.json
    assert snapshot(HotelRoomInventory)+snapshot(RoomBooking)==before


def test_109_contingents_and_seven_planning_events_are_lossless(inventory,monkeypatch):
    a,b,hotel,room,_,_,invs=inventory
    for i in range(108):
        db.session.add(HotelRoomInventory(event_id=a.id,hotel=hotel,room_type=room,
            room_count=i+1,available_from=date(2027,3,3),available_until=date(2027,3,9),has_half_board=i%2==0,comment=f'Maintained {i}'))
    names=['Parallel','Aerials','Moguls','Big Air','Slopestyle','Snowboard Cross','Ski Cross']
    for i,name in enumerate(names):
        p=AccommodationEvent(championship_event_id=a.id,discipline=name,start_date=date(2027,3,3),end_date=date(2027,3,9),person_demand=111+i,single_room_percentage=30+i)
        p.room_demands=[EventRoomDemand(room_type=room,room_count=20+i)];db.session.add(p)
    foreign=AccommodationEvent(championship_event_id=b.id,discipline='Foreign planning',start_date=date(2027,3,3),end_date=date(2027,3,9),person_demand=999)
    foreign.room_demands=[EventRoomDemand(room_type=room,room_count=999)];db.session.add(foreign);db.session.commit()
    before=snapshot(HotelRoomInventory)+snapshot(AccommodationEvent)+snapshot(EventRoomDemand)
    client=app.test_client()
    for path in ['/api/events','/api/analytics/occupancy-timeline','/api/analytics/room-availability','/api/hotels','/api/hotels/capacity-overview']:
        response=client.get(path);assert response.status_code==200,response.json
        assert 'Foreign planning' not in json.dumps(response.json)
    response=client.get('/api/events');assert {e['discipline'] for e in response.json}==set(names)
    assert len(client.get(f'/api/hotels/{hotel.id}').json['roomInventories'])==109
    for method in ('PUT','DELETE'):
        denied=client.open(f'/api/events/{foreign.id}',method=method,json={'personDemand':1})
        assert denied.status_code==404
    assert snapshot(HotelRoomInventory)+snapshot(AccommodationEvent)+snapshot(EventRoomDemand)==before


@pytest.mark.parametrize('kind',['seed','csv','legacy_internal','references','generator'])
def test_legacy_bootstrap_is_blocked_before_destructive_work(inventory,monkeypatch,kind):
    monkeypatch.setitem(app.config,'RUNTIME_ENV','production')
    before=snapshot(HotelRoomInventory)+snapshot(RoomBooking)
    with pytest.raises(OperationalEventError,match='isolated test'):
        if kind=='seed':
            from seed_data import seed_database
            seed_database()
        elif kind=='csv':
            from import_csv import run_import
            run_import(app,'/must-not-open.csv')
        elif kind=='references':
            from app import ensure_reference_data
            ensure_reference_data()
        elif kind=='generator':
            from generate_test_files import reset_athlete_related_data
            reset_athlete_related_data()
        else:
            from app import import_data_from_csv
            import_data_from_csv('must not import')
    assert snapshot(HotelRoomInventory)+snapshot(RoomBooking)==before


def test_lat_four_people_two_pairs_import_assignment_reimport(events,monkeypatch):
    """Portable LAT-shaped regression; no private LAT workbook was supplied."""
    import io
    import pandas as pd
    from app import _build_room_booking_units
    a,_=events;monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(a.id))
    hotel=Hotel(name='LAT fixture hotel');room=RoomType(name='LAT DZ',max_persons=2)
    db.session.add_all([hotel,room]);db.session.flush()
    inv=HotelRoomInventory(event_id=a.id,hotel=hotel,room_type=room,room_count=2,
        available_from=date(2027,3,3),available_until=date(2027,3,9))
    db.session.add(inv);db.session.commit()
    records=[dict(Firstname=f'Person{i}',Lastname='Synthetic',Nationcode='LAT',Function='Athlete',
        Gender='M',Fiscode=str(800001+i),**{'Competitorid/Staff ID':str(800001+i)},
        WSC_PGS_M_6170='YES',Room_type='Double shared',Arrival_date='03.03.2027',Departure_date='09.03.2027') for i in range(4)]
    for i, record in enumerate(records):
        record['Shared with Name'] = f'Synthetic, Person{i ^ 1}'
    rooms=[{**records[i],'Shared with Name':f'Synthetic, Person{i+1}','Shared with Nationcode':'LAT'} for i in (0,2)]
    def upload():
        entries,roomlist=io.BytesIO(),io.BytesIO()
        pd.DataFrame(records).to_excel(entries,index=False,sheet_name='Data')
        pd.DataFrame(rooms).to_excel(roomlist,index=False,sheet_name='Data')
        entries.seek(0);roomlist.seek(0)
        response=app.test_client().post('/api/import/fis/preview',data={'eventId':str(a.id),'createSession':'true',
            'entriesList':(entries,'LAT-entries.xlsx'),'roomListDetailed':(roomlist,'LAT-rooms.xlsx')})
        assert response.status_code==200 and response.json['isValid'],response.json
        return response.json
    def confirm(p):
        sid=p['session']['id'];released=app.test_client().post(f'/api/import/sessions/{sid}/approve',json={
            'planDigest':p['changePlan']['digest'],'snapshotScope':'FULL_NATION','confirmDestructiveChanges':True})
        assert released.status_code==200,released.json
        response=app.test_client().post(f'/api/import/sessions/{sid}/import',json={'versionId':p['session']['currentVersionId']})
        assert response.status_code==200,response.json
        return response.json
    first=upload();assert len(first['people'])==4 and len(first['rooms'])==2
    confirm(first)
    units,_=_build_room_booking_units();assert len(units)==2 and all(len(u['occupants'])==2 for u in units)
    for i,unit in enumerate(units):
        response=app.test_client().post('/api/assignments/segments',json={
            'athleteIds':[o['athleteId'] for o in unit['occupants']],'hotelId':str(hotel.id),'roomTypeId':str(room.id),
            'roomNumber':f'{i+1:02}','checkInDate':'2027-03-03','checkOutDate':'2027-03-09','countsAsSingle':False})
        assert response.status_code==201,response.json
    before=snapshot(RoomBooking)+snapshot(RoomBookingOccupant)
    second=upload();assert confirm(second)['summary']['peopleCreated']==0
    assert Athlete.query.count()==4 and RoomBooking.query.count()==2
    assert snapshot(RoomBooking)+snapshot(RoomBookingOccupant)==before


def test_hotel_projection_has_bounded_queries(inventory):
    from sqlalchemy import event as sql_event
    a,b,_,room,_,_,_=inventory;aid,bid,rid=a.id,b.id,room.id
    for i in range(30):
        hotel=Hotel(name=f'Bounded hotel {i}');db.session.add(hotel);db.session.flush()
        for owner in (aid,bid):
            db.session.add(HotelRoomInventory(event_id=owner,hotel_id=hotel.id,room_type_id=rid,room_count=1,
                available_from=date(2027,3,3),available_until=date(2027,3,9)))
    db.session.commit();db.session.remove();queries=[]
    def count(*args):queries.append(args[2])
    sql_event.listen(db.engine,'before_cursor_execute',count)
    try:
        response=app.test_client().get('/api/hotels')
        assert response.status_code==200,response.json
        assert len(response.json)==31 and all(len(h['roomInventories'])==1 for h in response.json)
        assert len(queries)<=4,queries
    finally:sql_event.remove(db.engine,'before_cursor_execute',count)


def test_internal_save_rejects_foreign_existing_object_before_changes(inventory):
    from app import _save_booking_from_payload
    _,_,_,_,_,bookings,_=inventory;before=snapshot(RoomBooking)
    with pytest.raises(OperationalEventError):
        _save_booking_from_payload({},existing_booking=bookings[1],commit=False)
    assert snapshot(RoomBooking)==before


@pytest.mark.parametrize('path',['/api/room-bookings/grouped','/api/assignments/planning-view'])
def test_corrupt_legacy_occupant_is_not_serialized(inventory,path):
    _,_,_,_,people,bookings,_=inventory
    # Deliberately bypass ORM checks to represent an already corrupt legacy DB.
    db.session.execute(sa.insert(RoomBookingOccupant.__table__).values(room_booking_id=bookings[0].id,athlete_id=people[1][2].id))
    db.session.commit();db.session.expire_all()
    response=app.test_client().get(path)
    assert response.status_code==409,response.json
    assert people[1][2].lastname not in json.dumps(response.json)


def test_unscopable_history_reset_is_blocked_even_for_empty_second_event(events,monkeypatch):
    a,_=events;monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(a.id))
    monkeypatch.setitem(app.config,'DATABASE_MAINTENANCE_MODE',True)
    response=app.test_client().post('/api/admin/test-data/reset',json={'scope':'activities','confirmation':'RESET EVENT DATA'})
    assert response.status_code==409,response.json
    from models import Event
    assert Event.query.count()==2
