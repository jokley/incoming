"""Event-scoped accommodation access using the existing ownership resolver.

Hotels/RoomTypes stay global. Query helpers also constrain relationship loading;
no global session filter can accidentally change import snapshot Core SQL.
"""
from flask import abort, g, has_request_context, request
from sqlalchemy import or_
from sqlalchemy.orm import with_loader_criteria
from event_ownership_runtime import configured_event_id, validate_operational_import_event, OperationalEventError


def accommodation_event_id():
    from imports.event_context import normalize_event_id
    selected = getattr(g, 'import_event_id', None) if has_request_context() else None
    owner = validate_operational_import_event(selected) if selected is not None else configured_event_id()
    if has_request_context():
        from models import db, Event
        if getattr(g, '_validated_accommodation_owner', None) != owner:
            event = db.session.get(Event, owner)
            if event is None or not event.active:
                raise OperationalEventError('Operational event is missing or inactive')
            g._validated_accommodation_owner = owner
            g._quota_event_record = event
        data = request.get_json(silent=True)
        values = [request.args.get('eventId'), request.args.get('championshipEventId')]
        if isinstance(data, dict):
            values += [data.get('eventId'), data.get('championshipEventId')]
        for value in values:
            if value is not None and normalize_event_id(value) != owner:
                raise OperationalEventError('Request event conflicts with the authorized operational event')
    return owner


def ownership_clause(model, owner):
    from models import (Athlete, RoomBooking, RoomBookingOccupant, HotelRoomInventory,
        AccommodationEvent, EventRoomDemand, RoomAssignment, FisRoomAssignment, ImportRun, ImportSession, WorldChampion)
    if model is AccommodationEvent:
        return model.championship_event_id == owner
    if model in (Athlete, RoomBooking, HotelRoomInventory, ImportRun, ImportSession, WorldChampion):
        return model.event_id == owner
    if model is RoomBookingOccupant:
        return model.room_booking.has(RoomBooking.event_id == owner) & model.athlete.has(Athlete.event_id == owner)
    if model is EventRoomDemand:
        return model.event.has(AccommodationEvent.championship_event_id == owner)
    if model is RoomAssignment:
        return model.athlete.has(Athlete.event_id == owner) & or_(model.shared_with_athlete_id.is_(None), model.shared_with.has(Athlete.event_id == owner))
    if model is FisRoomAssignment:
        return model.person1.has(Athlete.event_id == owner) & or_(model.person2_id.is_(None), model.person2.has(Athlete.event_id == owner))
    return None


def event_query(model):
    from models import RoomBooking, HotelRoomInventory, AccommodationEvent, EventRoomDemand, RoomAssignment, FisRoomAssignment, Hotel
    owner = accommodation_event_id()
    query = model.query
    clause = ownership_clause(model, owner)
    if clause is not None:
        query = query.filter(clause)
    for related in (RoomBooking, HotelRoomInventory, AccommodationEvent, EventRoomDemand, RoomAssignment, FisRoomAssignment):
        query = query.options(with_loader_criteria(related, ownership_clause(related, owner), include_aliases=True))
    # A global Hotel may already be cached by a prior administrative lookup.
    # Refresh its event-dependent collections instead of reusing that cache.
    if model is Hotel:
        query = query.populate_existing()
    return query


def event_get(model, identity, *, required=False):
    row = event_query(model).filter(model.id == identity).first()
    if row is None and required:
        abort(404)
    if row is not None:
        from models import RoomBooking
        if isinstance(row, RoomBooking):
            validate_serialized_ownership(row)
    return row


def require_event_object(obj):
    from models import AccommodationEvent
    field = 'championship_event_id' if isinstance(obj, AccommodationEvent) else 'event_id'
    if obj is None or getattr(obj, field, None) != accommodation_event_id():
        raise OperationalEventError('Object does not belong to the authorized event')
    return obj


def validate_serialized_ownership(obj):
    """Fail closed for corrupt legacy links; never serialize a foreign occupant."""
    from models import RoomBooking, RoomBookingOccupant, RoomAssignment, FisRoomAssignment, EventRoomDemand
    if not has_request_context():
        return
    owner = accommodation_event_id()
    if isinstance(obj, RoomBooking):
        require_event_object(obj)
        if any(o.athlete is None or o.athlete.event_id != owner for o in obj.occupants):
            raise OperationalEventError('Mixed-event booking occupants require administrative review')
    elif isinstance(obj, RoomBookingOccupant):
        if not obj.room_booking or not obj.athlete or obj.room_booking.event_id != owner or obj.athlete.event_id != owner:
            raise OperationalEventError('Mixed-event booking relationship')
    elif isinstance(obj, (RoomAssignment, FisRoomAssignment)):
        people = (obj.athlete, obj.shared_with) if isinstance(obj, RoomAssignment) else (obj.person1, obj.person2)
        if any(p is not None and p.event_id != owner for p in people):
            raise OperationalEventError('Mixed-event legacy relationship')
    elif isinstance(obj, EventRoomDemand):
        if obj.event.championship_event_id != owner:
            raise OperationalEventError('Foreign event demand')
    else:
        require_event_object(obj)


def event_audit_refs(refs, owner=None):
    """Canonical ownership envelope for new audit evidence, never legacy backfill."""
    import json
    from imports.event_context import normalize_event_id
    owner = accommodation_event_id() if owner is None else normalize_event_id(owner)
    return json.dumps({'championshipEventId': str(owner), '_scope': 'OPERATIONAL_EVENT',
        **{k: v for k, v in refs.items() if k not in {'championshipEventId', '_scope'}}}, ensure_ascii=False)
