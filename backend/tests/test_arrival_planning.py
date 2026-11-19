"""Operative forecasts count exclusive real people, never entries or quota slots."""
import json
from datetime import date
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
    app.add_url_rule('/api/assignments/planning-view',view_func=routes.get_assignments_planning_view)
    group=Competition.query.filter_by(quota_discipline='Freeski Park & Pipe',gender='M').first()
    people=[Athlete(firstname=f'Person{i}',lastname='Forecast',nation_code='FIN',function='Athlete',gender='M',arrival_date=date(2027,3,11),departure_date=date(2027,3,23),fis_code=str(9000000+i),competitions=[group]) for i in range(8)]
    db.session.add_all(people);db.session.commit()
    return app.test_client(),event,people


def rows(client):
    response=client.get('/api/athletes/arrival-planning');assert response.status_code==200,response.json
    return response.json['rows']


def save(client,row,total,**extra):
    return client.put('/api/athletes/arrival-planning/'+row['areaId'],json=dict(baseToken=row['baseToken'],expectedTotal=total,**extra))



@pytest.mark.parametrize('reported,total,virtual,replaced',[(4,None,0,0),(8,None,0,0),(8,4,4,8),(8,5,5,8),(4,4,0,0),(8,0,0,8)])
def test_normal_reduced_and_explicit_zero(planning,reported,total,virtual,replaced):
    client,_,people=planning
    for p in people[reported:]:db.session.delete(p)
    db.session.commit()
    if total is not None:assert save(client,rows(client)[0],total).status_code==200
    row=rows(client)[0]
    assert row['reportedCount']==reported and row['virtualPlaces']==virtual
    assert len(row['replacedPersonIds'])==replaced
    assert row['usesVirtualPlanning']==(replaced>0)
    assert row['expectedTotal']==total and not row['conflict']
    planning_view=client.get('/api/assignments/planning-view?includeValidations=false').json
    assert planning_view['athletePlanning']['replacedPersonIds']==row['replacedPersonIds']
    assert len(planning_view['athletePlanning']['groups'])==(1 if virtual else 0)
    assert len({p['athleteId'] for u in planning_view['units']['unassigned'] for p in u['occupants']})==reported
    assert Athlete.query.count()==reported
    projection=client.get('/api/fis/official-quotas?includePeople=true').json
    assert projection['personSummary']['unassigned']==reported-replaced
    assert projection['personSummary']['operationalAccommodationDemand']==reported-replaced+virtual
    assert 'arrivalStatus' not in client.get('/api/athletes').json[0]
    assert client.patch(f'/api/athletes/{people[0].id}',json={'arrivalStatus':'EXPECTED'}).status_code==400


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
    assert unresolved['virtualPlaces']==0
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
    assert row['worldChampionCount']==1 and row['virtualPlaces']==5 and row['reportedCount']==8
    assert champion.single_room_quota_exempt_reason is None
    db.session.commit()
    current=rows(client)[0]
    assert current['virtualPlaces']==5
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


