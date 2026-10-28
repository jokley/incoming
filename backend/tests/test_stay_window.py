"""Non-blocking stay projections: one MIN/MAX window, never split people or prices."""
from pathlib import Path
from datetime import date
from types import SimpleNamespace as NS
import json
import pytest
from stay_window import assess_stay, load_stay_schedule


def competition(identity=1, name='Big Air'):
    return NS(id=identity, name=name, display_name=f'Snowboard {name}')


def period(name='Big Air', start='2027-03-06', end='2027-03-13'):
    return NS(discipline=name, start_date=start, end_date=end)


@pytest.mark.parametrize('arrival,departure,before,after',[
    ('2027-03-04','2027-03-14',0,0),  # both exact boundaries; checkout is not a night
    ('2027-03-02','2027-03-14',2,0),
    ('2027-03-04','2027-03-15',0,1),
    ('2027-03-02','2027-03-15',2,1),
    ('2027-03-05','2027-03-13',0,0),
    ('2027-03-01','2027-03-03',2,0),  # wholly before
    ('2027-03-15','2027-03-17',0,2),  # wholly after
])
def test_nights_and_checkout_semantics(arrival,departure,before,after):
    view=assess_stay(arrival,departure,[competition()],[period()])
    assert (view['nightsBefore'],view['nightsAfter'],view['outsideNights'])==(before,after,before+after)
    assert view['allowedStart']=='2027-03-04' and view['allowedEnd']=='2027-03-14'


@pytest.mark.parametrize('second_start,second_end',[
    ('2027-03-14','2027-03-21'),  # consecutive competitions
    ('2027-03-20','2027-03-21'),  # large gap remains included
    ('2027-03-08','2027-03-21'),  # overlap must not double count
])
def test_multiple_competitions_use_one_min_max_window(second_start,second_end):
    view=assess_stay('2027-03-02','2027-03-23',[competition(),competition(2,'Slopestyle'),competition()],
                     [period(),period('Slopestyle',second_start,second_end)])
    assert (view['eventStart'],view['eventEnd'],view['allowedStart'],view['allowedEnd'])==('2027-03-06','2027-03-21','2027-03-04','2027-03-22')
    assert view['outsideNights']==3


@pytest.mark.parametrize('schedule',[
    [], [period(start=None)], [period(end='not-a-date')], [period(start='2027-03-20')],
    [period(),period()],  # ambiguous dates are never guessed
])
def test_missing_or_ambiguous_dates_do_not_look_compliant(schedule):
    view=assess_stay('2027-03-02','2027-03-23',[competition()],schedule)
    assert view['reason']=='EVENT_DATES_UNCLEAR' and view['outsideNights'] is None


def test_every_membership_must_resolve_and_people_keep_individual_stays():
    assert assess_stay('2027-03-04','2027-03-14',[competition(),competition(2,'Halfpipe')],[period()])['outsideNights'] is None
    assert assess_stay('2027-03-04','2027-03-14',[competition()],[period()])['outsideNights']==0
    assert assess_stay('2027-03-02','2027-03-15',[competition()],[period()])['outsideNights']==3
    assert assess_stay(None,None,[competition()],[period()])['reason']=='STAY_DATES_UNCLEAR'
    assert assess_stay('2027-03-02','2027-03-15',[competition()],[period()],'NO_ROOM')['reason']=='NO_ROOM'


from test_import_event_identity import events
from test_event_quota_rules import bind
from models import db, Athlete, Competition, AccommodationEvent, Hotel, RoomType, RoomBooking, RoomBookingOccupant
from app import app
from import_control import build_import_control
from imports.read_context import ImportReadContext
pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


