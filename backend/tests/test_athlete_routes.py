"""Characterize roomlist acknowledgement before moving the person routes."""
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url

os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from models import Athlete, AuditEvent, db


class AthleteRoutesTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
            athlete = Athlete(firstname='Ada', lastname='Test', nation_code='AUT',
                roomlist_changed_at=datetime(2026, 1, 1), roomlist_change_summary='Stay changed')
            db.session.add(athlete)
            db.session.commit()
            self.athlete_id = athlete.id
        self.client = app.test_client()
        self.path = f'/api/athletes/{self.athlete_id}/acknowledge-roomlist-change'

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    @staticmethod
    def headers(role):
        return {'X-Authenticated-User': role, 'X-Authenticated-Groups': 'incoming-' + role}

    def test_success_and_repeated_acknowledgement_preserve_payload_and_audit_for_both_paths(self):
        for suffix in ('', '/'):
            for role in ('editor', 'admin'):
                with self.subTest(suffix=suffix, role=role):
                    # Already-acknowledged changes are accepted again, not a no-op.
                    old_ack = datetime(2026, 1, 2)
                    with app.app_context():
                        athlete = db.session.get(Athlete, self.athlete_id)
                        athlete.roomlist_change_acknowledged_at = old_ack if role == 'admin' else None
                        athlete.roomlist_change_acknowledged_summary = 'Previous summary'
                        db.session.commit()
                        expected = athlete.to_dict()
                        before_count = AuditEvent.query.count()
                    start = datetime.utcnow()
                    response = self.client.post(self.path + suffix, headers=self.headers(role))
                    end = datetime.utcnow()
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.mimetype, 'application/json')
                    payload = response.get_json()
                    acknowledged = datetime.fromisoformat(payload['roomlistChangeAcknowledgedAt'])
                    self.assertLessEqual(start, acknowledged)
                    self.assertLessEqual(acknowledged, end)
                    self.assertEqual(payload, {**expected,
                        'roomlistChangeAcknowledgedAt': acknowledged.isoformat(),
                        'roomlistChangeAcknowledgedSummary': 'Stay changed',
                        'hasPendingRoomlistReview': False})
                    with app.app_context():
                        athlete = db.session.get(Athlete, self.athlete_id)
                        self.assertEqual(athlete.roomlist_change_acknowledged_at, acknowledged)
                        self.assertEqual(athlete.roomlist_change_acknowledged_summary, 'Stay changed')
                        self.assertEqual(AuditEvent.query.count(), before_count + 1)
                        audit = AuditEvent.query.order_by(AuditEvent.id.desc()).first()
                        self.assertEqual((audit.action, audit.activity, audit.entity_type),
                                         ('create', 'Athlet angelegt', 'athletes'))
                        self.assertEqual((audit.path, audit.method, audit.username),
                                         (self.path + suffix, 'POST', role))
                        self.assertEqual(audit.entity_label, 'Ada Test')
                        self.assertEqual(audit.entity_id, str(self.athlete_id))
                        self.assertEqual(json.loads(audit.entity_refs_json),
                                         {'personId': str(self.athlete_id)})
                        self.assertIsNone(audit.changes_json)
                        self.assertEqual(response.headers['X-Request-ID'], audit.request_id)

    def test_missing_change_and_missing_person_do_not_audit(self):
        with app.app_context():
            athlete = db.session.get(Athlete, self.athlete_id)
            athlete.roomlist_changed_at = None
            db.session.commit()
        for suffix in ('', '/'):
            response = self.client.post(self.path + suffix, headers=self.headers('editor'))
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json(), {'error': 'No roomlist change to acknowledge'})
            response = self.client.post('/api/athletes/2147483647/acknowledge-roomlist-change' + suffix,
                                        headers=self.headers('editor'))
            self.assertEqual(response.status_code, 404)
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)
            self.assertIsNone(db.session.get(Athlete, self.athlete_id).roomlist_change_acknowledged_at)

    def test_acknowledgement_requires_authentication_and_write_permission(self):
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='athlete-test'):
            for suffix in ('', '/'):
                for headers, status, error in (({}, 401, 'UNAUTHENTICATED'),
                        (self.headers('viewer'), 403, 'FORBIDDEN'),
                        (self.headers('unknown'), 403, 'FORBIDDEN')):
                    with self.subTest(suffix=suffix, status=status, headers=headers):
                        headers = {**headers, 'X-Auth-Proxy-Secret': 'athlete-test'}
                        response = self.client.post(self.path + suffix, headers=headers)
                        self.assertEqual(response.status_code, status)
                        self.assertEqual(response.get_json()['error'], error)
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)
            self.assertIsNone(db.session.get(Athlete, self.athlete_id).roomlist_change_acknowledged_at)


if __name__ == '__main__':
    unittest.main()
