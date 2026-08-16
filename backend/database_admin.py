"""Read-only backup metadata API and control-plane client for Operations."""

import json
from pathlib import Path
import re
import urllib.error
import urllib.request

from flask import Blueprint, current_app, jsonify, send_file
from sqlalchemy import text

from models import db


database_admin = Blueprint('database_admin', __name__)
BACKUP_PATTERN = re.compile(r'^[A-Za-z0-9_.-]+\.dump\.gz$')


def backup_directory():
    return Path(current_app.config['BACKUP_DIR'])


def backup_files():
    directory = backup_directory()
    if not directory.is_dir():
        return []
    return sorted((item for item in directory.iterdir()
                   if item.is_file() and BACKUP_PATTERN.fullmatch(item.name)),
                  key=lambda item: item.stat().st_mtime, reverse=True)


def last_status():
    try:
        return json.loads((backup_directory() / 'last-backup.json').read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


@database_admin.get('/api/admin/database/status')
def database_status():
    if current_app.config['DATABASE_BACKEND'] != 'postgresql':
        return jsonify({'error': 'POSTGRESQL_REQUIRED'}), 503
    version = db.session.execute(text('SHOW server_version')).scalar_one()
    size = db.session.execute(text('SELECT pg_database_size(current_database())')).scalar_one()
    alembic = db.session.execute(text('SELECT version_num FROM alembic_version')).scalar_one_or_none()
    status = last_status()
    files = backup_files()
    return jsonify({
        'postgresVersion': version,
        'databaseSize': size,
        'alembicVersion': alembic,
        'lastBackup': status,
        'backupSize': status.get('size') if status and status.get('status') == 'success' else None,
        'backupCount': len(files),
        'backupStatus': status.get('status') if status else 'never',
    })


@database_admin.post('/api/admin/database/backup')
def trigger_backup():
    request = urllib.request.Request(
        current_app.config['BACKUP_SERVICE_URL'].rstrip('/') + '/backup', method='POST', data=b'')
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read())
            return jsonify(payload), response.status
    except urllib.error.HTTPError as error:
        return jsonify({'error': 'BACKUP_REJECTED', 'message': error.read().decode()}), error.code
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        current_app.logger.exception('Backup service request failed')
        return jsonify({'error': 'BACKUP_SERVICE_UNAVAILABLE'}), 503


@database_admin.get('/api/admin/database/backups')
def list_backups():
    return jsonify([{'filename': item.name, 'size': item.stat().st_size,
                     'modified': item.stat().st_mtime} for item in backup_files()])


@database_admin.get('/api/admin/database/backups/<filename>')
def download_backup(filename):
    if not BACKUP_PATTERN.fullmatch(filename):
        return jsonify({'error': 'BACKUP_NOT_FOUND'}), 404
    path = backup_directory() / filename
    if not path.is_file():
        return jsonify({'error': 'BACKUP_NOT_FOUND'}), 404
    return send_file(path, as_attachment=True, download_name=filename,
                     mimetype='application/gzip', conditional=True)
