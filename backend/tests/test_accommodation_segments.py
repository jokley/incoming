from datetime import date
from unittest.mock import patch
import pytest

from test_real_workbook_import import database
from models import Athlete, Hotel, HotelRoomInventory, RoomType, RoomBooking, RoomBookingOccupant, db


@pytest.fixture
def state(database):
    app,_=database
    app.config['TESTING']=True
    from routes.accommodation_segments import accommodation_segments
    app.register_blueprint(accommodation_segments)
    people=[Athlete(firstname=name,lastname='Person',nation_code='AUT',gender='M',
            function='Athlete',arrival_date=date(2027,3,14),departure_date=date(2027,3,27)) for name in ('A','B','C')]
    hotel=Hotel(name='Hotel'); rt=RoomType(name='Double',max_persons=2)
    db.session.add_all([*people,hotel,rt]);db.session.flush()
    db.session.add(HotelRoomInventory(hotel=hotel,room_type=rt,room_count=5,
        available_from=date(2027,3,1),available_until=date(2027,3,31)))
    db.session.commit()
    return app.test_client(),people,hotel,rt


def data(state,start,end,room='Zimmer 01',**extra):
    _,_,hotel,rt=state
    return dict(hotelId=str(hotel.id),roomTypeId=str(rt.id),roomNumber=room,
        checkInDate=f'2027-03-{start:02}',checkOutDate=f'2027-03-{end:02}',**extra)


def path(person,booking=None):
    return f'/api/assignments/persons/{person.id}/segments'+(f'/{booking}' if booking else '')


def add(state,start,end,room='Zimmer 01',person=0,**extra):
    client,people,_,_=state
    response=client.post(path(people[person]),json=data(state,start,end,room,**extra))
    assert response.status_code==201,response.get_json()
    return response.get_json()


def snapshot():
    db.session.expire_all()
    return [(b.id,b.hotel_id,b.room_number,b.check_in_date,b.check_out_date,b.counts_as_single,
             tuple(sorted(o.athlete_id for o in b.occupants))) for b in RoomBooking.query.order_by(RoomBooking.id).all()]


