from datetime import date
from sqlalchemy import event
import pytest
from test_accommodation_segments import state, add, data, path
from test_real_workbook_import import database
from models import db, HotelRoomInventory, RoomBooking, Athlete
import app as routes
from assignment_availability import project


def projection(state, indices=(0,), start=14, end=27):
    planning=routes._build_assignment_planning_view(set())
    needs=[{'key':str(i),'athleteIds':[str(state[1][i].id)],'checkInDate':f'2027-03-{start:02}','checkOutDate':f'2027-03-{end:02}'} for i in indices]
    return project(planning,needs,{str(state[1][0].id)})


def test_fit_all_and_no_writes(state):
    result=projection(state,(0,1,2))
    assert result['hotels'][str(state[2].id)]==dict(state='FIT_ALL',count=3,total=3,alreadyUsed=False,conservative=False)
    assert RoomBooking.query.count()==0


def test_date_contingent_blocks_target_and_direct_write(state):
    HotelRoomInventory.query.one().available_from=date(2027,3,15);db.session.commit()
    result=projection(state)
    assert result['hotels'][str(state[2].id)]['state']=='NO_FIT'
    assert all(v['status']=='blocked' and 'Kontingent' in v['messages'][0] for v in result['targets']['0'])
    rejected=state[0].post(path(state[1][0]),json=data(state,14,27))
    assert rejected.status_code==400 and rejected.get_json()['reasonCode']=='NO_KONTINGENT'


@pytest.mark.parametrize('room',['Zimmer 01','01'])
@pytest.mark.parametrize('single,expected',[(True,'NO_FIT'),(False,'FIT_ALL')])
def test_existing_double_join_and_single_use_guard(state,single,expected,room):
    HotelRoomInventory.query.one().room_count=1;db.session.commit()
    booking=add(state,14,27,room=room)['booking']
    db.session.get(RoomBooking,int(booking['id'])).counts_as_single=single;db.session.commit()
    result=projection(state,(1,))
    fit=result['hotels'][str(state[2].id)]
    assert fit['state']==expected and fit['alreadyUsed']
    joins=[v for v in result['targets']['1'] if v['slotId']==f"booking:{booking['id']}"]
    assert len(joins)==1 and joins[0]['status']==('blocked' if single else 'valid')
    response=state[0].post(path(state[1][1]),json=data(state,14,27,joinBookingId=booking['id']))
    assert response.status_code==(400 if single else 201)


def test_partial_reserves_capacity_without_double_count(state):
    HotelRoomInventory.query.one().room_count=1;db.session.commit()
    fit=projection(state,(0,1,2))['hotels'][str(state[2].id)]
    assert fit['state']=='FIT_PARTIAL' and fit['count']==2 and fit['total']==3
    assert RoomBooking.query.count()==0


def test_no_room_and_stale_interval_blocked(state):
    state[1][0].accommodation_requirement='NO_ROOM';db.session.commit()
    assert projection(state)['hotels'][str(state[2].id)]['state']=='NO_FIT'
    assert projection(state,(1,),13)['hotels'][str(state[2].id)]['state']=='NO_FIT'


def test_query_count_constant_for_projection(state):
    planning=routes._build_assignment_planning_view(set())
    counts=[]
    for size in (1,3):
        queries=[]
        def executed(*args):queries.append(1)
        event.listen(db.engine,'before_cursor_execute',executed)
        try:
            project(planning,[{'key':str(i),'athleteIds':[str(state[1][i].id)],'checkInDate':'2027-03-14','checkOutDate':'2027-03-27'} for i in range(size)],set())
        finally:event.remove(db.engine,'before_cursor_execute',executed)
        counts.append(len(queries))
    assert counts==[2,2]


def test_endpoint_bulk_projection(state):
    state[0].application.add_url_rule('/api/assignments/availability',view_func=routes.get_assignment_availability,methods=['POST'])
    response=state[0].post('/api/assignments/availability',json={'needs':[{'key':'selected','athleteIds':[str(state[1][0].id)],'checkInDate':'2027-03-14','checkOutDate':'2027-03-27'}]})
    assert response.status_code==200,response.get_json()
    assert response.get_json()['hotels'][str(state[2].id)]['state']=='FIT_ALL'


