from accommodation_scope import event_query, event_get
from accommodation_requirements import require_assignable
"""Explicit person-segment operations; no implicit replacement of other stays."""
from datetime import datetime
from flask import Blueprint, jsonify, request, g
from models import db, Athlete, RoomBooking, RoomBookingOccupant, Hotel
from accommodation_coverage import person_accommodation_coverage
from accommodation_mutations import lock_accommodation_writes
from accommodation_split import SplitError

accommodation_segments = Blueprint('accommodation_segments', __name__)


class InvalidSegment(ValueError):
    def __init__(self, code, message):
        self.code, self.message = code, message


def bookings_for(person_id):
    return event_query(RoomBooking).join(RoomBookingOccupant).filter(
        RoomBookingOccupant.athlete_id == person_id).options(
            db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()


def coverage_for(person):
    return person_accommodation_coverage(person.arrival_date, person.departure_date, bookings_for(person.id), person.accommodation_requirement)


def _require(condition, code, message):
    if not condition:
        raise InvalidSegment(code, message)


@accommodation_segments.route('/api/assignments/persons/<int:person_id>/segments', methods=['POST'])
@accommodation_segments.route('/api/assignments/persons/<int:person_id>/segments/<int:booking_id>', methods=['PUT', 'DELETE'])
def mutate_segment(person_id, booking_id=None):
    return _mutate_segment(person_id, booking_id)


def _mutate_segment(person_id, booking_id=None, *, data_override=None, commit=True, new_booking_default=None, assembling_pair=False):
    # Import lazily: app owns the existing validator/defaults and audit behavior.
    from app import (_validate_booking_payload, _initialize_new_booking_counts_as_single,
                     _save_booking_from_payload, _acknowledge_import_changes,
                     _planned_room_key, _dates_overlap)
    try:
        lock_accommodation_writes()
        person = event_get(Athlete, person_id, required=True)
        existing = event_get(RoomBooking, booking_id, required=True) if booking_id else None
        membership = event_query(RoomBookingOccupant).filter_by(
            athlete_id=person.id, room_booking_id=booking_id).first() if existing else None
        _require(not existing or membership, 'SEGMENT_NOT_FOUND', 'Diese Person gehört nicht zur gewählten Zuweisung.')
        if existing:
            g.audit_snapshot = existing.to_dict()
        data = data_override if data_override is not None else (request.get_json(silent=True) or {})
        if request.method == 'DELETE':
            db.session.delete(membership)
            db.session.flush()
            if not event_query(RoomBookingOccupant).filter_by(room_booking_id=existing.id).count():
                db.session.delete(existing)
            _acknowledge_import_changes([person.id])
            db.session.flush()
            result = {'success': True, 'bookingId': str(booking_id), 'personId': str(person.id),
                      'booking': None, 'accommodationCoverage': coverage_for(person)}
            if commit:
                db.session.commit()
            return jsonify(result)

        require_assignable(person)
        other_bookings = [b for b in bookings_for(person.id) if not existing or b.id != existing.id]
        other_coverage = person_accommodation_coverage(person.arrival_date, person.departure_date, other_bookings, person.accommodation_requirement)
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

        target = event_get(RoomBooking, int(data['joinBookingId']), required=True) if data.get('joinBookingId') else None
        _require(not target or not existing, 'INVALID_JOIN', 'Beitreten ist nur beim Hinzufügen möglich.')
        if target:
            _require(target.hotel.accommodation_type == 'EXTERNAL' or assembling_pair or not target.counts_as_single,
                     'ROOM_SINGLE_USE', 'Zimmer ist durch EZ-Nutzung gesperrt.')
            _require(not any(o.athlete_id == person.id for o in target.occupants),
                     'ALREADY_ATTACHED', 'Person ist diesem Zimmer bereits zugewiesen.')
            _require(target.check_in_date == start and target.check_out_date == end,
                     'SHARED_DATES_DIFFER', 'Beim Beitreten müssen die Aufenthaltsdaten übereinstimmen.')
            _require(target.hotel.accommodation_type == 'EXTERNAL' or (target.room_type and len(target.occupants) < target.room_type.max_persons),
                     'CAPACITY_EXCEEDED', 'Zimmer ist bereits voll belegt.')

        shared = bool(existing and len(existing.occupants) > 1)
        payload_data = {
            'athleteIds': [str(person.id)],
            'hotelId': str(target.hotel_id) if target else data.get('hotelId'),
            'roomTypeId': target.room_type_id if target else data.get('roomTypeId'),
            'roomNumber': target.room_number if target else data.get('roomNumber'),
            'checkInDate': data['checkInDate'], 'checkOutDate': data['checkOutDate'],
        }
        if existing or target:
            payload_data['countsAsSingle'] = (existing or target).counts_as_single
        else:
            if new_booking_default is not None:
                payload_data['countsAsSingle'] = new_booking_default
            elif 'countsAsSingle' in data:
                payload_data['countsAsSingle'] = data['countsAsSingle']
            payload_data = _initialize_new_booking_counts_as_single(payload_data)
        if (shared and start == existing.check_in_date and end == existing.check_out_date
                and str(payload_data['hotelId']) == str(existing.hotel_id)
                and str(payload_data['roomTypeId']) == str(existing.room_type_id)
                and (_planned_room_key(payload_data['roomNumber']) or payload_data['roomNumber'])
                == (_planned_room_key(existing.room_number) or existing.room_number)):
            # Saving an unchanged shared segment must not force a new reservation.
            result = {'success': True, 'personId': str(person.id), 'booking': existing.to_dict(),
                      'accommodationCoverage': coverage_for(person)}
            if commit:
                db.session.commit()
            return jsonify(result)
        # A shared edit creates a separate room booking. Its old room still
        # consumes capacity for the other occupants, but is excluded for this person.
        payload, _, error = _validate_booking_payload(payload_data,
            existing_booking=target or (existing if not shared else None),
            person_booking_exclusion_id=existing.id if existing else None, allow_single_join=assembling_pair)
        if error:
            db.session.rollback()
            return error
        external = event_get(Hotel, payload['hotel_id']).accommodation_type == 'EXTERNAL'
        _require(external or bool(payload['room_number']), 'ROOM_REQUIRED', 'Ein Zimmer auswählen.')
        excluded = {b.id for b in (target, existing if not shared else None) if b}
        same_room = event_query(RoomBooking).filter_by(hotel_id=payload['hotel_id'], room_type_id=payload['room_type_id']).all()
        for other in ([] if external else same_room):
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
            selected_membership = event_query(RoomBookingOccupant).filter_by(room_booking_id=booking.id, athlete_id=person.id).one()
            selected_membership.role = role
        db.session.flush()
        db.session.expire(booking, ['occupants'])
        result = {'success': True, 'personId': str(person.id), 'booking': booking.to_dict(),
                  'accommodationCoverage': coverage_for(person)}
        if commit:
            db.session.commit()
        return jsonify(result), 201 if request.method == 'POST' else 200
    except SplitError as error:
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode=error.code, message=error.message), error.status
    except InvalidSegment as error:
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode=error.code, message=error.message), 400
    except (ValueError, TypeError):
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode='INVALID_SEGMENT', message='Ungültige Zuweisungsdaten.'), 400
    except Exception:
        db.session.rollback()
        raise


