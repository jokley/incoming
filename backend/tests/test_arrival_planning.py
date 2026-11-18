"""Operative forecasts count exclusive real people, never entries or quota slots."""
import json
import pytest
from test_real_workbook_import import database, preview
from models import db,Athlete,Competition,AthleteArrivalForecast,AuditEvent,Event,WorldChampion
import excel_import as imports


@pytest.fixture
def planning(database):
    import app as routes
    from routes.athletes import athletes
    app,event=database
    app.config.update(TESTING=True,RUNTIME_ENV='development',AUTH_DEV_USER='tester',AUTH_DEV_GROUPS='incoming-admin',AUTH_PROXY_SECRET='')
    app.before_request(routes.authenticate_api_request);app.after_request(routes.audit_successful_mutation)
    app.register_blueprint(athletes)
    app.add_url_rule('/api/athletes/<int:athlete_id>',endpoint='update_athlete',view_func=routes.update_athlete,methods=['PATCH'])
    app.add_url_rule('/api/fis/official-quotas',view_func=routes.get_official_quotas)
    group=Competition.query.filter_by(quota_discipline='Freeski Park & Pipe',gender='M').first()
    people=[Athlete(firstname=f'Person{i}',lastname='Forecast',nation_code='FIN',function='Athlete',gender='M',fis_code=str(9000000+i),competitions=[group]) for i in range(8)]
    db.session.add_all(people);db.session.commit()
    return app.test_client(),event,people


def rows(client):
    response=client.get('/api/athletes/arrival-planning');assert response.status_code==200,response.json
    return response.json['rows']


def save(client,row,total,**extra):
    return client.put('/api/athletes/arrival-planning/'+row['areaId'],json=dict(baseToken=row['baseToken'],expectedTotal=total,**extra))


@pytest.mark.parametrize('named,remaining,conflict',[(0,4,False),(2,2,False),(4,0,False),(5,0,True)])
def test_eight_reported_four_expected(planning,named,remaining,conflict):
    client,_,people=planning
    for p in people[:named]:p.arrival_status='EXPECTED'
    db.session.commit()
    result=save(client,rows(client)[0],4)
    assert result.status_code==200,result.json
    row=result.json
    assert (row['reportedCount'],row['namedExpectedCount'],row['anonymousRemaining'],row['conflict'])==(8,named,remaining,conflict)
    assert row['status']==('CONFLICT' if conflict else 'PLANNED')
    db.session.expire_all();assert rows(client)[0]['expectedTotal']==4
    assert Athlete.query.count()==8


def test_not_set_is_not_zero_and_arrival_changes_are_read_from_people(planning):
    client,_,people=planning
    row=rows(client)[0];assert row['status']=='NOT_SET' and row['expectedTotal'] is None and row['anonymousRemaining'] is None
    saved=save(client,row,4).json
    changed=client.patch(f'/api/athletes/{people[0].id}',json={'arrivalStatus':'CONFIRMED'})
    assert changed.status_code==200
    current=rows(client)[0];assert current['namedExpectedCount']==1 and current['anonymousRemaining']==3 and not current['conflict']
    assert save(client,saved,3).status_code==409  # stale roster/status preview
    assert save(client,current,None).json['status']=='NOT_SET'
    zero=save(client,rows(client)[0],0).json
    assert zero['expectedTotal']==0 and zero['status']=='CONFLICT'  # one named person, not an unset total


def test_multiple_competitions_and_groups_are_exclusive_clarifications(planning):
    client,_,people=planning
    other_same=Competition.query.filter_by(quota_discipline='Freeski Park & Pipe',gender='M').all()[1]
    people[0].competitions.append(other_same)
    people[1].competitions.append(Competition.query.filter_by(quota_discipline='Freestyle',gender='M').first())
    people[2].competitions.append(Competition.query.filter_by(quota_discipline='Snowboard Cross',gender='M').first())
    people[3].gender=None;people[4].gender='M/W';people[5].competitions=[]
    db.session.commit()
    result=rows(client);identities=[p['personId'] for row in result for p in row['people']]
    assert len(identities)==len(set(identities))==8
    assert sum(row['reportedCount'] for row in result)==8
    unresolved=next(row for row in result if not row['editable'])
    assert unresolved['reportedCount']==5 and unresolved['conflict']
    assert unresolved['anonymousRemaining'] is None
    assert save(client,unresolved,4).status_code==400
    assert next(row for row in result if row['editable'])['reportedCount']==3


