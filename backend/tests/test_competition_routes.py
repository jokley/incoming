"""HTTP contracts for the read-only competition catalogue."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url
os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from models import db, Competition


class CompetitionRoutesTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.viewer = {'X-Authenticated-User': 'viewer',
                       'X-Authenticated-Groups': 'incoming-viewer'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    def test_active_catalogue_serialization_and_sport_then_name_order(self):
        expected = []
        with app.app_context():
            for code, sport, name, active in [('z', 'Snowboard', 'Zulu', True),
                    ('b', 'Freestyle', 'Bravo', True), ('a', 'Freestyle', 'Alpha', True),
                    ('hidden', 'Freestyle', 'A hidden competition', False)]:
                row = Competition(import_code='WSC_' + code, code=code, name=name,
                    display_name=name + ' display', sport=sport, gender='mixed',
                    team_competition=True, quota_discipline='Slopestyle', active=active)
                db.session.add(row)
                db.session.flush()
                if active:
                    expected.append({'id': str(row.id), 'importCode': 'WSC_' + code,
                        'code': code, 'name': name, 'displayName': name + ' display',
                        'sport': sport, 'gender': 'mixed', 'teamCompetition': True,
                        'quotaDiscipline': 'Slopestyle', 'active': True})
            db.session.commit()
        response = self.client.get('/api/competitions', headers=self.viewer)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/json')
        self.assertEqual(response.get_json(), [expected[2], expected[1], expected[0]])

    def test_empty_catalogue(self):
        response = self.client.get('/api/competitions', headers=self.viewer)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), [])

    def test_authentication_and_data_read_permission(self):
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='catalogue-secret'):
            self.assertEqual(self.client.get('/api/competitions').status_code, 401)
            headers = {'X-Auth-Proxy-Secret': 'catalogue-secret',
                       'X-Authenticated-User': 'reader', 'X-Authenticated-Groups': 'unknown'}
            self.assertEqual(self.client.get('/api/competitions', headers=headers).status_code, 403)
            for role in ('incoming-viewer', 'incoming-editor', 'incoming-admin'):
                self.assertEqual(self.client.get('/api/competitions', headers={
                    **headers, 'X-Authenticated-Groups': role}).status_code, 200)
