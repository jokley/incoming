"""Identity serialization and audit-list HTTP contracts; hooks remain global."""
from datetime import datetime
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url
os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from auth import ROLE_PERMISSIONS
from models import db, AuditEvent


class IdentityAuditReadRoutesTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        app.config.update(AUTH_DEV_USER='', AUTH_PROXY_SECRET='read-secret')
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.headers = {'X-Auth-Proxy-Secret': 'read-secret', 'X-Authenticated-User': 'reader',
                        'X-Authenticated-Groups': 'incoming-editor'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    def seed(self):
        expected = []
        with app.app_context():
            for day, user, action, entity in [(1, 'alice', 'create', 'hotels'),
                    (3, 'alice', 'update', 'hotels'), (2, 'bob', 'update', 'athletes')]:
                row = AuditEvent(created_at=datetime(2027, 3, day, 12, 30), username=user,
                    display_name='Alice' if day == 1 else None, email=None,
                    groups_json='["incoming-editor"]', action=action, entity_type=entity,
                    entity_id='42' if day == 1 else None, request_id='request-' + str(day),
                    method='POST' if day == 1 else 'PUT', path='/api/' + entity,
                    changes_json='{"name":"Updated"}' if day == 1 else None,
                    activity='Changed' if day == 1 else None, category=None, entity_label=None,
                    details_json='["detail"]' if day == 1 else None,
                    entity_refs_json='{"hotelId":"42"}' if day == 1 else '{}')
                db.session.add(row)
                db.session.flush()
                expected.append({'id': str(row.id), 'createdAt': f'2027-03-{day:02d}T12:30:00Z',
                    'username': user, 'displayName': 'Alice' if day == 1 else None, 'email': None,
                    'groups': ['incoming-editor'], 'action': action, 'entityType': entity,
                    'entityId': '42' if day == 1 else None, 'requestId': 'request-' + str(day),
                    'method': 'POST' if day == 1 else 'PUT', 'path': '/api/' + entity,
                    'changes': {'name': 'Updated'} if day == 1 else None,
                    'activity': 'Changed' if day == 1 else None, 'category': None, 'entityLabel': None,
                    'details': ['detail'] if day == 1 else [],
                    'entityRefs': {'hotelId': '42'} if day == 1 else {}})
            db.session.commit()
        return [expected[1], expected[2], expected[0]]

    def audit(self, query=None):
        response = self.client.get('/api/audit-events', query_string=query, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/json')
        return response.get_json()

    def test_identity_serialization_and_unknown_role_without_permissions(self):
        response = self.client.get('/api/auth/me', headers={**self.headers,
            'X-Authenticated-Name': 'Reader Name', 'X-Authenticated-Email': 'reader@example.test',
            'X-Authenticated-Groups': 'incoming-viewer;incoming-editor|incoming-viewer'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'username': 'reader', 'displayName': 'Reader Name',
            'email': 'reader@example.test', 'groups': ['incoming-editor', 'incoming-viewer'],
            'permissions': ['assignments.write', 'audit.read', 'data.read', 'data.write', 'imports.write']})
        response = self.client.get('/api/auth/me', headers={**self.headers,
            'X-Authenticated-Groups': 'unknown'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'username': 'reader', 'displayName': 'reader',
            'email': '', 'groups': ['unknown'], 'permissions': []})
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)

    def test_authentication_and_distinct_audit_permission(self):
        for path in ('/api/auth/me', '/api/audit-events'):
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path, headers={**self.headers,
                'X-Auth-Proxy-Secret': 'wrong'}).status_code, 401)
        for role in ('incoming-viewer', 'unknown'):
            response = self.client.get('/api/audit-events', headers={**self.headers,
                'X-Authenticated-Groups': role})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.get_json(), {'error': 'FORBIDDEN', 'message': 'Insufficient permissions'})
        with patch.dict(ROLE_PERMISSIONS, {'incoming-editor': {'audit.read'}}):
            self.assertEqual(self.audit()['items'], [])

    def test_audit_serialization_newest_first_and_no_read_audit(self):
        expected = self.seed()
        self.assertEqual(self.audit(), {'items': expected, 'page': 1, 'perPage': 50, 'total': 3, 'pages': 1})
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 3)

    def test_audit_exact_filters_and_combined_filters(self):
        rows = self.seed()
        for query, expected in [({'username': 'alice'}, [rows[0], rows[2]]),
                ({'action': 'update'}, rows[:2]), ({'entityType': 'athletes'}, [rows[1]]),
                ({'username': 'alice', 'action': 'update', 'entityType': 'hotels'}, [rows[0]]),
                ({'username': 'Alice'}, []), ({'username': '', 'action': '', 'entityType': ''}, rows)]:
            with self.subTest(query=query):
                payload = self.audit(query)
                self.assertEqual(payload['items'], expected)
                self.assertEqual(payload['total'], len(expected))

    def test_audit_pagination_clamps_defaults_and_out_of_range(self):
        rows = self.seed()
        for query, page, per_page, items, pages in [
                ({'page': 2, 'perPage': 2}, 2, 2, rows[2:], 2),
                ({'page': 99, 'perPage': 2}, 99, 2, [], 2),
                ({'page': -5, 'perPage': 0}, 1, 1, rows[:1], 3),
                ({'page': 'bad', 'perPage': 'bad'}, 1, 50, rows, 1),
                ({'perPage': 999}, 1, 200, rows, 1)]:
            with self.subTest(query=query):
                self.assertEqual(self.audit(query), {'items': items, 'page': page,
                    'perPage': per_page, 'total': 3, 'pages': pages})

    def test_audit_empty_result(self):
        self.assertEqual(self.audit(), {'items': [], 'page': 1, 'perPage': 50, 'total': 0, 'pages': 0})
