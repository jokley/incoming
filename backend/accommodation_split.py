"""One read-only split plan, applied atomically by the HTTP boundary.

No slots or split provenance are stored. Shared prefixes retain occupant context.
"""
import hashlib
import json
from datetime import date
from types import SimpleNamespace
from models import db, RoomBooking, RoomBookingOccupant, HotelRoomInventory
from accommodation_coverage import person_accommodation_coverage, booking_intervals_overlap


class SplitError(ValueError):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status


def require(condition, code, message, status=400):
    if not condition:
        raise SplitError(code, message, status)


def person_bookings(person_id):
    return RoomBooking.query.join(RoomBookingOccupant).filter(RoomBookingOccupant.athlete_id == person_id).all()


def snapshot_token(booking):
    people = sorted((o.athlete for o in booking.occupants), key=lambda p: p.id)
    relevant = {b.id: b for p in people for b in person_bookings(p.id)}
    # Include competing use of this physical room, not unrelated room assignments.
    from app import _planned_room_key
    room_key = _planned_room_key(booking.room_number) or (booking.room_number or '').strip()
    for b in RoomBooking.query.filter_by(hotel_id=booking.hotel_id, room_type_id=booking.room_type_id).all():
        if room_key and room_key == (_planned_room_key(b.room_number) or (b.room_number or '').strip()):
            relevant[b.id] = b
    rows = []
    for b in sorted(relevant.values(), key=lambda b: b.id):
        rows.append([b.id, b.hotel_id, b.room_type_id, b.room_number, b.check_in_date,
                     b.check_out_date, b.counts_as_single, b.created_by, b.created_at,
                     sorted((o.athlete_id, o.role, str(o.created_at)) for o in b.occupants)])
    inventories = HotelRoomInventory.query.filter_by(hotel_id=booking.hotel_id, room_type_id=booking.room_type_id).all()
    state = [booking.id, rows, [[p.id, p.arrival_date, p.departure_date, p.updated_at,
                    p.single_room_status, p.single_room_decision_id, p.accommodation_requirement, p.accommodation_requirement_source] for p in people],
             [[i.id, i.room_count, i.available_from, i.available_until] for i in sorted(inventories, key=lambda i: i.id)],
             booking.room_type.max_persons if booking.room_type else None, booking.hotel.accommodation_type]
    return hashlib.sha256(json.dumps(state, default=str, ensure_ascii=False).encode()).hexdigest()


def preview_token(booking, ids, split_date):
    try:
        selection = sorted(int(value) for value in ids)
    except (TypeError, ValueError):
        return None
    state = [snapshot_token(booking), selection, split_date]
    return hashlib.sha256(json.dumps(state).encode()).hexdigest()


def _copy(booking, identity, start, end):
    return SimpleNamespace(id=identity, hotel_id=booking.hotel_id, room_type_id=booking.room_type_id,
        hotel=booking.hotel, room_type=booking.room_type, room_number=booking.room_number,
        check_in_date=start, check_out_date=end, counts_as_single=booking.counts_as_single)


def validate_partition_source(booking):
    """Common physical-room safety for explicit split and external replacement."""
    external = booking.hotel.accommodation_type == 'EXTERNAL'
    require(external or (booking.room_type and len(booking.occupants) <= booking.room_type.max_persons), 'ACCOMMODATION_REVIEW_REQUIRED', 'Zimmerbelegung prüfen.')
    from app import _planned_room_key
    key = _planned_room_key(booking.room_number) or (booking.room_number or '').strip()
    for other in RoomBooking.query.filter_by(hotel_id=booking.hotel_id, room_type_id=booking.room_type_id).all():
        same_room = not external and key and key == (_planned_room_key(other.room_number) or (other.room_number or '').strip())
        require(not (other.id != booking.id and same_room and booking_intervals_overlap(
            booking.check_in_date, booking.check_out_date, other.check_in_date, other.check_out_date)),
            'ROOM_BOOKING_CONFLICT', 'Bestehende Zimmerbelegung prüfen.')
    return external, key