def test_multi_inventory_envelope_is_not_valid_contingent(state):
    original=HotelRoomInventory.query.one();original.available_until=date(2027,3,18)
    db.session.add(HotelRoomInventory(hotel=state[2],room_type=state[3],room_count=10,available_from=date(2027,3,20),available_until=date(2027,3,31)))
    db.session.commit()
    assert projection(state)['hotels'][str(state[2].id)]['state']=='NO_FIT'
    slots=routes._build_assignment_planning_view(set())['hotels'][0]['slots']
    assert {slot['dateCoverage']['availableFrom'] for slot in slots} == {'2027-03-01', '2027-03-20'}
    assert all(len(slot['dateCoverage']['intervals']) == 1 for slot in slots)



def test_adjacent_uses_can_reuse_room(state):
    HotelRoomInventory.query.one().room_count=1;db.session.commit()
    add(state,14,20,countsAsSingle=True)
    assert projection(state,(1,),20,27)['hotels'][str(state[2].id)]['state']=='NO_FIT' # interval must be the actual canonical gap
    state[1][1].arrival_date=date(2027,3,20);db.session.commit()
    assert projection(state,(1,),20,27)['hotels'][str(state[2].id)]['state']=='FIT_ALL'


def test_pair_target_and_individual_variant_share_projection(state):
    planning=routes._build_assignment_planning_view(set())
    result=project(planning,[{'key':'pair','athleteIds':[str(p.id) for p in state[1][:2]],'checkInDate':'2027-03-14','checkOutDate':'2027-03-27'}],set())
    assert result['hotels'][str(state[2].id)]['count']==2
    assert all(result['targets'][f'pair:athlete:{p.id}'] for p in state[1][:2])


def test_invalid_need_never_joins_provisional_capacity(state):
    state[1][2].accommodation_requirement='NO_ROOM';db.session.commit()
    result=projection(state,(0,2))['hotels'][str(state[2].id)]
    assert result['state']=='FIT_ALL' and result['count']==1 and result['total']==1


def test_endpoint_snapshot_queries_do_not_scale_with_people(state):
    from assignment_availability import load_context
    from models import Athlete
    counts=[]
    for size in (0,20):
        if size:
            db.session.add_all([Athlete(firstname=f'Extra {i}',lastname='Person',nation_code='USA',function='Athlete',arrival_date=date(2027,3,14),departure_date=date(2027,3,27)) for i in range(size)])
            db.session.commit()
        db.session.expire_all()
        queries=[]
        def executed(*args):queries.append(1)
        event.listen(db.engine,'before_cursor_execute',executed)
        try:
            planning,loaded=load_context()
            project(planning,[],set(),loaded=loaded)
        finally:event.remove(db.engine,'before_cursor_execute',executed)
        counts.append(len(queries))
    assert counts==[4,4],counts


def test_legacy_validator_cannot_append_to_single_use_booking(state):
    booking=add(state,14,27)['booking']
    row=db.session.get(RoomBooking,int(booking['id']));row.counts_as_single=True;db.session.commit()
    with state[0].application.test_request_context():
        _,_,error=routes._validate_booking_payload({**data(state,14,27),'athleteIds':[str(p.id) for p in state[1][:2]],'countsAsSingle':True},existing_booking=row)
        assert error[0].get_json()['reasonCode']=='ROOM_SINGLE_USE'

