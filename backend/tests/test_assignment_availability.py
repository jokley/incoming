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


@pytest.mark.parametrize('single,expected',[(True,'NO_FIT'),(False,'FIT_ALL')])
def test_existing_double_join_and_single_use_guard(state,single,expected):
    HotelRoomInventory.query.one().room_count=1;db.session.commit()
    booking=add(state,14,27)['booking']
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
