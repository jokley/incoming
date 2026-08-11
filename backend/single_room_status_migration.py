"""Idempotent migration for the person-owned single-room business status."""

from sqlalchemy import text


def migrate_single_room_status(db):
    """Add and backfill status columns without changing legacy relationships."""
    columns = {row[1] for row in db.session.execute(text('PRAGMA table_info(athlete)')).fetchall()}
    status_added = 'single_room_status' not in columns
    if status_added:
        db.session.execute(text(
            "ALTER TABLE athlete ADD COLUMN single_room_status VARCHAR(30) NOT NULL DEFAULT 'NONE'"
        ))
    if 'single_room_decision_id' not in columns:
        db.session.execute(text('ALTER TABLE athlete ADD COLUMN single_room_decision_id INTEGER'))

    if status_added:
        # Preserve the business result already persisted by earlier releases.
        db.session.execute(text("""
            UPDATE athlete
               SET single_room_status = CASE single_room_entitlement
                   WHEN 'IN_QUOTA' THEN 'IN_QUOTA'
                   WHEN 'APPROVED_EXTRA' THEN 'APPROVED_EXTRA'
                   ELSE 'NONE'
               END
        """))
    db.session.commit()
