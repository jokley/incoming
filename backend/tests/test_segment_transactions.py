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
    first_room=next(slot for hotel in planning['hotels'] for slot in hotel['slots'] if slot['slotIndex']==1)
    slot=next(v for v in response.get_json()['validations'] if v['slotId']==first_room['slotId'])
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


def test_concurrent_disjoint_external_creates_allow_only_one_per_person(state):
    with app.app_context():
        hotel=Hotel(name='Outside',accommodation_type='EXTERNAL');db.session.add(hotel);db.session.commit();identity=hotel.id
    barrier=Barrier(2)
    def post(index):
        barrier.wait(timeout=5)
        start,end=(14,18) if index==0 else (20,27)
        response=app.test_client().post(url(state[0][0]),headers=headers,json={
            'hotelId':str(identity),'checkInDate':f'2027-03-{start}','checkOutDate':f'2027-03-{end}'})
        return response.status_code,response.json
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(post,[0,1]))
    assert sorted(code for code,_ in results)==[201,400],results
    assert next(body for code,body in results if code==400)['reasonCode']=='EXTERNAL_ALREADY_EXISTS'
    with app.app_context():assert RoomBooking.query.count()==1


def test_pair_external_confirmation_rejects_one_ineligible_person_without_partial_add(state):
    client=app.test_client()
    with app.app_context():
        hotel=Hotel(name='Outside',accommodation_type='EXTERNAL');db.session.add(hotel);db.session.commit();identity=hotel.id
    plan=client.get('/api/assignments/segments/preview',headers=headers,query_string={
        'hotelId':str(identity),'athleteIds':','.join(map(str,state[0])),
        'checkInDate':'2027-03-20','checkOutDate':'2027-03-27','openCheckInDate':'2027-03-14','openCheckOutDate':'2027-03-27'})
    assert plan.status_code==200
    assert client.post(url(state[0][0]),headers=headers,json={
        'hotelId':str(identity),'checkInDate':'2027-03-14','checkOutDate':'2027-03-18'}).status_code==201
    response=client.post('/api/assignments/segments',headers=headers,json=plan.json)
    assert response.status_code==409 and response.json['reasonCode']=='EXTERNAL_ALREADY_EXISTS'
    with app.app_context():
        assert RoomBooking.query.count()==1
        assert RoomBookingOccupant.query.filter_by(athlete_id=state[0][1]).count()==0


def test_apartment_exception_is_affirmative_and_audited_atomically(state):
    from app import _inventory_room_number
    first, second = state[0]
    with app.app_context():
        inventory = HotelRoomInventory.query.one()
        inventory.room_count = 1
        inventory.room_type.apartment_layout = {'bedrooms': [2, 2], 'showers': 1}
        inventory.room_type.max_persons = 1
        identity = inventory.id
        db.session.commit()

    client = app.test_client()
    base = {**payload(state, 14, 27, _inventory_room_number(identity, 1)), 'inventoryId': str(identity)}
    def add(person, bedroom, **extra):
        return client.post('/api/assignments/segments', headers=headers,
            json={**base, 'athleteIds': [str(person)], 'bedroomIndex': bedroom, **extra})

    assert add(first, 1).status_code == 201
    assert add(second, 2, confirmApartmentException=True).json['reasonCode'] == 'APARTMENT_EXCEPTION_REQUIRED'
    assert add(second, 1, confirmApartmentException=True,
               apartmentExceptionReason='Test').json['reasonCode'] == 'APARTMENT_PHYSICAL_LIMIT'
    with patch('apartment_occupancy.audit_exception', side_effect=RuntimeError('Audit unavailable')), pytest.raises(RuntimeError):
        add(second, 2, confirmApartmentException=True, apartmentExceptionReason='Test')
    with app.app_context():
        assert RoomBooking.query.count() == 1
    result = add(second, 2, confirmApartmentException=True, apartmentExceptionReason='Test')
    assert result.status_code == 201, result.json
    evidence = result.json['booking']['apartmentException']
    assert evidence['rules'] == ['DU','MAX_PERSONS']
    assert evidence['bedroomIndex'] == 2 and evidence['inventoryId'] == str(identity)
    assert not result.json['booking']['countsAsSingle']
    with app.app_context():
        audit = AuditEvent.query.filter_by(activity='Apartmentausnahme bestätigt').one()
        assert audit.username == evidence['username']
        assert json.loads(audit.changes_json) == evidence
        assert RoomBooking.query.count() == 2


