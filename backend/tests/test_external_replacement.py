from datetime import date
from unittest.mock import patch
import pytest
from test_accommodation_segments import state, data
from test_real_workbook_import import database
from test_external_accommodation import external
from models import db, RoomBooking, RoomBookingOccupant
from routes.accommodation_segments import coverage_for
from accommodation_mutations import physical_room_usage


def prepare(state, shared=True):
    client, people, hotel, rt = state
    ids = [str(p.id) for p in people[:2 if shared else 1]]
    response = client.post('/api/assignments/segments', json={**data(state,14,27),'athleteIds':ids})
    assert response.status_code == 201, response.json
    booking = RoomBooking.query.one()
    booking.created_by='source'; booking.counts_as_single=True
    for o in booking.occupants:o.role='Team'
    db.session.commit()
    return external(state), booking.id


def plan(state, hotel, ids, start='2027-03-14', end='2027-03-20'):
    return state[0].get('/api/assignments/segments/preview', query_string={
        'athleteIds':','.join(map(str,ids)), 'hotelId':str(hotel.id), 'replaceStandard':'true',
        'checkInDate':start,'checkOutDate':end,'openCheckInDate':'2027-03-14','openCheckOutDate':'2027-03-27'})


@pytest.mark.parametrize('selected',[(0,),(0,1),(1,)])
@pytest.mark.parametrize('start,end,retained',[
    ('2027-03-14','2027-03-20',[(20,27)]),
    ('2027-03-18','2027-03-22',[(14,18),(22,27)]),
    ('2027-03-20','2027-03-27',[(14,20)]),
    ('2027-03-14','2027-03-27',[]),
])
def test_external_replaces_standard_atomically_and_preserves_shared_partner(state,selected,start,end,retained):
    client,people,standard,_ = state
    hotel,original = prepare(state)
    ids=[people[i].id for i in selected]
    preview=plan(state,hotel,ids,start,end)
    assert preview.status_code==200,preview.json
    assert RoomBooking.query.count()==1  # preview has no writes
    assert all(p['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED' for p in preview.json['people'])
    response=client.post('/api/assignments/segments',json=preview.json)
    assert response.status_code==201,response.json
    assert {o['athlete']['id'] for o in response.json['booking']['occupants']}==set(map(str,ids))
    for index,person in enumerate(people[:2]):
        coverage=coverage_for(person)
        assert coverage['coverageStatus']=='FULLY_ASSIGNED'
        if index in selected:
            assert [(b['checkInDate'],b['checkOutDate']) for b in coverage['segments'] if b['accommodationType']=='STANDARD']==[(f'2027-03-{a}',f'2027-03-{b}') for a,b in retained]
        else:
            assert all(b['accommodationType']=='STANDARD' for b in coverage['segments'])
            assert coverage['coveredIntervals']==[{'checkInDate':'2027-03-14','checkOutDate':'2027-03-27'}]
    bookings=RoomBooking.query.filter_by(hotel_id=standard.id).all()
    assert physical_room_usage(bookings)==(1 if bookings else 0)
    for booking in bookings:
        assert booking.created_by=='source'
        assert booking.counts_as_single is True
        assert booking.room_number=='Zimmer 01'
        assert all(o.role=='Team' for o in booking.occupants)


def test_solo_replacement_and_stale_confirmation(state):
    client,people,_,_=state;hotel,original=prepare(state,False)
    preview=plan(state,hotel,[people[0].id]);assert preview.status_code==200
    booking=db.session.get(RoomBooking,original);booking.room_number='Zimmer 02';db.session.commit()
    response=client.post('/api/assignments/segments',json=preview.json)
    assert response.status_code==409,response.json
    assert RoomBooking.query.count()==1
    fresh=plan(state,hotel,[people[0].id]);assert client.post('/api/assignments/segments',json=fresh.json).status_code==201


def test_failure_after_partition_rolls_back_original_bookings_and_pair(state):
    client,people,_,_=state;hotel,original=prepare(state)
    preview=plan(state,hotel,[p.id for p in people[:2]],'2027-03-18','2027-03-22')
    import routes.accommodation_segments as routes
    actual=routes._mutate_segment
    def fail(identity,**kwargs):
        if identity==people[1].id:raise RuntimeError('second occupant save failed')
        return actual(identity,**kwargs)
    with patch.object(routes,'_mutate_segment',side_effect=fail),pytest.raises(RuntimeError):
        client.post('/api/assignments/segments',json=preview.json)
    assert RoomBooking.query.count()==1
    booking=db.session.get(RoomBooking,original)
    assert (booking.check_in_date,booking.check_out_date)==(date(2027,3,14),date(2027,3,27))
    assert len(booking.occupants)==2


def test_existing_external_overlap_requires_explicit_edit_not_silent_replacement(state):
    client,people,_,_=state;hotel,_=prepare(state)
    preview=plan(state,hotel,[people[0].id]);assert client.post('/api/assignments/segments',json=preview.json).status_code==201
    retry=plan(state,hotel,[people[0].id],'2027-03-18','2027-03-22')
    assert retry.status_code==400,retry.json
    assert retry.json['reasonCode']=='EXTERNAL_OVERLAP'


def test_middle_replacement_without_physical_room_identity_requires_review(state):
    client,people,_,_=state;hotel,original=prepare(state)
    booking=db.session.get(RoomBooking,original);booking.room_number=None;db.session.commit()
    response=plan(state,hotel,[p.id for p in people[:2]],'2027-03-18','2027-03-22')
    assert response.status_code==400,response.json
    assert response.json['reasonCode']=='ACCOMMODATION_REVIEW_REQUIRED'
    assert RoomBooking.query.count()==1
