"""Real PostgreSQL migration chain, independent of ORM create_all fixtures."""
import os
import json
import tempfile
from pathlib import Path
import subprocess
import sys
import unittest

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from test_support import postgres_test_url
from competitions import COMPETITIONS

BACKEND = Path(__file__).resolve().parents[1]


def complete_reviewed_test_ownership(engine, environment):
    """Explicit owner plan for this isolated WM fixture, never production inference."""
    from event_ownership import inventory
    with engine.connect() as conn:
        report = inventory(conn)
        target = conn.execute(text("SELECT id FROM championship_event WHERE name='WSC Montafon 2027'")).scalar_one()
    rows = {name: {str(row['id']): target for row in report['tables'][name]['rows']}
            for name in ('athlete', 'room_booking', 'import_session', 'import_run')}
    plan = dict(wsc_event_id=target, baseline_fingerprint=report['fingerprint'], rows=rows)
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'reviewed.json';path.write_text(json.dumps(plan))
        result = subprocess.run([sys.executable, '-m', 'alembic', '-c', 'alembic.ini',
            '-x', 'ownership_plan='+str(path), 'upgrade', 'head'],
            cwd=BACKEND, env=environment, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr


class PostgresMigrationTest(unittest.TestCase):
    def test_rendered_sql_matches_online_empty_and_legacy_catalogues(self):
        url = postgres_test_url()
        engine = create_engine(url)
        self.addCleanup(engine.dispose)
        environment = {**os.environ, 'DATABASE_URL': url}

        def upgrade(target, *, offline=False):
            result = subprocess.run(
                [sys.executable, '-m', 'alembic', '-c', 'alembic.ini', 'upgrade', target,
                 *(['--sql'] if offline else [])],
                cwd=BACKEND, env=environment, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            if offline:
                # Execute the actual generated script, including its transaction.
                connection = engine.raw_connection()
                try:
                    with connection.cursor() as cursor:
                        cursor.execute(result.stdout, prepare=False)
                    connection.commit()
                finally:
                    connection.close()

        def snapshot():
            queries = [
                'SELECT * FROM alembic_version',
                'SELECT id, name, year, active, fis_event_id, sector_code FROM championship_event ORDER BY id',
                'SELECT id, import_code, code, name, display_name, sport, gender, '
                'team_competition, quota_discipline, active FROM competition ORDER BY id',
                'SELECT * FROM event_competition ORDER BY id',
                'SELECT * FROM athlete_competition ORDER BY athlete_id, competition_id',
            ]
            with engine.connect() as conn:
                return [[tuple(row) for row in conn.execute(text(query))] for query in queries]

        for seeded in (False, True):
            results = []
            for offline in (False, True):
                with self.subTest(seeded=seeded, offline=offline):
                    with engine.begin() as conn:
                        self.assertEqual(tuple(conn.execute(text(
                            'SELECT current_database(), current_user'
                        )).one()), ('incoming_test', 'incoming_test'))
                        conn.execute(text('DROP SCHEMA public CASCADE'))
                        conn.execute(text('CREATE SCHEMA public'))
                    if seeded:
                        upgrade('20260924_01')
                        with engine.begin() as conn:
                            # Legacy/current collision, old-name match, current-code
                            # match, and a non-catalogue competition to deactivate.
                            conn.execute(text("""
                                INSERT INTO competition
                                    (id, import_code, code, name, display_name, sport, gender,
                                     team_competition, quota_discipline, active)
                                VALUES
                                    (1, 'WSC_MO_M_8212', '8212', 'Men''s Moguls', 'Old', 'Freestyle Ski', 'M', false, 'Old', false),
                                    (2, 'WSC_MO_M_8179', '8179', 'Shadow', 'Old', 'Freestyle Ski', 'M', false, 'Old', true),
                                    (3, 'custom-team', '8226', 'Mixed Aerials Team', 'Old', 'Freestyle Ski', 'A', true, 'Old', true),
                                    (4, 'WSC_BA_M_6182', '6182', 'Old Big Air', 'Old', 'Snowboard', 'M', false, 'Old', false),
                                    (5, 'obsolete', '9999', 'Obsolete', 'Old', 'Snowboard', 'M', false, 'Old', true)
                            """))
                            conn.execute(text("SELECT setval(pg_get_serial_sequence('competition', 'id'), 5)"))
                            conn.execute(text("""
                                INSERT INTO athlete (id, lastname, firstname, nation_code, single_room_status)
                                VALUES (1, 'Test', 'One', 'AUT', 'NONE'), (2, 'Test', 'Two', 'AUT', 'NONE')
                            """))
                            conn.execute(text("""
                                INSERT INTO athlete_competition (athlete_id, competition_id, created_at)
                                VALUES (1, 1, '2000-01-01'), (1, 2, '2000-01-02'), (2, 2, '2000-01-03')
                            """))
                        upgrade('20260924_01:20260924_02' if offline else '20260924_02', offline=offline)
                        initial_mapping = snapshot()
                        with engine.begin() as conn:
                            conn.execute(text('DELETE FROM event_competition WHERE competition_id = 4'))
                            conn.execute(text("INSERT INTO championship_event (name) VALUES ('Other Event')"))
                            conn.execute(text("""
                                INSERT INTO event_competition
                                    (event_id, competition_id, fis_codex, import_code, official_name, active)
                                SELECT 2, id, code, import_code, name, true FROM competition WHERE id IN (2, 5)
                            """))
                        upgrade('20260924_02:20261016_02' if offline else '20261016_02', offline=offline)
                    else:
                        upgrade('20261016_02', offline=offline)
                        initial_mapping = None
                    results.append((initial_mapping, snapshot()))
                    with engine.connect() as conn:
                        self.assertEqual(conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one(),
                                         '20261016_02')
                        self.assertEqual(conn.execute(text(
                            'SELECT count(*) FROM event_competition WHERE event_id = 1 AND active'
                        )).scalar_one(), 31)
                        actual = {(row.import_code, row.code): row.quota_discipline for row in conn.execute(text(
                            'SELECT import_code, code, quota_discipline FROM competition'))}
                        for competition in COMPETITIONS:
                            self.assertEqual(actual[(competition.import_code, competition.code)], competition.quota_discipline)
                        if seeded:
                            self.assertEqual(conn.execute(text(
                                "SELECT quota_discipline FROM competition WHERE id = 5"
                            )).scalar_one(), 'Old')
                            self.assertEqual(list(conn.execute(text(
                                'SELECT athlete_id, competition_id FROM athlete_competition ORDER BY athlete_id'
                            ))), [(1, 1), (2, 1)])
                            self.assertEqual(list(conn.execute(text(
                                'SELECT event_id, active FROM event_competition WHERE competition_id = 5 ORDER BY event_id'
                            ))), [(1, False), (2, True)])
            self.assertEqual(len(results), 2)
            self.assertEqual(results[0], results[1], 'Rendered SQL must preserve online catalogue IDs, data and memberships')

    def test_event_group_forward_migration_preserves_operational_and_historical_data(self):
        url = postgres_test_url()
        engine = create_engine(url)
        self.addCleanup(engine.dispose)
        environment = {**os.environ, 'DATABASE_URL': url}

        def upgrade(target):
            result = subprocess.run([sys.executable, '-m', 'alembic', '-c', 'alembic.ini', 'upgrade', target],
                cwd=BACKEND, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        with engine.begin() as conn:
            self.assertEqual(tuple(conn.execute(text('SELECT current_database(), current_user')).one()),
                             ('incoming_test', 'incoming_test'))
            conn.execute(text('DROP SCHEMA public CASCADE'))
            conn.execute(text('CREATE SCHEMA public'))
        upgrade('20261011_01')
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO competition (import_code, code, name, display_name, sport, gender, "
                "team_competition, quota_discipline, active) VALUES "
                "('CUSTOM', '9999', 'Custom', 'Custom display', 'Custom sport', 'A', true, 'CustomGroup', true)"))
            conn.execute(text("INSERT INTO athlete (id, lastname, firstname, nation_code, gender, function, single_room_status) "
                "VALUES (1, 'Person', 'Athlete', 'AUT', 'W', 'Athlete', 'NONE')"))
            conn.execute(text("INSERT INTO athlete_competition (athlete_id, competition_id, created_at) "
                "SELECT 1, id, '2000-01-01' FROM competition WHERE code = '8185'"))
            conn.execute(text("INSERT INTO hotel (id, name) VALUES (1, 'Preserved Hotel')"))
            conn.execute(text("INSERT INTO room_type (id, name, max_persons) VALUES (1, 'Double', 2)"))
            conn.execute(text("INSERT INTO room_booking (id, hotel_id, room_type_id, counts_as_single) VALUES (1, 1, 1, true)"))
            conn.execute(text("INSERT INTO room_booking_occupant (room_booking_id, athlete_id) VALUES (1, 1)"))
            conn.execute(text("INSERT INTO import_session (id, nation, status, created_at, updated_at) "
                "VALUES (1, 'AUT', 'IMPORTED', '2000-01-01', '2000-01-01')"))
            conn.execute(text("INSERT INTO import_session_version (id, session_id, version, uploaded_by, created_at, preview_json) "
                "VALUES (1, 1, 1, 'original', '2000-01-01', :preview)"),
                {'preview': '{"people":[{"matchKey":"original","quotaDisciplines":["Freestyle"]}]}'})
            conn.execute(text("INSERT INTO import_approval (id, session_id, version_id, nation, approval_type, description, "
                "decision, username, created_at, quota_details_json, approved_person_keys_json) VALUES "
                "(1, 1, 1, 'AUT', 'NATION_APPROVED', 'Historical decision', 'APPROVED', 'original', '2000-01-01', :details, :selected)"),
                {'details': '{"quotaMembershipVersion":1,"discipline":"Freestyle","gender":"W"}', 'selected': '["original"]'})

        def snapshot():
            with engine.connect() as conn:
                names = inspect(conn).get_table_names()
                return {name: sorted([tuple(row) for row in conn.execute(text('SELECT * FROM "' + name + '"'))], key=repr)
                        for name in names if name not in {'competition', 'alembic_version'}}

        before = snapshot()
        with engine.connect() as conn:
            competition_before = [dict(row._mapping) for row in conn.execute(text('SELECT * FROM competition ORDER BY id'))]
        upgrade('20261012_01')
        self.assertEqual(snapshot(), before)
        expected_groups = {(c.import_code, c.code): c.quota_discipline for c in COMPETITIONS}
        with engine.connect() as conn:
            competition_after = [dict(row._mapping) for row in conn.execute(text('SELECT * FROM competition ORDER BY id'))]
        for row in competition_before:
            row['quota_discipline'] = expected_groups.get((row['import_code'], row['code']), row['quota_discipline'])
        self.assertEqual(competition_after, competition_before)
        # Re-running head cannot change even the data snapshot.
        upgrade('20261012_01')
        self.assertEqual(snapshot(), before)

    def test_empty_database_reaches_head_twice(self):
        url = postgres_test_url()
        config = Config(str(BACKEND / 'alembic.ini'))
        scripts = ScriptDirectory.from_config(config)
        self.assertEqual(len(scripts.get_heads()), 1, 'Repository must have one migration head')
        engine = create_engine(url)
        self.addCleanup(engine.dispose)
        environment = {**os.environ, 'DATABASE_URL': url}
        for attempt in range(2):
            with self.subTest(attempt=attempt + 1):
                with engine.begin() as conn:
                    self.assertEqual(tuple(conn.execute(text(
                        'SELECT current_database(), current_user'
                    )).one()), ('incoming_test', 'incoming_test'))
                    version = int(conn.execute(text("SHOW server_version_num")).scalar_one())
                    self.assertGreaterEqual(version, 170000)
                    self.assertLess(version, 180000)
                    conn.execute(text('DROP SCHEMA public CASCADE'))
                    conn.execute(text('CREATE SCHEMA public'))
                    self.assertEqual(inspect(conn).get_table_names(), [])
                result = subprocess.run(
                    [sys.executable, '-m', 'alembic', '-c', 'alembic.ini', 'upgrade', '20261016_02'],
                    cwd=BACKEND, env=environment, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                complete_reviewed_test_ownership(engine, environment)
                with engine.connect() as conn:
                    self.assertEqual(conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one(),
                                     scripts.get_current_head())
                    tables = inspect(conn).get_table_names()
                    self.assertIn('world_champion', tables)
                    self.assertIn('single_room_exemption_source', {c['name'] for c in inspect(conn).get_columns('athlete')})
                    self.assertEqual(conn.execute(text('SELECT count(*) FROM world_champion')).scalar_one(), 35)
                    self.assertEqual(conn.execute(text("SELECT count(*) FROM world_champion WHERE title_type = 'INDIVIDUAL' AND entitlement_enabled")).scalar_one(), 26)
                    self.assertEqual(conn.execute(text("SELECT count(*) FROM world_champion WHERE title_type = 'TEAM' AND NOT entitlement_enabled")).scalar_one(), 9)
                    for table in ('athlete', 'room_booking', 'import_session', 'event_competition'):
                        self.assertIn(table, tables)
                    self.assertEqual(conn.execute(text('SELECT count(*) FROM competition WHERE active')).scalar_one(), 31)
                    self.assertEqual(conn.execute(text('SELECT count(*) FROM event_competition WHERE active')).scalar_one(), 31)
                    columns = {column['name'] for column in inspect(conn).get_columns('athlete')}
                    self.assertIn('single_room_quota_exempt_reason', columns)
                    # Database constraint enforcement, not SQLite emulation.
                    with self.assertRaises(IntegrityError) as rejected:
                        conn.execute(text("INSERT INTO athlete (event_id, lastname, firstname, nation_code, single_room_status) "
                                          "VALUES (1, 'Test', 'Person', 'AUT', 'INVALID')"))
                    self.assertEqual(getattr(rejected.exception.orig, 'sqlstate', None), '23514')

    def test_external_hotel_migration_preserves_standard_bookings(self):
        url = postgres_test_url()
        engine = create_engine(url)
        self.addCleanup(engine.dispose)
        environment = {**os.environ, 'DATABASE_URL': url}
        with engine.begin() as conn:
            conn.execute(text('DROP SCHEMA public CASCADE'))
            conn.execute(text('CREATE SCHEMA public'))
        def upgrade(target):
            result = subprocess.run([sys.executable, '-m', 'alembic', '-c', 'alembic.ini', 'upgrade', target],
                                    cwd=BACKEND, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        upgrade('20261014_01')
        with engine.begin() as conn:
            hotel = conn.execute(text("INSERT INTO hotel (name) VALUES ('Existing') RETURNING id")).scalar_one()
            room = conn.execute(text("INSERT INTO room_type (name, max_persons) VALUES ('Double', 2) RETURNING id")).scalar_one()
            booking = conn.execute(text("INSERT INTO room_booking (hotel_id, room_type_id, room_number, check_in_date, check_out_date, counts_as_single) VALUES (:h,:r,'01','2027-03-14','2027-03-27',false) RETURNING id"),{'h':hotel,'r':room}).scalar_one()
            before = tuple(conn.execute(text('SELECT * FROM room_booking WHERE id=:id'),{'id':booking}).one())
        upgrade('20261016_02')
        upgrade('20261016_02')
        with engine.begin() as conn:
            self.assertEqual(conn.execute(text('SELECT accommodation_type FROM hotel WHERE id=:id'),{'id':hotel}).scalar_one(),'STANDARD')
            self.assertEqual(tuple(conn.execute(text('SELECT * FROM room_booking WHERE id=:id'),{'id':booking}).one()),before)
            external = conn.execute(text("INSERT INTO hotel (name, accommodation_type) VALUES ('Kühtai','EXTERNAL') RETURNING id")).scalar_one()
            conn.execute(text("INSERT INTO room_booking (hotel_id, check_in_date, check_out_date) VALUES (:h,'2027-03-14','2027-03-20')"),{'h':external})
        self.assertTrue(next(c for c in inspect(engine).get_columns('room_booking') if c['name']=='room_type_id')['nullable'])