def test_roster_changes_are_explicit_and_stored_forecasts_do_not_disappear(planning):
    client,_,people=planning
    original=save(client,rows(client)[0],4).json
    new_group=Competition.query.filter_by(quota_discipline='Snowboard Cross',gender='M').first()
    people[0].competitions=[new_group];db.session.commit()
    old=next(row for row in rows(client) if row['areaId']==original['areaId'])
    assert old['expectedTotal']==4 and old['conflict'] and 'Zuordnung' in ' '.join(old['reasons'])
    assert save(client,original,3).status_code==409
    for p in people[1:]:p.competitions=[new_group]
    db.session.commit()
    orphan=next(row for row in rows(client) if row['areaId']==original['areaId'])
    assert orphan['reportedCount']==0 and orphan['expectedTotal']==4 and orphan['conflict']
    assert save(client,orphan,None).json['status']=='NOT_SET'


def test_additional_world_champion_is_one_person_and_never_auto_arrival_or_exemption(planning):
    client,event,people=planning
    # Explicit synthetic WSC policy, same fixture setup as test_world_champion_workflow.
    db.session.execute(db.update(Event).where(Event.id==event.id).values(is_world_championship=True));db.session.commit()
    champion=people[0]
    title=WorldChampion(event_id=event.id,fis_code=champion.fis_code,name='Champion',nation='FIN',gender='M',discipline='Halfpipe',event_group='Freeski Park & Pipe',championship='Previous WSC',championship_year=2025,title_type='INDIVIDUAL',entitlement_enabled=True,active=True,source='Synthetic')
    db.session.add(title)
    champion.competitions.append(Competition.query.filter_by(quota_discipline='Freeski Park & Pipe',gender='M').all()[1]);db.session.commit()
    # Five is the explicit total: four regular travellers plus the champion.
    row=save(client,rows(client)[0],5).json
    assert row['worldChampionCount']==1 and row['anonymousRemaining']==5 and row['reportedCount']==8
    assert champion.arrival_status is None and champion.single_room_quota_exempt_reason is None
    champion.arrival_status='EXPECTED';db.session.commit()
    current=rows(client)[0]
    assert current['namedExpectedCount']==1 and current['anonymousRemaining']==4
    assert len([p for p in current['people'] if p['personId']==str(champion.id)])==1
    assert champion.single_room_quota_exempt_reason is None and current['expectedTotal']==5


def test_versions_dates_audit_roles_and_nations(planning):
    client,event,people=planning
    row=rows(client)[0]
    first=save(client,row,4,checkInDate='2027-03-11',checkOutDate='2027-03-23',note='Discussed with nation')
    assert first.status_code==200 and first.json['checkOutDate']=='2027-03-23'
    assert save(client,row,2).status_code==409
    audit=AuditEvent.query.order_by(AuditEvent.id.desc()).first()
    assert audit.entity_type=='athlete-arrival-forecast'
    changes=json.loads(audit.changes_json)
    assert changes['previousForecast']['expectedTotal'] is None and changes['expectedTotal']==4
    assert first.json['updatedBy']=='tester'
    for bad in [-1,True,1.5,'4']:
        assert save(client,first.json,bad).status_code==400
    assert save(client,first.json,4,checkInDate='2027-03-23',checkOutDate='2027-03-11').status_code==400
    client.application.config['AUTH_DEV_GROUPS']='incoming-viewer'
    assert save(client,first.json,2).status_code==403
    assert client.get('/api/athletes/arrival-planning?nationCode=AUT').json['rows']==[]
    client.application.config['AUTH_DEV_GROUPS']='incoming-editor'
    assert save(client,first.json,3).status_code==200
    assert AthleteArrivalForecast.query.one().expected_total==3


