"""Real PostgreSQL migration and PR1 ownership invariants; no deployment database."""
import json
import logging
import uuid
from datetime import date, datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from event_ownership import inventory, assignment_plan, compare, OwnershipError
from test_support import postgres_test_url

pytestmark = pytest.mark.explicit_event_ownership
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def legacy(monkeypatch, tmp_path):
    # Existing fail-closed test guard: only dedicated loopback PostgreSQL test service.
    logger_states = {name: logger.disabled for name, logger in logging.Logger.manager.loggerDict.items() if isinstance(logger, logging.Logger)}
    url = sa.engine.make_url(postgres_test_url())
    admin = sa.create_engine(url, isolation_level='AUTOCOMMIT')
    database = 'ownership_' + uuid.uuid4().hex
    with admin.connect() as c:
        c.exec_driver_sql('CREATE DATABASE "' + database + '"')
    test_url = url.set(database=database).render_as_string(hide_password=False)
    monkeypatch.setenv('DATABASE_URL', test_url)
    cfg = Config(str(ROOT / 'alembic.ini'))
    engine = sa.create_engine(test_url)
    try:
        command.upgrade(cfg, '20261016_02')
        metadata = sa.MetaData()
        metadata.reflect(engine)
        def put(c, table_name, **values):
            t = metadata.tables[table_name]
            # SQLAlchemy model defaults are Python-owned in the historical schema.
            for col in t.columns:
                if col.name not in values and not col.nullable and col.server_default is None and not col.primary_key:
                    if isinstance(col.type, sa.DateTime):values[col.name]=datetime(2026,10,1)
                    elif isinstance(col.type, sa.Boolean):values[col.name]=False
            return c.execute(t.insert().values(**values).returning(t.c.id)).scalar_one()
        with engine.begin() as c:
            target = c.scalar(sa.select(metadata.tables['championship_event'].c.id).where(metadata.tables['championship_event'].c.name=='WSC Montafon 2027'))
            if target is None:target=put(c,'championship_event',name='WSC Montafon 2027',year=2027,active=True)
            other=put(c,'championship_event',name='Other explicit test event',year=2028,active=True)
            hotel=put(c,'hotel',name='Protected Hotel',location='Protected address',email='protected@example.test',accommodation_type='STANDARD')
            rt=put(c,'room_type',name='DZ / DU',max_persons=2)
            for i in range(2):
                put(c,'hotel_room_inventory',hotel_id=hotel,room_type_id=rt,available_from=date(2027,3,1+i),available_until=date(2027,3,22),room_count=7+i,has_half_board=True,has_sr=bool(i),comment='Do not change')
            for i,name in enumerate(['Parallel','Aerials','Moguls','Big Air','Slopestyle','Snowboard Cross','Ski Cross']):
                planning=put(c,'event',discipline=name,start_date=date(2027,3,1+i),end_date=date(2027,3,20),person_demand=11+i,single_room_percentage=30+i)
                put(c,'event_room_demand',event_id=planning,room_type_id=rt,room_count=9+i)
        yield engine,cfg,target,other,tmp_path,put
    finally:
        engine.dispose()
        with admin.connect() as c:
            c.exec_driver_sql('DROP DATABASE "'+database+'" WITH (FORCE)')
        admin.dispose()
        # In-process Alembic fileConfig must not disable later Flask/caplog tests.
        for name, logger in logging.Logger.manager.loggerDict.items():
            if isinstance(logger, logging.Logger):logger.disabled=logger_states.get(name,False)


def reviewed(legacy, rows=None):
    engine,cfg,target,other,directory,_=legacy
    with engine.connect() as c:before=inventory(c)
    config={'wsc_event_id':target,'baseline_fingerprint':before['fingerprint'],'rows':rows or {}}
    filename=directory/'plan.json';filename.write_text(json.dumps(config))
    cfg.cmd_opts=type('Options',(),{'x':['ownership_plan='+str(filename)]})()
    return before,config


def test_lossless_stock_and_seven_planning_events(legacy):
    engine,cfg,target,other,_,_=legacy
    before,plan=reviewed(legacy)
    command.upgrade(cfg,'head')
    with engine.connect() as c:
        after=inventory(c);compare(before,after)
        for name,field in [('hotel_room_inventory','event_id'),('event','championship_event_id')]:
            assert all(r[field]==target for r in after['tables'][name]['rows'])
        assert after['tables']['event']['count']==7
        assert after['tables']['event_room_demand']['count']==7
        assert c.exec_driver_sql('select version_num from alembic_version').scalar()=='20261022_01'
        for table in ['athlete','room_booking','import_session','hotel_room_inventory']:
            assert not next(col for col in sa.inspect(c).get_columns(table) if col['name']=='event_id')['nullable']
    command.upgrade(cfg,'head')  # Alembic rerun is a no-op, not a second data assignment.


