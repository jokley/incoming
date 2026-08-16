"""Read-only backup metadata API and control-plane client for Operations."""

import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, current_app, jsonify, request, send_file
from sqlalchemy import text

from models import db


database_admin = Blueprint('database_admin', __name__)
BACKUP_PATTERN = re.compile(r'^[A-Za-z0-9_.-]+\.dump\.gz$')
BACKUP_CATEGORIES = ('automatic', 'manual', 'pre-restore')


def backup_directory():
    return Path(current_app.config['BACKUP_DIR'])


def backup_files():
    directory = backup_directory()
    return [(category, item) for category in BACKUP_CATEGORIES
            for item in sorted((directory / category).glob('*.dump.gz'),
                               key=lambda path: path.stat().st_mtime, reverse=True)]


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


def delegate(path, body, headers=None, timeout=5):
    upstream = urllib.request.Request(
        current_app.config['BACKUP_SERVICE_URL'].rstrip('/') + path,
        method='POST', data=body, headers=headers or {})
    try:
        with urllib.request.urlopen(upstream, timeout=timeout) as response:
            return jsonify(json.loads(response.read())), response.status
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read())
        except json.JSONDecodeError:
            payload = {'error': 'BACKUP_SERVICE_ERROR', 'message': 'Die Aktion konnte nicht abgeschlossen werden.'}
        return jsonify(payload), error.code
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        current_app.logger.exception('Backup service request failed')
        return jsonify({'error': 'BACKUP_SERVICE_UNAVAILABLE',
                        'message': 'Der Backup-Service ist derzeit nicht erreichbar.'}), 503


@database_admin.post('/api/admin/database/import')
def import_backup():
    upload = request.files.get('file')
    if upload is None or not upload.filename:
        return jsonify({'error': 'INVALID_BACKUP', 'message': 'Bitte wählen Sie eine Backupdatei aus.'}), 400
    upload.stream.seek(0, 2)
    size = upload.stream.tell()
    upload.stream.seek(0)
    return delegate('/import', upload.stream,
                    {'Content-Length': str(size),
                     'X-Filename': urllib.parse.quote(upload.filename)}, timeout=60)


@database_admin.post('/api/admin/database/restore')
def restore_backup():
    payload = request.get_json(silent=True) or {}
    if not payload.get('filename') and not payload.get('token'):
        return jsonify({'error': 'BACKUP_REQUIRED', 'message': 'Bitte wählen Sie ein Backup aus.'}), 400
    # Always forward one canonical request shape, irrespective of whether the
    # selected backup was imported or already resides on the server.
    restore_request = {
        'filename': payload.get('filename'),
        'category': payload.get('category'),
        'token': payload.get('token'),
    }
    return delegate('/restore', json.dumps(restore_request).encode(),
                    {'Content-Type': 'application/json'}, timeout=3600)


@database_admin.get('/api/admin/database/backups')
def list_backups():
    return jsonify([{'category': category, 'filename': item.name,
                     'size': item.stat().st_size, 'modified': item.stat().st_mtime}
                    for category, item in backup_files()])


@database_admin.get('/api/admin/database/backups/<category>/<filename>')
def download_backup(category, filename):
    if category not in BACKUP_CATEGORIES or not BACKUP_PATTERN.fullmatch(filename):
        return jsonify({'error': 'BACKUP_NOT_FOUND'}), 404
    path = backup_directory() / category / filename
    if not path.is_file():
        return jsonify({'error': 'BACKUP_NOT_FOUND'}), 404
    return send_file(path, as_attachment=True, download_name=filename,
                     mimetype='application/octet-stream', conditional=True)