def test_full_reimport_keeps_forecast_and_new_people_do_not_increase_it(planning,monkeypatch):
    client,event,people=planning
    row=save(client,rows(client)[0],4).json
    result=preview('AUS',event,monkeypatch);imports.confirm_fis_import(result['previewToken'])
    assert next(r for r in rows(client) if r['areaId']==row['areaId'])['expectedTotal']==4
    p=Athlete(firstname='New',lastname='Person',nation_code='FIN',gender='M',function='Athlete',competitions=people[0].competitions)
    db.session.add(p);db.session.commit()
    changed=next(r for r in rows(client) if r['areaId']==row['areaId'])
    assert changed['reportedCount']==9 and changed['expectedTotal']==4 and changed['conflict']


def test_forecast_migration_is_additive_and_reversible():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine,text,inspect
    from sqlalchemy.exc import IntegrityError
    from alembic.operations import Operations
    from alembic.migration import MigrationContext
    path=Path(__file__).parents[1]/'migrations/versions/20261118_02_arrival_forecast.py'
    spec=importlib.util.spec_from_file_location('forecast_migration',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    with create_engine('sqlite://').begin() as connection:
        connection.execute(text('CREATE TABLE championship_event(id INTEGER PRIMARY KEY)'))
        connection.execute(text('INSERT INTO championship_event VALUES (1)'))
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            connection.execute(text("INSERT INTO athlete_arrival_forecast(id,event_id,nation_code,discipline,gender,expected_total,roster_digest,updated_by,updated_at) VALUES (1,1,'FIN','Freeski Park & Pipe','M',4,'digest','tester','2026-11-18')"))
            assert connection.scalar(text('SELECT expected_total FROM athlete_arrival_forecast'))==4
            with pytest.raises(IntegrityError):connection.execute(text('UPDATE athlete_arrival_forecast SET expected_total=-1'))
            with pytest.raises(IntegrityError):connection.execute(text("UPDATE athlete_arrival_forecast SET gender='X'"))
            module.downgrade()
            assert 'athlete_arrival_forecast' not in inspect(connection).get_table_names()
            assert connection.scalar(text('SELECT count(*) FROM championship_event'))==1


def test_forecasts_preserve_booking_single_use_and_live_person_status(planning):
    from datetime import date
    from models import RoomBooking,RoomBookingOccupant,Hotel,RoomType
    client,event,people=planning
    person=people[0]
    person.arrival_date=date(2027,3,11);person.departure_date=date(2027,3,23)
    hotel=Hotel(name='Forecast test');rt=RoomType(name='Single',max_persons=1)
    db.session.add_all([hotel,rt]);db.session.flush()
    booking=RoomBooking(event_id=event.id,hotel=hotel,room_type=rt,room_number='1',check_in_date=person.arrival_date,check_out_date=person.departure_date,counts_as_single=True)
    db.session.add(booking);db.session.flush();db.session.add(RoomBookingOccupant(room_booking_id=booking.id,athlete_id=person.id));db.session.commit()
    before=booking.to_dict()
    projection=client.get('/api/fis/official-quotas?includePeople=true').json
    response=save(client,rows(client)[0],4)
    assert response.status_code==200
    assert booking.to_dict()==before
    assert client.get('/api/fis/official-quotas?includePeople=true').json==projection
    person.arrival_status='NOT_TRAVELLING';db.session.commit()
    current=rows(client)[0]
    assert current['conflict'] and 'bestehende Buchungen' in ' '.join(current['reasons'])
    assert booking.counts_as_single and len(booking.occupants)==1


def test_explicit_zero_is_not_an_unset_forecast(planning):
    client,_,_=planning
    zero=save(client,rows(client)[0],0).json
    assert zero['status']=='PLANNED' and zero['anonymousRemaining']==0 and zero['expectedTotal']==0