@pytest.mark.parametrize('failure',['missing_plan','wrong_target','stale','unknown_people'])
def test_preflight_failure_is_atomic(legacy,failure,monkeypatch):
    engine,cfg,target,other,folder,put=legacy
    if failure=='unknown_people':
        with engine.begin() as c:
            put(c,'athlete',firstname='Preserve',lastname='Unknown',nation_code='JPN',single_room_status='NONE',accommodation_requirement='REQUIRED',accommodation_requirement_source='DEFAULT',accommodation_rate_category='STANDARD',accommodation_rate_source='DEFAULT')
    before,plan=reviewed(legacy)
    if failure=='missing_plan':
        cfg.cmd_opts.x=[];monkeypatch.delenv('EVENT_OWNERSHIP_PLAN',raising=False)
    elif failure=='wrong_target':plan['wsc_event_id']=other
    elif failure=='stale':plan['baseline_fingerprint']='stale'
    (folder/'plan.json').write_text(json.dumps(plan))
    with pytest.raises(OwnershipError):command.upgrade(cfg,'head')
    with engine.connect() as c:
        assert 'event_id' not in {col['name'] for col in sa.inspect(c).get_columns('athlete')}
        assert c.exec_driver_sql('select version_num from alembic_version').scalar()=='20261016_02'
        compare(before,inventory(c))


def test_explicit_legacy_rows_and_approval_preserved(legacy):
    engine,cfg,target,other,folder,put=legacy
    with engine.begin() as c:
        session=put(c,'import_session',nation='JPN',status='IMPORTED')
        approval=put(c,'import_approval',session_id=session,nation='JPN',approval_type='NATION_APPROVED',description='Preserve evidence',decision='APPROVED',username='Original')
        person=put(c,'athlete',firstname='Preserve',lastname='Person',nation_code='JPN',single_room_status='APPROVED_EXTRA',single_room_decision_id=approval,accommodation_requirement='REQUIRED',accommodation_requirement_source='MANUAL',accommodation_rate_category='SPECIAL',accommodation_rate_source='MANUAL')
        hotel=c.exec_driver_sql('select id from hotel limit 1').scalar();rt=c.exec_driver_sql('select id from room_type limit 1').scalar()
        booking=put(c,'room_booking',hotel_id=hotel,room_type_id=rt,room_number='04',counts_as_single=False,check_in_date=date(2027,3,4),check_out_date=date(2027,3,9))
        put(c,'room_booking_occupant',room_booking_id=booking,athlete_id=person)
    before,_=reviewed(legacy,{'athlete':{str(person):target},'room_booking':{str(booking):target},'import_session':{str(session):target}})
    command.upgrade(cfg,'head')
    with engine.connect() as c:compare(before,inventory(c))


def test_mixed_legacy_bookings_rejected_before_ddl(legacy):
    engine,cfg,target,other,_,put=legacy
    with engine.begin() as c:
        person=put(c,'athlete',firstname='Mixed',lastname='Person',nation_code='JPN',single_room_status='NONE',accommodation_requirement='REQUIRED',accommodation_requirement_source='DEFAULT',accommodation_rate_category='STANDARD',accommodation_rate_source='DEFAULT')
        booking=put(c,'room_booking',hotel_id=c.exec_driver_sql('select id from hotel limit 1').scalar(),counts_as_single=False)
        put(c,'room_booking_occupant',room_booking_id=booking,athlete_id=person)
    reviewed(legacy,{'athlete':{str(person):target},'room_booking':{str(booking):other}})
    with pytest.raises(OwnershipError,match='Mixed ownership'):command.upgrade(cfg,'head')


