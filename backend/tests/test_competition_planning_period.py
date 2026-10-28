"""Explicit calendar links remain read-only for imports and event isolated."""
from datetime import date
import json
import pytest
from sqlalchemy.exc import IntegrityError
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_admin_cleanup_reference_pairs import upload_pair
from models import db, AccommodationEvent, EventCompetition, ImportSession, ImportApproval
from app import app
from imports.change_plan import state,digest
from quota_rules import initialization_preflight
from stay_window import assess_stay,load_stay_schedule
pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


def prepare(owner):
    bind(owner)
    period=AccommodationEvent(championship_event_id=owner.id,discipline='Parallel',start_date=date(2027,3,4),end_date=date(2027,3,11))
    db.session.add(period);db.session.commit()
    mappings=EventCompetition.query.filter_by(event_id=owner.id).all()
    return period,[m for m in mappings if m.import_code in {'WSC_PGS_W_6172','WSC_PSL_W_6178'}]


def test_calendar_link_reprojects_isr_without_invalidating_any_review(events):
    owner,_=events;period,mappings=prepare(owner);payload=upload_pair('ISR',owner)
    session=db.session.get(ImportSession,int(payload['session']['id']));saved=session.current_version.preview_json
    approvals={a.id:a.quota_details_json for a in ImportApproval.query.all()}
    assert all('accommodation_event_id' not in row for row in state(owner.id,'ISR')['mappings'])
    before=digest(state(owner.id,'ISR'));preflight=initialization_preflight(owner)['fingerprint']
    assert len(mappings)==2
    for mapping in mappings:
        r=app.test_client().put(f'/api/admin/events/{owner.id}/competitions/{mapping.id}',json={'accommodationEventId':str(period.id)})
        assert r.status_code==200,r.json
        assert r.json['accommodationEvent']['startDate']=='2027-03-04'
    assert digest(state(owner.id,'ISR'))==before
    assert initialization_preflight(owner)['fingerprint']==preflight
    fresh=app.test_client().get(f'/api/import/sessions/{session.id}').json
    assert not fresh['preview']['planStale'] and session.current_version.preview_json==saved
    assert {a.id:a.quota_details_json for a in ImportApproval.query.all()}==approvals
    assert all((p['stayWindow']['outsideNights'],p['stayWindow']['nightsBefore'],p['stayWindow']['nightsAfter'])==(10,0,10) for p in fresh['importControl']['people'])
    # A maintained date changes only the projection, not evidence or review status.
    period.end_date=date(2027,3,15);db.session.commit()
    fresh=app.test_client().get(f'/api/import/sessions/{session.id}').json
    assert all(p['stayWindow']['outsideNights']==6 for p in fresh['importControl']['people'])
    assert not fresh['preview']['planStale'] and digest(state(owner.id,'ISR'))==before
    mappings[0].fis_codex='changed-fis-evidence';db.session.commit()
    assert digest(state(owner.id,'ISR'))!=before


def test_admin_choices_and_links_are_scoped_and_cross_event_fk_is_enforced(events):
    owner,foreign=events;period,mappings=prepare(owner)
    other=AccommodationEvent(championship_event_id=foreign.id,discipline='Foreign',start_date=date(2027,1,1),end_date=date(2027,12,31))
    db.session.add(other);db.session.commit();mapping=mappings[0]
    data=app.test_client().get(f'/api/admin/events/{owner.id}').json
    assert [p['id'] for p in data['planningPeriods']]==[str(period.id)]
    url=f'/api/admin/events/{owner.id}/competitions/{mapping.id}'
    for value in [str(other.id),True,'bad',-1]:
        r=app.test_client().put(url,json={'accommodationEventId':value})
        assert r.status_code==400,r.json
    assert mapping.accommodation_event_id is None
    mapping.accommodation_event_id=other.id
    with pytest.raises(IntegrityError):db.session.commit()
    db.session.rollback()
    assert app.test_client().put(url,json={'accommodationEventId':str(period.id)}).status_code==200
    app.config['OPERATIONAL_EVENT_ID']=str(owner.id)
    assert app.test_client().delete(f'/api/events/{period.id}').status_code==409
    assert app.test_client().put(url,json={'accommodationEventId':None}).status_code==200
    assert mapping.accommodation_event_id is None


def test_explicit_link_is_authoritative_and_bulk_schedule_keeps_one_calendar(events):
    owner,foreign=events;period,mappings=prepare(owner)
    for mapping in mappings:mapping.accommodation_event_id=period.id
    db.session.commit();schedule=load_stay_schedule(owner.id)
    assert len(schedule)==1
    value=assess_stay('2027-03-04','2027-03-22',[m.competition for m in mappings],schedule)
    assert value['outsideNights']==10
    assert all(row.championship_event_id==owner.id for row in schedule)
    # Clearing one unknown competition link cannot silently use its family.
    mappings[0].accommodation_event_id=None;db.session.commit()
    assert assess_stay('2027-03-04','2027-03-22',[m.competition for m in mappings],load_stay_schedule(owner.id))['outsideNights'] is None


def test_copying_event_mappings_never_copies_foreign_period_references(events):
    owner,target=events;period,mappings=prepare(owner)
    mappings[0].accommodation_event_id=period.id
    EventCompetition.query.filter_by(event_id=target.id).delete();db.session.commit()
    result=app.test_client().post(f'/api/admin/events/{target.id}/copy-mappings',json={'sourceEventId':str(owner.id)})
    assert result.status_code==200,result.json
    assert result.json['created']>0
    assert all(row['accommodationEventId'] is None for row in result.json['event']['competitionMappings'])
    assert result.json['event']['planningPeriods']==[]


def test_linked_calendar_is_identical_in_person_and_booking_reads_without_price_changes(events):
    from models import Athlete,Hotel,RoomType,RoomBooking,RoomBookingOccupant
    owner,_=events;period,mappings=prepare(owner)
    for mapping in mappings:mapping.accommodation_event_id=period.id
    person=Athlete(event_id=owner.id,firstname='Synthetic',lastname='ISR',nation_code='ISR',
        function='Athlete',gender='W',arrival_date=date(2027,3,4),departure_date=date(2027,3,22),
        competitions=[m.competition for m in mappings],accommodation_rate_category='SPECIAL',accommodation_rate_source='MANUAL')
    hotel=Hotel(name='Synthetic');room_type=RoomType(name='EZ',max_persons=1)
    db.session.add_all([person,hotel,room_type]);db.session.flush()
    booking=RoomBooking(event_id=owner.id,hotel_id=hotel.id,room_type_id=room_type.id,check_in_date=person.arrival_date,check_out_date=person.departure_date)
    db.session.add(booking);db.session.flush();db.session.add(RoomBookingOccupant(room_booking_id=booking.id,athlete_id=person.id));db.session.commit()
    client=app.test_client();people=client.get('/api/athletes').json;bookings=client.get('/api/room-bookings/grouped').json
    assert len(people)==len(bookings)==1
    expected=people[0]['stayWindow'];assert expected['outsideNights']==10
    assert bookings[0]['occupants'][0]['athlete']['stayWindow']==expected
    assert client.get(f'/api/athletes/{person.id}').json['stayWindow']==expected
    db.session.refresh(person)
    assert person.accommodation_rate_category=='SPECIAL' and person.accommodation_rate_source=='MANUAL'
    assert RoomBooking.query.count()==1
