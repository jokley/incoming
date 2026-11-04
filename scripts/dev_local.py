"""Start the existing backend or backup service with a pinned local target."""
import argparse
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from test_support import LOCAL_TEST_URL, validate_test_url
from sqlalchemy.engine import make_url

def local_environment(values, inherited):
    # Reuse the strict PR3B target allowlist, while running the app in development.
    requested = make_url(values.get('DATABASE_URL', LOCAL_TEST_URL))
    database = requested.database
    isolated = bool(re.fullmatch(r'incoming_restorecheck_[0-9]{8}_[0-9]{6}', database or ''))
    if database != 'incoming_test' and not isolated:
        raise ValueError('Require incoming_test or a separate incoming_restorecheck_YYYYMMDD_HHMMSS database')
    url = validate_test_url(requested.set(database='incoming_test').render_as_string(hide_password=False), 'test')
    url = make_url(url).set(database=database).render_as_string(hide_password=False)
    # Both processes must use the same IPv4 listener even for a loopback alias.
    url = make_url(url).set(host='127.0.0.1').render_as_string(hide_password=False)
    unknown = set(values) - {'DATABASE_URL', 'POSTGRES_BIN', 'VITE_API_URL',
                            'OPERATIONAL_EVENT_ID', 'EVENT_OWNERSHIP_PLAN', 'BACKUP_PORT'}
    if unknown:
        raise ValueError('Unsupported .env.local keys: ' + ', '.join(sorted(unknown)))
    if values.get('VITE_API_URL', '/api') != '/api':
        raise ValueError('Local frontend must use VITE_API_URL=/api')
    port = values.get('BACKUP_PORT', '58080')
    if port not in {'58080', '8080'}:
        raise ValueError('Local BACKUP_PORT must be 58080 or 8080')
    directory = (ROOT / '.local-dev' / 'restores' / database / 'backups'
                 if isolated else ROOT / '.local-dev' / 'backups').resolve()
    if not directory.is_relative_to(ROOT):
        raise ValueError('Local backup directory must stay inside this repository')
    env = {key: value for key, value in inherited.items()
           if not key.upper().startswith(('PG', 'POSTGRES_', 'DATABASE_', 'TEST_DATABASE_',
                                           'AUTH_', 'BACKUP_', 'FLASK_', 'PYTHON', 'CORS_'))
           and key.upper() not in {'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
                                   'EVENT_OWNERSHIP_PLAN', 'OPERATIONAL_EVENT_ID'}}
    env.update(DATABASE_URL=url, POSTGRES_HOST='127.0.0.1', POSTGRES_PORT='55432',
               POSTGRES_DB=database, POSTGRES_USER='incoming_test',
               POSTGRES_PASSWORD='incoming_test', BACKUP_DIR=str(directory),
               BACKUP_SERVICE_URL=f'http://127.0.0.1:{port}', BACKUP_PORT=port, BACKUP_ENABLED='false',
               FLASK_ENV='development', AUTH_DEV_USER='test-admin',
               AUTH_DEV_GROUPS='incoming-admin', AUTH_PROXY_SECRET='',
               NO_PROXY='127.0.0.1,localhost,::1', CORS_ORIGINS='',
               PYTHONUNBUFFERED='1')
    if values.get('OPERATIONAL_EVENT_ID'):
        identity = values['OPERATIONAL_EVENT_ID']
        if not identity.isdecimal() or int(identity) <= 0:
            raise ValueError('OPERATIONAL_EVENT_ID must be an explicit positive integer')
        env['OPERATIONAL_EVENT_ID'] = identity
    if values.get('EVENT_OWNERSHIP_PLAN'):
        plan = Path(values['EVENT_OWNERSHIP_PLAN'])
        if not plan.is_absolute() or not plan.is_file():
            raise ValueError('EVENT_OWNERSHIP_PLAN must name an existing absolute plan file')
        env['EVENT_OWNERSHIP_PLAN'] = str(plan)
    return env


