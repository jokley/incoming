"""Internal cleanup safety backup must be completed, target-bound and verified."""
import io,json,os
from unittest.mock import patch
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backup_service as service


def invoke(payload,secret='private-test'):
    handler=object.__new__(service.Handler);handler.path='/cleanup-backup'
    raw=json.dumps(payload).encode();handler.rfile=io.BytesIO(raw)
    handler.headers={'Content-Length':str(len(raw)),'X-Backup-Control-Secret':secret}
    replies=[];handler._reply=lambda status,body:replies.append((status,body))
    handler.do_POST();return replies[0]


def test_safety_backup_only_succeeds_after_verified_dump(tmp_path):
    settings={'host':'postgres','port':'5432','database':'isolated','directory':tmp_path}
    payload={'databaseTarget':{'host':'postgres','port':5432,'database':'isolated'}}
    with patch.dict(os.environ,AUTH_PROXY_SECRET='private-test'),patch.object(service,'config',return_value=settings),patch.object(service,'create_backup',return_value={'status':'success','filename':'safe.dump.gz','category':'manual','size':123}) as create,patch.object(service,'validate_dump') as validate:
        assert invoke(payload)[0]==200
        create.assert_called_once_with('manual');validate.assert_called_once_with(tmp_path/'manual'/'safe.dump.gz',settings)
        create.reset_mock()
        assert invoke(payload,'wrong')[0]==403;create.assert_not_called()
        assert invoke({'databaseTarget':{**payload['databaseTarget'],'database':'other'}})[0]==400;create.assert_not_called()
        validate.side_effect=RuntimeError('invalid dump')
        assert invoke(payload)[0]==409
        assert not service.RESTORE_LOCK.locked()