@pytest.mark.parametrize('capacity,start,end,expected', [(2,9,21,True),(1,9,21,False),(2,1,9,False)])
def test_two_person_apartment_projection_matches_write_validation(state,capacity,start,end,expected):
    state[3].name='APP: 1 DZ + DU';state[3].max_persons=capacity
    inv=HotelRoomInventory.query.one();inv.room_count=1
    inv.available_from=date(2027,3,4);inv.available_until=date(2027,3,22)
    for person in state[1][:2]:
        person.arrival_date=date(2027,3,start);person.departure_date=date(2027,3,end)
    db.session.commit()
    planning=routes._build_assignment_planning_view(set())
    need={'key':'pair','athleteIds':[str(p.id) for p in state[1][:2]],'checkInDate':f'2027-03-{start:02}','checkOutDate':f'2027-03-{end:02}'}
    result=project(planning,[need],set())
    target=result['targets']['pair'][0]
    assert (target['status']=='valid') is expected,target
    if start==1:
        assert '04.03.2027' in target['messages'][0]
        assert '01.03.2027' in target['messages'][0]
    response=state[0].post('/api/assignments/segments',json={**data(state,start,end),'athleteIds':need['athleteIds']})
    assert response.status_code==(201 if expected else 400),response.json
    assert RoomBooking.query.count()==int(expected)
    if expected:
        assert len(RoomBooking.query.one().occupants)==2
        assert all(result['targets'][f"pair:athlete:{p.id}"][0]['status']=='valid' for p in state[1][:2])


def test_apartment_overlap_and_checkout_remain_authoritative(state):
    state[3].name='APP: 1 DZ + DU';HotelRoomInventory.query.one().room_count=1
    state[1][2].arrival_date=date(2027,3,9);state[1][2].departure_date=date(2027,3,14)
    db.session.commit()
    add(state,9,14,person=2,countsAsSingle=True)
    # Existing use ends at check-in, so the room can be reused for the pair.
    planning=routes._build_assignment_planning_view(set())
    need={'key':'pair','athleteIds':[str(p.id) for p in state[1][:2]],'checkInDate':'2027-03-14','checkOutDate':'2027-03-27'}
    assert project(planning,[need],set())['targets']['pair'][0]['status']=='valid'
    booking=RoomBooking.query.one();booking.check_out_date=date(2027,3,15);db.session.commit()
    assert project(planning,[need],set())['targets']['pair'][0]['status']=='blocked'
    response=state[0].post('/api/assignments/segments',json={**data(state,14,27),'athleteIds':need['athleteIds']})
    assert response.status_code==400
    assert response.json['reasonCode']=='KONTINGENT_EXCEEDED'


@pytest.mark.parametrize('roles', [('Athlete','Athlete'),('Athlete','Official'),('Official','Athlete'),('Official','Official')])
def test_custom_room_number_can_join_without_role_restriction(state, roles):
    for person, role in zip(state[1], roles):
        person.function=role
    HotelRoomInventory.query.one().room_count=1
    db.session.commit()
    booking=add(state,14,27,room='01',countsAsSingle=False)['booking']
    result=projection(state,(1,))
    joins=[v for v in result['targets']['1'] if v['slotId']==f"booking:{booking['id']}"]
    assert len(joins)==1 and joins[0]['status']=='valid', result
    from assignment_availability import load_context
    planning,loaded=load_context()
    request=[{'key':'1','athleteIds':[str(state[1][1].id)],'checkInDate':'2027-03-14','checkOutDate':'2027-03-27'}]
    assert project(planning,request,set(),loaded=loaded)['targets']['1']==result['targets']['1']
    response=state[0].post(path(state[1][1]),json=data(state,14,27,room='01',joinBookingId=booking['id']))
    assert response.status_code==201,response.json
    assert RoomBooking.query.count()==1
    assert len(RoomBooking.query.one().occupants)==2
    assert not RoomBooking.query.one().counts_as_single
    before=[o.athlete_id for o in RoomBooking.query.one().occupants]
    rejected=state[0].post(path(state[1][2]),json=data(state,14,27,room='01',joinBookingId=booking['id']))
    assert rejected.status_code==400
    assert [o.athlete_id for o in RoomBooking.query.one().occupants]==before


