"""One-time SQLite migration to the single-session import model."""
from __future__ import annotations

import sqlite3
from collections import defaultdict


def migrate_import_sessions(database_path: str) -> None:
    """Collapse legacy per-version sessions and remove ImportSession.version."""
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        columns = {row['name'] for row in connection.execute("PRAGMA table_info(import_session)")}
        if not columns or 'version' not in columns:
            return
        connection.execute('PRAGMA foreign_keys = OFF')
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('''
            CREATE TABLE import_session_migrated (
                id INTEGER PRIMARY KEY, nation VARCHAR(10) NOT NULL UNIQUE,
                discipline VARCHAR(100), status VARCHAR(30) NOT NULL,
                current_version_id INTEGER, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL, approved_at DATETIME, approved_by VARCHAR(100),
                imported_at DATETIME, archived_at DATETIME, replaced_by_id INTEGER,
                error_message TEXT, FOREIGN KEY(current_version_id) REFERENCES import_session_version(id),
                FOREIGN KEY(replaced_by_id) REFERENCES import_session(id)
            )
        ''')
        legacy = connection.execute('SELECT * FROM import_session ORDER BY created_at, id').fetchall()
        by_nation: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in legacy:
            by_nation[row['nation']].append(row)

        event_columns = {row['name'] for row in connection.execute("PRAGMA table_info(import_session_event)")}
        approval_columns = {row['name'] for row in connection.execute("PRAGMA table_info(import_approval)")}
        version_columns = {row['name'] for row in connection.execute("PRAGMA table_info(import_session_version)")}
        if 'version_id' not in event_columns:
            connection.execute('ALTER TABLE import_session_event ADD COLUMN version_id INTEGER')
        if 'version_id' not in approval_columns:
            connection.execute('ALTER TABLE import_approval ADD COLUMN version_id INTEGER')
        if 'entries_filename' not in version_columns:
            connection.execute('ALTER TABLE import_session_version ADD COLUMN entries_filename VARCHAR(255)')
        if 'room_filename' not in version_columns:
            connection.execute('ALTER TABLE import_session_version ADD COLUMN room_filename VARCHAR(255)')

        for nation, sessions in by_nation.items():
            canonical = sessions[-1]
            canonical_id = canonical['id']
            legacy_ids = [row['id'] for row in sessions]
            placeholders = ','.join('?' for _ in legacy_ids)
            # Free the old per-session version numbers before consolidating them under
            # one session, otherwise the existing UNIQUE(session_id, version) can fire
            # halfway through the migration.
            connection.execute(
                f'UPDATE import_session_version SET version = -id WHERE session_id IN ({placeholders})',
                legacy_ids,
            )
            versions_by_session = {
                old['id']: [item['id'] for item in connection.execute(
                    'SELECT id FROM import_session_version WHERE session_id = ? ORDER BY created_at, id',
                    (old['id'],),
                ).fetchall()]
                for old in sessions
            }
            next_number = 1
            latest_version_id = None
            for old in sessions:
                version_ids = versions_by_session[old['id']]
                if not version_ids:
                    cursor = connection.execute('''
                        INSERT INTO import_session_version
                            (session_id, version, preview_token, preview_json, uploaded_by, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', (canonical_id, next_number, old['preview_token'], old['preview_json'],
                          old['uploaded_by'], old['created_at']))
                    version_ids = [cursor.lastrowid]
                else:
                    for version_id in version_ids:
                        connection.execute(
                            'UPDATE import_session_version SET session_id = ?, version = ? WHERE id = ?',
                            (canonical_id, next_number, version_id),
                        )
                        next_number += 1
                    next_number -= 1
                latest_version_id = version_ids[-1]
                connection.execute(
                    'UPDATE import_session_event SET session_id = ?, version_id = COALESCE(version_id, ?) WHERE session_id = ?',
                    (canonical_id, latest_version_id, old['id']),
                )
                connection.execute(
                    'UPDATE import_approval SET session_id = ?, version_id = COALESCE(version_id, ?) WHERE session_id = ?',
                    (canonical_id, latest_version_id, old['id']),
                )
                next_number += 1

            connection.execute('''
                INSERT INTO import_session_migrated
                    (id, nation, discipline, status, current_version_id, created_at, updated_at,
                     approved_at, approved_by, imported_at, archived_at, replaced_by_id, error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            ''', (canonical_id, nation, canonical['discipline'], canonical['status'], latest_version_id,
                  sessions[0]['created_at'], canonical['created_at'], canonical['approved_at'],
                  canonical['approved_by'], canonical['imported_at'], canonical['archived_at'],
                  canonical['error_message']))

        connection.execute('DROP TABLE import_session')
        connection.execute('ALTER TABLE import_session_migrated RENAME TO import_session')
        connection.execute('CREATE INDEX ix_import_session_status ON import_session(status)')
        connection.execute('CREATE UNIQUE INDEX ix_import_session_nation ON import_session(nation)')
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
