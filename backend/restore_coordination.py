"""Durable restore control plane on the shared *local POSIX* backup volume.

The lock inode is never replaced. Flask holds a shared lease through transaction
cleanup; the backup worker requires its exclusive lease before touching databases.
"""
import fcntl
import json
import os
from pathlib import Path
from datetime import datetime, timezone

NORMAL = {'IDLE', 'SUCCEEDED'}
STATES = NORMAL | {'QUEUED', 'DRAINING', 'SAFETY_BACKUP', 'RESTORING', 'VERIFYING', 'RECOVERY_REQUIRED'}


def directory(root):
    return Path(root) / '.restore-control'


def read_status(root):
    result = json.loads((directory(root) / 'status.json').read_text())
    if result.get('formatVersion') != 1 or result.get('state') not in STATES:
        raise ValueError('Invalid restore coordination state')
    return result


def write_status(root, payload):
    folder = directory(root)
    value = {**payload, 'formatVersion': 1, 'updatedAt': datetime.now(timezone.utc).isoformat()}
    temporary = folder / 'status.tmp'
    with temporary.open('w') as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    if value.get('operationId'):
        with (folder / 'history.jsonl').open('a') as history:
            history.write(json.dumps(value) + '\n')
            history.flush()
            os.fsync(history.fileno())
    temporary.replace(folder / 'status.json')
    descriptor = os.open(folder, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
    return value


def initialize(root):
    folder = directory(root)
    folder.mkdir(parents=True, exist_ok=True)
    # Never replace a lock inode, including during service restarts.
    for name in ('access.lock', 'operation.lock'):
        (folder / name).touch(exist_ok=True)
    lock = (folder / 'operation.lock').open('rb')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not (folder / 'status.json').exists():
            history=folder/'history.jsonl'
            if history.exists() and history.stat().st_size:
                previous=json.loads(history.read_text().splitlines()[-1])
                write_status(root,{**previous,'state':'RECOVERY_REQUIRED','message':'Restorestatus fehlt; Journal und Datenbank vor Freigabe prüfen.'})
            else:
                write_status(root, {'state': 'IDLE'})
        else:
            status = read_status(root)
            if status['state'] not in NORMAL:
                write_status(root, {**status, 'state': 'RECOVERY_REQUIRED',
                                   'message': 'Dienstneustart oder unterbrochener Restore. Betriebsprüfung erforderlich.'})
    except BlockingIOError:
        pass  # A different backup process owns the job. Do not rewrite its state.
    finally: lock.close()


def request_lease(root):
    handle = (directory(root) / 'access.lock').open('rb')
    try:
        fcntl.flock(handle, fcntl.LOCK_SH | fcntl.LOCK_NB)
        status = read_status(root)
        if status['state'] not in NORMAL:
            raise BlockingIOError('Restore maintenance active')
        return handle, status
    except BaseException:
        handle.close()
        raise


def schema_contract():
    """Non-secret compatibility handshake between running API and backup image."""
    import hashlib
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from models import db
    backend=Path(__file__).resolve().parent
    config=Config(str(backend/'alembic.ini'))
    config.set_main_option('script_location',str(backend/'migrations'))
    columns=sorted((table.name,column.name,str(column.type),column.nullable,column.primary_key)
                   for table in db.metadata.sorted_tables for column in table.columns)
    return {'heads':sorted(ScriptDirectory.from_config(config).get_heads()),
            'modelDigest':hashlib.sha256(json.dumps(columns,separators=(',',':')).encode()).hexdigest()}
