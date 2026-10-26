from unittest.mock import patch
import pytest
from restore_coordination import initialize,write_status
from restore_startup import main


def test_startup_migration_holds_drain_lease(tmp_path,monkeypatch):
    import fcntl
    from restore_coordination import directory
    initialize(tmp_path);monkeypatch.setenv('BACKUP_DIR',str(tmp_path))
    def migration(command, **kwargs):
        assert kwargs['pass_fds']
        with (directory(tmp_path)/'access.lock').open('rb') as handle:
            with pytest.raises(BlockingIOError):fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return 0
    with patch('restore_startup.subprocess.call',side_effect=migration):assert main(['migration'])==0


def test_restart_during_restore_starts_only_guarded_control_plane(tmp_path,monkeypatch):
    initialize(tmp_path);monkeypatch.setenv('BACKUP_DIR',str(tmp_path))
    write_status(tmp_path,{'state':'RESTORING'})
    with patch('restore_startup.subprocess.call') as migration:
        assert main(['migration'])==0
        migration.assert_not_called()