def test_database_constraints_and_same_fis_across_events(legacy):
    engine,cfg,target,other,_,_=legacy;reviewed(legacy);command.upgrade(cfg,'head')
    m=sa.MetaData();m.reflect(engine)
    # Explicit raw SQL bypasses ORM compatibility: database constraints are real.
    with engine.begin() as c:
        sessions=m.tables['import_session'];people=m.tables['athlete']
        for event in [target,other]:
            c.execute(sessions.insert().values(event_id=event,nation='JPN',status='DRAFT',created_at=datetime.now(),updated_at=datetime.now()))
            c.execute(people.insert().values(event_id=event,firstname='Same',lastname='FIS',nation_code='JPN',fis_code='9300953',single_room_status='NONE',created_at=datetime.now(),updated_at=datetime.now()))
        with pytest.raises(sa.exc.IntegrityError), c.begin_nested():
            c.execute(sessions.insert().values(event_id=target,nation='JPN',status='DRAFT',created_at=datetime.now(),updated_at=datetime.now()))
        with pytest.raises(sa.exc.IntegrityError), c.begin_nested():
            c.execute(people.insert().values(firstname='No',lastname='Event',nation_code='JPN'))
        with pytest.raises(sa.exc.IntegrityError), c.begin_nested():
            c.execute(m.tables['room_booking'].insert().values(hotel_id=1,counts_as_single=False))


def test_failure_after_ddl_rolls_back_columns_data_and_revision(legacy,monkeypatch):
    engine,cfg,_,_,_,_=legacy;before,_=reviewed(legacy)
    def reject(*args):raise OwnershipError('Injected post-DDL validation failure')
    monkeypatch.setattr('event_ownership.compare',reject)
    with pytest.raises(OwnershipError,match='Injected'):command.upgrade(cfg,'head')
    with engine.connect() as c:
        assert 'event_id' not in {col['name'] for col in sa.inspect(c).get_columns('athlete')}
        assert c.exec_driver_sql('select version_num from alembic_version').scalar()=='20261016_02'
        compare(before,inventory(c))


@pytest.fixture
def orm():
    from flask import Flask
    from models import db, Event
    app=Flask(__name__);app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://',SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        db.session.add_all([Event(id=7,name='Explicit owner'),Event(id=8,name='Other owner')]);db.session.commit()
        yield app
        db.session.remove();db.drop_all()


def test_orm_requires_explicit_owner_without_runtime_configuration(orm):
    from models import db,Athlete
    db.session.add(Athlete(firstname='No',lastname='Owner',nation_code='JPN'))
    with pytest.raises(sa.exc.IntegrityError):db.session.flush()
    db.session.rollback()
    db.session.add(Athlete(event_id=7,firstname='Valid',lastname='Owner',nation_code='JPN'))
    db.session.commit()


def test_orm_rejects_mixed_event_occupants_and_owner_reassignment(orm):
    from models import db,Athlete,RoomBooking,RoomBookingOccupant,Hotel
    from event_ownership_runtime import OperationalEventError
    person=Athlete(event_id=8,firstname='Other',lastname='Person',nation_code='JPN')
    booking=RoomBooking(event_id=7,hotel=Hotel(name='Shared master hotel'))
    db.session.add_all([person,booking]);db.session.commit()
    db.session.add(RoomBookingOccupant(athlete=person,room_booking=booking))
    with pytest.raises(OperationalEventError,match='occupants'):db.session.flush()
    db.session.rollback()
    person.event_id=7
    with pytest.raises(OperationalEventError,match='reassigned'):db.session.flush()
    db.session.rollback()


def test_api_compatibility_only_uses_explicit_configured_event(orm):
    from models import db,Athlete,ImportSession
    from event_ownership_runtime import OperationalEventError
    orm.config['OPERATIONAL_EVENT_ID']=7
    with orm.test_request_context('/compatibility',method='POST'):
        person=Athlete(firstname='Existing',lastname='Workflow',nation_code='JPN');db.session.add(person);db.session.commit()
        assert person.event_id==7
        db.session.add(ImportSession(event_id=8,nation='JPN'))
        with pytest.raises(OperationalEventError,match='second operational'):db.session.flush()
        db.session.rollback()


@pytest.mark.parametrize('model_name', ['Athlete', 'ImportSession', 'ImportRun', 'RoomBooking'])
def test_import_orm_guard_normalizes_context_and_keeps_foreign_event_blocked(orm, model_name):
    from flask import g
    import models
    from event_ownership_runtime import OperationalEventError
    model = getattr(models, model_name)
    orm.config['OPERATIONAL_EVENT_ID'] = '7'
    kwargs = ({'firstname': 'Test', 'lastname': 'Owner', 'nation_code': 'LAT'} if model_name == 'Athlete'
              else {'nation': 'LAT'} if model_name == 'ImportSession'
              else {'import_type': 'test'} if model_name == 'ImportRun'
              else {'hotel': models.Hotel(name='Local test hotel')})
    with orm.test_request_context('/api/import/test', method='POST'):
        g.import_event_id = '7'
        item = model(event_id=7, **kwargs)
        models.db.session.add(item)
        models.db.session.commit()
        assert item.event_id == 7
        g.import_event_id = '8'
        if model_name == 'RoomBooking':
            item.counts_as_single = True
            item.event_id = 8
        else:
            item.event_id = 8
        with pytest.raises(OperationalEventError, match='second operational'):
            models.db.session.flush()
        models.db.session.rollback()