@accommodation_segments.route('/api/assignments/segments', methods=['POST'])
def add_shared_segment():
    """One explicit ADD for one/two people; all occupants succeed or all roll back."""
    try:
        lock_accommodation_writes()
        data = request.get_json(silent=True) or {}
        _require(isinstance(data, dict), 'INVALID_SEGMENT', 'Ungültige Zuweisungsdaten.')
        ids = data.get('athleteIds')
        _require(isinstance(ids, list) and 1 <= len(ids) <= 2,
                 'INVALID_PEOPLE', 'Eine Person oder zwei Zimmerpartner auswählen.')
        ids = [int(value) for value in ids]
        _require(len(set(ids)) == len(ids), 'INVALID_PEOPLE', 'Personen müssen unterschiedlich sein.')
        from external_accommodation import external_plan, release_standard_period
        hotel = event_get(Hotel, int(data.get('hotelId', 0)))
        external = bool(hotel and hotel.accommodation_type == 'EXTERNAL')
        if data.get('previewToken') and not external:
            raise SplitError('STALE_EXTERNAL_STAY', 'Externe Unterkunft hat sich geändert. Bitte Vorschau erneut prüfen.', 409)
        if external:
            _require(not data.get('joinBookingId'), 'INVALID_JOIN', 'Externe Aufenthalte als neue Zuweisung anlegen.')
            if not data.get('previewToken'):
                raise SplitError('STALE_EXTERNAL_STAY', 'Bitte Vorschau vor dem Speichern prüfen.', 409)
            try:
                plan = external_plan(data)
            except SplitError as error:
                raise SplitError(error.code, error.message, 409) from error
            if data['previewToken'] != plan['previewToken']:
                raise SplitError('STALE_EXTERNAL_STAY', 'Aufenthalt hat sich geändert. Bitte Vorschau erneut prüfen.', 409)
            if plan['replacedBookings']:
                g.audit_snapshot = {'replacedBookings':[event_get(RoomBooking, int(row['bookingId'])).to_dict() for row in plan['replacedBookings']]}
                release_standard_period(plan)
        interval = {key: data.get(key) for key in ('checkInDate', 'checkOutDate')}
        # Exact frozen selection, no implicit intersection or replacement.
        people = [event_get(Athlete, identity, required=True) for identity in ids]
        for person in people:
            require_assignable(person)
            coverage = coverage_for(person)
            _require(coverage['coverageStatus'] != 'CONFLICT' and (external or interval in coverage['openIntervals']),
                     'OPEN_INTERVAL_CHANGED', 'Der gewählte offene Zeitraum muss für alle Personen identisch und noch offen sein. Bitte Ansicht aktualisieren.')
        from app import _initialize_new_booking_counts_as_single
        default_flag = _initialize_new_booking_counts_as_single({**data, 'athleteIds': ids}, people=people)['countsAsSingle']
        join_id = data.get('joinBookingId')
        for person in people:
            response = _mutate_segment(person.id, data_override={**data, 'joinBookingId': join_id}, commit=False, new_booking_default=default_flag, assembling_pair=not data.get('joinBookingId'))
            body, status = response if isinstance(response, tuple) else (response, 200)
            if status >= 400:
                db.session.rollback()
                return response
            result = body.get_json()
            join_id = result['booking']['id']
        booking = event_get(RoomBooking, int(join_id))
        db.session.expire(booking, ['occupants'])
        result = {'success': True, 'booking': booking.to_dict(),
                  'people': [{'personId': str(person.id), 'accommodationCoverage': coverage_for(person)} for person in people]}
        db.session.commit()
        return jsonify(result), 201
    except SplitError as error:
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode=error.code, message=error.message), error.status
    except InvalidSegment as error:
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode=error.code, message=error.message), 400
    except (ValueError, TypeError):
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode='INVALID_PEOPLE', message='Ungültige Personenauswahl.'), 400
    except Exception:
        db.session.rollback()
        raise


