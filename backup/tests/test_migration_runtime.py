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
                str(backend / 'alembic.ini'), 'upgrade', '20261014_01:20261016_02', '--sql'],
                cwd=backend, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('accommodation_rate_category', result.stdout)
            self.assertIn('accommodation_requirement', result.stdout)
            records = json.loads((backend / 'reference_data/engadin_2025_world_champions.json').read_text())
            self.assertTrue(records)
            self.assertTrue((backend / 'quota_catalogue.py').is_file())
            self.assertTrue((backend / 'event_ownership.py').is_file())
            self.assertTrue((backend / 'event_ownership_runtime.py').is_file())
            guarded = subprocess.run([sys.executable, '-I', '-m', 'alembic', '-c',
                str(backend / 'alembic.ini'), 'upgrade', '20261016_02:head', '--sql'],
                cwd=backend, env=env, capture_output=True, text=True)
            self.assertNotEqual(guarded.returncode, 0)
            self.assertIn('offline SQL is unsafe', guarded.stderr)


    def test_packaged_ownership_guard_supports_flush_and_serialization(self):
        with tempfile.TemporaryDirectory() as directory:
            backend = Path(directory) / 'backend'
            package_backend(backend)
            script = """
import sys
sys.path.insert(0, '.')
from datetime import date
from flask import Flask
from models import db, Event, Hotel, RoomType, HotelRoomInventory
app = Flask(__name__)
app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False, OPERATIONAL_EVENT_ID='7')
db.init_app(app)
with app.app_context():
    db.create_all()
    db.session.add(Event(id=7, name='Isolated package test'))
    hotel=Hotel(name='Package'); room=RoomType(name='DZ', max_persons=2)
    db.session.add_all([hotel, room]); db.session.commit()
    with app.test_request_context('/api/hotels/1/inventory', method='POST'):
        inventory=HotelRoomInventory(event_id='7', hotel_id=hotel.id, room_type_id=room.id, room_count=4,
            available_from=date(2027,3,3), available_until=date(2027,3,9))
        db.session.add(inventory); db.session.commit()
        assert inventory.to_dict()['roomCount']==4
print('Packaged ownership runtime OK')
"""
            result = subprocess.run([sys.executable, '-I', '-c', script], cwd=backend,
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Packaged ownership runtime OK', result.stdout)



if __name__ == '__main__':
    unittest.main()
