"""HTTP coverage for championship administration and event audit parity."""
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
from models import AuditEvent, Competition, db


class EventRoutesTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
            competition = Competition(import_code='legacy', code='legacy', name='Big Air M',
                display_name='Snowboard Big Air', sport='Snowboard', gender='M',
                team_competition=False, quota_discipline='Snowboard Big Air', active=True)
            db.session.add(competition)
            db.session.commit()
            self.competition_id = str(competition.id)
        self.client = app.test_client()
        self.viewer = {'X-Authenticated-User': 'viewer', 'X-Authenticated-Groups': 'incoming-viewer'}
        self.editor = {'X-Authenticated-User': 'editor', 'X-Authenticated-Groups': 'incoming-editor'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    def create_event(self, name, **values):
        response = self.client.post('/api/admin/events', json={'name': name, **values})
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def test_championship_lists_detail_update_and_validation(self):
        self.assertEqual(self.client.post('/api/admin/events', json={'name': '  '}).status_code, 400)
        later = self.create_event(' Later ', year=2028, fisEventId='123', sectorCode='SB')
        earlier = self.create_event('Earlier', year=2027)
        inactive = self.create_event('Inactive', year=2026, active=False)
        self.assertEqual(later, {'id': later['id'], 'name': 'Later', 'year': 2028,
                                'fisEventId': '123', 'sectorCode': 'SB', 'active': True})
        self.assertEqual(self.client.get('/api/championship-events', headers=self.viewer).get_json(),
                         [earlier, later])
        self.assertEqual(self.client.get('/api/admin/events').get_json(), [inactive, earlier, later])
        path = '/api/admin/events/' + later['id']
        self.assertEqual(self.client.get(path).get_json(), {**later, 'competitionMappings': []})
        changes = {'name': 'Updated', 'year': 2029, 'active': False, 'fisEventId': '456', 'sectorCode': 'FS'}
        response = self.client.put(path, json=changes)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {**later, **changes, 'competitionMappings': []})
        self.assertEqual(self.client.get('/api/admin/events/2147483647').status_code, 404)
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)

    def test_mapping_creation_update_copy_and_event_scoping(self):
        source = self.create_event('Source')['id']
        target = self.create_event('Target')['id']
        source_path = f'/api/admin/events/{source}'
        target_path = f'/api/admin/events/{target}'
        payload = {'competitionId': self.competition_id, 'fisCodex': ' 6182 ',
                   'importCode': ' WSC_BA_M ', 'officialName': ' Big Air ', 'active': False}
        self.assertEqual(self.client.post(source_path + '/competitions',
            json={'competitionId': self.competition_id}).status_code, 400)
        self.assertEqual(self.client.post(source_path + '/competitions',
            json={**payload, 'competitionId': 2147483647}).status_code, 404)
        response = self.client.post(source_path + '/competitions', json=payload)
        self.assertEqual(response.status_code, 201)
        original = response.get_json()
        self.assertEqual(original, {'id': original['id'], 'eventId': source,
            'competitionId': self.competition_id, 'fisCodex': '6182', 'importCode': 'WSC_BA_M',
            'officialName': 'Big Air', 'active': False, 'displayName': 'Snowboard Big Air',
            'sport': 'Snowboard', 'gender': 'M', 'quotaDiscipline': 'Snowboard Big Air',
            'teamCompetition': False})
        self.assertEqual(self.client.put(target_path + '/competitions/' + original['id'],
                                        json={'active': True}).status_code, 404)
        for invalid in (None, '', 'abc'):
            response = self.client.post(target_path + '/copy-mappings', json={'sourceEventId': invalid})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()['error'], 'INVALID_EVENT_ID')
        self.assertEqual(self.client.post(target_path + '/copy-mappings',
            json={'sourceEventId': 2147483647}).status_code, 404)
        response = self.client.post(target_path + '/copy-mappings', json={'sourceEventId': source})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['created'], 1)
        copied = response.get_json()['event']['competitionMappings'][0]
        self.assertNotEqual(copied['id'], original['id'])
        self.assertEqual(copied, {**original, 'id': copied['id'], 'eventId': target})
        changes = {'officialName': ' Changed ', 'fisCodex': '9999', 'importCode': 'OTHER', 'active': True}
        response = self.client.put(target_path + '/competitions/' + copied['id'], json=changes)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {**copied, **changes})
        self.assertEqual(self.client.get(source_path).get_json()['competitionMappings'], [original])
        for source_id in (source, target):
            response = self.client.post(target_path + '/copy-mappings', json={'sourceEventId': source_id})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()['created'], 0)
            self.assertEqual(response.get_json()['event']['competitionMappings'], [{**copied, **changes}])
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)

    def test_accommodation_mutation_audit_and_rejected_commands(self):
        payload = {'discipline': 'Big Air', 'startDate': '2027-03-01',
                   'endDate': '2027-03-10', 'personDemand': 10}
        response = self.client.post('/api/events', json=payload, headers=self.editor)
        self.assertEqual(response.status_code, 201)
        event_id = response.get_json()['id']
        path = '/api/events/' + event_id
        self.assertEqual(self.client.put(path, json={'personDemand': 20}, headers=self.editor).status_code, 200)
        self.assertEqual(self.client.post(path + '/demand', json={}, headers=self.editor).status_code, 405)
        self.assertEqual(self.client.delete(path + '/demand/1', headers=self.editor).status_code, 405)
        self.assertEqual(self.client.put(path, json={}, headers=self.viewer).status_code, 403)
        self.assertEqual(self.client.delete(path, headers=self.editor).status_code, 204)
        self.assertEqual(self.client.get('/api/events', headers=self.viewer).get_json(), [])
        with app.app_context():
            rows = AuditEvent.query.order_by(AuditEvent.id).all()
            self.assertEqual([(r.action, r.method, r.path) for r in rows],
                [('create', 'POST', '/api/events'), ('update', 'PUT', path), ('delete', 'DELETE', path)])
            self.assertEqual([r.activity for r in rows], ['Event angelegt', 'Event geändert', 'Event geändert'])
            for row in rows:
                self.assertEqual(row.username, 'editor')
                self.assertEqual(row.entity_type, 'events')
                self.assertEqual(row.entity_id, event_id)
                self.assertEqual(json.loads(row.entity_refs_json), {'eventId': event_id})
            self.assertEqual(json.loads(rows[0].changes_json), payload)
            self.assertEqual(json.loads(rows[1].changes_json), {'personDemand': 20})

    def test_event_surface_has_no_compatibility_aliases_or_slash_variants(self):
        routes = json.loads((Path(__file__).parent / 'fixtures/api_routes.json').read_text())
        event_paths = {p for p in routes if p.startswith(('/api/events', '/api/admin/events',
                                                        '/api/championship-events'))}
        self.assertEqual(len(event_paths), 10)
        registered = {r.rule for r in app.url_map.iter_rules()}
        for path in event_paths:
            self.assertIn(path, registered)
            self.assertNotIn(path + '/', registered)
            self.assertNotIn(path.removeprefix('/api'), registered)


if __name__ == '__main__':
    unittest.main()
