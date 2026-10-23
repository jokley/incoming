from accommodation_scope import event_get
from accommodation_requirements import require_assignable
"""Plan external ADDs using the same canonical coverage service as persisted stays."""
import hashlib
import json
from datetime import date
from types import SimpleNamespace
from models import db, Athlete, Hotel, RoomBooking
from accommodation_coverage import person_accommodation_coverage
from accommodation_split import SplitError, require, person_bookings, _copy, validate_partition_source, partition_booking
from accommodation_coverage import booking_intervals_overlap


def ensure_external_create_allowed(person_ids, editing_booking_id=None):
    """One external relationship per person; historical edits do not add one.

    Called under the common accommodation transaction lock by every write path.
    Historical duplicates remain untouched and can be edited/removed explicitly.
    """
    for identity in person_ids:
        require_assignable(event_get(Athlete, identity))
        bookings = person_bookings(identity)
        if editing_booking_id and any(b.id == editing_booking_id and b.hotel.accommodation_type == 'EXTERNAL' for b in bookings):
            continue
        if any(b.hotel.accommodation_type == 'EXTERNAL' for b in bookings):
            person = event_get(Athlete, identity)
            name = f'{person.firstname} {person.lastname}'.strip() if person else str(identity)
            raise SplitError('EXTERNAL_ALREADY_EXISTS', f'{name}: Bereits externer Aufenthalt vorhanden.')


