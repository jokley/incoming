"""Independent, durable restore jobs. One shared-volume coordinator, no DB state."""
import fcntl
import hashlib
import os
from pathlib import Path
import threading
import time
import uuid
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from restore_coordination import directory, read_status, write_status, NORMAL, schema_contract


def start(payload, actor, service):
    if payload.get('schemaContract') != schema_contract():
        raise ValueError('Backend und Backupimage sind nicht schemakompatibel. Release prüfen.')
    settings = service.config()
    target={'host':settings.get('host','postgres').lower(),'port':int(settings.get('port',5432)),'database':settings['database']}
    if payload.get('databaseTarget')!=target:
        raise ValueError('Backend und Backup verweisen nicht auf dasselbe explizite Datenbankziel.')
    root = settings['directory']
    lock = (directory(root) / 'operation.lock').open('rb')
    status = None
    archive = None
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if read_status(root)['state'] not in NORMAL:
            raise BlockingIOError('Restore or recovery already active')
        source, imported = service.resolve_restore_source(payload, settings)
        if not source.is_file() or source.is_symlink(): raise FileNotFoundError
        # Validate before accepting the job; a full staging restore checks content.
        service.validate_dump(source, settings)
        archive = source.open('rb')
        operation = uuid.uuid4().hex
        status = write_status(root, dict(operationId=operation, actor=actor, state='QUEUED',
                            filename=source.name if not payload.get('token') else 'Hochgeladenes Backup',
                            category=payload.get('category') if not payload.get('token') else 'upload',
                            size=source.stat().st_size, modified=source.stat().st_mtime))
        # A stable private copy avoids pruning a selected pre-restore backup while
        # creating the new safety backup. Never persist upload tokens in job state.
        selected = directory(root) / f'{operation}.dump'
        worker = threading.Thread(target=run, args=(status, selected, lock, service, archive, source if imported else None), daemon=True)
        worker.start()
        return status
    except BaseException:
        try:
            if status is not None:
                write_status(root,{**status,'state':'RECOVERY_REQUIRED','message':'Restoreauftrag konnte nicht gestartet werden. Betriebsprüfung erforderlich.'})
        finally:
            if archive is not None: archive.close()
            lock.close()
        # If acceptance had already persisted QUEUED, it remains fail-closed.
        raise


def verify_schema(service, settings, database):
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    backend = Path(service.__file__).resolve().parents[1] / 'backend'
    config = Config(str(backend / 'alembic.ini'))
    config.set_main_option('script_location', str(backend / 'migrations'))
    heads = set(ScriptDirectory.from_config(config).get_heads())
    actual = set(service._postgres_command(settings, 'SELECT version_num FROM alembic_version', database).stdout.split())
    if actual != heads: raise RuntimeError('SCHEMA_INCOMPATIBLE')
    # Validate every runtime metadata column, not just a claimed Alembic marker.
    from models import db
    expected={(table.name,column.name) for table in db.metadata.sorted_tables for column in table.columns}
    result=service._postgres_command(settings,
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",database)
    actual_columns={tuple(line.split('|')) for line in result.stdout.splitlines()}
    if expected-actual_columns:raise RuntimeError('SCHEMA_COLUMNS_MISSING')


def run(status, source, operation_lock, service, archive=None, imported_source=None):
    root = source.parent.parent
    access = None
    def progress(state, **fields):
        nonlocal status
        status = write_status(root, {**status, **fields, 'state': state})
        service.log('restore_job', operationId=status['operationId'], actor=status['actor'], state=state)
    try:
        settings = service.config()
        if archive is not None:
            checksum=hashlib.sha256()
            with source.open('wb') as selected:
                while chunk := archive.read(1024*1024):
                    checksum.update(chunk)
                    selected.write(chunk)
                selected.flush()
                os.fsync(selected.fileno())
            archive.close()
        progress('DRAINING', archiveSha256=checksum.hexdigest() if archive is not None else None)
        access = (directory(root) / 'access.lock').open('rb')
        # New requests are already blocked by QUEUED; never force-kill an active
        # application transaction. A stuck request times out the job fail-closed.
        deadline = time.monotonic() + 120
        while True:
            try:
                fcntl.flock(access, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline: raise RuntimeError('DRAIN_TIMEOUT')
                time.sleep(.1)
        # Await server-side completion/rollback too (including a killed worker).
        database_literal = settings['database'].replace("'", "''")
        while int(service._postgres_command(settings,
                "SELECT count(*) FROM pg_stat_activity WHERE datname='" + database_literal +
                "' AND state IS DISTINCT FROM 'idle'").stdout.strip() or '0'):
            if time.monotonic() >= deadline: raise RuntimeError('DATABASE_DRAIN_TIMEOUT')
            time.sleep(.1)
        result = service.restore_backup({'_job_source': str(source)}, progress=progress,
                                        verify=lambda database: verify_schema(service, settings, database))
        progress('VERIFYING', safetyBackup=result['safetyBackup'])
        verify_schema(service, settings, settings['database'])
        try:
            source.unlink(missing_ok=True)
            if imported_source is not None: imported_source.unlink(missing_ok=True)
        except OSError:
            status['cleanupWarning']=True  # Verified database remains healthy.
        progress('SUCCEEDED', message='Wiederherstellung und Schema-/Verbindungsprüfung erfolgreich.')
    except BaseException as error:
        # Disk errors may also prevent this write: the previously persisted active
        # state then remains blocking. Never turn an exception into normal mode.
        progress('RECOVERY_REQUIRED', message='Wiederherstellung nicht freigegeben. Betriebsprüfung und Recovery erforderlich.',
                 failurePhase=status['state'], errorCode=str(error) if str(error) in {'DRAIN_TIMEOUT','DATABASE_DRAIN_TIMEOUT','BACKUP_DRAIN_TIMEOUT','SCHEMA_INCOMPATIBLE','SCHEMA_COLUMNS_MISSING','PRE_RESTORE_BACKUP_VALIDATION_FAILED','ARCHIVE_RESTORE_FAILED','MIGRATION_FAILED'} else type(error).__name__)
    finally:
        if archive is not None: archive.close()
        if access is not None: access.close()
        operation_lock.close()


def recover(operation_id, confirmation, service):
    """Explicit VPS recovery after operator data inspection; never auto-unlock."""
    if confirmation != 'RECOVERY VERIFIED': raise ValueError('Explicit recovery confirmation required')
    settings = service.config();root=settings['directory']
    with (directory(root)/'operation.lock').open('rb') as lock, (directory(root)/'access.lock').open('rb') as access:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(access, fcntl.LOCK_EX | fcntl.LOCK_NB)
        status=read_status(root)
        if status.get('operationId') != operation_id or status['state'] != 'RECOVERY_REQUIRED':
            raise ValueError('Recovery operation does not match')
        verify_schema(service,settings,settings['database'])
        return write_status(root,{**status,'state':'SUCCEEDED','message':'Betriebsprüfung und Recovery ausdrücklich durch VPS-Betreiber bestätigt.'})


if __name__ == '__main__':
    import argparse
    import backup_service
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['recover'])
    parser.add_argument('--operation-id',required=True)
    parser.add_argument('--confirmation',required=True)
    args=parser.parse_args()
    print(recover(args.operation_id,args.confirmation,backup_service))
