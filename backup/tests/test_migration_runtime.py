"""Exercise the backend filesystem actually shipped in the backup image.

No source-tree PYTHONPATH and no production/database connection are used.
"""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def package_backend(destination):
    """Materialize the literal backend COPY instructions from backup/Dockerfile."""
    for line in (ROOT / 'backup/Dockerfile').read_text().splitlines():
        parts = shlex.split(line)
        if not parts or parts[0] != 'COPY' or not parts[-1].startswith('/opt/backend'):
            continue
        sources, target = parts[1:-1], parts[-1]
        for name in sources:
            source = ROOT / name
            result = destination / target.removeprefix('/opt/backend').lstrip('/')
            if source.is_dir():
                shutil.copytree(source, result, dirs_exist_ok=True)
            else:
                if target.endswith('/'):
                    result /= source.name
                result.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, result)


class MigrationRuntimeTest(unittest.TestCase):
    def test_backup_image_backend_loads_alembic_env_without_application_source(self):
        with tempfile.TemporaryDirectory() as directory:
            backend = Path(directory) / 'backend'
            package_backend(backend)
            env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'DATABASE_', 'PYTHONPATH'))}
            # Offline mode must never connect; this loopback URL is a dummy.
            env['DATABASE_URL'] = 'postgresql://test:test@127.0.0.1:1/offline_only'
            result = subprocess.run([sys.executable, '-I', '-m', 'alembic', '-c',
                str(backend / 'alembic.ini'), 'upgrade', '20261014_01:head', '--sql'],
                cwd=backend, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('accommodation_rate_category', result.stdout)
            self.assertIn('accommodation_requirement', result.stdout)
            records = json.loads((backend / 'reference_data/engadin_2025_world_champions.json').read_text())
            self.assertTrue(records)
            self.assertTrue((backend / 'quota_catalogue.py').is_file())


if __name__ == '__main__':
    unittest.main()