@pytest.mark.parametrize('shared,stored_single', [(False,True),(True,False),(False,False)])
def test_legacy_apartment_resolution_preserves_booking_and_unlocks_other_bedroom(state, shared, stored_single):
    from app import _inventory_room_number
    people, _, _ = state
    with app.app_context():
        inv = HotelRoomInventory.query.one()
        inv.room_count = 2
        inv.room_type.apartment_layout = {'bedrooms':[2,2], 'showers':2}
        inv.room_type.max_persons = 4
        extra = Athlete(firstname='Future', lastname='Guest', nation_code='AUT',
                        arrival_date=date(2027,3,14), departure_date=date(2027,3,27))
        extra2 = Athlete(firstname='Future two',lastname='Guest',nation_code='AUT',
                         arrival_date=date(2027,3,14),departure_date=date(2027,3,27))
        db.session.add_all([extra,extra2])
        db.session.flush()
        legacy = RoomBooking(event_id=inv.event_id, hotel_id=inv.hotel_id, room_type_id=inv.room_type_id,
            room_number='Slot 01', check_in_date=date(2027,3,14), check_out_date=date(2027,3,27),
            counts_as_single=stored_single)
        legacy.occupants = [RoomBookingOccupant(athlete_id=person,role='legacy') for person in people[:2 if shared else 1]]
        other_legacy = RoomBooking(event_id=inv.event_id, hotel_id=inv.hotel_id, room_type_id=inv.room_type_id,
            room_number='Other legacy', check_in_date=date(2027,3,14), check_out_date=date(2027,3,27))
        db.session.add_all([legacy, other_legacy])
        db.session.commit()
        booking_id, inventory_id, extra_id = legacy.id, inv.id, extra.id
        new_people = [str(extra_id),str(extra2.id)] if shared else [str(extra_id)]
        memberships = [(o.id,o.athlete_id,o.role) for o in legacy.occupants]

    client = app.test_client()
    new_room = _inventory_room_number(inventory_id, 1)
    other = {**payload(state,14,27,new_room),'inventoryId':str(inventory_id),
             'athleteIds':new_people,'bedroomIndex':2}
    def bedroom_status():
        response = client.post('/api/assignments/availability',json={'needs':[{'key':'need',
            'athleteIds':new_people, 'checkInDate':'2027-03-14', 'checkOutDate':'2027-03-27'}]},headers=headers)
        assert response.status_code == 200, response.json
        key = f'{state[1]}:{state[2]}:{inventory_id}:1:bedroom:2'
        return next(row['status'] for row in response.json['targets']['need'] if row['slotId']==key)

    assert bedroom_status() == 'blocked'
    assert client.post('/api/assignments/segments',json=other,headers=headers).json['reasonCode'] == 'APARTMENT_PHYSICAL_LIMIT'
    url = f'/api/assignments/bookings/{booking_id}/bedroom'
    data = {'inventoryId':str(inventory_id), 'roomNumber':new_room, 'bedroomIndex':1,
            'expected':{'athleteIds':sorted(str(m[1]) for m in memberships), 'roomNumber':'Slot 01',
                        'checkInDate':'2027-03-14','checkOutDate':'2027-03-27','countsAsSingle':stored_single}}
    changed = {**data, 'expected':{**data['expected'], 'checkOutDate':'2027-03-26'}}
    assert client.post(url,json=changed,headers=headers).json['reasonCode'] == 'STALE_LEGACY_BOOKING'
    assert client.post(url,json={**data,'inventoryId':'999'},headers=headers).json['reasonCode'] == 'STALE_APARTMENT_SLOT'
    assert client.post(url,json={**data,'bedroomIndex':3},headers=headers).status_code == 400
    with patch('apartment_occupancy.audit_apartment_change',side_effect=RuntimeError('Audit unavailable')), pytest.raises(RuntimeError):
        client.post(url,json=data,headers=headers)
    with app.app_context():
        assert db.session.get(RoomBooking,booking_id).bedroom_index is None
    resolved = client.post(url,json=data,headers=headers)
    assert resolved.status_code == 200, resolved.json
    assert resolved.json['id'] == str(booking_id) and resolved.json['countsAsSingle'] == stored_single
    assert resolved.json['bedroomIndex'] == 1
    assert bedroom_status() == 'valid'
    assert client.post(url,json=data,headers=headers).status_code == 400
    assert client.post('/api/assignments/segments',json={**other,'bedroomIndex':1},headers=headers).json[
        'reasonCode'] == 'APARTMENT_PHYSICAL_LIMIT'
    added = client.post('/api/assignments/segments',json=other,headers=headers)
    assert added.status_code == 201, added.json
    assert added.json['booking']['bedroomIndex'] == 2
    assert len(added.json['booking']['occupants']) == len(new_people)
    with app.app_context():
        booking = db.session.get(RoomBooking,booking_id)
        assert [(o.id,o.athlete_id,o.role) for o in booking.occupants] == memberships
        assert (booking.check_in_date, booking.check_out_date) == (date(2027,3,14),date(2027,3,27))
        audit = AuditEvent.query.filter_by(activity='Schlafraum zugeordnet').one()
        assert json.loads(audit.changes_json)['previousRoomNumber'] == 'Slot 01'
        assert booking.counts_as_single == stored_single
        assert booking.effective_counts_as_single == stored_single
        assert db.session.query(RoomBooking.effective_counts_as_single).filter(RoomBooking.id == booking_id).scalar() == stored_single
        assert all(db.session.get(Athlete, identity).single_room_decision_id is None for _,identity,_ in memberships)
        assert RoomBooking.query.count() == 3
    plan = client.get('/api/assignments/planning-view?includeValidations=false',headers=headers).json
    assert sorted(b['bedroomIndex'] for b in plan['hotels'][0]['slots'][0]['bookings']) == [1,2]
    statuses = client.get('/api/fis/official-quotas?includePeople=true',headers=headers).json['personStatuses']
    legacy_status = next(row for row in statuses if row['personId']==str(memberships[0][1]))
    assert legacy_status['singleRoom']['hasSingleUse'] == stored_single
    assert not legacy_status['singleRoom']['approvalApplicable']
    assert legacy_status['roomPreference']['segments'][0]['capacity'] == 2


