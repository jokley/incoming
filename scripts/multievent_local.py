"""Create/run the disposable PR8 workspace, never the existing development DB.

Uses the separate IPv6-loopback PostgreSQL 17 cluster. `init` refuses an existing
database; there is deliberately no reset command. Run frontend separately with
VITE_API_PROXY_TARGET=http://127.0.0.1:5001 on port 5174.
"""
import argparse
from datetime import date, datetime
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DATABASE = 'incoming_multievent_test'


def environment():
    # No inherited credentials, routing, proxy, or operational pin.
    env = {k:v for k,v in os.environ.items() if not k.upper().startswith(
        ('PG','POSTGRES_','DATABASE_','TEST_DATABASE_','AUTH_','BACKUP_','FLASK_','PYTHON','CORS_'))
        and k.upper() not in {'OPERATIONAL_EVENT_ID','EVENT_OWNERSHIP_PLAN','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'}}
    env.update(DATABASE_URL=f'postgresql+psycopg://incoming_test:incoming_test@[::1]:55432/{DATABASE}',
        FLASK_ENV='development', AUTH_DEV_USER='test-admin', AUTH_DEV_GROUPS='incoming-admin',
        AUTH_PROXY_SECRET='', BACKUP_ENABLED='false', BACKUP_SERVICE_URL='http://127.0.0.1:58081',
        PYTHONUTF8='1', PYTHONUNBUFFERED='1', NO_PROXY='localhost,127.0.0.1,::1')
    return env


def connection(database):
    import psycopg
    return psycopg.connect(host='::1', port=55432, dbname=database,
        user='incoming_test', password='incoming_test', connect_timeout=5, autocommit=True)


def verify_cluster(conn):
    row=conn.execute("SELECT current_user, current_setting('server_version_num'), current_setting('data_directory')").fetchone()
    expected=(ROOT/'.local-dev/pr8-tests/pgdata').resolve()
    if row[0]!='incoming_test' or not 170000<=int(row[1])<180000 or Path(row[2]).resolve()!=expected:
        raise RuntimeError('Require the dedicated PR8 test cluster, never the development cluster')


def seed():
    from models import (db, Event, EventAccess, Hotel, RoomType, Competition, EventCompetition,
        Athlete, HotelRoomInventory, RoomBooking, RoomBookingOccupant, AccommodationEvent,
        EventRoomDemand, ImportSession, ImportSessionVersion, AuditEvent)
    from accommodation_scope import event_audit_refs
    from quota_rules import standard_rules
    a=Event.query.filter_by(name='WSC Montafon 2027').one()
    b=Event(name='Synthetisches Incoming Testevent 2028',year=2028,active=True)
    db.session.add(b);db.session.flush()
    hotel=Hotel(name='PR8 gemeinsames Testhotel',location='Lokale Testumgebung')
    room=RoomType(name='PR8 Test-DZ',max_persons=2)
    db.session.add_all([hotel,room]);db.session.flush()
    competition=Competition.query.filter_by(gender='M',quota_discipline='Snowboard Cross').first()
    if competition is None: raise RuntimeError('Expected migrated competition catalogue')
    for owner,marker,year in [(a,'A',2027),(b,'B',2028)]:
        rules=standard_rules();rules['officials']['allowance']=2 if marker=='A' else 5
        owner.quota_rules_json=json.dumps(rules);owner.quota_rules_fixed_at=datetime(2026,10,24)
        owner.quota_rules_fixed_by='explicit-pr8-fixture';owner.quota_rules_revision=1;owner.is_world_championship=True
        if not EventCompetition.query.filter_by(event_id=owner.id,competition_id=competition.id).first():
            db.session.add(EventCompetition(event_id=owner.id,competition_id=competition.id,
                import_code=competition.import_code,fis_codex=competition.code,official_name=competition.name))
        for username in ['test-admin','both']+(['only-a','reader'] if marker=='A' else []):
            db.session.add(EventAccess(username=username,event_id=owner.id,can_write=username!='reader'))
        start,end=date(year,3,3),date(year,3,9)
        person=Athlete(event_id=owner.id,firstname=f'PR8-{marker}',lastname='Same Identity',fis_code='9300953',
            competitor_id='00042',nation_code='JPN',gender='M',function='Athlete',room_type='Double shared',
            arrival_date=start,departure_date=end,competitions=[competition])
        db.session.add(person);db.session.flush()
        db.session.add(HotelRoomInventory(event_id=owner.id,hotel=hotel,room_type=room,room_count=5,
            available_from=start,available_until=end,comment=f'Kontingent {marker}'))
        booking=RoomBooking(event_id=owner.id,hotel=hotel,room_type=room,room_number=f'{marker}-01',
            counts_as_single=False,check_in_date=start,check_out_date=end)
        booking.occupants=[RoomBookingOccupant(athlete=person)];db.session.add(booking)
        planning=AccommodationEvent(championship_event_id=owner.id,discipline=f'Planung {marker}',
            start_date=start,end_date=end,person_demand=2,single_room_percentage=0)
        db.session.add(planning);db.session.flush()
        db.session.add(EventRoomDemand(event_id=planning.id,room_type_id=room.id,room_count=1))
        session=ImportSession(event_id=owner.id,nation='JPN',status='DRAFT');db.session.add(session);db.session.flush()
        version=ImportSessionVersion(session_id=session.id,version=1,uploaded_by='explicit-pr8-fixture',
            preview_token=f'pr8-{marker}',preview_json=json.dumps({'eventId':str(owner.id),'people':[], 'rooms':[], 'changes':[], 'quotaChecks':[], 'athleteQuotaChecks':[], 'errors':[], 'warnings':[]}))
        db.session.add(version);db.session.flush();session.current_version_id=version.id
        db.session.add(AuditEvent(username='explicit-pr8-fixture',action='create',entity_type='athletes',
            entity_id=str(person.id),request_id=f'pr8-{marker}',method='FIXTURE',path='/local-fixture',
            activity=f'Testperson {marker} angelegt',category='Stammdaten',entity_label=f'PR8-{marker}',
            details_json=json.dumps([f'Event: {owner.name}']),entity_refs_json=event_audit_refs({'personId':str(person.id)},owner.id)))
    db.session.commit()
    print(json.dumps({'eventA':a.id,'eventB':b.id,'database':DATABASE}))