def configure(config_file=None):
    local = Path(config_file).resolve() if config_file else ROOT / '.env.local'
    if not local.exists():
        if config_file:
            raise ValueError('Explicit local environment file does not exist')
        shutil.copyfile(ROOT / '.env.local.example', local)
    values = {}
    for line in local.read_text(encoding='utf-8-sig').splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, separator, value = line.partition('=')
            if not separator or key.strip() in values:
                raise ValueError('Use unique, plain KEY=value entries in .env.local')
            values[key.strip()] = value.strip()
    env = local_environment(values, os.environ)
    pg_bin = values.get('POSTGRES_BIN')
    if not pg_bin and os.name == 'nt':
        portable = Path(os.environ.get('TEMP', '')) / 'incoming-pr3b-postgresql17/pgsql/bin'
        if portable.is_dir():
            pg_bin = str(portable)
    if pg_bin:
        if not Path(pg_bin).is_absolute() or not Path(pg_bin).is_dir():
            raise ValueError('POSTGRES_BIN must be an existing absolute PostgreSQL 17 bin directory')
        env['PATH'] = pg_bin + os.pathsep + env.get('PATH', '')
    os.environ.clear()
    os.environ.update(env)
    # All later libpq and subprocess calls inherit only the guarded environment.
    for name in ('psql', 'pg_dump', 'pg_restore'):
        executable = shutil.which(name)
        if not executable:
            raise ValueError(f'{name} missing; set POSTGRES_BIN in .env.local')
        version = subprocess.check_output([executable, '--version'], text=True)
        if ' (PostgreSQL) 17.' not in version:
            raise ValueError(f'{name} must be PostgreSQL 17')
    import psycopg
    database = env['POSTGRES_DB']
    with psycopg.connect(host='127.0.0.1', port=55432, dbname=database,
                         user='incoming_test', password='incoming_test', connect_timeout=5) as conn:
        row = conn.execute("SELECT current_database(), current_user, "
                           "current_setting('server_version_num'), "
                           "rolsuper OR rolcreatedb FROM pg_roles WHERE rolname=current_user").fetchone()
        if not row or row[:2] != (database, 'incoming_test') or not 170000 <= int(row[2]) < 180000 or not row[3]:
            raise ValueError('Require the local incoming_test PostgreSQL 17 role with CREATEDB')
        if env.get('OPERATIONAL_EVENT_ID'):
            event = conn.execute('SELECT name FROM championship_event WHERE id = %s',
                                 (int(env['OPERATIONAL_EVENT_ID']),)).fetchone()
            if event != ('WSC Montafon 2027',):
                raise ValueError('OPERATIONAL_EVENT_ID does not identify the reviewed WSC Montafon 2027')
    Path(env['BACKUP_DIR']).mkdir(parents=True, exist_ok=True)
    print(f'LOCAL ONLY: {database} / incoming_test at 127.0.0.1:55432', flush=True)
    print(f'Backup service: {env["BACKUP_SERVICE_URL"]}; files: {env["BACKUP_DIR"]}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('service', choices=('backup', 'backend', 'check'))
    parser.add_argument('--env-file', help='Explicit local-only configuration; leaves .env.local unchanged')
    args = parser.parse_args()
    try:
        configure(args.env_file)
    except ValueError as error:
        parser.exit(1, f'Local startup refused: {error}\n')
    except Exception as error:
        # Do not echo connection strings or inherited credentials on failure.
        parser.exit(1, f'Local startup refused ({type(error).__name__}). Check .env.local, '
                    'PostgreSQL 17 tools and the loopback incoming_test database.\n')
    if args.service == 'backup':
        sys.path.insert(0, str(ROOT / 'backup'))
        from backup_service import serve
        serve(host='127.0.0.1', port=int(os.environ['BACKUP_PORT']))
    elif args.service == 'backend':
        from app import app
        print(f'Flask OPERATIONAL_EVENT_ID={app.config.get("OPERATIONAL_EVENT_ID")!r}', flush=True)
        app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False,
                load_dotenv=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
