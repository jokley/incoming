from datetime import date, timedelta
from itertools import permutations
from types import SimpleNamespace

import pytest

from accommodation_coverage import person_accommodation_coverage, booking_intervals_overlap


def day(number):
    return date(2027, 3, number) if number is not None else None


def booking(identity, start, end):
    return SimpleNamespace(id=identity, check_in_date=day(start), check_out_date=day(end),
        hotel_id=1, hotel=SimpleNamespace(name='Hotel'), room_type_id=2,
        room_type=SimpleNamespace(name='Double'), room_number='101', counts_as_single=False)


@pytest.mark.parametrize('ranges,gaps,status', [
    ([], [(14,27)], 'UNASSIGNED'),
    ([(14,27)], [], 'FULLY_ASSIGNED'),
    ([(14,20)], [(20,27)], 'PARTIALLY_ASSIGNED'),
    ([(20,27)], [(14,20)], 'PARTIALLY_ASSIGNED'),
    ([(18,22)], [(14,18),(22,27)], 'PARTIALLY_ASSIGNED'),
    ([(14,18),(18,22),(22,27)], [], 'FULLY_ASSIGNED'),
    ([(14,18),(20,27)], [(18,20)], 'PARTIALLY_ASSIGNED'),
    ([(14,22),(20,27)], [], 'CONFLICT'),
    ([(13,20)], [(14,27)], 'CONFLICT'),
    ([(20,28)], [(14,27)], 'CONFLICT'),
    ([(20,18)], [(14,27)], 'CONFLICT'),
    ([(20,20)], [(14,27)], 'CONFLICT'),
    ([(None,20)], [(14,27)], 'CONFLICT'),
])
def test_interval_cases(ranges,gaps,status):
    result=person_accommodation_coverage(day(14),day(27),[booking(i,*span) for i,span in enumerate(ranges)])
    assert result['coverageStatus']==status
    assert result['openIntervals']==[{'checkInDate':day(a).isoformat(),'checkOutDate':day(b).isoformat()} for a,b in gaps]


def test_adjacent_boundary_is_not_overlap_and_real_overlap_is_detected():
    assert not booking_intervals_overlap(day(14),day(20),day(20),day(27))
    assert booking_intervals_overlap(day(14),day(22),day(20),day(27))
    assert not booking_intervals_overlap(day(20),day(20),day(14),day(27))


def test_deterministic_overlap_reporting_and_no_input_mutation():
    rows=[booking(3,20,27),booking(2,14,22),booking(1,14,18)]
    expected=person_accommodation_coverage(day(14),day(27),rows)
    for order in permutations(rows):
        assert person_accommodation_coverage(day(14),day(27),order)==expected
    assert expected['conflicts']==[
        {'code':'BOOKING_OVERLAP','bookingIds':['1','2']},
        {'code':'BOOKING_OVERLAP','bookingIds':['2','3']}]
    assert expected['coverageStatus']=='CONFLICT'
    assert rows[0].check_in_date==day(20)


def test_unlimited_segments_and_duplicate_membership_evidence():
    start=date(2027,1,1)
    rows=[booking(i,14,15) for i in range(100)]
    for i,row in enumerate(rows):
        row.check_in_date=start+timedelta(days=i)
        row.check_out_date=start+timedelta(days=i+1)
    result=person_accommodation_coverage(start,start+timedelta(days=100),[*reversed(rows),rows[0]])
    assert result['coverageStatus']=='FULLY_ASSIGNED'
    assert len(result['segments'])==100
    assert len(result['coveredIntervals'])==1


@pytest.mark.parametrize('arrival,departure',[(None,27),(14,None),(20,14),(14,14)])
def test_missing_or_invalid_person_stay_requires_review(arrival,departure):
    result=person_accommodation_coverage(day(arrival),day(departure),[booking(1,14,20)])
    assert result['coverageStatus']=='CONFLICT'
    assert result['openIntervals']==[]
    assert len(result['segments'])==1


