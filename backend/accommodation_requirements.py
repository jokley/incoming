"""Person-owned LOC accommodation demand; no quota-role classification."""
BOOKING_MESSAGE = 'Für diese Person bestehen Unterkunftszuweisungen. Bitte diese zuerst ausdrücklich entfernen.'
NORMAL_REQUESTS = {'single', 'double', 'double shared', 'double single', 'appartment', 'apartment', 'ez', 'dz', 'ez / du', 'dz / du'}


class RequirementConflict(ValueError):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)


def requirement_projection(person):
    return {'accommodationRequirement': getattr(person, 'accommodation_requirement', None) or 'REQUIRED',
            'accommodationRequirementSource': getattr(person, 'accommodation_requirement_source', None) or 'DEFAULT'}


def has_bookings(person):
    from models import RoomBookingOccupant, RoomBooking
    if not person or not person.id:
        return False
    rows = RoomBookingOccupant.query.join(RoomBooking).filter(RoomBookingOccupant.athlete_id == person.id)
    if rows.filter(RoomBooking.event_id != person.event_id).first():
        from event_ownership_runtime import OperationalEventError
        raise OperationalEventError('Mixed-event booking relationship requires review')
    return bool(rows.filter(RoomBooking.event_id == person.event_id).first())


def ensure_no_bookings(person):
    if has_bookings(person):
        raise RequirementConflict('NO_ROOM_HAS_BOOKINGS', BOOKING_MESSAGE)


def require_assignable(person):
    if requirement_projection(person)['accommodationRequirement'] == 'NO_ROOM':
        from accommodation_split import SplitError
        raise SplitError('NO_ROOM_ASSIGNMENT_FORBIDDEN', 'Kein Zimmer benötigt. Unterkunftsbedarf zuerst ausdrücklich ändern.')


def source_requirement(values):
    normalized = {' '.join(str(v or '').split()).casefold() for v in values}
    evidence = ({'NO_ROOM'} if 'no room' in normalized else set()) | ({'REQUIRED'} if normalized & NORMAL_REQUESTS else set())
    return next(iter(evidence)) if len(evidence) == 1 else None, len(evidence) > 1


def resolve_requirement(existing, values, override=None):
    from imports.event_context import ImportValidationError
    current = requirement_projection(existing)
    proposed, contradictory = source_requirement(values)
    if override:
        if override['base'] != current:
            raise ImportValidationError('ACCOMMODATION_REQUIREMENT_STALE', 'Unterkunftsbedarf wurde zwischenzeitlich geändert. Bitte erneut prüfen.')
        value = override.get('requirement')
        if value not in {None, 'REQUIRED', 'NO_ROOM'}:
            raise ValueError('accommodationRequirement must be REQUIRED, NO_ROOM or null')
        if value:
            return {**current, 'accommodationRequirement': value, 'accommodationRequirementSource': 'MANUAL'}, proposed, False
        # Explicit release resumes source ownership; absent evidence remains conservative.
        imported = proposed or getattr(existing, 'accommodation_requirement_import_value', None)
        current = {'accommodationRequirement': imported or 'REQUIRED', 'accommodationRequirementSource': 'IMPORT' if imported else 'DEFAULT'}
    elif current['accommodationRequirementSource'] == 'MANUAL':
        return current, proposed, False
    if proposed:
        current = {'accommodationRequirement': proposed, 'accommodationRequirementSource': 'IMPORT'}
    return current, proposed, contradictory or proposed is None


def apply_preview_requirements(people, rooms=(), overrides=None, *, read_context=None):
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    maps = read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps()
    issues = []
    for person in people:
        existing = _find_existing_athlete(person, maps)
        values = [person.get('roomType')]
        values += [r.get('roomType') for r in rooms if person.get('matchKey') in {r.get('person1Key'), r.get('person2Key')}]
        effective, proposed, review = resolve_requirement(existing, values, (overrides or {}).get(person.get('matchKey')))
        person.update(effective)
        person['importAccommodationRequirement'] = proposed
        person['accommodationRequirementReviewRequired'] = review
        if person['accommodationRequirement'] == 'NO_ROOM' and (
                bool(existing.room_booking_memberships) if read_context is not None and existing else has_bookings(existing)):
            issues.append({'code': 'ACCOMMODATION_REQUIREMENT_BOOKINGS', 'message': BOOKING_MESSAGE,
                           'details': {'personKey': person.get('matchKey')}})
        elif source_requirement(values)[1] and effective['accommodationRequirementSource'] != 'MANUAL':
            issues.append({'code': 'ACCOMMODATION_REQUIREMENT_SOURCE_CONFLICT', 'message': 'Widersprüchliche Unterkunftswünsche in Entries und Room List.',
                           'details': {'personKey': person.get('matchKey')}})
    return issues


def set_requirement(person, value, source):
    if value not in {'REQUIRED', 'NO_ROOM'} or source not in {'DEFAULT', 'IMPORT', 'MANUAL'}:
        raise ValueError('Invalid accommodation requirement/source')
    if value == 'NO_ROOM':
        ensure_no_bookings(person)
    person.accommodation_requirement = value
    person.accommodation_requirement_source = source


def legacy_candidates():
    from models import Athlete
    result = []
    for person in Athlete.query.order_by(Athlete.id).all():
        if ' '.join((person.room_type or '').split()).casefold() != 'no room':
            continue
        state = requirement_projection(person)
        result.append({'personId': person.id, 'name': f'{person.firstname} {person.lastname}', **state,
                       'eligible': state['accommodationRequirementSource'] == 'DEFAULT' and not has_bookings(person),
                       'hasBookings': has_bookings(person)})
    return result


def accommodation_metrics(people, coverage_by_id):
    unique = {str(p['personId']): p for p in people}
    required = {key: p for key, p in unique.items() if p.get('accommodationRequirement') != 'NO_ROOM'}
    statuses = [coverage_by_id.get(key, {}).get('coverageStatus', 'UNASSIGNED') for key in required]
    return {'accommodationPeopleRequired': len(required),
            'accommodationPeopleFullyAssigned': statuses.count('FULLY_ASSIGNED'),
            'accommodationPeoplePartiallyAssigned': statuses.count('PARTIALLY_ASSIGNED'),
            'accommodationPeopleOpen': sum(status != 'FULLY_ASSIGNED' for status in statuses),
            'noRoomPeople': len(unique) - len(required)}


def accommodation_room_requests(people, rooms):
    required = {p.get('matchKey') for p in people if p.get('accommodationRequirement') != 'NO_ROOM'}
    return [room for room in rooms if required & {room.get('person1Key'), room.get('person2Key')}]
