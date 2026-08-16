"""Central runtime configuration for the backend.

Environment parsing belongs here so application and infrastructure modules do
not independently interpret deployment settings.  The resulting Flask config
uses conventional keys and remains overridable in tests.
"""

from dataclasses import dataclass
import os
from pathlib import Path


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(',') if item.strip())


@dataclass(frozen=True)
class RuntimeSettings:
    base_dir: Path
    data_dir: Path
    database_backend: str
    database_path: Path
    database_url: str | None
    mock_files_dir: Path
    cors_origins: tuple[str, ...]
    auth_proxy_secret: str
    auth_dev_user: str
    auth_dev_groups: str
    log_level: str
    environment: str
    backup_dir: Path
    backup_service_url: str

    @classmethod
    def from_environment(cls, base_dir: Path | None = None):
        base = (base_dir or Path(__file__).resolve().parent).resolve()
        data = Path(os.environ.get('APP_DATA_DIR', base / 'data')).resolve()
        database = Path(os.environ.get('DATABASE_PATH', data / 'freestyle_wm_new.db')).resolve()
        database_backend = os.environ.get('DATABASE_BACKEND', 'sqlite').strip().lower()
        if database_backend not in {'sqlite', 'postgresql'}:
            raise ValueError("DATABASE_BACKEND must be 'sqlite' or 'postgresql'")
        database_url = os.environ.get('DATABASE_URL', '').strip() or None
        if database_backend == 'postgresql':
            if database_url is None:
                raise ValueError('DATABASE_URL is required when DATABASE_BACKEND=postgresql')
            if database_url.startswith('postgresql://'):
                database_url = database_url.replace('postgresql://', 'postgresql+psycopg://', 1)
            elif not database_url.startswith('postgresql+psycopg://'):
                raise ValueError('DATABASE_URL must use the postgresql:// scheme')
        return cls(
            base_dir=base,
            data_dir=data,
            database_backend=database_backend,
            database_path=database,
            database_url=database_url,
            mock_files_dir=base / 'mock_fis_files',
            cors_origins=_csv(os.environ.get('CORS_ORIGINS', '')),
            auth_proxy_secret=os.environ.get('AUTH_PROXY_SECRET', ''),
            auth_dev_user=os.environ.get('AUTH_DEV_USER', ''),
            auth_dev_groups=os.environ.get('AUTH_DEV_GROUPS', 'incoming-admin'),
            log_level=os.environ.get('LOG_LEVEL', 'INFO').upper(),
            environment=os.environ.get('FLASK_ENV', ''),
            backup_dir=Path(os.environ.get('BACKUP_DIR', '/backups')),
            backup_service_url=os.environ.get('BACKUP_SERVICE_URL', 'http://backup:8080'),
        )

    def apply(self, app):
        """Apply settings at the composition root without hiding side effects."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        database_uri = (f'sqlite:///{self.database_path}' if self.database_backend == 'sqlite'
                        else self.database_url)
        app.config.update(
            SQLALCHEMY_DATABASE_URI=database_uri,
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            DATABASE_BACKEND=self.database_backend,
            AUTH_PROXY_SECRET=self.auth_proxy_secret,
            AUTH_DEV_USER=self.auth_dev_user,
            AUTH_DEV_GROUPS=self.auth_dev_groups,
            LOG_LEVEL=self.log_level,
            RUNTIME_ENV=self.environment,
            BACKUP_DIR=str(self.backup_dir),
            BACKUP_SERVICE_URL=self.backup_service_url,
        )
