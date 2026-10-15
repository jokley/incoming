"""Explicit person-segment operations; no implicit replacement of other stays."""
from datetime import datetime
from flask import Blueprint, jsonify, request, g
from models import db, Athlete, RoomBooking, RoomBookingOccupant
from accommodation_coverage import person_accommodation_coverage
from accommodation_mutations import lock_accommodation_writes

accommodation_segments = Blueprint('accommodation_segments', __name__)


class InvalidSegment(ValueError):
    def __init__(self, code, message):
        self.code, self.message = code, message


def bookings_for(person_id):
    return RoomBooking.query.join(RoomBookingOccupant).filter(
        RoomBookingOccupant.athlete_id == person_id).options(
            db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()


def coverage_for(person):
    return person_accommodation_coverage(person.arrival_date, person.departure_date, bookings_for(person.id))


def _require(condition, code, message):
    if not condition:
        raise InvalidSegment(code, message)


@accommodation_segments.route('/api/assignments/persons/<int:person_id>/segments', methods=['POST'])
@accommodation_segments.route('/api/assignments/persons/<int:person_id>/segments/<int:booking_id>', methods=['PUT', 'DELETE'])
def mutate_segment(person_id, booking_id=None):
    # Import lazily: app owns the existing validator/defaults and audit behavior.
    from app import (_validate_booking_payload, _initialize_new_booking_counts_as_single,
                     _save_booking_from_payload, _acknowledge_import_changes,
                     _planned_room_key, _dates_overlap)
    try:
        lock_accommodation_writes()
        person = Athlete.query.get_or_404(person_id)
        existing = RoomBooking.query.get_or_404(booking_id) if booking_id else None
        membership = RoomBookingOccupant.query.filter_by(
            athlete_id=person.id, room_booking_id=booking_id).first() if existing else None
        _require(not existing or membership, 'SEGMENT_NOT_FOUND', 'Diese Person gehört nicht zur gewählten Zuweisung.')
        if existing:
            g.audit_snapshot = existing.to_dict()
        data = request.get_json(silent=True) or {}
        if request.method == 'DELETE':
            db.session.delete(membership)
            db.session.flush()
            if not RoomBookingOccupant.query.filter_by(room_booking_id=existing.id).count():
                db.session.delete(existing)
            _acknowledge_import_changes([person.id])
            db.session.flush()
            result = {'success': True, 'bookingId': str(booking_id), 'personId': str(person.id),
                      'booking': None, 'accommodationCoverage': coverage_for(person)}
            db.session.commit()
            return jsonify(result)

        other_bookings = [b for b in bookings_for(person.id) if not existing or b.id != existing.id]
        other_coverage = person_accommodation_coverage(person.arrival_date, person.departure_date, other_bookings)
        _require(other_coverage['coverageStatus'] != 'CONFLICT', 'ACCOMMODATION_REVIEW_REQUIRED',
                 'Bestehende Aufenthaltskonflikte müssen zuerst geklärt werden.')
        try:
            start = datetime.fromisoformat(data['checkInDate']).date()
            end = datetime.fromisoformat(data['checkOutDate']).date()
        except (KeyError, TypeError, ValueError):
            raise InvalidSegment('INVALID_DATES', 'Gültige Anreise und Abreise angeben.')
        _require(start < end, 'INVALID_DATES', 'Anreise muss vor Abreise liegen.')
        _require(person.arrival_date and person.departure_date and
                 person.arrival_date <= start < end <= person.departure_date,
                 'SEGMENT_OUTSIDE_PERSON_STAY', 'Zuweisung muss innerhalb des Gesamtaufenthalts liegen.')

        target = RoomBooking.query.get_or_404(int(data['joinBookingId'])) if data.get('joinBookingId') else None
        _require(not target or not existing, 'INVALID_JOIN', 'Beitreten ist nur beim Hinzufügen möglich.')
        if target:
            _require(not any(o.athlete_id == person.id for o in target.occupants),
                     'ALREADY_ATTACHED', 'Person ist diesem Zimmer bereits zugewiesen.')
            _require(target.check_in_date == start and target.check_out_date == end,
                     'SHARED_DATES_DIFFER', 'Beim Beitreten müssen die Aufenthaltsdaten übereinstimmen.')
            _require(len(target.occupants) < target.room_type.max_persons,
                     'CAPACITY_EXCEEDED', 'Zimmer ist bereits voll belegt.')

        shared = bool(existing and len(existing.occupants) > 1)
        payload_data = {
            'athleteIds': [str(person.id)],
            'hotelId': str(target.hotel_id) if target else data.get('hotelId'),
            'roomTypeId': str(target.room_type_id) if target else data.get('roomTypeId'),
            'roomNumber': target.room_number if target else data.get('roomNumber'),
            'checkInDate': data['checkInDate'], 'checkOutDate': data['checkOutDate'],
        }
        if existing or target:
            payload_data['countsAsSingle'] = (existing or target).counts_as_single
        else:
            payload_data = _initialize_new_booking_counts_as_single(payload_data)
        if (shared and start == existing.check_in_date and end == existing.check_out_date
                and str(payload_data['hotelId']) == str(existing.hotel_id)
                and str(payload_data['roomTypeId']) == str(existing.room_type_id)
                and (_planned_room_key(payload_data['roomNumber']) or payload_data['roomNumber'])
                == (_planned_room_key(existing.room_number) or existing.room_number)):
            # Saving an unchanged shared segment must not force a new reservation.
            result = {'success': True, 'personId': str(person.id), 'booking': existing.to_dict(),
                      'accommodationCoverage': coverage_for(person)}
            db.session.commit()
            return jsonify(result)
        # A shared edit creates a separate room booking. Its old room still
        # consumes capacity for the other occupants, but is excluded for this person.
        payload, _, error = _validate_booking_payload(payload_data,
            existing_booking=target or (existing if not shared else None),
            person_booking_exclusion_id=existing.id if existing else None)
        if error:
            db.session.rollback()
            return error
        _require(bool(payload['room_number']), 'ROOM_REQUIRED', 'Ein Zimmer auswählen.')
        excluded = {b.id for b in (target, existing if not shared else None) if b}
        same_room = RoomBooking.query.filter_by(hotel_id=payload['hotel_id'], room_type_id=payload['room_type_id']).all()
        for other in same_room:
            if other.id in excluded:
                continue
            same_number = (_planned_room_key(other.room_number) or other.room_number) == (
                _planned_room_key(payload['room_number']) or payload['room_number'])
            _require(not (same_number and _dates_overlap(other.check_in_date, other.check_out_date, start, end)),
                     'ROOM_BOOKING_OVERLAP', 'Zimmer ist in diesem Zeitraum belegt. Für einen abweichenden geteilten Aufenthalt ein anderes freies Zimmer wählen.')

        if target:
            db.session.add(RoomBookingOccupant(athlete_id=person.id, room_booking_id=target.id))
            _acknowledge_import_changes([person.id])
            booking = target
        else:
            role = membership.role if membership else None
            if shared:
                db.session.delete(membership)
                db.session.flush()
            booking = _save_booking_from_payload(payload, existing_booking=existing if not shared else None, commit=False)
            selected_membership = RoomBookingOccupant.query.filter_by(room_booking_id=booking.id, athlete_id=person.id).one()
            selected_membership.role = role
        db.session.flush()
        db.session.expire(booking, ['occupants'])
        result = {'success': True, 'personId': str(person.id), 'booking': booking.to_dict(),
                  'accommodationCoverage': coverage_for(person)}
        db.session.commit()
        return jsonify(result), 201 if request.method == 'POST' else 200
    except InvalidSegment as error:
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode=error.code, message=error.message), 400
    except (ValueError, TypeError):
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode='INVALID_SEGMENT', message='Ungültige Zuweisungsdaten.'), 400
    except Exception:
        db.session.rollback()
        raise
