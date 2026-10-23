"""Ownership invariants and explicit single-operational-event compatibility."""
from flask import current_app, g, has_app_context, has_request_context
from sqlalchemy import inspect


class OperationalEventError(ValueError):
    pass


def configured_event_id():
    value = current_app.config.get('OPERATIONAL_EVENT_ID') if has_app_context() else None
    if value is None or str(value).strip() == '':
        raise OperationalEventError('OPERATIONAL_EVENT_ID must explicitly identify the single operational championship')
    raw = str(value).strip()
    if not raw.isascii() or not raw.isdigit() or int(raw) <= 0:
        raise OperationalEventError('OPERATIONAL_EVENT_ID must be a positive integer')
    return int(raw)


def validate_operational_import_event(value):
    """Normalize request ownership and honor an explicit single-event deployment."""
    from imports.event_context import normalize_event_id
    selected = normalize_event_id(value)
    configured = current_app.config.get('OPERATIONAL_EVENT_ID') if has_app_context() else None
    if configured is not None and str(configured).strip():
        if selected != configured_event_id():
            raise OperationalEventError('A second operational event is disabled until backend isolation is complete')
    return selected



def apply_event_ownership(session, flush_context, instances):
    """Guard unit-of-work writes, including deletions and inherited ownership."""
    from imports.event_context import normalize_event_id
    from models import (Athlete, RoomBooking, ImportSession, HotelRoomInventory,
        AccommodationEvent, ImportRun, RoomBookingOccupant, RoomAssignment,
        FisRoomAssignment, EventRoomDemand)
    required = (Athlete, RoomBooking, ImportSession, HotelRoomInventory, AccommodationEvent, ImportRun)
    objects = session.new.union(session.dirty).union(session.deleted)
    allowed = None
    if has_request_context() and any(isinstance(o, required + (RoomBookingOccupant, RoomAssignment, FisRoomAssignment, EventRoomDemand)) for o in objects):
        from accommodation_scope import accommodation_event_id
        allowed = accommodation_event_id()

    for obj in objects:
        if not isinstance(obj, required):
            continue
        field = 'championship_event_id' if isinstance(obj, AccommodationEvent) else 'event_id'
        owner = getattr(obj, field)
        if obj in session.new and owner is None:
            if allowed is not None:
                owner = allowed
            elif has_app_context() and current_app.config.get('OPERATIONAL_EVENT_ID'):
                owner = configured_event_id()
            if owner is not None:
                setattr(obj, field, owner)
        if owner is not None:
            owner = normalize_event_id(owner)
            setattr(obj, field, owner)
        if allowed is not None and owner != allowed:
            raise OperationalEventError('Object does not belong to the authorized event; a second operational event is disabled')
        history = inspect(obj).attrs[field].history
        if inspect(obj).persistent and history.has_changes():
            if history.deleted:
                previous = history.deleted[0]
            else:
                from sqlalchemy import select
                table = obj.__table__
                previous = session.connection().execute(select(table.c[field]).where(table.c.id == obj.id)).scalar_one()
            if normalize_event_id(previous) != owner:
                raise OperationalEventError('Existing operational ownership cannot be reassigned')

    def related(obj, relation, field, model):
        # FK assignment and relationship assignment must both be safe, even when
        # the old relationship was already in the identity map before an FK edit.
        history = inspect(obj).attrs[relation].history
        if history.added:
            return history.added[0]
        identity = getattr(obj, field)
        return session.get(model, identity) if identity is not None else getattr(obj, relation)

    def check(*parents):
        owners = {normalize_event_id(p.event_id) for p in parents if p is not None and p.event_id is not None}
        if len(owners) > 1 or (allowed is not None and owners - {allowed}):
            raise OperationalEventError('Accommodation occupants and relationships must belong to the authorized event')

    for obj in objects:
        if isinstance(obj, RoomBookingOccupant):
            check(related(obj, 'athlete', 'athlete_id', Athlete), related(obj, 'room_booking', 'room_booking_id', RoomBooking))
        elif isinstance(obj, RoomAssignment):
            check(related(obj, 'athlete', 'athlete_id', Athlete), related(obj, 'shared_with', 'shared_with_athlete_id', Athlete))
        elif isinstance(obj, FisRoomAssignment):
            check(related(obj, 'person1', 'person1_id', Athlete), related(obj, 'person2', 'person2_id', Athlete))
        elif isinstance(obj, EventRoomDemand):
            parent = related(obj, 'event', 'event_id', AccommodationEvent)
            if parent is not None and allowed is not None and normalize_event_id(parent.championship_event_id) != allowed:
                raise OperationalEventError('Room demand does not belong to the authorized event')


def require_isolated_legacy_database(app):
    """Destructive obsolete bootstrap utilities are never operational entry points."""
    if app.config.get('RUNTIME_ENV') != 'test':
        raise OperationalEventError('Legacy bootstrap/reset utilities require the isolated test database')
    from test_support import postgres_test_url, validate_test_url
    from models import db
    with app.app_context():
        expected = postgres_test_url()
        actual = validate_test_url(db.engine.url.render_as_string(hide_password=False), 'test')
        if expected != actual:
            raise OperationalEventError('Legacy bootstrap target differs from the isolated test database')
