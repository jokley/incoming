"""Run startup migrations under the same lease as HTTP transactions.

During an existing restore start only the guarded control-plane application;
its database endpoints remain closed until the backup worker verifies success.
"""
import os
import subprocess
import sys
from restore_coordination import request_lease, read_status, NORMAL


def main(command):
    root=os.environ.get('BACKUP_DIR','/backups')
    try:lease,_=request_lease(root)
    except BlockingIOError:
        if read_status(root)['state'] in NORMAL:raise
        print('Restore/recovery active: startup migration skipped; database routes remain blocked.',flush=True)
        return 0
    try:return subprocess.call(command, pass_fds=(lease.fileno(),))
    finally:lease.close()


if __name__=='__main__':raise SystemExit(main(sys.argv[1:]))