def test_read_only_cli_and_post_migration_verification(legacy):
    import os,subprocess,sys
    engine,cfg,target,other,folder,_=legacy
    report_path=folder/'before.json'
    command_line=[sys.executable,'-m','event_ownership','--output',str(report_path)]
    env={**os.environ,'PYTHONPATH':str(ROOT)}
    before_revision=None
    with engine.connect() as c:before_revision=c.exec_driver_sql('select version_num from alembic_version').scalar()
    result=subprocess.run(command_line,cwd=ROOT,env=env,text=True,capture_output=True)
    assert result.returncode==0,result.stderr
    assert report_path.stat().st_mode & 0o777==0o600
    before=json.loads(report_path.read_text())
    with engine.connect() as c:
        assert c.exec_driver_sql('select version_num from alembic_version').scalar()==before_revision
        assert inventory(c)['fingerprint']==before['fingerprint']
    plan={'wsc_event_id':target,'baseline_fingerprint':before['fingerprint'],'rows':{}}
    plan_path=folder/'plan.json';plan_path.write_text(json.dumps(plan))
    cfg.cmd_opts=type('Options',(),{'x':['ownership_plan='+str(plan_path)]})()
    command.upgrade(cfg,'head')
    result=subprocess.run([sys.executable,'-m','event_ownership','--output',str(folder/'after.json'),
        '--compare',str(report_path),'--plan',str(plan_path)],cwd=ROOT,env=env,text=True,capture_output=True)
    assert result.returncode==0,result.stderr


def test_planning_timeline_inventory_reads_and_legacy_creates_after_migration(legacy):
    from flask import Flask
    from models import db,HotelRoomInventory,AccommodationEvent
    from routes.events import events
    from routes.hotels import hotels
    from routes.analytics import analytics
    engine,cfg,target,_,_,_=legacy
    before,_=reviewed(legacy);command.upgrade(cfg,'head')
    app=Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=engine.url.render_as_string(hide_password=False),
                      SQLALCHEMY_TRACK_MODIFICATIONS=False,OPERATIONAL_EVENT_ID=target)
    db.init_app(app)
    for blueprint in [events,hotels,analytics]:app.register_blueprint(blueprint)
    with app.app_context():
        client=app.test_client()
        plans=client.get('/api/events').get_json()
        assert len(plans)==7
        source={row['discipline']:row for row in before['tables']['event']['rows']}
        for plan in plans:
            row=source[plan['discipline']]
            assert plan['id']==str(row['id'])
            assert plan['personDemand']==row['person_demand']
            assert plan['singleRoomPercentage']==row['single_room_percentage']
            assert plan['startDate']==row['start_date'].isoformat()
            assert plan['endDate']==row['end_date'].isoformat()
        timeline=client.get('/api/analytics/occupancy-timeline').get_json()
        assert len(timeline)==7
        for entry in timeline:
            original=source[entry['discipline']]
            demand=next(r for r in before['tables']['event_room_demand']['rows'] if r['event_id']==original['id'])
            assert entry['demands'][0]['roomCount']==demand['room_count']
            assert entry['demands'][0]['totalBeds']==demand['room_count']*2
        hotel=before['tables']['hotel']['rows'][0]['id'];room=before['tables']['room_type']['rows'][0]['id']
        read=client.get('/api/hotels').get_json()
        assert len(read[0]['roomInventories'])==2
        response=client.post(f'/api/hotels/{hotel}/inventory',json=dict(roomTypeId=str(room),availableFrom='2027-03-01',availableUntil='2027-03-21',roomCount=3))
        assert response.status_code==201,response.get_json()
        assert db.session.get(HotelRoomInventory,int(response.json['id'])).event_id==target
        response=client.post('/api/events',json=dict(discipline='Explicit compatibility test',startDate='2027-03-02',endDate='2027-03-10',personDemand=12,singleRoomPercentage=25))
        assert response.status_code==201,response.get_json()
        assert db.session.get(AccommodationEvent,int(response.json['id'])).championship_event_id==target
        db.session.remove()
