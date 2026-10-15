"""Shared transaction lock for accommodation writes, including legacy routes."""
from sqlalchemy import text
from models import db


def lock_accommodation_writes():
    # Transaction-scoped serialization avoids person/room check-then-write races.
    # Deliberately coarse for the first split-stay rollout; no schema needed.
    if db.session.get_bind().dialect.name == 'postgresql':
        db.session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': 701027001})
