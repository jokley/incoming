#!/usr/bin/env python3
"""Start CodeServer LOCAL/DEV against shared TEST infrastructure; never migrate."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def validate_targets(env):
    """Fail closed before importing the application or making network requests."""
    database = urlsplit(env.get('DATABASE_URL', ''))
    if (database.scheme not in {'postgresql', 'postgresql+psycopg'}
            or database.hostname != 'incoming-test-postgres'
            or (database.port or 5432) != 5432
            or database.path != '/incoming_test'
            or database.username != env.get('POSTGRES_USER')
            or not database.username or database.query or database.fragment):
        raise ValueError('LOCAL requires incoming-test-postgres:5432 / incoming_test; URL overrides are forbidden')
    if (env.get('POSTGRES_HOST') != 'incoming-test-postgres'
            or env.get('POSTGRES_PORT', '5432') != '5432'
            or env.get('POSTGRES_DB') != 'incoming_test'):
        raise ValueError('POSTGRES_* must match the TEST DATABASE_URL')
    if env.get('BACKUP_SERVICE_URL', '').rstrip('/') != 'http://incoming-test-backup:8080':
        raise ValueError('LOCAL requires http://incoming-test-backup:8080')
    if env.get('BACKUP_DIR') != '/backups':
        raise ValueError('LOCAL requires the shared TEST volume at /backups')
    if any(key.startswith('PG') for key in env):
        raise ValueError('libpq environment overrides are forbidden in LOCAL')


def environment():
    # Only source the repository-owned TEST configuration, never incoming.env or .env.
    inherited = {key: value for key, value in os.environ.items()
                 if not key.startswith(('PG', 'POSTGRES_', 'DATABASE_', 'TEST_DATABASE_',
                                        'AUTH_', 'BACKUP_', 'FLASK_', 'VITE_', 'CORS_'))
                 and key not in {'SUPERADMIN_USERNAME', 'OPERATIONAL_EVENT_ID',
                                 'EVENT_OWNERSHIP_PLAN', 'DATABASE_MAINTENANCE_MODE'}}
    result = subprocess.run(
        ['bash', '--noprofile', '--norc', '-c',
         'set -ae; source "$1"; env -0', 'dev-start', str(ROOT / 'incoming.test.env')],
        env=inherited, capture_output=True, check=False)
    if result.returncode:
        # Never echo shell diagnostics: they may include expanded credentials.
        raise ValueError('Cannot load incoming.test.env; check the trusted shell configuration')
    env = dict(entry.split('=', 1) for entry in result.stdout.decode().split('\0') if '=' in entry)
    validate_targets(env)
    secret = env.get('AUTH_PROXY_SECRET', '')
    if not secret:
        raise ValueError('TEST AUTH_PROXY_SECRET is required for outgoing backup control')
    env.update(BACKUP_CONTROL_SECRET=secret, AUTH_PROXY_SECRET='',
               AUTH_DEV_USER='local-admin', AUTH_DEV_GROUPS='incoming-admin',
               SUPERADMIN_USERNAME='', DATABASE_MAINTENANCE_MODE='false',
               FLASK_ENV='development', FLASK_SKIP_DOTENV='1',
               VITE_BASE_PATH='/absproxy/5173/', VITE_API_URL='/absproxy/5173/api',
               VITE_API_PROXY_TARGET='http://127.0.0.1:5000')
    return env


def preflight(env):
    if not os.statvfs('/backups').f_flag & os.ST_RDONLY:
        raise ValueError('/backups must be the read-only TEST backup mount')
    # Keep the shared inode and fail closed if a restore is running.
    with open('/backups/.restore-control/access.lock', 'rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        status = json.loads(Path('/backups/.restore-control/status.json').read_text())
        if status.get('formatVersion') != 1 or status.get('state') not in {'IDLE', 'SUCCEEDED'}:
            raise ValueError('Restore coordination is not ready')
        import psycopg
        from sqlalchemy.engine import make_url
        url = make_url(env['DATABASE_URL'])
        with psycopg.connect(host=url.host, port=url.port or 5432, dbname=url.database,
                             user=url.username, password=url.password, connect_timeout=5) as conn:
            with conn.transaction():
                conn.execute('SET TRANSACTION READ ONLY')
                database, user, version = conn.execute(
                    "SELECT current_database(), current_user, current_setting('server_version')").fetchone()
                if database != 'incoming_test' or user != env['POSTGRES_USER']:
                    raise ValueError('Connected database does not match TEST')
                revision = conn.execute('SELECT version_num FROM alembic_version').fetchone()[0]
    with urllib.request.urlopen(env['BACKUP_SERVICE_URL'] + '/health', timeout=5) as response:
        if json.load(response).get('status') != 'healthy':
            raise ValueError('TEST backup service is not healthy')
    print('LOCAL database target: incoming-test-postgres:5432 / incoming_test')
    print(f'PostgreSQL {version}; Alembic {revision}')
    print('LOCAL backup target: incoming-test-backup:8080')
    print('/backups: read-only; shared restore lease available')
    print('Browser: https://code.jokley.at/absproxy/5173/', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('service', choices=['backend', 'frontend'])
    parser.add_argument('--check', action='store_true', help='Read-only preflight without starting a process')
    args = parser.parse_args()
    try:
        env = environment()
        os.environ.clear()
        os.environ.update(env)
        preflight(env)
    except Exception as error:
        # Connection exceptions can contain credentials. Report only their type.
        print(f'LOCAL startup refused ({type(error).__name__}); check TEST targets, dependencies and /backups.', file=sys.stderr)
        return 1
    if args.check:
        return 0
    if args.service == 'backend':
        os.chdir(ROOT / 'backend')
        command = [sys.executable, '-m', 'flask', '--app', 'app', 'run',
                   '--host', '127.0.0.1', '--port', '5000', '--reload']
    else:
        os.chdir(ROOT / 'frontend')
        # The frontend needs no backend credentials, even in its process environment.
        env = {key: value for key, value in env.items()
               if not key.startswith(('POSTGRES_', 'DATABASE_', 'AUTH_', 'BACKUP_'))}
        # The reachable browser URL is printed by preflight; keep Vite warnings/errors.
        command = ['pnpm', 'dev', '--host', '127.0.0.1', '--port', '5173', '--strictPort',
                   '--logLevel', 'warn', '--clearScreen', 'false']
    os.execvpe(command[0], command, env)


if __name__ == '__main__':
    raise SystemExit(main())