def test_sequential_different_rooms_do_not_exhaust_inventory(state):
    HotelRoomInventory.query.one().room_count=2
    db.session.commit()
    add(state,14,20,room='Zimmer 01',person=0,countsAsSingle=False)
    add(state,20,27,room='Zimmer 02',person=1,countsAsSingle=False)
    # Each day has one free inventory unit. The guard must not sum both periods.
    from assignment_availability import inventory_guard
    assert inventory_guard(HotelRoomInventory.query.all(),RoomBooking.query.all(),date(2027,3,14),date(2027,3,27)) is None
    RoomBooking.query.filter_by(room_number='Zimmer 01').one().check_out_date=date(2027,3,21)
    db.session.commit()
    failure=inventory_guard(HotelRoomInventory.query.all(),RoomBooking.query.all(),date(2027,3,14),date(2027,3,27))
    assert failure[0]=='KONTINGENT_EXCEEDED'
    assert '20.03.2027' in failure[1]


def test_join_different_dates_explains_rejection_without_editing_resident(state):
    booking=add(state,14,27,room='01',countsAsSingle=False)['booking']
    state[1][1].arrival_date=date(2027,3,15);db.session.commit()
    result=projection(state,(1,),15,27)
    target=next(v for v in result['targets']['1'] if v['slotId']==f"booking:{booking['id']}")
    assert target['status']=='blocked'
    assert target['messages']==['Aufenthaltsdaten stimmen nicht überein.']
    response=state[0].post(path(state[1][1]),json=data(state,15,27,room='01',joinBookingId=booking['id']))
    assert response.status_code==400 and response.json['reasonCode']=='SHARED_DATES_DIFFER'
    row=RoomBooking.query.one()
    assert row.check_in_date==date(2027,3,14) and row.check_out_date==date(2027,3,27)
    assert len(row.occupants)==1 and not row.counts_as_single


def test_zero_inventory_never_offers_assignment(state):
    HotelRoomInventory.query.one().room_count=0;db.session.commit()
    assert projection(state)['hotels'][str(state[2].id)]['state']=='NO_FIT'
    response=state[0].post(path(state[1][0]),json=data(state,14,27))
    assert response.status_code==400 and response.json['reasonCode']=='NO_KONTINGENT'
    assert RoomBooking.query.count()==0


def test_pol_full_stay_uses_all_inventory_active_on_each_night(state):
    """Screenshot intervals; bookings are synthetic, not an export of TEST."""
    inv=HotelRoomInventory.query.one();inv.room_count=8
    inv.available_from=date(2027,3,2);inv.available_until=date(2027,3,11)
    db.session.add(HotelRoomInventory(hotel=state[2],room_type=state[3],room_count=18,
        available_from=date(2027,3,4),available_until=date(2027,3,21)))
    for person in state[1]:
        person.arrival_date=date(2027,3,2);person.departure_date=date(2027,3,21)
    state[1][0].departure_date=date(2027,3,11)
    state[1][0].function='NSA Head Coach';state[1][0].room_type='Single'
    db.session.commit()
    for index in range(8):
        person=Athlete(firstname=f'Synthetic {index}',lastname='Later booking',nation_code='AUT',gender='M',
            function='Athlete',arrival_date=date(2027,3,6),departure_date=date(2027,3,13))
        db.session.add(person);state[1].append(person)
    db.session.commit()
    for index in range(8):
        add(state,6,13,room=f'Zimmer {9+index:02}',person=3+index,countsAsSingle=True)
    # The later contingent's booking must not exhaust the early contingent.
    result=projection(state,(0,),2,11)
    target=next(v for v in result['targets']['0'] if v['slotId'].endswith(':1'))
    assert target['status']=='valid',target
    response=state[0].post('/api/assignments/segments',json={**data(state,2,11),'athleteIds':[str(state[1][0].id)]})
    assert response.status_code==201,response.json
    booking=db.session.get(RoomBooking,int(response.json['booking']['id']))
    assert booking.check_in_date==date(2027,3,2) and booking.check_out_date==date(2027,3,11)
    assert booking.counts_as_single # Existing creation default; not an approval.
    assert state[1][0].single_room_decision_id is None
    assert state[1][0].room_type=='Single'


