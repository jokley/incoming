"""Operative arrival decisions never change FIS participation or hotel demand."""
from datetime import date
import importlib.util
import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from alembic.migration import MigrationContext
from alembic.operations import Operations

from test_real_workbook_import import database, preview
from test_accommodation_segments import state, add, snapshot
from models import db, Athlete, AuditEvent, Event
import excel_import as imports


@pytest.mark.parametrize('function,expected', [('Athlete','UNDECIDED'),(' athlete ','UNDECIDED'),('NSA Coach','EXPECTED'),('Official','EXPECTED')])
def test_defaults_are_read_projections_not_imported_decisions(database,function,expected):
    person=Athlete(firstname='A',lastname='Person',nation_code='AUT',function=function)
    db.session.add(person);db.session.commit()
    assert person.arrival_status is None
    assert person.to_dict()['arrivalStatus']==expected
    assert person.to_dict()['arrivalStatusSource']=='DEFAULT'


@pytest.fixture
def api_state(state):
    import app as routes
    from routes.athletes import athletes
    app=state[0].application
    app.config.update(TESTING=True,RUNTIME_ENV='development',AUTH_DEV_USER='tester',AUTH_DEV_GROUPS='incoming-admin',AUTH_PROXY_SECRET='')
    app.before_request(routes.authenticate_api_request)
    app.after_request(routes.audit_successful_mutation)
    app.register_blueprint(athletes)
    app.add_url_rule('/api/fis/official-quotas',view_func=routes.get_official_quotas)
    app.add_url_rule('/api/athletes/<int:athlete_id>',endpoint='update_athlete',view_func=routes.update_athlete,methods=['PATCH'])
    return state


@pytest.mark.parametrize('status',['UNDECIDED','EXPECTED','CONFIRMED','NOT_TRAVELLING'])
def test_persist_reload_audit_and_keep_bookings_and_quota(api_state,status):
    import app as routes
    client,people,_,_=api_state;p=people[0];add(api_state,14,27)
    before=snapshot();quotas=routes._build_official_quota_usage_rows()
    projection=client.get('/api/fis/official-quotas?includePeople=true').json
    response=client.patch(f'/api/athletes/{p.id}',json={'arrivalStatus':status})
    assert response.status_code==200,response.json
    db.session.expire_all()
    assert db.session.get(Athlete,p.id).arrival_status==status
    assert client.get(f'/api/athletes/{p.id}').json['arrivalStatus']==status
    assert next(r for r in client.get('/api/athletes').json if r['id']==str(p.id))['arrivalStatus']==status
    assert snapshot()==before
    assert routes._build_official_quota_usage_rows()==quotas
    assert client.get('/api/fis/official-quotas?includePeople=true').json==projection
    event=AuditEvent.query.order_by(AuditEvent.id.desc()).first()
    assert json.loads(event.changes_json)['arrival_status']=={'old':'UNDECIDED','new':status}
    assert json.loads(event.changes_json)['arrival_status_source']=={'old':'DEFAULT','new':'MANUAL'}
    released=client.patch(f'/api/athletes/{p.id}',json={'arrivalStatus':None})
    assert released.status_code==200 and released.json['arrivalStatusSource']=='DEFAULT'
    assert p.arrival_status is None and snapshot()==before


@pytest.mark.parametrize('value',['INVALID',1,{},[],False])
def test_invalid_values_do_not_write(api_state,value):
    client,people,_,_=api_state
    response=client.patch(f'/api/athletes/{people[0].id}',json={'arrivalStatus':value})
    assert response.status_code==400
    assert people[0].arrival_status is None and AuditEvent.query.count()==0


@pytest.mark.parametrize('role,allowed',[('incoming-viewer',False),('incoming-editor',True),('incoming-admin',True)])
def test_existing_role_and_event_guards_apply(api_state,role,allowed):
    client,people,_,_=api_state;app=client.application
    app.config['AUTH_DEV_GROUPS']=role
    response=client.patch(f'/api/athletes/{people[0].id}',json={'arrivalStatus':'CONFIRMED'})
    assert response.status_code==(200 if allowed else 403),response.json
    assert people[0].arrival_status==('CONFIRMED' if allowed else None)
    foreign=Event(name='Other event');db.session.add(foreign);db.session.flush()
    p=Athlete(event_id=foreign.id,firstname='Foreign',lastname='Person',nation_code='AUT')
    db.session.add(p);db.session.commit()
    app.config['OPERATIONAL_EVENT_ID']=people[0].event_id  # The legacy fixture pins newly created foreign rows.
    before=AuditEvent.query.count()
    response=client.patch(f'/api/athletes/{p.id}',headers={'X-Championship-Event-ID':str(people[0].event_id)},json={'arrivalStatus':'CONFIRMED'})
    assert response.status_code in {403,404,409}
    assert p.arrival_status is None and AuditEvent.query.count()==before


def test_real_reimport_keeps_live_decisions_and_room_partners(database,monkeypatch):
    _,event=database
    first=preview('AUS',event,monkeypatch);imports.confirm_fis_import(first['previewToken'])
    people=Athlete.query.order_by(Athlete.id).all()
    statuses=['UNDECIDED','EXPECTED','CONFIRMED','NOT_TRAVELLING']
    for index,p in enumerate(people):p.arrival_status=statuses[index%4]
    db.session.commit()
    expected={p.id:(p.arrival_status,p.shared_with_name,tuple(c.id for c in p.competitions)) for p in people}
    repeated=preview('AUS',event,monkeypatch)
    # An operative decision after preview creation must also survive confirmation.
    people[0].arrival_status='CONFIRMED';db.session.commit()
    expected[people[0].id]=('CONFIRMED',*expected[people[0].id][1:])
    imports.confirm_fis_import(repeated['previewToken']);db.session.expire_all()
    assert {p.id:(p.arrival_status,p.shared_with_name,tuple(c.id for c in p.competitions)) for p in Athlete.query.all()}==expected


def test_nullable_migration_preserves_legacy_rows_and_has_constraint():
    path=Path(__file__).parents[1]/'migrations/versions/20261118_01_arrival_status.py'
    spec=importlib.util.spec_from_file_location('arrival_migration',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    with create_engine('sqlite://').begin() as connection:
        connection.execute(text('CREATE TABLE athlete(id INTEGER PRIMARY KEY, function VARCHAR(50))'))
        connection.execute(text("INSERT INTO athlete VALUES (1,'Athlete'),(2,'NSA Coach')"))
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            assert connection.execute(text('SELECT arrival_status FROM athlete')).scalars().all()==[None,None]
            connection.execute(text("UPDATE athlete SET arrival_status='CONFIRMED' WHERE id=1"))
            with pytest.raises(IntegrityError):connection.execute(text("UPDATE athlete SET arrival_status='INVALID'"))
            module.downgrade()
            assert connection.execute(text('SELECT function FROM athlete ORDER BY id')).scalars().all()==['Athlete','NSA Coach']