def test_api_and_planning_expose_all_segments_without_changing_assigned_flags(database):
    from models import Athlete, RoomBooking, RoomBookingOccupant, Hotel, RoomType, Competition, db
    from routes.athletes import get_athletes, get_athlete
    from app import _build_room_booking_units, _dates_overlap
    person=Athlete(firstname='One',lastname='Person',nation_code='AUT',gender='M',function='Athlete',
                   arrival_date=day(14),departure_date=day(27))
    person.competitions=Competition.query.limit(2).all()
    hotel=Hotel(name='Hotel'); rt=RoomType(name='Double',max_persons=2)
    db.session.add_all([person,hotel,rt]); db.session.flush()
    for a,b in [(14,18),(20,27)]:
        reservation=RoomBooking(hotel=hotel,room_type=rt,check_in_date=day(a),check_out_date=day(b),counts_as_single=False)
        db.session.add(RoomBookingOccupant(athlete=person,room_booking=reservation))
    db.session.commit()
    result=get_athletes().get_json()
    assert len(result)==1
    assert len(result[0]['competitions'])==2
    coverage=result[0]['accommodationCoverage']
    assert len(coverage['segments'])==2
    assert coverage['coverageStatus']=='PARTIALLY_ASSIGNED'
    assert result[0]['assignment']['hasAssignment']  # Compatibility stays unchanged.
    assert get_athlete(person.id).get_json()['accommodationCoverage']==coverage
    units,_=_build_room_booking_units()
    assert len(units)==1 and units[0]['isFullyAssigned']
    assert units[0]['occupants'][0]['accommodationCoverage']==coverage
    assert not _dates_overlap(day(14),day(20),day(20),day(27))


@pytest.fixture
def reservation_state(database):
    from models import Athlete, RoomBooking, RoomBookingOccupant, Hotel, HotelRoomInventory, RoomType, db
    people=[Athlete(firstname=name,lastname='Person',nation_code='AUT') for name in ('First','Second')]
    hotel=Hotel(name='Local'); other=Hotel(name='Other'); rt=RoomType(name='Single',max_persons=1)
    db.session.add_all([*people,hotel,other,rt]); db.session.flush()
    for target in (hotel,other):
        db.session.add(HotelRoomInventory(hotel=target,room_type=rt,available_from=day(1),available_until=day(31),room_count=1))
    reservation=RoomBooking(hotel=hotel,room_type=rt,room_number='Zimmer 01',check_in_date=day(14),check_out_date=day(20))
    db.session.add(RoomBookingOccupant(athlete=people[0],room_booking=reservation)); db.session.commit()
    payload={'athleteIds':[str(people[0].id)],'hotelId':str(hotel.id),'roomTypeId':str(rt.id),
             'roomNumber':'Zimmer 01','checkInDate':'2027-03-20','checkOutDate':'2027-03-27'}
    return payload,people,other,reservation


def test_booking_validator_allows_adjacency_and_preserves_inventory_dates(reservation_state):
    from app import _validate_booking_payload
    payload,_,_,_=reservation_state
    result,_,error=_validate_booking_payload(payload)
    assert error is None and result['check_in_date']==day(20)
    # available_until retains its existing inclusive latest-checkout comparison.
    payload['checkOutDate']='2027-03-31'
    assert _validate_booking_payload(payload)[2] is None
    payload['checkOutDate']='2027-04-01'
    response,status=_validate_booking_payload(payload)[2]
    assert status==400 and response.get_json()['reasonCode']=='NO_KONTINGENT'


def test_person_overlap_is_blocked_even_in_another_hotel(reservation_state):
    from app import _validate_booking_payload
    payload,_,other,_=reservation_state
    payload.update(hotelId=str(other.id),checkInDate='2027-03-18')
    response,status=_validate_booking_payload(payload)[2]
    assert status==400 and response.get_json()['reasonCode']=='PERSON_BOOKING_OVERLAP'


def test_room_capacity_conflict_remains_blocked_for_another_person(reservation_state):
    from app import _validate_booking_payload
    payload,people,_,_=reservation_state
    payload.update(athleteIds=[str(people[1].id)],checkInDate='2027-03-18')
    response,status=_validate_booking_payload(payload)[2]
    assert status==400 and response.get_json()['reasonCode']=='KONTINGENT_EXCEEDED'


@pytest.mark.parametrize('start,end', [('2027-03-20','2027-03-20'),('2027-03-22','2027-03-20'),('bad-date','2027-03-20')])
def test_new_booking_rejects_zero_reversed_and_malformed_dates(reservation_state,start,end):
    from app import _validate_booking_payload
    payload,_,_,_=reservation_state
    payload.update(checkInDate=start,checkOutDate=end)
    response,status=_validate_booking_payload(payload)[2]
    assert status==400 and response.get_json()['reasonCode']=='INVALID_DATES'


def test_existing_full_stay_move_still_excludes_its_own_booking(reservation_state):
    from app import _validate_booking_payload
    payload,_,_,existing=reservation_state
    payload.update(checkInDate='2027-03-14',checkOutDate='2027-03-20')
    assert _validate_booking_payload(payload,existing_booking=existing)[2] is None


# Reuse the isolated database/catalogue; the calculator itself has no DB dependency.
from test_real_workbook_import import database  # noqa: E402,F401