@accommodation_segments.route('/api/assignments/bookings/<int:booking_id>/split-preview', methods=['GET'])
@accommodation_segments.route('/api/assignments/bookings/<int:booking_id>/split', methods=['POST'])
def split_booking(booking_id):
    from accommodation_split import SplitError, split_plan, preview_token, apply_split
    try:
        lock_accommodation_writes()
        booking = event_get(RoomBooking, booking_id)
        if not booking:
            raise SplitError('STALE_SPLIT', 'Zuweisung wurde entfernt. Bitte Ansicht aktualisieren.', 409)
        if request.method == 'GET':
            data = {'athleteIds': request.args.get('athleteIds', '').split(','), 'splitDate': request.args.get('splitDate')}
        else:
            data = request.get_json(silent=True) or {}
            if not isinstance(data, dict):
                raise SplitError('INVALID_SPLIT', 'Ungültige Teilungsdaten.')
            if not data.get('previewToken') or data.get('previewToken') != preview_token(booking, data.get('athleteIds'), data.get('splitDate')):
                raise SplitError('STALE_SPLIT', 'Zuweisungen haben sich geändert. Bitte Vorschau erneut prüfen.', 409)
        plan = split_plan(booking, data.get('athleteIds'), data.get('splitDate'))
        if request.method == 'GET':
            db.session.rollback()  # release the preview's transaction lock; no writes
            response = jsonify(plan)
            response.headers['Cache-Control'] = 'no-store'
            return response
        g.audit_snapshot = booking.to_dict()
        result = apply_split(booking, plan)
        db.session.commit()
        return jsonify(result)
    except SplitError as error:
        db.session.rollback()
        return jsonify(error='VALIDATION_ERROR', reasonCode=error.code, message=error.message), error.status
    except Exception:
        db.session.rollback()
        raise


@accommodation_segments.route('/api/assignments/segments/preview', methods=['GET'])
def preview_external_segment():
    """Read-only preview; confirmation reuses the atomic shared ADD endpoint."""
    from external_accommodation import external_plan
    try:
        lock_accommodation_writes()
        data = {'athleteIds': request.args.get('athleteIds', '').split(','),
                'hotelId': request.args.get('hotelId'), 'checkInDate': request.args.get('checkInDate'),
                'checkOutDate': request.args.get('checkOutDate'),
                'replaceStandard': request.args.get('replaceStandard') == 'true',
                'openInterval': {'checkInDate': request.args.get('openCheckInDate'), 'checkOutDate': request.args.get('openCheckOutDate')}}
        plan = external_plan(data)
        response = jsonify(plan)
        response.headers['Cache-Control'] = 'no-store'
        return response
    except SplitError as error:
        return jsonify(error='VALIDATION_ERROR', reasonCode=error.code, message=error.message), error.status
    finally:
        db.session.rollback()