@pytest.mark.parametrize('booked_count',[1,2])
@pytest.mark.parametrize('total',[0,4])
def test_forecasts_preserve_booking_single_use_and_live_person_status(planning,booked_count,total):
    from models import RoomBooking,RoomBookingOccupant,Hotel,RoomType
    client,event,people=planning
    hotel=Hotel(name='Forecast test');rt=RoomType(name='Single',max_persons=1)
    db.session.add_all([hotel,rt]);db.session.flush()
    bookings=[]
    for index,person in enumerate(people[:booked_count]):
        booking=RoomBooking(event_id=event.id,hotel=hotel,room_type=rt,room_number=str(index+1),check_in_date=person.arrival_date,check_out_date=person.departure_date,counts_as_single=True)
        db.session.add(booking);db.session.flush();db.session.add(RoomBookingOccupant(room_booking_id=booking.id,athlete_id=person.id));bookings.append(booking)
    db.session.commit()
    before=[booking.to_dict() for booking in bookings]
    projection=client.get('/api/fis/official-quotas?includePeople=true').json
    response=save(client,rows(client)[0],total)
    assert response.status_code==200
    assert [booking.to_dict() for booking in bookings]==before
    current=client.get('/api/fis/official-quotas?includePeople=true').json
    # A blocked forecast never changes the operative basis or physical usage.
    assert current['personStatuses']==projection['personStatuses']
    assert current['rows'][0]['athletesEntered']==projection['rows'][0]['athletesEntered']==8
    assert current['rows'][0]['expectedAthletes']==8
    assert current['rows'][0]['officialQuota']==10
    assert current['rows'][0]['singleRoomOfficialBasis']==0
    assert current['personSummary']['pendingSingleRoomPeople']==projection['personSummary']['pendingSingleRoomPeople']
    assert response.json['conflict'] and response.json['virtualPlaces']==0
    assert response.json['replacedPersonIds']==[]
    assert current['personSummary']['planningConflicts']==1
    assert current['personSummary']['fullyAssigned']==booked_count
    assert current['personSummary']['unassigned']==8-booked_count
    assert current['personSummary']['accommodationPeopleRequired']==current['personSummary']['operationalAccommodationDemand']==8
    assert current['personPlanning']['replacedPersonIds']==[]
    assert current['personPlanning']['virtualPlaces']==current['personPlanning']['zeroAreas']==0
    assert current['personPlanning']['zeroGroups']==[]
    view=client.get('/api/assignments/planning-view?includeValidations=false').json
    assert view['athletePlanning']['replacedPersonIds']==[] and view['athletePlanning']['conflicts']==1
    open_ids={p['athleteId'] for unit in view['units']['unassigned'] for p in unit['occupants'] if p['accommodationCoverage']['openIntervals']}
    assert open_ids=={str(p.id) for p in people[booked_count:]}
    assert view['athletePlanning']['groups'][0]['conflict']
    assert all(booking.counts_as_single and len(booking.occupants)==1 for booking in bookings)


def test_explicit_zero_is_not_an_unset_forecast(planning):
    client,_,_=planning
    zero=save(client,rows(client)[0],0).json
    assert zero['status']=='PLANNED' and zero['virtualPlaces']==0 and zero['expectedTotal']==0


