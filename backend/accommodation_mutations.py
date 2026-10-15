"""Shared transaction lock for accommodation writes, including legacy routes."""
from sqlalchemy import text
from models import db


def lock_accommodation_writes():
    # Transaction-scoped serialization avoids person/room check-then-write races.
    # Deliberately coarse for the first split-stay rollout; no schema needed.
    if db.session.get_bind().dialect.name == 'postgresql':
        db.session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': 701027001})


def physical_room_usage(bookings):
    """Coalesce non-overlapping uses of a named room; retain conflicts conservatively.

    Only booking-write validation uses this adapter, not overview/quota counters.
    Unnamed rooms keep independent identities. Overlapping duplicates still count.
    """
    from app import _planned_room_key
    groups = {}
    for booking in bookings:
        key = _planned_room_key(booking.room_number) or (booking.room_number or '').strip()
        groups.setdefault(key or ('booking', booking.id), []).append(booking)
    count = 0
    for rows in groups.values():
        ends = []
        for row in sorted(rows, key=lambda b: (b.check_in_date, b.check_out_date, b.id)):
            reusable = next((i for i, end in enumerate(ends) if end <= row.check_in_date), None)
            if reusable is None:
                ends.append(row.check_out_date)
            else:
                ends[reusable] = row.check_out_date
        count += len(ends)
    return count