def external_plan(data):
    try:
        if not isinstance(data['athleteIds'], list):
            raise ValueError('Invalid person selection')
        ids = sorted(int(value) for value in data['athleteIds'])
        start, end = date.fromisoformat(data['checkInDate']), date.fromisoformat(data['checkOutDate'])
        hotel = event_get(Hotel, int(data['hotelId']))
    except (KeyError, ValueError, TypeError):
        raise SplitError('INVALID_EXTERNAL_STAY', 'Personen, Unterkunft und gültige Daten auswählen.')
    require(1 <= len(ids) <= 2 and len(set(ids)) == len(ids), 'INVALID_PEOPLE', 'Eine Person oder zwei Zimmerpartner auswählen.')
    require(hotel and hotel.accommodation_type == 'EXTERNAL', 'EXTERNAL_REQUIRED', 'Eine externe Unterkunft auswählen.')
    require(start < end, 'INVALID_DATES', 'Von muss vor Bis liegen.')
    frozen = data.get('openInterval')
    require(isinstance(frozen, dict) and all(isinstance(frozen.get(key), str) for key in ('checkInDate', 'checkOutDate')), 'OPEN_INTERVAL_REQUIRED', 'Offenen Zeitraum auswählen.')
    ensure_external_create_allowed(ids)
    from app import _initialize_new_booking_counts_as_single
    flag = _initialize_new_booking_counts_as_single({'athleteIds': ids})['countsAsSingle']
    replace_standard = data.get('replaceStandard') is True
    replacements = {}
    people, state = [], [hotel.id, hotel.name, hotel.accommodation_type, ids, frozen, start, end, replace_standard]
    for identity in ids:
        person = event_get(Athlete, identity)
        require(person is not None, 'PERSON_NOT_FOUND', 'Person wurde entfernt. Bitte Ansicht aktualisieren.', 409)
        bookings = sorted(person_bookings(identity), key=lambda b:b.id)
        before = person_accommodation_coverage(person.arrival_date, person.departure_date, bookings, person.accommodation_requirement)
        require(before['coverageStatus'] != 'CONFLICT', 'STALE_EXTERNAL_STAY', 'Aufenthalt prüfen. Bitte Ansicht aktualisieren.', 409)
        if not replace_standard:
            require(frozen in before['openIntervals'], 'STALE_EXTERNAL_STAY', 'Offener Aufenthalt hat sich geändert. Bitte Ansicht aktualisieren.', 409)
        require(person.arrival_date and person.departure_date and person.arrival_date <= start < end <= person.departure_date,
                'OUTSIDE_PERSON_STAY', 'Daten müssen innerhalb des Gesamtaufenthalts liegen.')
        require(frozen['checkInDate'] <= start.isoformat() < end.isoformat() <= frozen['checkOutDate'],
                'OUTSIDE_OPEN_INTERVAL', 'Daten müssen innerhalb des gewählten Aufenthalts liegen.')
        retained = []
        for booking in bookings:
            if not booking_intervals_overlap(start, end, booking.check_in_date, booking.check_out_date):
                retained.append(booking)
                continue
            require(replace_standard and booking.hotel.accommodation_type == 'STANDARD',
                    'EXTERNAL_OVERLAP', 'Bestehenden externen Aufenthalt über Bearbeiten korrigieren.')
            _, room_key = validate_partition_source(booking)
            retains_two_sides = booking.check_in_date < start and end < booking.check_out_date
            require(room_key or (not retains_two_sides and all(o.athlete_id in ids for o in booking.occupants)),
                    'ACCOMMODATION_REVIEW_REQUIRED', 'Zimmernummer muss vor einer individuellen Änderung geklärt sein.')
            for occupant in booking.occupants:
                other = occupant.athlete
                current = person_bookings(other.id)
                require(person_accommodation_coverage(other.arrival_date, other.departure_date, current, other.accommodation_requirement)['coverageStatus'] != 'CONFLICT',
                        'STALE_EXTERNAL_STAY', 'Geteilten Aufenthalt prüfen. Bitte Ansicht aktualisieren.', 409)
                state.append([other.id, other.arrival_date, other.departure_date, [b.to_dict() for b in sorted(current, key=lambda b:b.id)]])
            replacements[booking.id] = {'bookingId':str(booking.id),'athleteIds':[str(o.athlete_id) for o in booking.occupants if o.athlete_id in ids],
                                       'checkInDate':max(start,booking.check_in_date).isoformat(),'checkOutDate':min(end,booking.check_out_date).isoformat()}
            if booking.check_in_date < start:
                retained.append(_copy(booking, -booking.id*3, booking.check_in_date, start))
            if end < booking.check_out_date:
                retained.append(_copy(booking, -booking.id*3-1, end, booking.check_out_date))
        projected = SimpleNamespace(id=-1, hotel_id=hotel.id, hotel=hotel, room_type_id=None, room_type=None,
            room_number=None, check_in_date=start, check_out_date=end, counts_as_single=flag)
        coverage = person_accommodation_coverage(person.arrival_date, person.departure_date, [*retained, projected], person.accommodation_requirement)
        require(coverage['coverageStatus'] != 'CONFLICT', 'ACCOMMODATION_CONFLICT', 'Aufenthalt prüfen.')
        people.append({'personId': str(person.id), 'name': f'{person.firstname} {person.lastname}'.strip(),
                       'accommodationCoverage': coverage})
        state.append([person.id, person.arrival_date, person.departure_date, person.updated_at,
                      person.single_room_status, person.single_room_decision_id,
                      [b.to_dict() for b in sorted(bookings, key=lambda b:b.id)]])
    token = hashlib.sha256(json.dumps(state, default=str, sort_keys=True).encode()).hexdigest()
    return {'previewToken': token, 'hotelId': str(hotel.id), 'hotelName': hotel.name,
            'athleteIds': [str(i) for i in ids], 'checkInDate': start.isoformat(), 'checkOutDate': end.isoformat(),
            'openInterval': frozen, 'replaceStandard':replace_standard,
            'replacedBookings':list(replacements.values()), 'people': people}


def release_standard_period(plan):
    """Partition only the affected real bookings; preserve every other relationship.

    Shared-room boundaries and metadata are handled by the existing split primitive.
    The caller performs ADD and owns the only commit/rollback boundary.
    """
    for replacement in plan['replacedBookings']:
        booking = event_get(RoomBooking, int(replacement['bookingId']))
        start, end = date.fromisoformat(replacement['checkInDate']), date.fromisoformat(replacement['checkOutDate'])
        if booking.check_in_date < start:
            booking = partition_booking(booking, start, list(booking.occupants))
        if end < booking.check_out_date:
            partition_booking(booking, end, list(booking.occupants))
        memberships = list(booking.occupants)
        selected = [o for o in memberships if str(o.athlete_id) in replacement['athleteIds']]
        if len(selected) == len(memberships):
            db.session.delete(booking)
        else:
            for membership in selected:
                db.session.delete(membership)
        db.session.flush()
        if len(selected) != len(memberships):
            db.session.expire(booking, ['occupants'])