def test_full_stay_default_and_approved_extra_flag(state):
    state[1][0].single_room_status='APPROVED_EXTRA';db.session.commit()
    result=add(state,14,27)
    assert result['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'
    assert len(result['accommodationCoverage']['segments'])==1
    assert result['booking']['countsAsSingle'] is True


def test_adjacent_add_keeps_original_and_failed_overlap_is_atomic(state):
    from models import Competition
    state[1][0].competitions=Competition.query.limit(2).all()
    db.session.commit()
    first=add(state,14,20)
    before=snapshot()
    response=state[0].post(path(state[1][0]),json=data(state,19,27,'Zimmer 02'))
    assert response.status_code==400
    assert response.get_json()['reasonCode']=='PERSON_BOOKING_OVERLAP'
    assert snapshot()==before
    second=add(state,20,27,'Zimmer 02')
    assert second['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'
    assert len(second['accommodationCoverage']['segments'])==2
    assert snapshot()[0]==before[0]
    assert len(state[1][0].competitions)==2
    both=snapshot()
    rejected_edit=state[0].put(path(state[1][0],first['booking']['id']),json=data(state,14,21))
    assert rejected_edit.status_code==400
    assert rejected_edit.get_json()['reasonCode']=='PERSON_BOOKING_OVERLAP'
    assert snapshot()==both


def test_middle_and_arbitrary_segments(state):
    result=add(state,18,22)
    assert len(result['accommodationCoverage']['openIntervals'])==2
    result=add(state,14,18,'Zimmer 02')
    assert result['accommodationCoverage']['openIntervals']==[{'checkInDate':'2027-03-22','checkOutDate':'2027-03-27'}]
    for start in range(22,27):
        result=add(state,start,start+1,'Zimmer 03')
    assert result['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'
    assert len(result['accommodationCoverage']['segments'])==7
    assert Athlete.query.count()==3


def test_edit_and_remove_only_selected_segment(state):
    first=add(state,14,20);second=add(state,20,27,'Zimmer 02')
    tail=snapshot()[1]
    response=state[0].put(path(state[1][0],first['booking']['id']),json=data(state,14,19))
    assert response.status_code==200,response.get_json()
    assert response.get_json()['accommodationCoverage']['openIntervals']==[{'checkInDate':'2027-03-19','checkOutDate':'2027-03-20'}]
    assert snapshot()[1]==tail
    response=state[0].delete(path(state[1][0],second['booking']['id']))
    assert response.status_code==200
    assert response.get_json()['accommodationCoverage']['openIntervals']==[{'checkInDate':'2027-03-19','checkOutDate':'2027-03-27'}]
    assert RoomBooking.query.count()==1


@pytest.mark.parametrize('start,end',[(13,20),(20,28),(20,20),(22,20)])
def test_invalid_dates_do_not_mutate(state,start,end):
    add(state,14,18)
    before=snapshot()
    response=state[0].post(path(state[1][0]),json=data(state,start,end,'Zimmer 02'))
    assert response.status_code==400
    assert snapshot()==before


def shared(state):
    first=add(state,14,20)
    joined=add(state,14,20,person=1,joinBookingId=first['booking']['id'])
    assert len(joined['booking']['occupants'])==2
    return first['booking']['id']


def test_shared_remove_preserves_other_occupant_and_unrelated_segments(state):
    identity=shared(state)
    add(state,20,27,'Zimmer 02')
    response=state[0].delete(path(state[1][0],identity))
    assert response.status_code==200
    booking=db.session.get(RoomBooking,int(identity))
    assert [o.athlete_id for o in booking.occupants]==[state[1][1].id]
    assert RoomBooking.query.count()==2


def test_shared_edit_separates_selected_person_without_resizing_other_stay(state):
    identity=shared(state)
    response=state[0].put(path(state[1][0],identity),json=data(state,14,19,'Zimmer 02'))
    assert response.status_code==200,response.get_json()
    old=db.session.get(RoomBooking,int(identity))
    assert old.check_out_date==date(2027,3,20)
    assert [o.athlete_id for o in old.occupants]==[state[1][1].id]
    assert response.get_json()['booking']['id']!=identity
    assert RoomBooking.query.count()==2


def test_shared_edit_failure_rolls_back_detachment_and_failed_add_rolls_back_insert(state):
    identity=shared(state);before=snapshot()
    import app as routes
    original=routes._save_booking_from_payload
    def fail_after_save(*args,**kwargs):
        original(*args,**kwargs)
        raise RuntimeError('injected failure after flush')
    with patch.object(routes,'_save_booking_from_payload',side_effect=fail_after_save):
        with pytest.raises(RuntimeError):
            state[0].put(path(state[1][0],identity),json=data(state,14,19,'Zimmer 02'))
        assert snapshot()==before
        with pytest.raises(RuntimeError):
            state[0].post(path(state[1][0]),json=data(state,20,27,'Zimmer 02'))
        assert snapshot()==before


def test_shared_room_edit_and_capacity_do_not_affect_other_occupants(state):
    identity=shared(state);before=snapshot()
    unchanged=state[0].put(path(state[1][0],identity),json=data(state,14,20))
    assert unchanged.status_code==200
    assert snapshot()==before
    response=state[0].put(path(state[1][0],identity),json=data(state,14,19))
    assert response.status_code==400 and response.get_json()['reasonCode']=='ROOM_BOOKING_OVERLAP'
    assert snapshot()==before
    response=state[0].post(path(state[1][2]),json=data(state,14,20,joinBookingId=identity))
    assert response.status_code==400 and response.get_json()['reasonCode']=='CAPACITY_EXCEEDED'
    assert snapshot()==before


def test_empty_booking_cleanup_and_commit_failure_are_atomic(state):
    first=add(state,14,20);before=snapshot()
    with patch.object(db.session,'commit',side_effect=RuntimeError('commit failed')):
        with pytest.raises(RuntimeError):
            state[0].delete(path(state[1][0],first['booking']['id']))
    assert snapshot()==before
    assert state[0].delete(path(state[1][0],first['booking']['id'])).status_code==200
    assert RoomBooking.query.count()==0
