import os
import sys
import unittest


database_url = os.environ.get('TEST_DATABASE_URL')
if not database_url:
    raise unittest.SkipTest('TEST_DATABASE_URL is required for database integration tests')
os.environ['DATABASE_URL'] = database_url

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app  # noqa: E402
from models import Event, db  # noqa: E402


class ImportEventIdApiTest(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        with app.app_context():
            db.drop_all()
            db.create_all()
            active = Event(name='WSC Montafon 2027', active=True)
            inactive = Event(name='Inactive', active=False)
            db.session.add_all([active, inactive])
            db.session.commit()
            self.active_id, self.inactive_id = active.id, inactive.id
        self.client = app.test_client()

    def preview(self, event_id_marker=False, event_id=None):
        data = {}
        if event_id_marker:
            data['eventId'] = event_id
        return self.client.post('/api/import/fis/preview', data=data,
                                content_type='multipart/form-data')

    def test_multipart_string_id_is_normalized_before_postgresql_query(self):
        response = self.preview(True, str(self.active_id))
        # The typed event query succeeded; request continues to file-pair validation.
        self.assertEqual(response.status_code, 400)
        self.assertIn('two required FIS Excel files', response.get_json()['error'])

    def test_missing_and_invalid_event_ids_are_structured_400_responses(self):
        missing = self.preview()
        invalid = self.preview(True, 'abc')
        empty = self.preview(True, '')
        self.assertEqual((missing.status_code, missing.get_json()['error']), (400, 'EVENT_REQUIRED'))
        self.assertEqual((empty.status_code, empty.get_json()['error']), (400, 'EVENT_REQUIRED'))
        self.assertEqual((invalid.status_code, invalid.get_json()['error']), (400, 'INVALID_EVENT_ID'))

    def test_unknown_and_inactive_ids_are_controlled(self):
        unknown = self.preview(True, '2147483647')
        inactive = self.preview(True, str(self.inactive_id))
        self.assertEqual((unknown.status_code, unknown.get_json()['error']), (404, 'EVENT_NOT_FOUND'))
        self.assertEqual((inactive.status_code, inactive.get_json()['error']), (422, 'EVENT_INACTIVE'))


if __name__ == '__main__':
    unittest.main()
