"""Read-only backup metadata API and control-plane client for Operations."""

import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, current_app, jsonify, request, send_file
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from models import db


database_admin = Blueprint('database_admin', __name__)
BACKUP_PATTERN = re.compile(r'^[A-Za-z0-9_.-]+\.dump\.gz$')
BACKUP_CATEGORIES = ('automatic', 'manual', 'pre-restore')


# Exact allowlist: a GET download is a global data export, never metadata.
def is_database_metadata_request(path, method):
    return method in {'GET', 'HEAD'} and path in {
        '/api/admin/database/status', '/api/admin/database/backups'}


DATABASE_PERMISSIONS = {
    'database_admin.database_status': 'database.read',
    'database_admin.list_backups': 'database.read',
    'database_admin.trigger_backup': 'database.backup',
    'database_admin.import_backup': 'database.backup',
    'database_admin.download_backup': 'database.export',
    'database_admin.restore_backup': 'database.restore',
}


def database_permission():
    from flask import abort
    permission = DATABASE_PERMISSIONS.get(request.endpoint)
    if permission is None: abort(403)
    return permission


def require_maintenance(confirmation):
    from flask import abort
    if not current_app.config.get('DATABASE_MAINTENANCE_MODE'):
        abort(409, description='Restore/Reset nur im ausdrücklich freigegebenen Wartungsmodus.')
    if (request.get_json(silent=True) or {}).get('confirmation') != confirmation:
        abort(400, description='Zusätzliche ausdrückliche Bestätigung erforderlich.')


def database_capabilities():
    from auth import current_user
    user = current_user()
    has = lambda permission: bool(user and user.has_permission(permission))
    maintenance = current_app.config.get('DATABASE_MAINTENANCE_MODE', False)
    return dict(download=has('database.export'), create=has('database.backup'),
                upload=has('database.backup'), restore=has('database.restore') and maintenance,
                reset=has('database.reset') and maintenance)


@database_admin.before_request
def audit_database_attempt():
    from auth import current_user
    from flask import g
    from models import AuditEvent
    import uuid
    user = current_user()
    if not user or request.endpoint in {'database_admin.database_status','database_admin.list_backups'}:
        return
    # App authentication/functional authorization ran first. This records an
    # explicitly requested sensitive operation, not a business-data GET update.
    if not user.has_permission(database_permission()): return
    if request.endpoint == 'database_admin.restore_backup':
        require_maintenance('RESTORE DATABASE')
    db.session.add(AuditEvent(username=user.username,action='request',entity_type='global-database',
        entity_id=request.endpoint,request_id=str(getattr(g,'request_id',uuid.uuid4()))[:36],
        method=request.method,path=request.url_rule.rule,category='Administration',
        activity='Globale Datenbankoperation angefordert',changes_json=json.dumps({'operation':request.endpoint}),
        entity_refs_json='{}'))
    db.session.commit()


@database_admin.after_request
def audit_database_operation(response):
    # Persistent service logs also survive a database restore. Never log tokens,
    # uploaded contents, filenames, connection parameters or request bodies.
    from auth import current_user
    from flask import g
    user = current_user()
    current_app.logger.info('database_operation actor=%s operation=%s status=%s request_id=%s',
        user.username if user else 'unauthenticated', request.endpoint, response.status_code,
        getattr(g, 'request_id', '-'))
    g.atomic_import_audit = True
    return response


def backup_directory():
    return Path(current_app.config['BACKUP_DIR'])


def backup_files():
    directory = backup_directory()
    return [(category, item) for category in BACKUP_CATEGORIES
            for item in sorted((directory / category).glob('*.dump.gz'),
                               key=lambda path: path.stat().st_mtime, reverse=True)]


def last_status():
    try:
        payload = json.loads((backup_directory() / 'last-backup.json').read_text(encoding='utf-8'))
        # Do not disclose raw pg_dump errors, connection details or database names.
        if not isinstance(payload, dict):
            return None
        return {key: payload[key] for key in ('status', 'created', 'size', 'durationSeconds', 'category') if key in payload}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


@database_admin.get('/api/admin/database/status')
def database_status():
    status = last_status()
    files = backup_files()
    try:
        version = db.session.execute(text('SHOW server_version')).scalar_one()
        size = db.session.execute(text('SELECT pg_database_size(current_database())')).scalar_one()
        alembic = db.session.execute(text('SELECT version_num FROM alembic_version')).scalar_one_or_none()
    except SQLAlchemyError:
        # A terminated connection or unavailable schema must not turn this
        # diagnostic endpoint into an unhandled 500 response.
        db.session.rollback()
        current_app.logger.exception('Database status check failed')
        return jsonify({
            'databaseStatus': 'unavailable',
            'capabilities': database_capabilities(),
            'maintenanceMode': bool(current_app.config.get('DATABASE_MAINTENANCE_MODE')),
            'postgresVersion': None,
            'databaseSize': None,
            'alembicVersion': None,
            'lastBackup': status,
            'backupSize': status.get('size') if status and status.get('status') == 'success' else None,
            'backupCount': len(files),
            'backupStatus': status.get('status') if status else 'never',
        }), 503
    return jsonify({
        'databaseStatus': 'available',
        'capabilities': database_capabilities(),
        'maintenanceMode': bool(current_app.config.get('DATABASE_MAINTENANCE_MODE')),
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
    require_maintenance('RESTORE DATABASE')
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
