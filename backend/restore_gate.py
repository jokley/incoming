"""Request integration for the backup service's durable coordination protocol."""
from flask import current_app, g, jsonify, request
from models import db
from restore_coordination import request_lease, read_status


def acquire_request_lease():
    if not current_app.config.get('RESTORE_COORDINATION_REQUIRED', False):
        return None
    # These exact control-plane requests never use the restored database.
    if (request.endpoint == 'database_admin.restore_status'
            or getattr(g, 'api_path', None) == '/api/auth/me' and request.method in {'GET', 'HEAD'}):
        try:
            status=read_status(current_app.config.get('BACKUP_DIR','/backups'))
            if status['state'] in {'IDLE','SUCCEEDED'}:g.database_generation=status.get('operationId','initial')
        except (OSError,ValueError):pass
        return None
    if getattr(g, '_restore_lease', None) is not None:
        return None
    try:
        handle, status = request_lease(current_app.config.get('BACKUP_DIR', '/backups'))
        g._restore_lease = handle
        g.database_generation=status.get('operationId','initial')
        if request.method not in {'GET','HEAD','OPTIONS'} and (request.headers.get('X-Database-Generation') is not None or status['state']=='SUCCEEDED') and request.headers.get('X-Database-Generation')!=g.database_generation:
            g.atomic_import_audit=True
            return jsonify(error='DATABASE_GENERATION_CHANGED',message='Datenbank wurde wiederhergestellt. Anwendung neu laden.'),409
        operation = status.get('operationId') if status['state'] == 'SUCCEEDED' else None
        if operation and current_app.extensions.get('last_restore_operation') != operation:
            db.session.remove()
            db.engine.dispose()
            current_app.extensions['last_restore_operation'] = operation
    except (OSError, ValueError):
        g.atomic_import_audit = True
        return jsonify(error='RESTORE_MAINTENANCE', message='Wiederherstellung oder Betriebsprüfung läuft. Änderungen sind gesperrt.'), 503
    return None