def initialize_schema(env):
    from sqlalchemy import create_engine, inspect
    engine=create_engine(env['DATABASE_URL'])
    with engine.connect() as conn:
        if set(inspect(conn).get_table_names()) - {'alembic_version'}:
            raise RuntimeError('Refuse schema initialization on a populated database')
    subprocess.run([sys.executable,'-m','alembic','upgrade','20261016_02'],cwd=ROOT/'backend',env=env,check=True)
    sys.path.insert(0,str(ROOT/'backend'))
    from event_ownership import inventory
    from sqlalchemy import text
    with engine.connect() as conn:
        report=inventory(conn)
        owner=conn.execute(text("SELECT id FROM championship_event WHERE name='WSC Montafon 2027'")).scalar_one()
    # Explicit plan for this freshly created fixture only; no development inventory.
    plan={'wsc_event_id':owner,'baseline_fingerprint':report['fingerprint'],'rows':{}}
    path=ROOT/'.local-dev/pr8-tests/browser-ownership-plan.json';path.write_text(json.dumps(plan))
    subprocess.run([sys.executable,'-m','alembic','-x',f'ownership_plan={path}','upgrade','head'],cwd=ROOT/'backend',env=env,check=True)
    engine.dispose()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['init','serve'])
    args=parser.parse_args();env=environment();os.environ.clear();os.environ.update(env)
    if args.command=='init':
        with connection('incoming_test') as conn:
            verify_cluster(conn)
            if conn.execute('SELECT 1 FROM pg_database WHERE datname=%s',(DATABASE,)).fetchone():
                raise RuntimeError('Test database already exists; refusing reset or reseed')
            conn.execute('CREATE DATABASE incoming_multievent_test')
        initialize_schema(env)
    with connection(DATABASE) as conn:verify_cluster(conn)
    sys.path.insert(0,str(ROOT/'backend'))
    from app import app
    if args.command=='init':
        with app.app_context():seed()
    else:
        print(f'LOCAL PR8 ONLY: [::1]:55432/{DATABASE}; backend 127.0.0.1:5001')
        app.run(host='127.0.0.1',port=5001,debug=False,use_reloader=False,load_dotenv=False)


if __name__=='__main__':main()
