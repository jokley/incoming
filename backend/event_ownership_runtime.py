"""Single-operational-event compatibility, not a multi-event query isolation layer."""
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
    from models import Athlete, RoomBooking, ImportSession, HotelRoomInventory, AccommodationEvent, ImportRun, RoomBookingOccupant
    required = (Athlete, RoomBooking, ImportSession, HotelRoomInventory, AccommodationEvent)
    # Direct model/administrative writes must supply explicit ownership. API compatibility
    # fills only from an explicitly configured event, never from a first/active DB row.
    for obj in session.new.union(session.dirty):
        if isinstance(obj, required) or isinstance(obj, ImportRun):
            field = 'championship_event_id' if isinstance(obj, AccommodationEvent) else 'event_id'
            owner = getattr(obj, field)
            if obj in session.new and owner is None and has_app_context() and current_app.config.get('OPERATIONAL_EVENT_ID'):
                owner = configured_event_id()
                setattr(obj, field, owner)
            if has_request_context():
                allowed = (getattr(g, 'import_event_id', None) if isinstance(obj, (Athlete, ImportSession, ImportRun)) else None)
                if allowed is None:
                    allowed = configured_event_id()
                else:
                    allowed = validate_operational_import_event(allowed)
                if owner != allowed:
                    raise OperationalEventError('A second operational event is disabled until backend isolation is complete')
    # Do not permit mixed-event room memberships even through a direct ORM write.
    for obj in session.new.union(session.dirty):
        if isinstance(obj, RoomBookingOccupant):
            person = obj.athlete or session.get(Athlete, obj.athlete_id)
            booking = obj.room_booking or session.get(RoomBooking, obj.room_booking_id)
            if person and booking and person.event_id != booking.event_id:
                raise OperationalEventError('Booking occupants must belong to the booking event')
        elif isinstance(obj, (Athlete, RoomBooking)) and session.is_modified(obj, include_collections=False):
            state = inspect(obj)
            if state.persistent and state.attrs.event_id.history.has_changes():
                raise OperationalEventError('Existing operational ownership cannot be reassigned')
