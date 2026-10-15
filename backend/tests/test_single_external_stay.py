from datetime import date
import pytest
from test_accommodation_segments import state, data
from test_real_workbook_import import database
from test_external_accommodation import external, preview
from test_external_replacement import prepare, plan
from models import db, Hotel, RoomBooking, RoomBookingOccupant
from routes.accommodation_segments import coverage_for


def create(state, shared=False):
    client,people,_,_=state
    hotel,source=prepare(state,shared)
    result=client.post('/api/assignments/segments',json=plan(state,hotel,[p.id for p in people[:2 if shared else 1]]).json)
    assert result.status_code==201,result.json
    return hotel,result.json['booking']['id']


def snapshot():return [b.to_dict() for b in RoomBooking.query.order_by(RoomBooking.id).all()]

def external_count(person):
    return RoomBooking.query.join(RoomBookingOccupant).join(Hotel).filter(RoomBookingOccupant.athlete_id==person.id,Hotel.accommodation_type=='EXTERNAL').count()


def test_second_external_create_rejected_by_preview_direct_add_and_conversion(state):
    client,people,_,_=state;hotel,identity=create(state)
    before=snapshot()
    second=preview(state,hotel,start='2027-03-20',end='2027-03-22')
    assert second.status_code==400,second.json
    assert second.json['reasonCode']=='EXTERNAL_ALREADY_EXISTS'
    raw={'hotelId':str(hotel.id),'checkInDate':'2027-03-20','checkOutDate':'2027-03-22'}
    rejected=client.post(f'/api/assignments/persons/{people[0].id}/segments',json=raw)
    assert rejected.status_code==400 and rejected.json['reasonCode']=='EXTERNAL_ALREADY_EXISTS'
    standard=RoomBooking.query.filter_by(hotel_id=state[2].id).one()
    conversion=client.put(f'/api/assignments/persons/{people[0].id}/segments/{standard.id}',json={**raw,'checkOutDate':'2027-03-27'})
    assert conversion.status_code==400 and conversion.json['reasonCode']=='EXTERNAL_ALREADY_EXISTS'
    assert snapshot()==before


def test_pair_one_existing_blocks_both_but_other_person_can_create(state):
    client,people,_,_=state;hotel,_=prepare(state,True)
    assert client.post('/api/assignments/segments',json=plan(state,hotel,[people[0].id]).json).status_code==201
    before=snapshot()
    both=plan(state,hotel,[p.id for p in people[:2]])
    assert both.status_code==400 and both.json['reasonCode']=='EXTERNAL_ALREADY_EXISTS'
    assert snapshot()==before
    other=plan(state,hotel,[people[1].id]);assert other.status_code==200,other.json
    assert client.post('/api/assignments/segments',json=other.json).status_code==201
    assert all(external_count(person)==1 for person in people[:2])


def test_external_edit_location_and_shorten_only_selected_segment(state):
    client,people,_,_=state;hotel,identity=create(state)
    second=Hotel(name='Other external',accommodation_type='EXTERNAL');db.session.add(second);db.session.commit()
    standard=RoomBooking.query.filter_by(hotel_id=state[2].id).one();before=standard.to_dict()
    endpoint=f'/api/assignments/persons/{people[0].id}/segments/{identity}'
    response=client.put(endpoint,json={'hotelId':str(second.id),'checkInDate':'2027-03-14','checkOutDate':'2027-03-20'})
    assert response.status_code==200,response.json
    response=client.put(endpoint,json={'hotelId':str(second.id),'checkInDate':'2027-03-14','checkOutDate':'2027-03-18'})
    assert response.status_code==200,response.json
    assert response.json['accommodationCoverage']['openIntervals']==[{'checkInDate':'2027-03-18','checkOutDate':'2027-03-20'}]
    assert standard.to_dict()==before
    assert external_count(people[0])==1


def test_conflicting_external_edit_does_not_partition_standard(state):
    client,people,_,_=state;hotel,identity=create(state);before=snapshot()
    response=client.put(f'/api/assignments/persons/{people[0].id}/segments/{identity}',json={
        'hotelId':str(hotel.id),'checkInDate':'2027-03-14','checkOutDate':'2027-03-22'})
    assert response.status_code==400,response.json
    assert response.json['reasonCode']=='PERSON_BOOKING_OVERLAP'
    assert 'Bitte zuerst die betroffene Zuweisung anpassen oder entfernen' in response.json['message']
    assert snapshot()==before


def test_remove_external_leaves_gap_and_standard_does_not_expand(state):
    client,people,_,_=state;hotel,identity=create(state)
    standard=RoomBooking.query.filter_by(hotel_id=state[2].id).one();before=standard.to_dict()
    removed=client.delete(f'/api/assignments/persons/{people[0].id}/segments/{identity}')
    assert removed.status_code==200
    assert removed.json['accommodationCoverage']['openIntervals']==[{'checkInDate':'2027-03-14','checkOutDate':'2027-03-20'}]
    assert standard.to_dict()==before
    assert plan(state,hotel,[people[0].id]).status_code==200


def test_shared_external_individual_edit_preserves_partner_and_one_relationship_each(state):
    client,people,_,_=state;hotel,identity=create(state,True)
    partner=coverage_for(people[1])
    response=client.put(f'/api/assignments/persons/{people[0].id}/segments/{identity}',json={
        'hotelId':str(hotel.id),'checkInDate':'2027-03-14','checkOutDate':'2027-03-18'})
    assert response.status_code==200,response.json
    assert coverage_for(people[1])==partner
    assert all(external_count(person)==1 for person in people[:2])


def test_external_split_endpoint_cannot_bypass_one_segment_rule(state):
    client,people,_,_=state;hotel,identity=create(state,True);before=snapshot()
    response=client.get(f'/api/assignments/bookings/{identity}/split-preview',query_string={'athleteIds':str(people[0].id),'splitDate':'2027-03-17'})
    assert response.status_code==400 and response.json['reasonCode']=='EXTERNAL_SPLIT_DISABLED'
    from accommodation_split import preview_token
    booking=db.session.get(RoomBooking,int(identity))
    direct=client.post(f'/api/assignments/bookings/{identity}/split',json={'athleteIds':[str(people[0].id)],'splitDate':'2027-03-17','previewToken':preview_token(booking,[str(people[0].id)],'2027-03-17')})
    assert direct.status_code==400 and direct.json['reasonCode']=='EXTERNAL_SPLIT_DISABLED'
    assert snapshot()==before


def test_historical_multiple_external_stays_remain_visible_without_normalization(state):
    client,people,_,_=state;hotel=external(state)
    for start,end in ((14,18),(18,20)):
        b=RoomBooking(hotel=hotel,check_in_date=date(2027,3,start),check_out_date=date(2027,3,end))
        b.occupants=[RoomBookingOccupant(athlete=people[0])];db.session.add(b)
    db.session.commit();before=snapshot()
    assert len(coverage_for(people[0])['segments'])==2
    rejected=preview(state,hotel,start='2027-03-22',end='2027-03-27')
    assert rejected.status_code==400 and rejected.json['reasonCode']=='EXTERNAL_ALREADY_EXISTS'
    assert snapshot()==before
    existing=RoomBooking.query.first()
    edit=client.put(f'/api/assignments/persons/{people[0].id}/segments/{existing.id}',json={'hotelId':str(hotel.id),'checkInDate':'2027-03-14','checkOutDate':'2027-03-17'})
    assert edit.status_code==200,edit.json
    assert external_count(people[0])==2
    assert client.delete(f'/api/assignments/persons/{people[0].id}/segments/{existing.id}').status_code==200
    assert external_count(people[0])==1
