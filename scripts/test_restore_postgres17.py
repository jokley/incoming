"""Destructive restore smoke test ONLY on the fixed isolated loopback test server.

Start postgres:17 named incoming-restore-postgres-it at 127.0.0.1:55451 with
POSTGRES_USER/PASSWORD=incoming_restore_test, POSTGRES_DB=postgres and label
incoming.restore-test=true. --container-tools uses that container's PG17 clients
if native pg_dump/pg_restore/psql are not installed. No production URL accepted.
Only this invocation's incoming_restore_test_<uuid> namespaces are created/dropped.
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backup')]


def main(container_tools=False):
    if any(os.environ.get(key) for key in ('PGHOST','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS')):
        raise ValueError('Remove libpq host/service/options overrides before the isolated restore test')
    for key in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'):
        os.environ.pop(key,None)
    import psycopg
    from flask import Flask
    from models import db
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    import backup_service as service
    import restore_jobs
    from restore_coordination import initialize,read_status,request_lease,schema_contract
    admin='postgresql://incoming_restore_test:incoming_restore_test@127.0.0.1:55451/postgres'
    name='incoming_restore_test_'+uuid.uuid4().hex[:12]
    if container_tools:
        label=subprocess.check_output(['docker','--host=unix:///var/run/docker.sock','inspect',
            'incoming-restore-postgres-it','--format','{{index .Config.Labels "incoming.restore-test"}}'],text=True).strip()
        if label!='true':raise ValueError('Require explicitly labelled isolated test container')
    with tempfile.TemporaryDirectory(prefix='incoming-restore-smoke-') as directory:
        if container_tools:
            script=Path(directory)/'client.py'
            script.write_text('''#!'''+sys.executable+'''
import os,subprocess,sys,uuid
from pathlib import Path
name=Path(sys.argv[0]).name;args=sys.argv[1:]
if '-p' in args:args[args.index('-p')+1]='5432'
base=['docker','--host=unix:///var/run/docker.sock','exec','-i','-e','PGPASSWORD','incoming-restore-postgres-it']
remote=None
if name=='pg_restore':
 source=Path(args[-1]);remote='/tmp/restore-smoke-'+uuid.uuid4().hex
 with source.open('rb') as f:subprocess.run(base+['sh','-c','cat > '+remote],stdin=f,check=True)
 args[-1]=remote
result=subprocess.run(base+[name]+args)
if remote:subprocess.run(base+['rm',remote],check=True)
sys.exit(result.returncode)
''')
            script.chmod(0o700)
            for tool in ('psql','pg_dump','pg_restore'):(Path(directory)/tool).symlink_to(script)
            os.environ['PATH']=directory+os.pathsep+os.environ['PATH']
        with psycopg.connect(admin,autocommit=True) as connection:
            connection.execute('CREATE DATABASE '+name)
        try:
            app=Flask(__name__)
            app.config.update(SQLALCHEMY_DATABASE_URI=admin.rsplit('/',1)[0].replace('postgresql://','postgresql+psycopg://')+'/'+name,
                              SQLALCHEMY_ENGINE_OPTIONS={'pool_pre_ping':True})
            db.init_app(app)
            with app.app_context():
                db.create_all()
                config=Config(str(ROOT/'backend/alembic.ini'))
                config.set_main_option('script_location',str(ROOT/'backend/migrations'))
                head=ScriptDirectory.from_config(config).get_current_head()
                db.session.execute(db.text('CREATE TABLE alembic_version(version_num varchar(32) primary key)'))
                db.session.execute(db.text('INSERT INTO alembic_version VALUES (:head)'),{'head':head})
                db.session.execute(db.text("CREATE TABLE restore_probe(value text);INSERT INTO restore_probe VALUES ('before')"))
                db.session.commit();db.session.remove();db.engine.dispose()
            os.environ.update(POSTGRES_HOST='127.0.0.1',POSTGRES_PORT='55451',POSTGRES_USER='incoming_restore_test',
                POSTGRES_PASSWORD='incoming_restore_test',POSTGRES_DB=name,BACKUP_DIR=directory,BACKUP_ENABLED='false')
            initialize(directory)
            source=service.create_backup('manual')
            with psycopg.connect(admin.rsplit('/',1)[0]+'/'+name) as connection:
                connection.execute("UPDATE restore_probe SET value='after'")
            lease,_=request_lease(directory)
            # Exercise the actual authenticated Flask endpoint and independent
            # HTTP control service, not just the Python restore helper.
            os.environ['DATABASE_URL']=admin.rsplit('/',1)[0]+'/'+name
            os.environ['AUTH_PROXY_SECRET']='isolated-restore-control'
            from app import app as api_app
            api_app.config.update(BACKUP_DIR=directory,AUTH_DEV_USER='',AUTH_PROXY_SECRET='isolated-restore-control',
                                  RESTORE_COORDINATION_REQUIRED=True)
            server=service.ThreadingHTTPServer(('127.0.0.1',0),service.Handler)
            server_thread=threading.Thread(target=server.serve_forever,daemon=True);server_thread.start()
            api_app.config['BACKUP_SERVICE_URL']=f'http://127.0.0.1:{server.server_port}'
            headers={'X-Auth-Proxy-Secret':'isolated-restore-control','X-Authenticated-User':'isolated-admin',
                     'X-Authenticated-Groups':'incoming-admin','X-Database-Generation':'initial'}
            try:
                response=api_app.test_client().post('/api/admin/database/restore',headers=headers,
                    json={'filename':source['filename'],'category':'manual','confirmation':'RESTORE DATABASE'})
                assert response.status_code==202,response.json
                accepted=response.json
                status_response=api_app.test_client().get('/api/admin/database/restore-status',headers=headers)
                assert status_response.status_code==200
            finally:
                server.shutdown();server.server_close();server_thread.join(timeout=2)
            time.sleep(.2)
            assert read_status(directory)['state']=='DRAINING'
            lease.close()
            for _ in range(900):
                status=read_status(directory)
                if status['state'] in {'SUCCEEDED','RECOVERY_REQUIRED'}:break
                time.sleep(.1)
            assert status['state']=='SUCCEEDED',status
            with psycopg.connect(admin.rsplit('/',1)[0]+'/'+name) as connection:
                assert connection.execute('SELECT value FROM restore_probe').fetchone()[0]=='before'
            assert (Path(directory)/'pre-restore'/status['safetyBackup']).is_file()
            assert read_status(directory)['operationId']==accepted['operationId']
            assert read_status(directory)['actor']=='isolated-admin'
            assert api_app.test_client().get('/health').status_code==200
            print('PASS PostgreSQL17 HTTP restore: authenticated API202, independent service, drain, safety probe, staging, schema contract, swap, restored data, durable success and backend health')
        finally:
            with psycopg.connect(admin,autocommit=True) as connection:
                for row in connection.execute('SELECT datname FROM pg_database WHERE datname=%s OR starts_with(datname,%s)',(name,name+'_')).fetchall():
                    connection.execute('DROP DATABASE '+row[0]+' WITH (FORCE)')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--container-tools',action='store_true')
    main(parser.parse_args().container_tools)