def test_removal_migration_refuses_manual_values_then_preserves_people():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine,text,inspect
    from alembic.operations import Operations
    from alembic.migration import MigrationContext
    path=Path(__file__).parents[1]/'migrations/versions/20261118_03_remove_arrival_status.py'
    spec=importlib.util.spec_from_file_location('remove_status',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    with create_engine('sqlite://').begin() as connection:
        connection.execute(text("CREATE TABLE athlete(id INTEGER PRIMARY KEY, firstname TEXT, arrival_status VARCHAR(20), CONSTRAINT arrival_status CHECK(arrival_status IS NULL OR arrival_status IN ('EXPECTED','UNDECIDED','CONFIRMED','NOT_TRAVELLING')))"))
        connection.execute(text("INSERT INTO athlete VALUES (1,'Original','EXPECTED')"))
        with Operations.context(MigrationContext.configure(connection)):
            with pytest.raises(RuntimeError,match='Manual arrival statuses exist'):module.upgrade()
            assert connection.scalar(text('SELECT arrival_status FROM athlete'))=='EXPECTED'
            connection.execute(text('UPDATE athlete SET arrival_status=NULL'))
            module.upgrade()
            assert 'arrival_status' not in {c['name'] for c in inspect(connection).get_columns('athlete')}
            assert connection.scalar(text('SELECT firstname FROM athlete'))=='Original'
            module.downgrade()
            assert connection.scalar(text('SELECT arrival_status FROM athlete')) is None


@pytest.mark.parametrize('change',['added','removed','removed_all','regrouped','multiple_groups','missing_gender'])
def test_blocked_forecast_keeps_all_current_person_tasks(planning,change):
    client,_,people=planning
    original=save(client,rows(client)[0],4).json
    assert len(original['replacedPersonIds'])==8
    if change=='added':
        db.session.add(Athlete(firstname='New',lastname='Member',nation_code='FIN',function='Athlete',gender='M',competitions=people[0].competitions,arrival_date=people[0].arrival_date,departure_date=people[0].departure_date))
    elif change=='removed':db.session.delete(people[-1])
    elif change=='removed_all':
        for person in people:db.session.delete(person)
    elif change=='regrouped':people[0].competitions=[Competition.query.filter_by(quota_discipline='Snowboard Cross',gender='M').first()]
    elif change=='multiple_groups':people[0].competitions.append(Competition.query.filter_by(quota_discipline='Snowboard Cross',gender='M').first())
    else:people[0].gender=None
    db.session.commit()
    view=client.get('/api/assignments/planning-view?includeValidations=false').json
    policy=view['athletePlanning']
    from arrival_planning import project,operational_athlete_basis
    assert operational_athlete_basis(project())=={}
    assert policy['replacedPersonIds']==[] and policy['virtualPlaces']==0 and policy['conflicts']>0
    assert any(group['conflict'] for group in policy['groups'])
    count=Athlete.query.count()
    assert sum(len(unit['occupants']) for unit in view['units']['unassigned'])==count
    response=client.get('/api/fis/official-quotas?includePeople=true')
    if change=='missing_gender':
        # Existing quota validation remains fail-closed; the queue above still
        # exposes all people and the UI cannot claim a successful evaluation.
        assert response.status_code==409 and response.json['code']=='QUOTA_GENDER_REVIEW_REQUIRED'
        assert 'personSummary' not in response.json
        return
    assert response.status_code==200,response.json
    current=response.json
    assert current['personSummary']['unassigned']==count
    assert current['personSummary']['fullyAssigned']==0 and current['personSummary']['operationalAccommodationDemand']==count
    assert current['personSummary']['planningConflicts']>0
    assert current['personPlanning']['replacedPersonIds']==[]
    assert sum(len(unit['occupants']) for unit in view['units']['unassigned'])==count


@pytest.mark.parametrize('change',['booked','changed_roster','ambiguous','orphaned'])
def test_blocked_nn_uses_normal_operative_quota_basis(planning,change):
    from models import RoomBooking,RoomBookingOccupant,Hotel,RoomType
    from arrival_planning import project,operational_athlete_basis,operational_quota_projection
    from quota_rules import rules_for_event
    client,event,people=planning
    competition=people[0].competitions[0]
    db.session.add_all([Athlete(firstname=f'Official{i}',lastname='Fallback',nation_code='FIN',function='NSA Coach',gender='M',competitions=[competition]) for i in range(10)])
    db.session.commit()
    initial=save(client,rows(client)[0],4).json
    assert operational_athlete_basis(project())=={('FIN','Freeski Park & Pipe','M'):4}
    if change=='booked':
        hotel=Hotel(name='Fallback booking');room=RoomType(name='DZ',max_persons=2)
        booking=RoomBooking(event_id=event.id,hotel=hotel,room_type=room,counts_as_single=False,check_in_date=people[0].arrival_date,check_out_date=people[0].departure_date)
        db.session.add(booking);db.session.flush()
        db.session.add_all([RoomBookingOccupant(room_booking_id=booking.id,athlete_id=p.id) for p in people[:2]])
    elif change=='changed_roster':db.session.delete(people[-1])
    elif change=='ambiguous':
        for p in people:p.competitions.append(Competition.query.filter_by(quota_discipline='Snowboard Cross',gender='M').first())
    else:
        for p in people:p.competitions=[]
    db.session.commit()
    overview=project();assert operational_athlete_basis(overview)=={}
    assert any(row['conflict'] for row in overview['rows'])
    assert all(row['virtualPlaces']==0 and row['replacedPersonIds']==[] for row in overview['rows'])
    public=client.get('/api/fis/official-quotas?includePeople=true').json
    assert public['personPlanning']['conflicts']>0
    assert public['personPlanning']['replacedPersonIds']==[]
    for row in public['rows']:
        assert row['expectedAthletes']==row['athletesEntered']
        assert row['officialQuota']==row['athletesEntered']+2
        assert row['singleRoomOfficialBasis']==min(row['registeredOfficials'],row['officialQuota'])
    roster=[dict(personId=p.id,nationCode=p.nation_code,function=p.function,gender=p.gender,quotaDisciplines=[c.quota_discipline for c in p.competitions]) for p in Athlete.query.all()]
    projected=operational_quota_projection(overview,roster,[],rules_for_event(event.id))
    assert projected['conflict'] and projected['reasons']
    for row in projected['rows']:
        assert row['expectedAthletes']==row['athletesEntered']
        assert row['officialQuota']==row['fisOfficialQuota']
    if change in {'booked','changed_roster'}:
        assert next(row for row in projected['rows'] if row['discipline']=='Freeski Park & Pipe')['nnForecastBlocked']
    assert next(row for row in rows(client) if row['areaId']==initial['areaId'])['expectedTotal']==4
