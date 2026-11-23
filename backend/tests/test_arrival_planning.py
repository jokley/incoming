"""Ambiguous person scopes and historical planning migrations remain protected."""
from datetime import date
import pytest
from test_real_workbook_import import database
from models import db,Athlete,Competition


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
