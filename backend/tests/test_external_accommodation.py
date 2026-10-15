from datetime import date
from unittest.mock import patch
import pytest
from test_accommodation_segments import state, data
from test_real_workbook_import import database
from models import db, Hotel, RoomBooking, RoomBookingOccupant, HotelRoomInventory


def external(state):
    client, people, _, _ = state
    hotel = Hotel(name='Kühtai', accommodation_type='EXTERNAL')
    db.session.add(hotel); db.session.commit()
    return hotel


def preview(state, hotel, ids=None, start='2027-03-14', end='2027-03-20'):
    client, people, _, _ = state
    return client.get('/api/assignments/segments/preview', query_string={
        'athleteIds': ','.join(str(p.id) for p in (ids or people[:1])), 'hotelId':str(hotel.id),
        'checkInDate':start, 'checkOutDate':end, 'openCheckInDate':'2027-03-14', 'openCheckOutDate':'2027-03-27'})


@pytest.mark.parametrize('start,end,gaps', [
    ('2027-03-14','2027-03-20',[('2027-03-20','2027-03-27')]),
    ('2027-03-18','2027-03-22',[('2027-03-14','2027-03-18'),('2027-03-22','2027-03-27')]),
    ('2027-03-14','2027-03-27',[]),
])
def test_external_coverage_no_inventory(state,start,end,gaps):
    client, people, _, _=state
    hotel=external(state)
    result=preview(state,hotel,start=start,end=end)
    assert result.status_code==200,result.json
    plan=result.json
    assert RoomBooking.query.count()==0
    expected=[{'checkInDate':a,'checkOutDate':b} for a,b in gaps]
    assert plan['people'][0]['accommodationCoverage']['openIntervals']==expected
    response=client.post('/api/assignments/segments',json=plan)
    assert response.status_code==201,response.json
    assert response.json['booking']['roomType'] is None
    assert response.json['people'][0]['accommodationCoverage']['openIntervals']==expected
    assert RoomBooking.query.one().hotel_id==hotel.id
    assert HotelRoomInventory.query.filter_by(hotel_id=hotel.id).count()==0
    from app import _build_assignment_planning_view
    projection=_build_assignment_planning_view()
    row=next(h for h in projection['hotels'] if h['hotelId']==str(hotel.id))
    assert row['slots']==[]
    assert len(row['externalBookings'])==1


