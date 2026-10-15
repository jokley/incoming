"""PostgreSQL serialization/rollback and authenticated segment-route contracts."""
import json
import os
from pathlib import Path
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url
os.environ['DATABASE_URL']=postgres_test_url()
from app import app
from models import Athlete, Hotel, HotelRoomInventory, RoomType, RoomBooking, RoomBookingOccupant, AuditEvent, db
from datetime import date


@pytest.fixture
def state():
    configure_test_app(app)
    with app.app_context():
        db.drop_all(); db.create_all()
        people=[Athlete(firstname=name,lastname='Person',nation_code='AUT',arrival_date=date(2027,3,14),departure_date=date(2027,3,27)) for name in ('A','B')]
        hotel=Hotel(name='Hotel'); rt=RoomType(name='Double',max_persons=2)
        db.session.add_all([*people,hotel,rt]); db.session.flush()
        db.session.add(HotelRoomInventory(hotel=hotel,room_type=rt,available_from=date(2027,3,1),available_until=date(2027,3,31),room_count=5))
        db.session.commit()
        values=([p.id for p in people],hotel.id,rt.id)
    yield values
    with app.app_context():db.session.remove()


headers={'X-Authenticated-User':'segment-editor','X-Authenticated-Groups':'incoming-editor'}
def payload(state,start,end,room='Zimmer 01'):
    return dict(hotelId=str(state[1]),roomTypeId=str(state[2]),roomNumber=room,checkInDate=f'2027-03-{start}',checkOutDate=f'2027-03-{end}')
def url(person):return f'/api/assignments/persons/{person}/segments'


def test_adjacent_segment_http_responses_and_audit_identity(state):
    client=app.test_client(); person=state[0][0]
    assert client.post(url(person),json=payload(state,14,20),headers=headers).status_code==201
    response=client.post(url(person),json=payload(state,20,27),headers=headers)
    assert response.status_code==201,response.get_json()
    assert response.get_json()['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'
    assert len(response.get_json()['accommodationCoverage']['segments'])==2
    with app.app_context():
        assert RoomBooking.query.count()==2
        audit=AuditEvent.query.order_by(AuditEvent.id.desc()).first()
        refs=json.loads(audit.entity_refs_json)
        assert refs['personId']==str(person)
        assert refs['bookingId']==response.get_json()['booking']['id']


@pytest.mark.parametrize('same_person',[True,False])
def test_concurrent_person_or_room_overlap_cannot_both_commit(state,same_person):
    barrier=Barrier(2)
    def post(index):
        barrier.wait(timeout=5)
        person=state[0][0] if same_person else state[0][index]
        response=app.test_client().post(url(person),json=payload(state,14,20),headers=headers)
        return response.status_code,response.get_json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(post,[0,1]))
    assert sorted(code for code,_ in results)==[201,400],results
    failure=next(value for code,value in results if code==400)
    assert failure['reasonCode']==('PERSON_BOOKING_OVERLAP' if same_person else 'ROOM_BOOKING_OVERLAP')
    with app.app_context():assert RoomBooking.query.count()==1


def test_legacy_replacement_failure_rolls_back_detachment(state):
    import app as routes
    client=app.test_client(); person=state[0][0]
    original=client.post(url(person),json=payload(state,14,20),headers=headers).get_json()['booking']['id']
    save=routes._save_booking_from_payload
    def failing(*args,**kwargs):
        save(*args,**{**kwargs,'commit':False})
        raise RuntimeError('injected after replacement flush')
    with patch.object(routes,'_save_booking_from_payload',side_effect=failing):
        with pytest.raises(RuntimeError):
            client.post('/api/assignments/bookings',json={**payload(state,20,27,'Zimmer 02'),'athleteIds':[str(p) for p in state[0]]},headers=headers)
    with app.app_context():
        assert RoomBooking.query.count()==1
        assert db.session.get(RoomBooking,int(original)).check_in_date==date(2027,3,14)
        assert RoomBookingOccupant.query.one().athlete_id==person


def test_legacy_post_cannot_replace_a_split_person(state):
    client=app.test_client(); person=state[0][0]
    for start,end in [(14,20),(20,27)]:
        assert client.post(url(person),json=payload(state,start,end),headers=headers).status_code==201
    response=client.post('/api/assignments/bookings',json={**payload(state,14,27),'athleteIds':[str(person)]},headers=headers)
    assert response.status_code==400 and response.get_json()['reasonCode']=='SEGMENT_OPERATION_REQUIRED'
    with app.app_context():assert RoomBooking.query.count()==2