def split_plan(booking, ids, split_date):
    require(booking.hotel.accommodation_type != 'EXTERNAL', 'EXTERNAL_SPLIT_DISABLED',
            'Externe Aufenthalte über Bearbeiten ändern.')
    try:
        selected = sorted(int(value) for value in ids) if isinstance(ids, list) else []
        cut = date.fromisoformat(split_date)
    except (ValueError, TypeError):
        raise SplitError('INVALID_SPLIT', 'Personen und gültiges Teilungsdatum auswählen.')
    occupants = sorted(booking.occupants, key=lambda o: o.athlete_id)
    all_ids = [o.athlete_id for o in occupants]
    require(selected and len(set(selected)) == len(selected) and set(selected) <= set(all_ids),
            'INVALID_OCCUPANTS', 'Nur Bewohner dieser Zuweisung auswählen.')
    require(booking.check_in_date and booking.check_out_date and booking.check_in_date < cut < booking.check_out_date,
            'INVALID_SPLIT_DATE', 'Teilungsdatum muss zwischen Anreise und Abreise liegen.')
    external, key = validate_partition_source(booking)
    remaining = [identity for identity in all_ids if identity not in selected]
    require(external or not remaining or key, 'ACCOMMODATION_REVIEW_REQUIRED', 'Für das Teilen einzelner Bewohner muss die Zimmernummer geklärt sein.')
    prefix = _copy(booking, booking.id, booking.check_in_date, cut)
    suffix = _copy(booking, -booking.id, cut, booking.check_out_date)
    people = []
    for membership in occupants:
        person = membership.athlete
        current = person_bookings(person.id)
        before = person_accommodation_coverage(person.arrival_date, person.departure_date, current, person.accommodation_requirement)
        require(before['coverageStatus'] != 'CONFLICT', 'ACCOMMODATION_REVIEW_REQUIRED', 'Aufenthalt prüfen. Teilen ist bei Konflikten nicht möglich.')
        projected = [b for b in current if b.id != booking.id] + [prefix]
        if person.id in remaining:
            projected.append(suffix)
        coverage = person_accommodation_coverage(person.arrival_date, person.departure_date, projected, person.accommodation_requirement)
        require(coverage['coverageStatus'] != 'CONFLICT', 'ACCOMMODATION_REVIEW_REQUIRED', 'Aufenthalt prüfen.')
        people.append({'personId': str(person.id), 'name': f'{person.firstname} {person.lastname}'.strip(),
                       'selected': person.id in selected, 'affectedOpenIntervals': [i for i in coverage['openIntervals'] if i['checkInDate'] <= cut.isoformat() < i['checkOutDate']] if person.id in selected else [], 'accommodationCoverage': coverage})
    retained = [{'bookingId': str(booking.id), 'checkInDate': booking.check_in_date.isoformat(),
                 'checkOutDate': cut.isoformat(), 'athleteIds': [str(i) for i in all_ids]}]
    if remaining:
        retained.append({'bookingId': str(-booking.id), 'checkInDate': cut.isoformat(),
                         'checkOutDate': booking.check_out_date.isoformat(), 'athleteIds': [str(i) for i in remaining]})
    return {'booking': booking.to_dict(), 'athleteIds': [str(i) for i in selected], 'splitDate': cut.isoformat(),
            'previewToken': preview_token(booking, selected, cut.isoformat()), 'retainedSegments': retained, 'people': people}


def partition_booking(booking, cut, remaining):
    """Keep all occupants in the prefix and copy chosen memberships to the suffix.

    Flush only; both business flows own their single transaction boundary.
    """
    require(booking.check_in_date < cut < booking.check_out_date,
            'INVALID_SPLIT_DATE', 'Teilungsdatum muss innerhalb der Zuweisung liegen.')
    continuation = None
    if remaining:
        continuation = RoomBooking(event_id=booking.event_id, hotel_id=booking.hotel_id, room_type_id=booking.room_type_id,
            room_number=booking.room_number, check_in_date=cut, check_out_date=booking.check_out_date,
            counts_as_single=booking.counts_as_single, created_by=booking.created_by, created_at=booking.created_at)
        continuation.occupants = [RoomBookingOccupant(athlete_id=o.athlete_id, role=o.role, created_at=o.created_at) for o in remaining]
        db.session.add(continuation)
    booking.check_out_date = cut
    db.session.flush()
    return continuation


def apply_split(booking, plan):
    """Only flush; the caller owns the sole commit/rollback boundary."""
    cut = date.fromisoformat(plan['splitDate'])
    remaining = [o for o in booking.occupants if str(o.athlete_id) not in plan['athleteIds']]
    partition_booking(booking, cut, remaining)
    people = []
    for o in booking.occupants:
        p = o.athlete
        coverage = person_accommodation_coverage(p.arrival_date, p.departure_date, person_bookings(p.id), p.accommodation_requirement)
        people.append({'personId': str(p.id), 'name': f'{p.firstname} {p.lastname}'.strip(),
            'selected': str(p.id) in plan['athleteIds'],
            'affectedOpenIntervals': [i for i in coverage['openIntervals'] if i['checkInDate'] <= plan['splitDate'] < i['checkOutDate']] if str(p.id) in plan['athleteIds'] else [],
            'accommodationCoverage': coverage})
    return {'success': True, 'booking': booking.to_dict(), 'splitDate': plan['splitDate'],
            'athleteIds': plan['athleteIds'], 'people': people}