def test_import_people_booking_export_inputs_and_event_isolation_agree(events,monkeypatch,tmp_path):
    owner,foreign=events;bind(owner)
    comp=Competition.query.filter_by(display_name='Snowboard Big Air',gender='M').one()
    other=Competition.query.filter_by(display_name='Snowboard Slopestyle',gender='M').one()
    for event in (owner,foreign):
        for name,start,end in [('Big Air',6,13),('Slopestyle',14,21)]:
            db.session.add(AccommodationEvent(championship_event_id=event.id,discipline=name,
                start_date=date(2027,3,start),end_date=date(2027,3,end)))
    # Foreign date must never expand the permitted window.
    db.session.add(AccommodationEvent(championship_event_id=foreign.id,discipline='Big Air',start_date=date(2027,1,1),end_date=date(2027,12,31)))
    person=Athlete(event_id=owner.id,firstname='Synthetic',lastname='CAN',nation_code='CAN',function='Athlete',
        gender='M',arrival_date=date(2027,3,2),departure_date=date(2027,3,23),competitions=[comp,other],
        accommodation_rate_category='SPECIAL',accommodation_rate_source='MANUAL')
    hotel=Hotel(name='Synthetic hotel');room_type=RoomType(name='EZ',max_persons=1)
    db.session.add_all([person,hotel,room_type]);db.session.flush()
    booking=RoomBooking(event_id=owner.id,hotel_id=hotel.id,room_type_id=room_type.id,
        check_in_date=person.arrival_date,check_out_date=person.departure_date)
    db.session.add(booking);db.session.flush()
    db.session.add(RoomBookingOccupant(room_booking_id=booking.id,athlete_id=person.id));db.session.commit()
    preview=dict(people=[dict(matchKey='can',firstname='Synthetic',lastname='CAN',nationCode='CAN',function='Athlete',gender='M',
        arrivalDate='2027-03-02',departureDate='2027-03-23',accommodationRequirement='REQUIRED',
        competitionMemberships=[dict(competitionId=str(c.id),quotaDiscipline=c.quota_discipline) for c in (comp,other)])],rooms=[],errors=[],warnings=[])
    original=json.dumps(preview,sort_keys=True)
    control=build_import_control(preview,ImportReadContext(owner.id))
    expected=control['people'][0]['stayWindow'];assert expected['outsideNights']==3
    assert expected==json.loads((Path(__file__).parent/'fixtures/stay-window.synthetic.json').read_text())
    client=app.test_client()
    people=client.get('/api/athletes').json
    assert len(people)==1 and people[0]['stayWindow']==expected
    assert client.get(f'/api/athletes/{person.id}').json['stayWindow']==expected
    grouped=client.get('/api/room-bookings/grouped').json
    assert len(grouped)==1 and len(grouped[0]['occupants'])==1
    assert grouped[0]['occupants'][0]['athlete']['stayWindow']==expected
    assert json.dumps(preview,sort_keys=True)==original
    assert person.accommodation_rate_category=='SPECIAL' and db.session.get(RoomBooking,booking.id) is not None
    # Re-read of a changed import stay is fresh, without persisting projection facts.
    preview['people'][0]['arrivalDate']='2027-03-04'
    assert build_import_control(preview,ImportReadContext(owner.id))['people'][0]['stayWindow']['outsideNights']==1
    assert person.arrival_date==date(2027,3,2)
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(foreign.id))
    assert client.get('/api/athletes').json==[]
    assert len(load_stay_schedule(foreign.id))==3
    # Generated contract for the frontend/export regression, never a person database dump.
    (tmp_path/'stay-contract.json').write_text(json.dumps(expected))


def test_reimport_changed_stay_reassesses_without_changing_identity_or_rates(events,monkeypatch):
    from test_import_event_identity import preview as stage, rows
    import excel_import
    owner,_=events;bind(owner)
    db.session.add(AccommodationEvent(championship_event_id=owner.id,discipline='Big Air',start_date=date(2027,3,6),end_date=date(2027,3,13)))
    db.session.commit()
    data=rows();data['Arrival_date']='02.03.2027';data['Departure_date']='15.03.2027'
    first=stage(owner,monkeypatch,data)
    assert first['isValid'],first['errors']
    view=build_import_control(first,ImportReadContext(owner.id))['people'][0]['stayWindow']
    assert view['outsideNights']==3
    excel_import.confirm_fis_import(first['previewToken'])
    person=Athlete.query.one();identity=person.id
    person.accommodation_rate_category='SPECIAL';person.accommodation_rate_source='MANUAL';db.session.commit()
    data['Arrival_date']='04.03.2027';data['Departure_date']='14.03.2027'
    again=stage(owner,monkeypatch,data)
    assert build_import_control(again,ImportReadContext(owner.id))['people'][0]['stayWindow']['outsideNights']==0
    excel_import.confirm_fis_import(again['previewToken'])
    db.session.refresh(person)
    assert Athlete.query.count()==1 and person.id==identity and person.accommodation_rate_category=='SPECIAL'
    assert len(person.competitions)==1 and person.arrival_date==date(2027,3,4)


def test_isr_style_stay_needs_actual_alpine_dates_not_full_championship_guess():
    comps=[competition(1,'Parallel Giant Slalom'),competition(2,'Parallel Slalom')]
    unknown=assess_stay('2027-03-04','2027-03-22',comps,[])
    assert unknown['outsideNights'] is None and unknown['reason']=='EVENT_DATES_UNCLEAR'
    # Explicit synthetic dates, not claimed as actual Montafon event dates.
    dates=[period('Parallel Giant Slalom','2027-03-08','2027-03-08'),period('Parallel Slalom','2027-03-09','2027-03-09')]
    known=assess_stay('2027-03-04','2027-03-22',comps,dates)
    assert (known['allowedStart'],known['allowedEnd'],known['outsideNights'])==('2027-03-06','2027-03-10',14)
