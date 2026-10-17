from datetime import date
import pytest
from test_real_workbook_import import database
from test_accommodation_segments import state, data, path, pair
from models import db, RoomBooking
import app as routes


def setup_person(state, capacity, room_request=None, status='NONE'):
    state[3].max_persons=capacity
    # Deliberately misleading label: only authoritative max_persons is physical capacity.
    state[3].name='EZ / DU' if capacity==2 else 'Unrelated configured label'
    state[1][0].room_type=room_request
    state[1][0].function='NSA Medical'
    state[1][0].single_room_status=status
    db.session.commit()


def create(state, mode='person', **extra):
    payload=data(state,14,27,'Zimmer 04',**extra)
    if mode=='person':
        return state[0].post(path(state[1][0]),json=payload)
    payload['athleteIds']=[str(state[1][0].id)]
    if mode=='pair-api':
        return state[0].post('/api/assignments/segments',json=payload)
    endpoint='/api/assignments/bookings' if mode=='booking-api' else '/api/room-assignments'
    state[0].application.add_url_rule(endpoint,view_func=routes.create_room_booking if mode=='booking-api' else routes.create_room_assignment,methods=['POST'])
    return state[0].post(endpoint,json=payload)


@pytest.mark.parametrize('mode',['person','pair-api','booking-api','legacy-api'])
@pytest.mark.parametrize('room_request',[None,'Double shared','Single'])
def test_creation_persists_physical_one_person_default_independent_of_request(state,mode,room_request):
    setup_person(state,1,room_request)
    response=create(state,mode)
    assert response.status_code==201,response.get_json()
    assert RoomBooking.query.one().counts_as_single is True
    body=response.get_json()
    assert (body.get('booking') or body)['countsAsSingle'] is True


@pytest.mark.parametrize('room_request,status,expected',[
    ('Single','NONE',True),('Double single','NONE',True),
    (None,'APPROVED_EXTRA',True),('Double shared','APPROVED_EXTRA',True),
    ('Double shared','NONE',False),(None,'NONE',False),
])
def test_double_solo_defaults_use_request_or_existing_approved_condition(state,room_request,status,expected):
    setup_person(state,2,room_request,status)
    response=create(state)
    assert response.status_code==201,response.get_json()
    assert RoomBooking.query.one().counts_as_single is expected
    assert state[1][0].single_room_status==status


def test_manual_false_survives_update_refresh_and_other_mutation(state):
    setup_person(state,1)
    state[0].application.add_url_rule('/api/assignments/bookings/<int:booking_id>',view_func=routes.update_assigned_unit,methods=['PUT'])
    assert create(state).status_code==201
    booking=RoomBooking.query.one();identity=booking.id
    response=state[0].put(f'/api/assignments/bookings/{identity}',json={'countsAsSingle':False})
    assert response.status_code==200,response.get_json()
    db.session.expire_all()
    assert db.session.get(RoomBooking,identity).counts_as_single is False
    assert db.session.get(RoomBooking,identity).room_number=='Zimmer 04'
    # Canonical detail and planning projections are read-only, not a default repair.
    with state[0].application.test_request_context():
        for _ in range(2):
            assert routes._build_assignment_planning_view(set())['hotels'][0]['slots'][3]['bookings'][0]['countsAsSingle'] is False
    response=state[0].put(f'/api/assignments/bookings/{identity}',json={'roomNumber':'Zimmer 03'})
    assert response.status_code==200,response.get_json()
    assert RoomBooking.query.one().counts_as_single is False


def test_explicit_manual_false_at_creation_is_respected(state):
    setup_person(state,1)
    assert create(state,countsAsSingle=False).status_code==201
    assert RoomBooking.query.one().counts_as_single is False


@pytest.mark.parametrize('room_request,status',[('Single','APPROVED_EXTRA'),('Double shared','NONE')])
def test_double_pair_defaults_false_without_rewriting_person_flags(state,room_request,status):
    setup_person(state,2,room_request,status)
    state[1][1].room_type='Single';db.session.commit()
    response=pair(state,14,27)
    assert response.status_code==201,response.get_json()
    assert response.get_json()['booking']['countsAsSingle'] is False
    assert len(RoomBooking.query.one().occupants)==2
    assert state[1][0].single_room_status==status


def test_reading_an_automatic_single_does_not_mutate_it(state):
    setup_person(state,1)
    assert create(state).status_code==201
    booking=RoomBooking.query.one();before=(booking.id,booking.counts_as_single,booking.room_number,booking.check_in_date,booking.check_out_date)
    with state[0].application.test_request_context():
        planning=routes._build_assignment_planning_view(set())
        assert planning['hotels'][0]['slots'][3]['bookings'][0]['countsAsSingle'] is True
    db.session.expire_all();booking=RoomBooking.query.one()
    after=(booking.id,booking.counts_as_single,booking.room_number,booking.check_in_date,booking.check_out_date)
    assert after==before
