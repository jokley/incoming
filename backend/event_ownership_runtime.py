"""Ownership invariants and explicit single-operational-event compatibility."""
from flask import current_app, g, has_app_context, has_request_context, request, abort
from sqlalchemy import inspect


class OperationalEventError(ValueError):
    pass


def configured_event_id():
    # Within HTTP, every old resolver call resolves the authorized request owner.
    if has_request_context() and getattr(g, 'authorized_event_id', None) is not None:
        return g.authorized_event_id
    return deployment_event_id()


def deployment_event_id():
    value = current_app.config.get('OPERATIONAL_EVENT_ID') if has_app_context() else None
    if value is None or str(value).strip() == '':
        raise OperationalEventError('OPERATIONAL_EVENT_ID must explicitly identify the single operational championship')
    raw = str(value).strip()
    if not raw.isascii() or not raw.isdigit() or int(raw) <= 0:
        raise OperationalEventError('OPERATIONAL_EVENT_ID must be a positive integer')
    return int(raw)


def authorize_event(value, *, write=False, respect_pin=True, active=True, allow_superadmin=True):
    """Role checks remain app-wide. Grants never imply functional permissions."""
    from auth import current_user
    from imports.event_context import normalize_event_id
    from models import db, Event, EventAccess
    owner = normalize_event_id(value)
    user = current_user()
    if user is None:
        abort(401)
    if respect_pin and current_app.config.get('OPERATIONAL_EVENT_ID'):
        if owner != deployment_event_id():
            raise OperationalEventError('Request conflicts with the pinned championship')
    if allow_superadmin and user.is_superadmin:
        query = db.session.query(Event.id).filter(Event.id == owner)
        if active:
            query = query.filter(Event.active.is_(True))
        if query.first() is None:
            abort(403, description='Championship access not granted')
        return owner
    # SELECT scalar columns: do not reuse grants from an ORM identity map.
    grant = db.session.query(EventAccess.can_write).join(Event).filter(
        EventAccess.username == user.username, EventAccess.event_id == owner,
        *([Event.active.is_(True)] if active else [])).first()
    if grant is None or (write and not grant.can_write):
        abort(403, description='Championship access not granted')
    return owner


def bind_request_event():
    """One immutable request context, shared by imports, reads and ORM guards."""
    value = request.headers.get('X-Championship-Event-ID')
    if value is None:
        value = deployment_event_id()  # No owner inference from object IDs.
    write = request.method not in {'GET', 'HEAD', 'OPTIONS'} and getattr(g, 'api_path', '') != '/api/assignments/availability'
    owner = authorize_event(value, write=write,
        active=not getattr(g, 'api_path', '').startswith('/api/admin/events/'))
    g.authorized_event_id = owner
    return owner


def validate_operational_import_event(value):
    """Normalize request ownership and honor an explicit single-event deployment."""
    from imports.event_context import normalize_event_id
    selected = normalize_event_id(value)
    if has_request_context() and hasattr(g, 'authorized_event_id'):
        owner = getattr(g, 'authorized_event_id', None)
        if owner is None:
            owner = bind_request_event()
        if selected != owner:
            raise OperationalEventError('Object and authorized request event differ')
        return selected
    configured = current_app.config.get('OPERATIONAL_EVENT_ID') if has_app_context() else None
    if configured is not None and str(configured).strip():
        if selected != deployment_event_id():
            raise OperationalEventError('A second operational event is disabled until backend isolation is complete')
    return selected



def apply_event_ownership(session, flush_context, instances):
    """Guard unit-of-work writes, including deletions and inherited ownership."""
    from imports.event_context import normalize_event_id
    from models import (Athlete, RoomBooking, ImportSession, HotelRoomInventory,
        AccommodationEvent, ImportRun, RoomBookingOccupant, RoomAssignment,
        FisRoomAssignment, EventRoomDemand, WorldChampion, ImportSessionVersion, ImportApproval, ImportSessionEvent)
    required = (Athlete, RoomBooking, ImportSession, HotelRoomInventory, AccommodationEvent, ImportRun, WorldChampion)
    children = (ImportSessionVersion, ImportApproval, ImportSessionEvent)
    objects = session.new.union(session.dirty).union(session.deleted)
    allowed = None
    if has_request_context() and any(isinstance(o, required + children + (RoomBookingOccupant, RoomAssignment, FisRoomAssignment, EventRoomDemand)) for o in objects):
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
        if isinstance(obj, children) and allowed is not None:
            parent = related(obj, 'session', 'session_id', ImportSession)
            if parent is None or parent.event_id != allowed:
                raise OperationalEventError('Import evidence belongs to another event')
            for field, model in (('version_id', ImportSessionVersion), ('approval_id', ImportApproval)):
                identity = getattr(obj, field, None)
                linked = session.get(model, identity) if identity is not None else None
                if linked is not None and linked.session_id != parent.id:
                    raise OperationalEventError('Import evidence belongs to another session')
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