@pytest.mark.parametrize('apartment', [False, True])
@pytest.mark.parametrize('direct', [False, True])
def test_double_room_single_use_release_and_partner_assignment(state, apartment, direct):
    from app import _inventory_room_number
    from models import ImportApproval, ImportSession
    from routes.accommodation_segments import coverage_for

    first, second = state[0]
    with app.app_context():
        inventory = HotelRoomInventory.query.one()
        if apartment:
            inventory.room_type.apartment_layout = {'bedrooms': [2, 2], 'showers': 2}
            inventory.room_type.max_persons = 4
        session = ImportSession(nation='AUT', event_id=inventory.event_id)
        approval = ImportApproval(session=session, nation='AUT', approval_type='SINGLE_ROOM',
                                  description='Historical approval', decision='APPROVED', username='test')
        db.session.get(Athlete, first).single_room_decision = approval
        db.session.add(approval)
        third = Athlete(firstname='C', lastname='Person', nation_code='AUT',
                        arrival_date=date(2027, 3, 14), departure_date=date(2027, 3, 27))
        db.session.add(third)
        db.session.commit()
        identity, third_id, decision_id = inventory.id, third.id, approval.id

    client = app.test_client()
    base = {**payload(state, 14, 27, _inventory_room_number(identity, 1)), 'inventoryId': str(identity)}

    def add(person, **target):
        return client.post('/api/assignments/segments', headers=headers,
                           json={**base, 'athleteIds': [str(person)], **target})

    created = add(first, **({'bedroomIndex': 1} if apartment else {}))
    assert created.status_code == 201, created.json
    assert created.json['booking']['countsAsSingle'] is False
    booking_id = created.json['booking']['id']
    if apartment and not direct:
        other = add(third_id, bedroomIndex=2, countsAsSingle=True)
        assert other.status_code == 201 and other.json['booking']['countsAsSingle'] is True
    with app.app_context():
        membership_id = RoomBookingOccupant.query.filter_by(athlete_id=first).one().id

    def toggle(value):
        return client.put(f'/api/assignments/bookings/{booking_id}', headers=headers, json={'countsAsSingle': value})

    def join_status():
        response = client.post('/api/assignments/availability', headers=headers, json={'needs': [{
            'key': 'need', 'athleteIds': [str(second)],
            'checkInDate': base['checkInDate'], 'checkOutDate': base['checkOutDate'],
        }]})
        assert response.status_code == 200, response.json
        return next(row['status'] for row in response.json['targets']['need']
                    if row['slotId'] == f'booking:{booking_id}')

    assert join_status() == 'valid'
    marked = toggle(True)
    assert marked.status_code == 200 and marked.json['countsAsSingle'] is True
    quota = client.get('/api/fis/official-quotas?includePeople=true', headers=headers).json
    first_quota = next(row['singleRoom'] for row in quota['personStatuses'] if row['personId'] == str(first))
    assert first_quota['hasSingleUse'] and not first_quota['approvalApplicable']
    assert join_status() == 'warning'
    assert add(second, joinBookingId=booking_id).json['reasonCode'] == 'ROOM_SINGLE_USE'
    if direct:
        incompatible = client.post(url(second), headers=headers, json={
            **base, 'checkInDate': '2027-03-15', 'joinBookingId': booking_id, 'confirmReleaseSingleUse': True,
        })
        assert incompatible.json['reasonCode'] == 'SHARED_DATES_DIFFER'

        def fail_after_join(person):
            if not db.session.get(RoomBooking, int(booking_id)).counts_as_single:
                raise RuntimeError('injected failure after release and attachment')
            return coverage_for(person)

        with patch('routes.accommodation_segments.coverage_for', side_effect=fail_after_join), pytest.raises(RuntimeError):
            add(second, joinBookingId=booking_id, confirmReleaseSingleUse=True)
        with app.app_context():
            booking = db.session.get(RoomBooking, int(booking_id))
            assert booking.counts_as_single and len(booking.occupants) == 1
        barrier = Barrier(2)

        def attempt(person):
            barrier.wait(timeout=5)
            return add(person, joinBookingId=booking_id, confirmReleaseSingleUse=True)

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(attempt, [second, third_id]))
        assert sorted(response.status_code for response in responses) == [201, 400]
        joined = next(response for response in responses if response.status_code == 201)
        second = next(int(row['athlete']['id']) for row in joined.json['booking']['occupants']
                      if int(row['athlete']['id']) != first)
    else:
        assert toggle(False).json['countsAsSingle'] is False
        assert join_status() == 'valid'
        if apartment:
            with app.app_context():
                assert db.session.get(RoomBooking, int(other.json['booking']['id'])).effective_counts_as_single
        joined = add(second, joinBookingId=booking_id)
    assert joined.status_code == 201, joined.json
    assert len(joined.json['booking']['occupants']) == 2
    assert joined.json['booking']['countsAsSingle'] is False
    assert joined.json['booking']['id'] == booking_id
    assert joined.json['booking']['checkInDate'] == base['checkInDate']
    assert joined.json['booking']['checkOutDate'] == base['checkOutDate']
    plan = client.get('/api/assignments/planning-view?includeValidations=false', headers=headers).json
    displayed = next(booking for hotel in plan['hotels'] for slot in hotel['slots']
                     for booking in slot['bookings'] if booking['bookingId'] == booking_id)
    assert displayed['countsAsSingle'] is False and len(displayed['occupants']) == 2
    quota = client.get('/api/fis/official-quotas?includePeople=true', headers=headers).json
    assert not next(row['singleRoom'] for row in quota['personStatuses'] if row['personId'] == str(first))['hasSingleUse']
    with app.app_context():
        assert RoomBookingOccupant.query.filter_by(athlete_id=first).one().id == membership_id
        assert db.session.get(Athlete, first).single_room_decision_id == decision_id
        activity = 'EZ-Nutzung aufgehoben und Zimmerpartner hinzugefügt' if direct else 'Quotenbewertung auf DZ gesetzt'
        assert AuditEvent.query.filter_by(activity=activity).count() == 1
    assert toggle(True).json['reasonCode'] == 'INVALID_SINGLE_USE'
    removed = client.delete(f'{url(second)}/{booking_id}', headers=headers)
    assert removed.status_code == 200, removed.json
    with app.app_context():
        assert not db.session.get(RoomBooking, int(booking_id)).effective_counts_as_single
