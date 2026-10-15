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


def test_pair_http_audit_and_interval_validation(state):
    client=app.test_client()
    for index,person in enumerate(state[0]):
        response=client.post(url(person),json=payload(state,14,20,f'Zimmer 0{index+1}'),headers=headers)
        assert response.status_code==201,response.get_json()
    planning=client.get('/api/assignments/planning-view?includeValidations=false',headers=headers).get_json()
    units=planning['units']['assigned']+planning['units']['unassigned']
    key=next(u['unitId'] for u in units if any(o['athleteId']==str(state[0][0]) for o in u['occupants']))
    import urllib.parse
    response=client.get('/api/assignments/planning-view/validations/'+urllib.parse.quote(key,safe='')+'?checkInDate=2027-03-20&checkOutDate=2027-03-27',headers=headers)
    assert response.status_code==200,response.get_json()
    # The adjacent earlier reservation must not block the selected open period.
    slot=next(v for v in response.get_json()['validations'] if v['slotId']==f'{state[1]}:{state[2]}:1')
    assert slot['status']!='blocked',slot
    response=client.post('/api/assignments/segments',json={**payload(state,20,27,'Zimmer 03'),'athleteIds':[str(p) for p in state[0]]},headers=headers)
    assert response.status_code==201,response.get_json()
    assert all(p['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED' for p in response.get_json()['people'])
    with app.app_context():
        assert RoomBooking.query.count()==3
        audit=AuditEvent.query.order_by(AuditEvent.id.desc()).first()
        refs=json.loads(audit.entity_refs_json)
        assert refs['personId']==str(state[0][0])
        assert refs['personId2']==str(state[0][1])
        assert refs['bookingId']==response.get_json()['booking']['id']


def split_preview(client,booking,ids,cut=20):
    return client.get(f'/api/assignments/bookings/{booking}/split-preview',query_string={'athleteIds':','.join(str(i) for i in ids),'splitDate':f'2027-03-{cut}'},headers=headers)


def split_confirm(client,plan):
    return client.post(f"/api/assignments/bookings/{plan['booking']['id']}/split",json={k:plan[k] for k in ('athleteIds','splitDate','previewToken')},headers=headers)


def test_split_partition_http_preview_is_read_only_audit_and_queue_validation(state):
    client=app.test_client()
    response=client.post('/api/assignments/segments',json={**payload(state,14,27),'athleteIds':[str(p) for p in state[0]]},headers=headers)
    identity=response.get_json()['booking']['id']
    with app.app_context():before_audit=AuditEvent.query.count()
    plan=split_preview(client,identity,[state[0][0]]).get_json()
    with app.app_context():
        assert AuditEvent.query.count()==before_audit
        assert RoomBooking.query.one().check_out_date==date(2027,3,27)
    result=split_confirm(client,plan)
    assert result.status_code==200,result.get_json()
    assert next(p for p in result.get_json()['people'] if p['personId']==str(state[0][1]))['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'
    with app.app_context():
        assert RoomBooking.query.count()==2
        audit=AuditEvent.query.order_by(AuditEvent.id.desc()).first()
        assert audit.username=='segment-editor'
        assert 'Zuweisung geteilt' in audit.activity
    # Derived item keys need not be legacy preferred-pair unit IDs.
    response=client.get(f'/api/assignments/planning-view/validations/need:any?athleteIds={state[0][0]}&checkInDate=2027-03-20&checkOutDate=2027-03-27',headers=headers)
    assert response.status_code==200,response.get_json()
    assert response.get_json()['validations']


def test_concurrent_split_confirmations_only_one_commits(state):
    client=app.test_client()
    booking=client.post(url(state[0][0]),json=payload(state,14,27),headers=headers).get_json()['booking']['id']
    plan=split_preview(client,booking,[state[0][0]]).get_json()
    barrier=Barrier(2)
    def confirm(_):
        barrier.wait(timeout=5)
        return split_confirm(app.test_client(),plan).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:codes=list(pool.map(confirm,[0,1]))
    assert sorted(codes)==[200,409]
    with app.app_context():
        assert RoomBooking.query.count()==1
        assert RoomBooking.query.one().check_out_date==date(2027,3,20)


def test_external_pair_preview_atomic_add_and_audit_without_inventory(state):
    client=app.test_client()
    with app.app_context():
        hotel=Hotel(name='Kühtai',accommodation_type='EXTERNAL');db.session.add(hotel);db.session.commit();hotel_id=hotel.id
    query={'athleteIds':','.join(map(str,state[0])),'hotelId':str(hotel_id),
           'checkInDate':'2027-03-14','checkOutDate':'2027-03-20',
           'openCheckInDate':'2027-03-14','openCheckOutDate':'2027-03-27'}
    plan=client.get('/api/assignments/segments/preview',query_string=query,headers=headers)
    assert plan.status_code==200,plan.json
    with app.app_context():assert AuditEvent.query.count()==0
    result=client.post('/api/assignments/segments',json=plan.json,headers=headers)
    assert result.status_code==201,result.json
    assert len(result.json['booking']['occupants'])==2
    assert all(p['accommodationCoverage']['coverageStatus']=='PARTIALLY_ASSIGNED' for p in result.json['people'])
    assert client.post('/api/assignments/segments',json=plan.json,headers=headers).status_code==409
    with app.app_context():
        assert RoomBooking.query.count()==1
        assert RoomBooking.query.one().room_type_id is None
        audit=AuditEvent.query.one();assert json.loads(audit.entity_refs_json)['personId']==str(state[0][0])


def test_external_preview_rejects_person_change_without_gap_change(state):
    client=app.test_client()
    with app.app_context():
        hotel=Hotel(name='Kühtai',accommodation_type='EXTERNAL');db.session.add(hotel);db.session.commit();hotel_id=hotel.id
    plan=client.get('/api/assignments/segments/preview',query_string={'athleteIds':str(state[0][0]),'hotelId':str(hotel_id),
        'checkInDate':'2027-03-14','checkOutDate':'2027-03-20','openCheckInDate':'2027-03-14','openCheckOutDate':'2027-03-27'},headers=headers)
    assert plan.status_code==200
    with app.app_context():
        person=db.session.get(Athlete,state[0][0]);person.firstname='Changed';db.session.commit()
    response=client.post('/api/assignments/segments',json=plan.json,headers=headers)
    assert response.status_code==409,response.json
    with app.app_context():assert RoomBooking.query.count()==0


@pytest.mark.parametrize('both',[True,False])
def test_external_standard_replacement_is_atomic_and_stale_under_postgres(state,both):
    client=app.test_client()
    original=client.post('/api/assignments/segments',json={**payload(state,14,27),'athleteIds':list(map(str,state[0]))},headers=headers)
    assert original.status_code==201
    with app.app_context():
        hotel=Hotel(name='Outside',accommodation_type='EXTERNAL');db.session.add(hotel);db.session.commit();identity=hotel.id
    query={'athleteIds':','.join(map(str,state[0] if both else state[0][:1])),'hotelId':str(identity),'replaceStandard':'true',
           'checkInDate':'2027-03-18','checkOutDate':'2027-03-22','openCheckInDate':'2027-03-14','openCheckOutDate':'2027-03-27'}
    plan=client.get('/api/assignments/segments/preview',query_string=query,headers=headers)
    assert plan.status_code==200,plan.json
    import routes.accommodation_segments as routes
    actual=routes._mutate_segment
    def fail(*args,**kwargs):
        actual(*args,**kwargs)
        raise RuntimeError('failure after external insert')
    with patch.object(routes,'_mutate_segment',side_effect=fail),pytest.raises(RuntimeError):
        client.post('/api/assignments/segments',json=plan.json,headers=headers)
    with app.app_context():
        assert RoomBooking.query.count()==1
        assert RoomBooking.query.one().check_out_date==date(2027,3,27)
        assert RoomBookingOccupant.query.count()==2
    response=client.post('/api/assignments/segments',json=plan.json,headers=headers)
    assert response.status_code==201,response.json
    assert all(p['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED' for p in response.json['people'])
    assert client.post('/api/assignments/segments',json=plan.json,headers=headers).status_code==409
    with app.app_context():
        from accommodation_mutations import physical_room_usage
        assert physical_room_usage(RoomBooking.query.filter_by(hotel_id=state[1]).all())==1
        assert len(RoomBooking.query.filter_by(hotel_id=identity).one().occupants)==(2 if both else 1)