def test_supply_reduction_and_gap_remain_blocking():
    from types import SimpleNamespace as Row
    from assignment_availability import inventory_guard
    def inv(start,end,count):return Row(available_from=date(2027,3,start),available_until=date(2027,3,end),room_count=count)
    booking=Row(id=1,room_number='Zimmer 01',check_in_date=date(2027,3,2),check_out_date=date(2027,3,11))
    failure=inventory_guard([inv(2,11,1),inv(2,6,1)],[booking],date(2027,3,2),date(2027,3,11))
    assert failure[0]=='KONTINGENT_EXCEEDED' and '06.03.2027' in failure[1]
    failure=inventory_guard([inv(2,6,1),inv(7,11,1)],[],date(2027,3,2),date(2027,3,11))
    assert failure[0]=='NO_KONTINGENT' and '06.03.2027' in failure[1]


@pytest.mark.parametrize('roles',[('Athlete','Athlete'),('Athlete','NSA Coach'),('NSA Coach','Athlete'),('NSA Coach','NSA Coach')])
def test_est_join_after_previous_segment_preserves_booking_and_single_wish(state,roles):
    for person,role in zip(state[1],roles):
        person.function=role;person.arrival_date=date(2027,3,2);person.departure_date=date(2027,3,21)
    state[1][1].room_type='Single' # A request does not veto an explicit shared placement.
    db.session.commit()
    add(state,2,9,person=1,room='Zimmer 02',countsAsSingle=False)
    original=add(state,9,21,person=0,room='01',countsAsSingle=False)['booking']
    result=projection(state,(1,),9,21)
    target=next(v for v in result['targets']['1'] if v['slotId']==f"booking:{original['id']}")
    assert target['status']=='valid'
    response=state[0].post('/api/assignments/segments',json={**data(state,9,21,room='01'),
        'athleteIds':[str(state[1][1].id)],'joinBookingId':original['id']})
    assert response.status_code==201,response.json
    assert response.json['booking']['id']==original['id']
    assert RoomBooking.query.count()==2 # Previous segment plus the shared booking.
    row=db.session.get(RoomBooking,int(original['id']))
    assert len(row.occupants)==2 and not row.counts_as_single
    assert state[1][1].room_type=='Single' and state[1][1].single_room_decision_id is None
    from accommodation_coverage import person_disposition_status
    person_bookings=[b for b in RoomBooking.query.all() if any(o.athlete_id==state[1][1].id for o in b.occupants)]
    status=person_disposition_status({'personId':str(state[1][1].id),'roomRequest':'Single','accommodationRequirement':'REQUIRED'},
        response.json['people'][0]['accommodationCoverage'],person_bookings,None,room_request_kind='single')
    assert status['roomPreference']['hasMismatch'] is True
    assert status['singleRoom']['status']=='NO_SINGLE_USE'


def test_adjacent_contingents_require_separate_segments(state):
    inv=HotelRoomInventory.query.one();inv.room_count=1
    inv.available_from=date(2027,3,2);inv.available_until=date(2027,3,6)
    db.session.add(HotelRoomInventory(hotel=state[2],room_type=state[3],room_count=1,
        available_from=date(2027,3,6),available_until=date(2027,3,11)))
    state[1][0].arrival_date=date(2027,3,2);state[1][0].departure_date=date(2027,3,11)
    db.session.commit()
    assert all(target['status'] == 'blocked' for target in projection(state,(0,),2,11)['targets']['0'])
    response=state[0].post('/api/assignments/segments',json={**data(state,2,11),'athleteIds':[str(state[1][0].id)]})
    assert response.status_code==400 and response.json['reasonCode']=='NO_KONTINGENT'
    add(state,2,6)
    add(state,6,11)
    assert RoomBooking.query.count()==2
    # Ending the last contingent one day early must reject the last night.
    HotelRoomInventory.query.filter_by(available_from=date(2027,3,6)).one().available_until=date(2027,3,10)
    db.session.commit()
    failure=__import__('assignment_availability').inventory_guard(HotelRoomInventory.query.all(),[],date(2027,3,2),date(2027,3,11))
    assert failure[0]=='NO_KONTINGENT' and '10.03.2027' in failure[1]


