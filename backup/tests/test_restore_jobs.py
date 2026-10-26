import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
import threading
import time
from types import SimpleNamespace
from unittest.mock import patch
import pytest
import restore_jobs
from restore_coordination import initialize, read_status, request_lease, schema_contract


def setup(tmp_path, failure=False):
    initialize(tmp_path)
    source=tmp_path/'selected.dump';source.write_bytes(b'PGDMP-fixture')
    started,finish=threading.Event(),threading.Event()
    def restore(payload,progress,verify):
        progress('SAFETY_BACKUP');started.set();assert finish.wait(5)
        if failure:raise RuntimeError('unsafe underlying detail')
        progress('RESTORING');return {'safetyBackup':'safe.dump.gz'}
    service=SimpleNamespace(config=lambda:{'directory':tmp_path,'database':'isolated'},resolve_restore_source=lambda *_:(source,False),validate_dump=lambda *_:None,
        _postgres_command=lambda *_:SimpleNamespace(stdout='0'),restore_backup=restore,log=lambda *_a,**_k:None)
    return service,started,finish


def wait_terminal(root):
    for _ in range(100):
        result=read_status(root)
        if result['state'] in {'SUCCEEDED','RECOVERY_REQUIRED'}:return result
        time.sleep(.02)
    raise AssertionError('job did not finish')


def test_job_drains_active_requests_rejects_parallel_and_survives_backend_disconnection(tmp_path):
    service,started,finish=setup(tmp_path)
    lease,_=request_lease(tmp_path)
    with patch('restore_jobs.verify_schema'):
        accepted=restore_jobs.start({'filename':'safe.dump.gz','schemaContract':schema_contract(),'databaseTarget':{'host':'postgres','port':5432,'database':'isolated'}},'admin',service)
        assert accepted['operationId']
        assert not started.wait(.15)
        with pytest.raises(BlockingIOError):request_lease(tmp_path)
        with pytest.raises(BlockingIOError):restore_jobs.start({'schemaContract':schema_contract(),'databaseTarget':{'host':'postgres','port':5432,'database':'isolated'}},'second-admin',service)
        lease.close();assert started.wait(2)
        # No Flask request or connection is needed for completion.
        finish.set();assert wait_terminal(tmp_path)['state']=='SUCCEEDED'
    assert read_status(tmp_path)['actor']=='admin'
    lease,_=request_lease(tmp_path);lease.close()


def test_failure_remains_durable_and_blocks_writes_without_leaking_details(tmp_path):
    service,started,finish=setup(tmp_path,failure=True)
    with patch('restore_jobs.verify_schema'):
        restore_jobs.start({'schemaContract':schema_contract(),'databaseTarget':{'host':'postgres','port':5432,'database':'isolated'}},'admin',service);assert started.wait(2);finish.set()
        result=wait_terminal(tmp_path)
    assert result['state']=='RECOVERY_REQUIRED'
    assert 'unsafe underlying detail' not in str(result)
    with pytest.raises(BlockingIOError):request_lease(tmp_path)
    initialize(tmp_path)
    assert read_status(tmp_path)['state']=='RECOVERY_REQUIRED'


def test_schema_marker_and_all_runtime_columns_are_required():
    import backup_service
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from unittest.mock import MagicMock
    config=Config(str(Path(backup_service.__file__).resolve().parents[1]/'backend/alembic.ini'))
    config.set_main_option('script_location',str(Path(backup_service.__file__).resolve().parents[1]/'backend/migrations'))
    head=ScriptDirectory.from_config(config).get_current_head()
    settings={'database':'isolated'}
    with patch.object(backup_service,'_postgres_command',return_value=SimpleNamespace(stdout='unrecognized_revision')):
        with pytest.raises(RuntimeError,match='SCHEMA_INCOMPATIBLE'):restore_jobs.verify_schema(backup_service,settings,'isolated')
    with patch.object(backup_service,'_postgres_command',side_effect=[SimpleNamespace(stdout=head),SimpleNamespace(stdout='')]):
        with pytest.raises(RuntimeError,match='SCHEMA_COLUMNS_MISSING'):restore_jobs.verify_schema(backup_service,settings,'isolated')


def test_recovery_is_explicit_scoped_and_requires_current_database_validation(tmp_path):
    service,_,_=setup(tmp_path,failure=True)
    from restore_coordination import write_status
    write_status(tmp_path,dict(state='RECOVERY_REQUIRED',operationId='recovery-job',actor='admin'))
    with pytest.raises(ValueError):restore_jobs.recover('recovery-job','wrong',service)
    with patch('restore_jobs.verify_schema',side_effect=RuntimeError('unavailable')):
        with pytest.raises(RuntimeError):restore_jobs.recover('recovery-job','RECOVERY VERIFIED',service)
    assert read_status(tmp_path)['state']=='RECOVERY_REQUIRED'
    with patch('restore_jobs.verify_schema'):
        assert restore_jobs.recover('recovery-job','RECOVERY VERIFIED',service)['state']=='SUCCEEDED'


def test_internal_control_requires_secret_and_confirmation_before_starting_job():
    import json
    import os
    import urllib.request
    import urllib.error
    import backup_service
    server=backup_service.ThreadingHTTPServer(('127.0.0.1',0),backup_service.Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with patch.dict(os.environ,AUTH_PROXY_SECRET='isolated-control'),patch('restore_jobs.start',return_value={'state':'QUEUED','operationId':'job'}) as start:
            url=f'http://127.0.0.1:{server.server_port}/restore-jobs'
            def call(headers,body):
                req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**headers})
                try:
                    with urllib.request.urlopen(req) as response:return response.status
                except urllib.error.HTTPError as error:return error.code
            assert call({}, {'confirmation':'RESTORE DATABASE'})==403
            assert call({'X-Backup-Control-Secret':'isolated-control'}, {})==400
            start.assert_not_called()
            assert call({'X-Backup-Control-Secret':'isolated-control'}, {'confirmation':'RESTORE DATABASE','actor':'admin'})==202
            assert start.call_args.args[1]=='admin'
    finally:
        server.shutdown();server.server_close();thread.join(timeout=2)


def test_stale_backup_image_contract_is_rejected_before_maintenance(tmp_path):
    service,_,_=setup(tmp_path)
    with pytest.raises(ValueError,match='schemakompatibel'):
        restore_jobs.start({'schemaContract':{'heads':['old'],'modelDigest':'wrong'}},'admin',service)
    assert read_status(tmp_path)['state']=='IDLE'
    with pytest.raises(ValueError,match='Datenbankziel'):
        restore_jobs.start({'schemaContract':schema_contract(),'databaseTarget':{'host':'wrong','port':5432,'database':'isolated'}},'admin',service)
    assert read_status(tmp_path)['state']=='IDLE'
