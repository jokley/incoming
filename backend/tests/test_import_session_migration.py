import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from import_session_migration import migrate_import_sessions


class ImportSessionMigrationTest(unittest.TestCase):
    def test_legacy_sessions_are_consolidated_and_current_version_is_set(self):
        with tempfile.NamedTemporaryFile(suffix='.db') as database:
            connection = sqlite3.connect(database.name)
            connection.executescript('''
                CREATE TABLE import_session (
                    id INTEGER PRIMARY KEY, nation TEXT NOT NULL, discipline TEXT, version INTEGER NOT NULL,
                    status TEXT NOT NULL, preview_token TEXT, preview_json TEXT, uploaded_by TEXT NOT NULL,
                    created_at TEXT NOT NULL, approved_at TEXT, approved_by TEXT, imported_at TEXT,
                    archived_at TEXT, replaced_by_id INTEGER, error_message TEXT,
                    UNIQUE(nation, version));
                CREATE TABLE import_session_version (
                    id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, version INTEGER NOT NULL,
                    preview_token TEXT, preview_json TEXT, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(session_id, version));
                CREATE TABLE import_session_event (
                    id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, event_type TEXT NOT NULL,
                    title TEXT NOT NULL, description TEXT, username TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE import_approval (
                    id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, nation TEXT NOT NULL,
                    approval_type TEXT NOT NULL, description TEXT NOT NULL, decision TEXT NOT NULL,
                    comment TEXT, username TEXT NOT NULL, created_at TEXT NOT NULL);
                INSERT INTO import_session VALUES
                    (1,'CAN','Ski',1,'IMPORTED','a','{}','one','2026-01-01',NULL,NULL,NULL,NULL,NULL,NULL),
                    (2,'CAN','Ski',2,'DRAFT','b','{}','two','2026-02-01',NULL,NULL,NULL,NULL,NULL,NULL);
                INSERT INTO import_session_version VALUES
                    (10,1,1,'a','{}','one','2026-01-01'),
                    (20,2,1,'b','{}','two','2026-02-01');
                INSERT INTO import_session_event VALUES
                    (1,1,'IMPORTED','Importiert',NULL,'one','2026-01-01');
            ''')
            connection.commit(); connection.close()

            migrate_import_sessions(database.name)

            connection = sqlite3.connect(database.name)
            self.assertEqual(connection.execute(
                'SELECT id,nation,status,current_version_id FROM import_session').fetchall(),
                [(2, 'CAN', 'DRAFT', 20)])
            self.assertEqual(connection.execute(
                'SELECT session_id,version FROM import_session_version ORDER BY version').fetchall(),
                [(2, 1), (2, 2)])
            self.assertEqual(connection.execute(
                'SELECT session_id,version_id FROM import_session_event').fetchall(), [(2, 10)])
            columns = {row[1] for row in connection.execute('PRAGMA table_info(import_session)')}
            self.assertNotIn('version', columns)
            connection.close()


if __name__ == '__main__':
    unittest.main()