def test_full_period_capacity_shortage_matches_projection_and_write(state):
    inv=HotelRoomInventory.query.one();inv.room_count=1
    inv.available_from=date(2027,3,2);inv.available_until=date(2027,3,11)
    db.session.add(HotelRoomInventory(hotel=state[2],room_type=state[3],room_count=1,
        available_from=date(2027,3,2),available_until=date(2027,3,6)))
    for person in state[1]:
        person.arrival_date=date(2027,3,2);person.departure_date=date(2027,3,11)
    db.session.commit()
    original=add(state,2,11,person=0,countsAsSingle=True)['booking']
    result=projection(state,(1,),2,11)
    target=next(v for v in result['targets']['1'] if v['slotId'].endswith(f':{inv.id}:1'))
    assert target['status']=='blocked' and '06.03.2027' in target['messages'][0]
    response=state[0].post('/api/assignments/segments',json={**data(state,2,11,room='Zimmer 02'),'athleteIds':[str(state[1][1].id)]})
    assert response.status_code==400 and response.json['reasonCode']=='KONTINGENT_EXCEEDED'
    assert response.json['message']==target['messages'][0]
    assert RoomBooking.query.count()==1 and str(RoomBooking.query.one().id)==original['id']

def test_explicit_contingents_preserve_adjacent_capacity_and_booking_identity(state):
    client, people, hotel, room_type = state[:4]
    first = HotelRoomInventory.query.one()
    first.room_count = 1
    first.available_until = date(2027,3,20)
    second = HotelRoomInventory(hotel=hotel,room_type=room_type,room_count=2,
        available_from=date(2027,3,20),available_until=date(2027,3,31))
    db.session.add(second)
    people[0].departure_date = date(2027,3,20)
    people[1].arrival_date = date(2027,3,20)
    db.session.commit()

    def slots():
        return routes._build_assignment_planning_view(set())['hotels'][0]['slots']

    early, later_one, later_two = slots()
    assert [slot['inventoryId'] for slot in (early,later_one,later_two)] == [str(first.id),str(second.id),str(second.id)]
    assert early['inventoryRoomCount'] == 1 and later_one['inventoryRoomCount'] == 2
    assert len({slot['roomNumber'] for slot in (early,later_one,later_two)}) == 3

    def assign(person, slot, start, end, **overrides):
        payload = {**data(state,start,end,room=slot['roomNumber']),
                   'athleteIds':[str(person.id)], 'inventoryId':slot['inventoryId'], **overrides}
        return client.post('/api/assignments/segments',json=payload)

    assert assign(people[1], early, 20, 27).json['reasonCode'] == 'NO_KONTINGENT'
    assert assign(people[1], later_one, 20, 27, inventoryId=early['inventoryId']).json['reasonCode'] == 'INVALID_INVENTORY'
    assert assign(people[2], early, 14, 27).json['reasonCode'] == 'NO_KONTINGENT'
    assert client.post('/api/assignments/segments',json={**data(state,14,27),
        'athleteIds':[str(people[2].id)]}).json['reasonCode'] == 'NO_KONTINGENT'
    booking = assign(people[0], early, 14, 20)
    assert booking.status_code == 201, booking.json
    early_id = booking.json['booking']['id']
    shown = slots()
    assert [b['bookingId'] for b in shown[0]['bookings']] == [early_id]
    assert shown[1]['bookings'] == shown[2]['bookings'] == []
    targets = projection(state,(1,),20,27)['targets']['1']
    valid = {target['slotId'] for target in targets if target['status'] == 'valid'}
    assert later_one['slotId'] in valid and later_two['slotId'] in valid and early['slotId'] not in valid
    assert assign(people[1], later_one, 20, 27).status_code == 201
    assert db.session.get(RoomBooking,int(early_id)).room_number == early['roomNumber']

    db.session.delete(first)
    db.session.commit()
    retired = [slot for slot in slots() if slot['inventoryId'] is None]
    assert [b['bookingId'] for slot in retired for b in slot['bookings']] == [early_id]
    assert db.session.get(RoomBooking,int(early_id)).room_number == early['roomNumber']