def test_pair_external_then_standard_and_shared_split(state):
    client,people,_,_=state;hotel=external(state)
    plan=preview(state,hotel,people[:2]).json
    response=client.post('/api/assignments/segments',json=plan)
    assert response.status_code==201,response.json
    assert len(response.json['booking']['occupants'])==2
    from app import _build_assignment_planning_view
    # Canonical shared booking survives refresh without changing roommate preferences.
    external_rows=next(h for h in _build_assignment_planning_view()['hotels'] if h['hotelId']==str(hotel.id))['externalBookings']
    assert len(external_rows[0]['occupants'])==2
    standard={**data(state,20,27),'athleteIds':[str(p.id) for p in people[:2]]}
    complete=client.post('/api/assignments/segments',json=standard)
    assert complete.status_code==201,complete.json
    assert all(p['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED' for p in complete.json['people'])
    booking=response.json['booking']['id']
    preview_split=client.get(f'/api/assignments/bookings/{booking}/split-preview',query_string={'athleteIds':str(people[0].id),'splitDate':'2027-03-17'})
    assert preview_split.status_code==200,preview_split.json
    split=client.post(f'/api/assignments/bookings/{booking}/split',json=preview_split.json)
    assert split.status_code==200,split.json
    assert split.json['people'][0]['accommodationCoverage']['coverageStatus']=='PARTIALLY_ASSIGNED'
    assert split.json['people'][1]['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'


def test_individual_external_does_not_change_partner_and_edit_remove(state):
    client,people,_,_=state;hotel=external(state)
    response=client.post('/api/assignments/segments',json=preview(state,hotel).json)
    assert response.status_code==201,response.json
    assert RoomBookingOccupant.query.filter_by(athlete_id=people[1].id).count()==0
    booking=response.json['booking']['id']
    edit=client.put(f'/api/assignments/persons/{people[0].id}/segments/{booking}',json={'hotelId':str(hotel.id),'checkInDate':'2027-03-15','checkOutDate':'2027-03-19'})
    assert edit.status_code==200,edit.json
    assert len(edit.json['accommodationCoverage']['openIntervals'])==2
    remove=client.delete(f'/api/assignments/persons/{people[0].id}/segments/{booking}')
    assert remove.json['accommodationCoverage']['coverageStatus']=='UNASSIGNED'


def test_stale_external_preview_and_invalid_ranges(state):
    client,people,_,_=state;hotel=external(state)
    plan=preview(state,hotel).json
    created=client.post(f'/api/assignments/persons/{people[0].id}/segments',json=data(state,22,27))
    assert created.status_code==201
    response=client.post('/api/assignments/segments',json=plan)
    assert response.status_code==409,response.json
    assert RoomBooking.query.count()==1
    assert preview(state,hotel,start='2027-03-13').status_code==409  # frozen overall gap is stale


def test_external_pair_atomic_failure(state):
    client,people,_,_=state;hotel=external(state)
    plan=preview(state,hotel,people[:2]).json
    import routes.accommodation_segments as routes
    real=routes._mutate_segment
    def fail(person_id,**kwargs):
        if person_id==people[1].id:raise RuntimeError('forced second failure')
        return real(person_id,**kwargs)
    with patch.object(routes,'_mutate_segment',side_effect=fail),pytest.raises(RuntimeError):
        client.post('/api/assignments/segments',json=plan)
    assert RoomBooking.query.count()==0
    assert RoomBookingOccupant.query.count()==0


def test_default_and_hotel_type_configuration(state):
    client,_,standard,_=state
    assert standard.accommodation_type=='STANDARD'
    from routes.hotels import hotels
    # Fixture has not served any request yet.
    client.application.register_blueprint(hotels)
    created=client.post('/api/hotels',json={'name':'Outside','accommodationType':'EXTERNAL'})
    assert created.status_code==201
    assert client.get(f"/api/hotels/{created.json['id']}").json['accommodationType']=='EXTERNAL'
    assert client.post('/api/hotels',json={'name':'Bad','accommodationType':'NO_ROOM'}).status_code==400
    assert client.put(f'/api/hotels/{standard.id}',json={'accommodationType':'EXTERNAL'}).status_code==409
    assert client.get('/api/hotels/capacity-overview').status_code==200


@pytest.mark.parametrize('start,end',[('2027-03-14','2027-03-14'),('2027-03-13','2027-03-20'),('2027-03-20','2027-03-28')])
def test_invalid_external_dates(state,start,end):
    hotel=external(state)
    result=preview(state,hotel,start=start,end=end)
    assert result.status_code==400,result.json
    assert RoomBooking.query.count()==0


def test_external_preserves_approved_extra_default_without_duplicate_person_consumption(state):
    client,people,_,_=state;hotel=external(state)
    people[0].single_room_status='APPROVED_EXTRA';db.session.commit()
    plan=preview(state,hotel).json
    assert plan['people'][0]['accommodationCoverage']['segments'][0]['countsAsSingle'] is True
    response=client.post('/api/assignments/segments',json=plan)
    assert response.status_code==201,response.json
    assert response.json['booking']['countsAsSingle'] is True
    assert people[0].single_room_status=='APPROVED_EXTRA'
    remaining=client.post(f'/api/assignments/persons/{people[0].id}/segments',json=data(state,20,27))
    assert remaining.status_code==201,remaining.json
    assert {o.athlete_id for b in RoomBooking.query.all() for o in b.occupants}=={people[0].id}


def test_deleted_person_rejects_preview_confirmation_as_stale(state):
    client,people,_,_=state;hotel=external(state)
    plan=preview(state,hotel).json
    db.session.delete(people[0]);db.session.commit()
    response=client.post('/api/assignments/segments',json=plan)
    assert response.status_code==409,response.json
    assert RoomBooking.query.count()==0


def test_invalid_payload_does_not_start_a_mutation(state):
    assert state[0].post('/api/assignments/segments',json=['invalid']).status_code==400
    assert RoomBooking.query.count()==0
