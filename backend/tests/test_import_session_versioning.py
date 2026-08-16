import os
import sys
import unittest

from flask import Flask
from sqlalchemy.exc import IntegrityError

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from models import db, ImportSession, ImportSessionEvent, ImportSessionVersion


class ImportSessionVersioningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database_url = os.environ.get('TEST_DATABASE_URL')
        if not database_url:
            raise unittest.SkipTest('TEST_DATABASE_URL is required for database integration tests')
        cls.app = Flask(__name__)
        cls.app.config.update(SQLALCHEMY_DATABASE_URI=database_url,
                              SQLALCHEMY_TRACK_MODIFICATIONS=False)
        db.init_app(cls.app)

    def setUp(self):
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def add_version(self, session, username='tester'):
        version = ImportSessionVersion(session_id=session.id,
            version=session.next_version_number(), uploaded_by=username)
        db.session.add(version)
        db.session.flush()
        session.current_version = version
        db.session.commit()
        return version

    def test_new_session_receives_versions_one_two_and_three(self):
        session = ImportSession(nation='CAN', status='DRAFT')
        db.session.add(session); db.session.commit()

        versions = [self.add_version(session).version for _ in range(3)]

        self.assertEqual(versions, [1, 2, 3])
        self.assertEqual(session.current_version.version, 3)
        self.assertEqual(session.to_dict()['version'], 3)

    def test_nations_are_independent_and_session_nation_is_unique(self):
        canada = ImportSession(nation='CAN', status='DRAFT')
        austria = ImportSession(nation='AUT', status='DRAFT')
        db.session.add_all([canada, austria]); db.session.commit()

        self.assertEqual(self.add_version(canada).version, 1)
        self.assertEqual(self.add_version(austria).version, 1)
        with self.assertRaises(IntegrityError):
            db.session.add(ImportSession(nation='CAN', status='DRAFT'))
            db.session.commit()
        db.session.rollback()

    def test_completed_session_keeps_version_linked_history(self):
        session = ImportSession(nation='SUI', status='IMPORTED')
        db.session.add(session); db.session.commit()
        version = self.add_version(session)
        db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id,
            event_type='IMPORTED', title='Importiert', username='tester'))
        db.session.commit()

        serialized = session.to_dict()
        self.assertEqual(serialized['history'][0]['versionId'], str(version.id))
        self.assertEqual(serialized['version'], 1)

    def test_same_version_number_is_allowed_for_different_nations(self):
        sessions = [ImportSession(nation=nation, status='DRAFT') for nation in ('CAN', 'AUT')]
        db.session.add_all(sessions); db.session.commit()

        for session in sessions:
            self.add_version(session)

        self.assertEqual(ImportSessionVersion.query.filter_by(version=1).count(), 2)


if __name__ == '__main__':
    unittest.main()
