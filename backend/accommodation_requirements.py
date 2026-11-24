"""Person-owned LOC accommodation demand; no quota-role classification."""
BOOKING_MESSAGE = 'Für diese Person bestehen Unterkunftszuweisungen. Bitte diese zuerst ausdrücklich entfernen.'
NO_ACCOMMODATION = frozenset({'NO_ROOM', 'NO_DISPO'})
REQUIREMENTS = NO_ACCOMMODATION | {'REQUIRED'}
INVALID_REQUIREMENT = 'accommodationRequirement must be REQUIRED, NO_ROOM, NO_DISPO or null'
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


def ensure_no_bookings(person, requirement='NO_ROOM'):
    if has_bookings(person):
        raise RequirementConflict(f'{requirement}_HAS_BOOKINGS', BOOKING_MESSAGE)


def require_assignable(person):
    requirement = requirement_projection(person)['accommodationRequirement']
    if requirement in NO_ACCOMMODATION:
        from accommodation_split import SplitError
        label = 'Nicht einplanen' if requirement == 'NO_DISPO' else 'Kein Zimmer benötigt'
        raise SplitError(f'{requirement}_ASSIGNMENT_FORBIDDEN', f'{label}. Unterkunftsbedarf zuerst ausdrücklich ändern.')


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
        if value not in REQUIREMENTS | {None}:
            raise ValueError(INVALID_REQUIREMENT)
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


def _room_list_requirement(person, room):
    """Prefer explicit room evidence only for a verified, identical stay."""
    source = person.get('entryAccommodationSource') or person
    if not (person.get('fisCode') or person.get('competitorId')) or source.get('sharedWithName'):
        return None
    entry = (person.get('arrivalDate'), person.get('departureDate'))
    stay = (room.get('checkInDate'), room.get('checkOutDate'))
    if not all(entry + stay):
        return None
    start, end = map(str, entry)
    if start >= end or (start, end) != tuple(map(str, stay)):
        return None
    return source_requirement([room.get('roomType')])[0]


def _stay_review(person, rooms):
    """Check whether the operative person's single date range can be used safely."""
    from imports.normalization import parse_date

    entry_start = parse_date(person.get('arrivalDate'))
    entry_end = parse_date(person.get('departureDate'))
    room_stays = []
    for room in rooms:
        start, end = parse_date(room.get('checkInDate')), parse_date(room.get('checkOutDate'))
        if start and end and start < end and source_requirement([room.get('roomType')])[0] == 'REQUIRED':
            room_stays.append((start, end, room))
    if not room_stays:
        return None
    room_stays.sort(key=lambda stay: stay[0])

    # A broader Entry List travel window must not bridge a gap in room evidence.
    covered_until = room_stays[0][1]
    for start, end, _ in room_stays[1:]:
        if start > covered_until:
            return ('ACCOMMODATION_REQUIREMENT_SEPARATE_STAYS',
                    'Getrennte Room-List-Aufenthalte können nicht als ein Unterkunftszeitraum übernommen werden. Bitte Aufenthalte klären.')
        covered_until = max(covered_until, end)

    if entry_start and entry_end and entry_start < entry_end:
        for start, end, room in room_stays:
            if entry_end < start or end < entry_start:
                return ('ACCOMMODATION_REQUIREMENT_SEPARATE_STAYS',
                        'Getrennte Aufenthalte in Entry List und Room List. Bitte den Unterkunftszeitraum vor Freigabe klären.')
            if (entry_end == start or end == entry_start) and (
                    room.get('person2Key') or room.get('sharedWithRawName') or person.get('sharedWithName')):
                return ('ACCOMMODATION_REQUIREMENT_PARTNER_STAY',
                        'Angrenzende Aufenthalte mit Zimmerpartner. Bitte die Zeiträume beider Personen vor Freigabe klären.')
    return None


def apply_preview_requirements(people, rooms=(), overrides=None, *, read_context=None):
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    maps = read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps()
    issues = []
    for person in people:
        existing = _find_existing_athlete(person, maps)
        related_rooms = [r for r in rooms if person.get('matchKey') in {r.get('person1Key'), r.get('person2Key')}]
        source = person.get('entryAccommodationSource') or person
        values = [source.get('roomType'), *(room.get('roomType') for room in related_rooms)]
        if (len(related_rooms) == 1 and source_requirement([values[0]])[0] == 'NO_ROOM'
                and _room_list_requirement(person, related_rooms[0]) == 'REQUIRED'):
            room = related_rooms[0]
            person.setdefault('entryAccommodationSource', {
                'row': person.get('rowNumber'), 'roomType': values[0],
                'arrivalDate': str(person['arrivalDate']), 'departureDate': str(person['departureDate']),
                'sharedWithName': person.get('sharedWithName'),
            })
            person['roomType'] = room['roomType']
            if room.get('person2Key'):
                other = 'person2Name' if room['person1Key'] == person['matchKey'] else 'person1Name'
                person['sharedWithName'] = room.get(other)
            values = values[1:]
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
        if person['accommodationRequirement'] not in NO_ACCOMMODATION:
            stay_issue = _stay_review(person, related_rooms)
            if stay_issue:
                code, message = stay_issue
                issues.append({'code': code, 'message': message,
                               'details': {'personKey': person.get('matchKey')}})
    return issues


def set_requirement(person, value, source):
    if value not in REQUIREMENTS or source not in {'DEFAULT', 'IMPORT', 'MANUAL'}:
        raise ValueError('Invalid accommodation requirement/source')
    if value == 'NO_ROOM':
        ensure_no_bookings(person, value)
    person.accommodation_requirement = value
    person.accommodation_requirement_source = source


def legacy_candidates():
    from models import Athlete
    result = []
    from accommodation_scope import event_query
    for person in event_query(Athlete).order_by(Athlete.id).all():
        if ' '.join((person.room_type or '').split()).casefold() != 'no room':
            continue
        state = requirement_projection(person)
        result.append({'personId': person.id, 'name': f'{person.firstname} {person.lastname}', **state,
                       'eligible': state['accommodationRequirementSource'] == 'DEFAULT' and not has_bookings(person),
                       'hasBookings': has_bookings(person)})
    return result


def accommodation_metrics(people, coverage_by_id):
    unique = {str(p['personId']): p for p in people}
    required = {key: p for key, p in unique.items() if p.get('accommodationRequirement') not in NO_ACCOMMODATION}
    statuses = [coverage_by_id.get(key, {}).get('coverageStatus', 'UNASSIGNED') for key in required]
    no_dispo = sum(p.get('accommodationRequirement') == 'NO_DISPO' for p in unique.values())
    return {'accommodationPeopleRequired': len(required),
            'accommodationPeopleFullyAssigned': statuses.count('FULLY_ASSIGNED'),
            'accommodationPeoplePartiallyAssigned': statuses.count('PARTIALLY_ASSIGNED'),
            'accommodationPeopleOpen': sum(status != 'FULLY_ASSIGNED' for status in statuses),
            'noRoomPeople': sum(p.get('accommodationRequirement') == 'NO_ROOM' for p in unique.values()),
            **({'noDispoPeople': no_dispo} if no_dispo else {})}


def accommodation_room_requests(people, rooms):
    required = {p.get('matchKey') for p in people if p.get('accommodationRequirement') not in NO_ACCOMMODATION}
    return [room for room in rooms if required & {room.get('person1Key'), room.get('person2Key')}]
