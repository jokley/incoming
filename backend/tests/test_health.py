import os
import sys
import tempfile
import unittest


DB_FILE = tempfile.NamedTemporaryFile(suffix='.db', delete=False).name
os.environ['DATABASE_BACKEND'] = 'sqlite'
os.environ['DATABASE_PATH'] = DB_FILE
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app  # noqa: E402


class HealthCheckTest(unittest.TestCase):
    def test_health_reports_selected_database_backend(self):
        response = app.test_client().get('/health')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'status': 'healthy',
            'databaseBackend': 'sqlite',
        })


if __name__ == '__main__':
    unittest.main()
