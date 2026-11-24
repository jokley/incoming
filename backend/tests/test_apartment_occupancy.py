from datetime import date
from types import SimpleNamespace

import pytest

from apartment_occupancy import evaluate
from accommodation_mutations import physical_room_usage
from test_accommodation_segments import state
from test_real_workbook_import import database
from models import HotelRoomInventory, RoomBooking, db


def booking(bedroom, people):
    return SimpleNamespace(bedroom_index=bedroom, occupants=[object()] * people,
        room_number='K1-1', check_in_date=date(2027, 3, 14), check_out_date=date(2027, 3, 27))


@pytest.mark.parametrize('bedrooms,showers,maximum', [(1,1,2),(2,1,2),(2,2,4),(3,1,2),(3,2,4),(3,3,6)])
def test_confirmed_layouts(bedrooms, showers, maximum):
    layout = {'bedrooms':[2]*bedrooms, 'showers':showers}
    start, end = date(2027,3,15), date(2027,3,20)
    # The beds may be filled in any order, including the last bedroom first.
    for room in range(1, bedrooms+1):
        assert evaluate(layout, maximum, room, 1, [], start, end) == (None, [])
        assert evaluate(layout, maximum, room, 2, [], start, end) == (None, [])
        assert evaluate(layout, maximum, room, 3, [], start, end)[0]
    if showers < bedrooms:
        occupied = [booking(index, 2) for index in range(1, showers+1)]
        assert evaluate(layout, maximum, showers+1, 1, occupied, start, end) == (None,['DU','MAX_PERSONS'])
        occupied = [booking(index, 1) for index in range(1, showers+1)]
        assert evaluate(layout, maximum, showers+1, 1, occupied, start, end) == (None,['DU'])
    else:
        occupied = [booking(index, 2) for index in range(1, bedrooms)]
        assert evaluate(layout, maximum, bedrooms, 2, occupied, start, end) == (None,[])


def test_mixed_layout_uses_same_shower_rule():
    layout = {'bedrooms':[2, 1], 'showers':1}
    start, end = date(2027,3,15), date(2027,3,20)
    assert evaluate(layout,2,2,1,[booking(1,1)],start,end) == (None,['DU'])
    assert evaluate(layout,2,2,2,[],start,end)[0]
    occupied = [booking(1,1), booking(2,1)]
    assert physical_room_usage(occupied) == 1
    assert evaluate(layout,2,2,1,[booking(None,1)],start,end)[0]


def test_apartment_segment_booking_enforces_limits_and_keeps_one_physical_unit(state):
    client, people, hotel, room_type = state
    room_type.name = 'APP: verified fixture'
    room_type.apartment_layout = {'bedrooms':[2,2], 'showers':1}
    inventory = HotelRoomInventory.query.one()
    inventory.room_count = 1
    db.session.commit()
    from app import _inventory_room_number
    base = dict(hotelId=str(hotel.id), roomTypeId=str(room_type.id), inventoryId=str(inventory.id),
                roomNumber=_inventory_room_number(inventory.id,1), checkInDate='2027-03-14',checkOutDate='2027-03-27')
    from test_assignment_availability import projection
    before = projection(state)
    assert before['hotels'][str(hotel.id)]['state'] == 'FIT_ALL'
    assert len([row for row in before['targets']['0'] if row['status'] == 'valid']) == 2
    result = client.post('/api/assignments/segments',json={**base,'bedroomIndex':1,
        'athleteIds':[str(person.id) for person in people[:2]]})
    assert result.status_code == 201, result.json
    assert result.json['booking']['bedroomIndex'] == 1
    assert result.json['booking']['countsAsSingle'] is False
    second = {**base,'bedroomIndex':2,'athleteIds':[str(people[2].id)]}
    refused = client.post('/api/assignments/segments',json=second)
    assert refused.json['reasonCode'] == 'APARTMENT_EXCEPTION_REQUIRED'
    assert RoomBooking.query.count() == 1
    assert client.post('/api/assignments/segments',json={**second,'bedroomIndex':1,
        'confirmApartmentException':True,'apartmentExceptionReason':'Test'}).json['reasonCode'] == 'APARTMENT_PHYSICAL_LIMIT'
