"""Run from the repository root with the backend virtual environment's Python."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))
from test_support import validate_test_url  # noqa: E402

POSTGRES_TESTS = [
    'test_booking_read_routes.py',
    'test_identity_audit_read_routes.py',
    'test_competition_routes.py',
    'test_admin_scenario_routes.py',
    'test_import_mock_file_routes.py',
    'test_analytics_routes.py',
    'test_room_type_routes.py',
    'test_athlete_routes.py',
    'test_event_routes.py',
    'test_hotel_routes.py',
    'test_api_characterization.py',
    'test_assignment_planning_projection.py', 'test_import_event_id_api.py',
    'test_import_operational_impacts.py', 'test_import_session_versioning.py',
    'test_person_identity.py', 'test_single_room_status.py', 'test_postgres_migrations.py',
]


def environment(postgres):
    local = ROOT / '.env.test'
    if not local.exists():
        shutil.copyfile(ROOT / '.env.test.example', local)
    values = {}
    for line in local.read_text(encoding='utf-8-sig').splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    url = validate_test_url(values.get('TEST_DATABASE_URL'), values.get('FLASK_ENV'))
    # Preserve PATH etc., but never inherit database credentials or libpq routing options.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('PG', 'AUTH_', 'BACKUP_', 'DATABASE_', 'TEST_DATABASE_'))}
    env.update(DATABASE_URL=url, FLASK_ENV='test', AUTH_DEV_USER='test-admin',
               AUTH_DEV_GROUPS='incoming-admin', AUTH_PROXY_SECRET='',
               BACKUP_SERVICE_URL='http://127.0.0.1:58080',
               BACKUP_DIR=str(ROOT / '.local-test' / 'backups'),
               LOG_LEVEL='WARNING', ASSIGNMENT_PERFORMANCE_ENABLED='false')
    if postgres:
        env['TEST_DATABASE_URL'] = url
    return env


def run(*args, env, cwd=BACKEND):
    return subprocess.call([sys.executable, *args], cwd=cwd, env=env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['fast', 'unittest', 'postgres', 'migrate', 'backup'])
    args = parser.parse_args()
    try:
        env = environment(args.mode in {'postgres', 'migrate'})
    except (ValueError, TypeError) as error:
        parser.error(str(error))
    if args.mode == 'fast':
        return run('-m', 'pytest', 'tests', '-q',
                   *[f'--ignore=tests/{name}' for name in POSTGRES_TESTS], env=env)
    if args.mode == 'unittest':
        return run('-m', 'unittest', 'discover', '-s', 'tests', env=env)
    if args.mode == 'backup':
        return run('-m', 'unittest', 'discover', '-s', 'tests', env=env, cwd=ROOT / 'backup')
    # Connection preflight: do not allow a missing local service to turn integration into skips.
    # Run preflight with the same scrubbed environment as the tests, so inherited
    # libpq variables cannot redirect even this first connection.
    preflight = run('-c', '''
import os
import psycopg
from sqlalchemy.engine import make_url
url = make_url(os.environ['TEST_DATABASE_URL'])
with psycopg.connect(host=url.host, port=url.port, dbname=url.database,
                     user=url.username, password=url.password, connect_timeout=5) as conn:
    name, user, version = conn.execute(
        "SELECT current_database(), current_user, current_setting('server_version_num')"
    ).fetchone()
    if (name, user) != ('incoming_test', 'incoming_test') or not 170000 <= int(version) < 180000:
        raise ValueError('Expected the dedicated incoming_test PostgreSQL 17 instance')
''', env=env)
    if preflight:
        return preflight
    # The migration test verifies TWO empty-schema upgrades. ORM tests run in a separate
    # process after that, so their create_all fixtures cannot stand in for migrations.
    result = run('-m', 'pytest', 'tests/test_postgres_migrations.py', '-q', env=env)
    if result or args.mode == 'migrate':
        return result
    return run('-m', 'pytest', *[f'tests/{name}' for name in POSTGRES_TESTS
                                if name != 'test_postgres_migrations.py'], '-q', env=env)


if __name__ == '__main__':
    raise SystemExit(main())
