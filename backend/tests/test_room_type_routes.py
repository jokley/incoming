"""Room type contracts shared by canonical and compatibility routes."""
from datetime import date
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url

os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from models import db, AuditEvent, Hotel, HotelRoomInventory, RoomType


class RoomTypeRoutesTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
            room_type = RoomType(name='Double', max_persons=2)
            db.session.add(room_type)
            db.session.commit()
            self.type_id = room_type.id
        self.client = app.test_client()
        self.editor = {'X-Authenticated-User': 'editor',
                       'X-Authenticated-Groups': 'incoming-editor'}
        self.viewer = {'X-Authenticated-User': 'viewer',
                       'X-Authenticated-Groups': 'incoming-viewer'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    @staticmethod
    def paths(suffix=''):
        return [prefix + '/room-types' + suffix + slash
                for prefix in ('/api', '') for slash in ('', '/')]

    def test_list_serialization_on_all_aliases(self):
        for path in self.paths():
            with self.subTest(path=path):
                response = self.client.get(path, headers=self.viewer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.mimetype, 'application/json')
                self.assertEqual(response.get_json(), [
                    {'id': str(self.type_id), 'name': 'Double', 'maxPersons': 2}])

    def test_empty_list_on_all_aliases(self):
        with app.app_context():
            RoomType.query.delete()
            db.session.commit()
        for path in self.paths():
            with self.subTest(path=path):
                response = self.client.get(path, headers=self.viewer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), [])

    def test_missing_update_and_delete_return_html_404_without_writes_or_audit(self):
        for method in ('PUT', 'DELETE'):
            for path in self.paths('/2147483647'):
                with self.subTest(method=method, path=path):
                    response = self.client.open(path, method=method,
                        json={'name': 'Changed'}, headers=self.editor)
                    self.assertEqual(response.status_code, 404)
                    self.assertEqual(response.mimetype, 'text/html')
                    self.assertIsNone(response.get_json(silent=True))
                    self.assertIn(b'<h1>Not Found</h1>', response.data)
                    with app.app_context():
                        self.assertEqual(RoomType.query.count(), 1)
                        self.assertEqual(db.session.get(RoomType, self.type_id).name, 'Double')
                        self.assertEqual(AuditEvent.query.count(), 0)

    def test_inventory_guard_returns_exact_409_without_deletion_or_audit(self):
        with app.app_context():
            hotel = Hotel(name='Inventory Hotel')
            db.session.add(hotel)
            db.session.flush()
            for room_count in (3, 7):
                db.session.add(HotelRoomInventory(hotel_id=hotel.id,
                    room_type_id=self.type_id, available_from=date(2027, 3, 1),
                    available_until=date(2027, 3, 20), room_count=room_count))
            db.session.commit()
        for path in self.paths(f'/{self.type_id}'):
            with self.subTest(path=path):
                response = self.client.delete(path, headers=self.editor)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.mimetype, 'application/json')
                self.assertEqual(response.get_json(), {
                    'error': 'ROOM_TYPE_IN_USE',
                    'message': 'Dieser Zimmertyp wird aktuell in 2 Zimmerkontingenten verwendet.',
                    'usageCount': 2,
                })
                with app.app_context():
                    self.assertIsNotNone(db.session.get(RoomType, self.type_id))
                    self.assertEqual(HotelRoomInventory.query.count(), 2)
                    self.assertEqual(AuditEvent.query.count(), 0)
