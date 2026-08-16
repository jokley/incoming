import os
import sys
import unittest
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'postgresql://incoming:secret@postgres/incoming'
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app, db  # noqa: E402


class HealthCheckTest(unittest.TestCase):
    def test_health_reports_postgresql(self):
        with patch.object(db.session, 'execute'):
            response = app.test_client().get('/health')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'status': 'healthy',
            'databaseBackend': 'postgresql',
        })


if __name__ == '__main__':
    unittest.main()
