"""Cross-process POSIX coordination, with no production database or restore."""
import fcntl
import subprocess
import sys
import time
import pytest
from app import app
from restore_coordination import initialize, directory, read_status, write_status, request_lease


def test_shared_request_lease_blocks_other_process_exclusive_restore(tmp_path):
    initialize(tmp_path)
    lease, _ = request_lease(tmp_path)
    code = "import fcntl,sys; f=open(sys.argv[1],'rb'); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)"
    assert subprocess.run([sys.executable,'-c',code,str(directory(tmp_path)/'access.lock')],capture_output=True).returncode != 0
    lease.close()
    assert subprocess.run([sys.executable,'-c',code,str(directory(tmp_path)/'access.lock')],capture_output=True).returncode == 0


def test_restart_keeps_interrupted_job_blocked_and_keeps_history(tmp_path):
    initialize(tmp_path)
    write_status(tmp_path,dict(state='RESTORING',operationId='old-job',actor='admin'))
    initialize(tmp_path)
    assert read_status(tmp_path)['state']=='RECOVERY_REQUIRED'
    with pytest.raises(BlockingIOError): request_lease(tmp_path)
    assert 'old-job' in (directory(tmp_path)/'history.jsonl').read_text()
    (directory(tmp_path)/'status.json').unlink()
    initialize(tmp_path)
    assert read_status(tmp_path)['state']=='RECOVERY_REQUIRED'
    with pytest.raises(BlockingIOError):request_lease(tmp_path)


@pytest.mark.parametrize('state',['QUEUED','RESTORING','RECOVERY_REQUIRED'])
def test_api_blocks_import_booking_and_admin_changes_but_allows_job_status(tmp_path,monkeypatch,state):
    initialize(tmp_path)
    write_status(tmp_path,dict(state=state,operationId='test-job'))
    for name,value in dict(RESTORE_COORDINATION_REQUIRED=True,BACKUP_DIR=str(tmp_path),AUTH_PROXY_SECRET='',AUTH_DEV_USER='test-admin',AUTH_DEV_GROUPS='incoming-admin').items():monkeypatch.setitem(app.config,name,value)
    client=app.test_client()
    for path in ['/api/import/fis/preview','/api/room-assignments','/api/admin/events']:
        response=client.post(path,json={})
        assert response.status_code==503,response.json
        assert response.json['error']=='RESTORE_MAINTENANCE'
    status=client.get('/api/admin/database/restore-status')
    assert status.status_code==200 and status.json['operationId']=='test-job'
    assert client.get('/health').status_code==503


def test_missing_or_corrupt_control_volume_fails_closed(tmp_path,monkeypatch):
    for name,value in dict(RESTORE_COORDINATION_REQUIRED=True,BACKUP_DIR=str(tmp_path),AUTH_PROXY_SECRET='',AUTH_DEV_USER='test-admin',AUTH_DEV_GROUPS='incoming-admin').items():monkeypatch.setitem(app.config,name,value)
    assert app.test_client().post('/api/admin/events',json={}).status_code==503
    initialize(tmp_path)
    (directory(tmp_path)/'status.json').write_text('broken')
    assert app.test_client().post('/api/admin/events',json={}).status_code==503


def test_pre_restore_clients_cannot_write_after_database_replacement(tmp_path,monkeypatch):
    initialize(tmp_path);write_status(tmp_path,dict(state='SUCCEEDED',operationId='new-generation'))
    for name,value in dict(RESTORE_COORDINATION_REQUIRED=True,BACKUP_DIR=str(tmp_path),AUTH_PROXY_SECRET='',AUTH_DEV_USER='test-admin',AUTH_DEV_GROUPS='incoming-admin').items():monkeypatch.setitem(app.config,name,value)
    client=app.test_client()
    for supplied in ({},{'X-Database-Generation':'initial'}):
        response=client.post('/api/admin/events',headers=supplied,json={})
        assert response.status_code==409 and response.json['error']=='DATABASE_GENERATION_CHANGED'
        assert response.headers['X-Database-Generation']=='new-generation'
    assert client.get('/api/auth/me').headers['X-Database-Generation']=='new-generation'


def test_killed_coordinator_leaves_durable_block_across_process_restart(tmp_path):
    initialize(tmp_path)
    code="""import sys,time,fcntl
sys.path.insert(0,sys.argv[2])
from restore_coordination import directory,write_status
root=sys.argv[1]
operation=(directory(root)/'operation.lock').open('rb');fcntl.flock(operation,fcntl.LOCK_EX)
access=(directory(root)/'access.lock').open('rb');fcntl.flock(access,fcntl.LOCK_EX)
write_status(root,{'state':'RESTORING','operationId':'interrupted-job','actor':'test-admin'})
print('ready',flush=True)
time.sleep(120)
"""
    from pathlib import Path
    process=subprocess.Popen([sys.executable,'-c',code,str(tmp_path),str(Path(__file__).resolve().parents[1])],stdout=subprocess.PIPE,text=True)
    try:
        assert process.stdout.readline().strip()=='ready'
        with pytest.raises(BlockingIOError):request_lease(tmp_path)
    finally:
        process.terminate();process.wait(timeout=5)
    initialize(tmp_path)
    assert read_status(tmp_path)['state']=='RECOVERY_REQUIRED'
    with pytest.raises(BlockingIOError):request_lease(tmp_path)
