from flask import Flask, request, jsonify
from flask_cors import CORS
from models import db, RoomType, Hotel, HotelRoomInventory, Event, EventRoomDemand, Athlete, RoomAssignment, RoomBooking, RoomBookingOccupant, ImportRun, FisRoomAssignment
from fis_rules import compute_official_quota, compute_single_room_entitlement, is_supported_discipline
from datetime import datetime
import os
import csv
import io
import tempfile
import json
from sqlalchemy import text, func
from excel_import import create_fis_import_preview, confirm_fis_import, detect_fis_file_type

app = Flask(__name__)
CORS(app)

# Database configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'freestyle_wm_new.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)


def _normalize_gender(athlete):
    raw = (athlete.gender or athlete.for_gender or '').strip().lower()
    if raw in {'m', 'male', 'man', 'men', 'herr', 'herren'}:
        return 'male'
    if raw in {'f', 'female', 'woman', 'women', 'dame', 'damen'}:
        return 'female'
    return None


def _dates_overlap(start_a, end_a, start_b, end_b):
    if not start_a or not end_a or not start_b or not end_b:
        return False
    return start_a <= end_b and start_b <= end_a


def _booking_error(reason_code, message, details=None):
    return jsonify({
        'error': 'VALIDATION_ERROR',
        'reasonCode': reason_code,
        'message': message,
        'details': details or {}
    }), 400


def _normalize_text(value):
    return (value or '').strip().lower()


def _room_type_label(name):
    value = _normalize_text(name)
    if 'single' in value or value.startswith('ez') or value.startswith('sr'):
        return 'single'
    if 'double' in value or value.startswith('dz'):
        return 'double'
    if 'app' in value:
        return 'appartment'
    return value or 'unknown'


def _status_badges_for_athlete(athlete):
    badges = []
    if athlete.hasPendingRoomlistReview:
        badges.append('change-open')
    if athlete.changeTouchesAssignment:
        badges.append('assigned-change')
    if athlete.special_meal:
        badges.append('special-meal')
    if athlete.room_type and _room_type_label(athlete.room_type) == 'single':
        badges.append('single-request')
    return badges


def _has_pending_roomlist_review(athlete):
    return bool(
        athlete.roomlist_changed_at and (
            athlete.roomlist_change_acknowledged_at is None
            or athlete.roomlist_change_acknowledged_at < athlete.roomlist_changed_at
        )
    )


def _change_touches_assignment_for_athlete(athlete):
    return bool(_has_pending_roomlist_review(athlete) and RoomBookingOccupant.query.filter_by(athlete_id=athlete.id).first())


def _collect_booking_athlete_ids(booking):
    return sorted({occ.athlete_id for occ in (booking.occupants or []) if occ.athlete_id})


def _derive_assignment_warnings(athletes, room_type_name):
    warnings = []
    normalized_room_type = _room_type_label(room_type_name)
    occupant_count = len(athletes)
    if normalized_room_type == 'single' and occupant_count > 1:
        warnings.append({'code': 'OCCUPANCY_MISMATCH', 'level': 'error', 'message': 'Mehr als 1 Person in Single-Zimmer-Einheit'})
    if normalized_room_type == 'double' and occupant_count > 2:
        warnings.append({'code': 'OCCUPANCY_MISMATCH', 'level': 'error', 'message': 'Mehr als 2 Personen in Double-Zimmer-Einheit'})

    if len(athletes) == 2:
        if athletes[0].nation_code != athletes[1].nation_code:
            warnings.append({'code': 'NATION_MISMATCH', 'level': 'error', 'message': 'Zimmerpartner haben unterschiedliche Nationen'})
        g1 = _normalize_gender(athletes[0])
        g2 = _normalize_gender(athletes[1])
        if not g1 or not g2:
            warnings.append({'code': 'GENDER_UNKNOWN', 'level': 'warning', 'message': 'Geschlecht eines Zimmerpartners ist unbekannt'})
        elif g1 != g2:
            warnings.append({'code': 'GENDER_MISMATCH', 'level': 'error', 'message': 'Zimmerpartner haben unterschiedliches Geschlecht'})
    return warnings


def _calculate_unit_validation(unit, slot, existing_bookings):
    blocking_messages = []
    warning_messages = []
    unit_room_type = _room_type_label(unit['roomType'])
    slot_room_type = _room_type_label(slot['roomTypeName'])

    if unit_room_type == 'single' and slot['capacity'] < 1:
        blocking_messages.append('Slot hat keine Kapazität')
    elif unit_room_type == 'double' and slot['capacity'] < 2:
        blocking_messages.append('Slot passt nicht für DZ-Einheit')
    elif unit_room_type == 'appartment' and slot['capacity'] < max(1, len(unit['occupants'])):
        blocking_messages.append('Slot passt nicht für Apartment-Einheit')

    if unit_room_type and slot_room_type and unit_room_type != slot_room_type and not (unit_room_type == 'appartment' and slot_room_type == 'appartment'):
        blocking_messages.append(f'{unit["roomType"]} passt nicht auf {slot["roomTypeName"]}')

    if not slot['dateCoverage']['coversRequestedRange']:
        warning_messages.append('Kontingent-Zeitraum deckt den gewünschten Aufenthalt nicht vollständig ab')

    for booking in existing_bookings:
        if booking.id == unit.get('assignedBookingId'):
            continue
        if str(booking.hotel_id) != str(slot['hotelId']) or str(booking.room_type_id) != str(slot['roomTypeId']):
            continue
        if (booking.room_number or '') != (slot['roomNumber'] or ''):
            continue
        if _dates_overlap(
            booking.check_in_date,
            booking.check_out_date,
            datetime.fromisoformat(unit['checkInDate']).date() if unit.get('checkInDate') else None,
            datetime.fromisoformat(unit['checkOutDate']).date() if unit.get('checkOutDate') else None,
        ):
            blocking_messages.append(f'Zeitraum kollidiert mit bestehender Belegung {booking.check_in_date}–{booking.check_out_date}')
            break

    has_single_request = any(_room_type_label((occ.get('roomType') or unit['roomType'])) == 'single' for occ in unit['occupants'])
    if has_single_request and slot['capacity'] == 1:
        warning_messages.append('EZ-Wunsch prüfen / möglicher Aufpreis')

    status = 'valid'
    if blocking_messages:
        status = 'blocked'
    elif warning_messages:
        status = 'warning'

    return {
        'status': status,
        'messages': blocking_messages + warning_messages,
    }


def _build_virtual_slots(hotel, room_type, inventories, bookings):
    slot_count = sum(inv.room_count for inv in inventories)
    relevant_bookings = [
        booking for booking in bookings
        if booking.hotel_id == hotel.id and booking.room_type_id == room_type.id
    ]
    bookings_by_room_number = {}
    unmatched_bookings = []
    for booking in relevant_bookings:
        key = booking.room_number or ''
        if key.startswith('Slot '):
            bookings_by_room_number.setdefault(key, []).append(booking)
        else:
            unmatched_bookings.append(booking)
    slots = []
    for index in range(slot_count):
        room_number = f"Slot {index + 1:02d}"
        slot_bookings = bookings_by_room_number.get(room_number, [])
        if not slot_bookings and unmatched_bookings:
            slot_bookings = [unmatched_bookings.pop(0)]
        slot_bookings = sorted(slot_bookings, key=lambda booking: (booking.check_in_date or datetime.max.date(), booking.id))
        slots.append({
            'slotId': f'{hotel.id}:{room_type.id}:{index + 1}',
            'hotelId': str(hotel.id),
            'hotelName': hotel.name,
            'roomTypeId': str(room_type.id),
            'roomTypeName': room_type.name,
            'capacity': room_type.max_persons,
            'slotIndex': index + 1,
            'roomNumber': room_number,
            'inventoryRoomCount': slot_count,
            'dateCoverage': {
                'availableFrom': min(inv.available_from for inv in inventories).isoformat() if inventories else None,
                'availableUntil': max(inv.available_until for inv in inventories).isoformat() if inventories else None,
                'coversRequestedRange': True,
            },
            'bookings': slot_bookings,
        })
    return slots


def _build_room_booking_units():
    fis_assignments = FisRoomAssignment.query.order_by(FisRoomAssignment.check_in_date.asc().nullslast(), FisRoomAssignment.id.asc()).all()
    bookings = RoomBooking.query.options(db.joinedload(RoomBooking.occupants).joinedload(RoomBookingOccupant.athlete), db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()
    booking_index = {}
    for booking in bookings:
        booking_index[tuple(_collect_booking_athlete_ids(booking))] = booking

    units = []
    for assignment in fis_assignments:
        athletes = [assignment.person1]
        if assignment.person2:
            athletes.append(assignment.person2)
        athlete_ids = sorted([athlete.id for athlete in athletes if athlete])
        linked_booking = booking_index.get(tuple(athlete_ids))
        occupants = []
        for athlete in athletes:
            if not athlete:
                continue
            pending_review = _has_pending_roomlist_review(athlete)
            assigned_change = _change_touches_assignment_for_athlete(athlete)
            occupants.append({
                'athleteId': str(athlete.id),
                'name': f'{athlete.firstname} {athlete.lastname}'.strip(),
                'firstname': athlete.firstname,
                'lastname': athlete.lastname,
                'nationCode': athlete.nation_code,
                'discipline': athlete.discipline,
                'gender': _normalize_gender(athlete),
                'function': athlete.function,
                'specialMeal': athlete.special_meal,
                'roomType': athlete.room_type,
                'statusBadges': _status_badges_for_athlete(type('A', (), {
                    'hasPendingRoomlistReview': pending_review,
                    'changeTouchesAssignment': assigned_change,
                    'special_meal': athlete.special_meal,
                    'room_type': athlete.room_type,
                })()),
                'hasPendingReview': pending_review,
                'changeTouchesAssignment': assigned_change,
            })

        warnings = _derive_assignment_warnings(athletes, assignment.room_type)
        units.append({
            'unitId': str(assignment.id),
            'sourceRowKey': assignment.source_row_key,
            'nationCode': athletes[0].nation_code if athletes and athletes[0] else '',
            'occupants': occupants,
            'roomType': assignment.room_type,
            'roomTypeLabel': _room_type_label(assignment.room_type),
            'occupantCount': len(occupants),
            'checkInDate': assignment.check_in_date.isoformat() if assignment.check_in_date else None,
            'checkOutDate': assignment.check_out_date.isoformat() if assignment.check_out_date else None,
            'specialMealFlags': [occ['specialMeal'] for occ in occupants if occ.get('specialMeal')],
            'statusBadges': sorted({badge for occ in occupants for badge in occ.get('statusBadges', [])}),
            'assignmentWarnings': warnings,
            'assignedBookingId': str(linked_booking.id) if linked_booking else None,
            'assignedHotelId': str(linked_booking.hotel_id) if linked_booking else None,
            'assignedRoomTypeId': str(linked_booking.room_type_id) if linked_booking else None,
            'assignedRoomNumber': linked_booking.room_number if linked_booking else None,
        })
    return units, bookings


def _build_assignment_planning_view():
    units, bookings = _build_room_booking_units()
    hotels = Hotel.query.options(db.joinedload(Hotel.room_inventories).joinedload(HotelRoomInventory.room_type)).all()

    all_dates = []
    for unit in units:
        if unit.get('checkInDate'):
            all_dates.append(datetime.fromisoformat(unit['checkInDate']).date())
        if unit.get('checkOutDate'):
            all_dates.append(datetime.fromisoformat(unit['checkOutDate']).date())
    for booking in bookings:
        if booking.check_in_date:
            all_dates.append(booking.check_in_date)
        if booking.check_out_date:
            all_dates.append(booking.check_out_date)
    timeline_start = min(all_dates).isoformat() if all_dates else None
    timeline_end = max(all_dates).isoformat() if all_dates else None

    hotel_sections = []
    for hotel in hotels:
        by_room_type = {}
        for inventory in hotel.room_inventories or []:
            by_room_type.setdefault(inventory.room_type_id, {'roomType': inventory.room_type, 'inventories': []})
            by_room_type[inventory.room_type_id]['inventories'].append(inventory)

        slots = []
        for room_type_id, payload in by_room_type.items():
            slots.extend(_build_virtual_slots(hotel, payload['roomType'], payload['inventories'], bookings))

        hotel_sections.append({
            'hotelId': str(hotel.id),
            'hotelName': hotel.name,
            'location': hotel.location,
            'region': hotel.region,
            'slots': [
                {
                    **slot,
                    'bookings': [
                        {
                            'bookingId': str(booking.id),
                            'roomNumber': booking.room_number or slot['roomNumber'],
                            'hotelId': str(booking.hotel_id),
                            'roomTypeId': str(booking.room_type_id),
                            'checkInDate': booking.check_in_date.isoformat() if booking.check_in_date else None,
                            'checkOutDate': booking.check_out_date.isoformat() if booking.check_out_date else None,
                            'occupants': [
                                {
                                    'athleteId': str(occ.athlete.id),
                                    'name': f'{occ.athlete.firstname} {occ.athlete.lastname}'.strip(),
                                    'nationCode': occ.athlete.nation_code,
                                }
                                for occ in (booking.occupants or []) if occ.athlete
                            ],
                        }
                        for booking in slot['bookings']
                    ],
                }
                for slot in slots
            ],
        })

    unassigned_units = []
    assigned_units = []
    validation_by_unit = {}
    for unit in units:
        validations = []
        for hotel_section in hotel_sections:
            for slot in hotel_section['slots']:
                slot_copy = dict(slot)
                covers_requested_range = True
                if slot['dateCoverage']['availableFrom'] and slot['dateCoverage']['availableUntil'] and unit.get('checkInDate') and unit.get('checkOutDate'):
                    covers_requested_range = slot['dateCoverage']['availableFrom'] <= unit['checkInDate'] and slot['dateCoverage']['availableUntil'] >= unit['checkOutDate']
                slot_copy['dateCoverage'] = dict(slot['dateCoverage'])
                slot_copy['dateCoverage']['coversRequestedRange'] = covers_requested_range
                validation = _calculate_unit_validation(unit, slot_copy, bookings)
                validations.append({
                    'slotId': slot['slotId'],
                    **validation,
                })
        validation_by_unit[unit['unitId']] = validations
        if unit.get('assignedBookingId'):
            assigned_units.append(unit)
        else:
            unassigned_units.append(unit)

    return {
        'timeline': {
            'startDate': timeline_start,
            'endDate': timeline_end,
        },
        'units': {
            'unassigned': unassigned_units,
            'assigned': assigned_units,
        },
        'hotels': hotel_sections,
        'validationByUnit': validation_by_unit,
    }


def _validate_booking_payload(data, existing_booking=None):
    athlete_ids = data.get('athleteIds', [])
    if not isinstance(athlete_ids, list) or len(athlete_ids) < 1 or len(athlete_ids) > 4:
        return None, None, _booking_error('INVALID_OCCUPANTS', 'athleteIds must include between 1 and 4 athlete IDs')

    hotel_id = int(data['hotelId'])
    room_type_id = int(data['roomTypeId'])
    room_type = RoomType.query.get_or_404(room_type_id)

    unique_athlete_ids = []
    for athlete_id in athlete_ids:
        int_id = int(athlete_id)
        if int_id not in unique_athlete_ids:
            unique_athlete_ids.append(int_id)

    if len(unique_athlete_ids) > room_type.max_persons:
        return None, None, _booking_error('CAPACITY_EXCEEDED', f'Room type max occupancy is {room_type.max_persons}')

    if len(unique_athlete_ids) == 2:
        athletes = Athlete.query.filter(Athlete.id.in_(unique_athlete_ids)).all()
        if len(athletes) != 2:
            return None, None, _booking_error('ATHLETE_NOT_FOUND', 'One or more athletes not found')
        a1, a2 = athletes[0], athletes[1]
        if a1.nation_code != a2.nation_code:
            return None, None, _booking_error('NATION_MISMATCH', 'Room share requires same nation', {
                'athlete1': {'id': str(a1.id), 'nationCode': a1.nation_code},
                'athlete2': {'id': str(a2.id), 'nationCode': a2.nation_code},
            })
        g1 = _normalize_gender(a1)
        g2 = _normalize_gender(a2)
        if not g1 or not g2:
            return None, None, _booking_error('GENDER_UNKNOWN', 'Room share requires known gender for both occupants')
        if g1 != g2:
            return None, None, _booking_error('GENDER_MISMATCH', 'Room share requires same gender')

    check_in_date = datetime.fromisoformat(data['checkInDate']).date() if data.get('checkInDate') else None
    check_out_date = datetime.fromisoformat(data['checkOutDate']).date() if data.get('checkOutDate') else None
    if not check_in_date or not check_out_date:
        return None, None, _booking_error('MISSING_DATES', 'Booking requires check-in and check-out dates')
    if check_in_date > check_out_date:
        return None, None, _booking_error('INVALID_DATES', 'Check-in must be before or equal to check-out')

    inv_rooms = db.session.query(func.coalesce(func.sum(HotelRoomInventory.room_count), 0)).filter(
        HotelRoomInventory.hotel_id == hotel_id,
        HotelRoomInventory.room_type_id == room_type_id,
        HotelRoomInventory.available_from <= check_in_date,
        HotelRoomInventory.available_until >= check_out_date,
    ).scalar()

    if not inv_rooms or inv_rooms <= 0:
        return None, None, _booking_error('NO_KONTINGENT', 'No kontingent available for this hotel/room type in the given date range', {
            'hotelId': str(hotel_id),
            'roomTypeId': str(room_type_id),
            'checkInDate': check_in_date.isoformat(),
            'checkOutDate': check_out_date.isoformat(),
        })

    query = RoomBooking.query.filter(
        RoomBooking.hotel_id == hotel_id,
        RoomBooking.room_type_id == room_type_id,
        RoomBooking.check_in_date.isnot(None),
        RoomBooking.check_out_date.isnot(None),
        RoomBooking.check_in_date <= check_out_date,
        RoomBooking.check_out_date >= check_in_date,
    )
    if existing_booking:
        query = query.filter(RoomBooking.id != existing_booking.id)
    used_rooms = query.count()
    if used_rooms >= inv_rooms:
        return None, None, _booking_error('KONTINGENT_EXCEEDED', 'No remaining kontingent for this hotel/room type in the given date range', {
            'hotelId': str(hotel_id),
            'roomTypeId': str(room_type_id),
            'checkInDate': check_in_date.isoformat(),
            'checkOutDate': check_out_date.isoformat(),
            'inventoryRooms': int(inv_rooms),
            'usedRooms': int(used_rooms),
        })

    return {
        'hotel_id': hotel_id,
        'room_type_id': room_type_id,
        'room_number': data.get('roomNumber'),
        'check_in_date': check_in_date,
        'check_out_date': check_out_date,
        'athlete_ids': unique_athlete_ids,
    }, room_type, None


def _save_booking_from_payload(payload, existing_booking=None):
    if existing_booking is None:
        booking = RoomBooking(
            hotel_id=payload['hotel_id'],
            room_type_id=payload['room_type_id'],
            room_number=payload['room_number'],
            check_in_date=payload['check_in_date'],
            check_out_date=payload['check_out_date'],
        )
        db.session.add(booking)
        db.session.flush()
    else:
        booking = existing_booking
        booking.hotel_id = payload['hotel_id']
        booking.room_type_id = payload['room_type_id']
        booking.room_number = payload['room_number']
        booking.check_in_date = payload['check_in_date']
        booking.check_out_date = payload['check_out_date']
        RoomBookingOccupant.query.filter_by(room_booking_id=booking.id).delete()

    for athlete_id in payload['athlete_ids']:
        db.session.add(RoomBookingOccupant(room_booking_id=booking.id, athlete_id=athlete_id))
    db.session.commit()
    return booking


def _sync_fis_assignment_with_booking(booking):
    athlete_ids = tuple(_collect_booking_athlete_ids(booking))
    assignments = FisRoomAssignment.query.all()
    for assignment in assignments:
        assignment_ids = tuple(sorted([assignment.person1_id] + ([assignment.person2_id] if assignment.person2_id else [])))
        if assignment_ids == athlete_ids:
            assignment.hotel_id = booking.hotel_id
            assignment.room_number = booking.room_number
            db.session.add(assignment)
    db.session.commit()


def _clear_fis_assignment_booking_link(booking):
    athlete_ids = tuple(_collect_booking_athlete_ids(booking))
    assignments = FisRoomAssignment.query.all()
    for assignment in assignments:
        assignment_ids = tuple(sorted([assignment.person1_id] + ([assignment.person2_id] if assignment.person2_id else [])))
        if assignment_ids == athlete_ids:
            assignment.hotel_id = None
            assignment.room_number = None
            db.session.add(assignment)
    db.session.commit()


def _build_official_quota_usage_rows(nation_code=None, discipline=None, gender=None):
    rows = []
    athletes = Athlete.query
    if nation_code:
        athletes = athletes.filter(Athlete.nation_code == nation_code)
    if discipline:
        athletes = athletes.filter(Athlete.discipline == discipline)

    athletes = athletes.all()
    grouped = {}
    for athlete in athletes:
        if (athlete.function or '').strip().lower() != 'athlete':
            continue
        athlete_gender = (athlete.gender or athlete.for_gender or '').strip()
        if not athlete_gender:
            continue
        g = athlete_gender.lower()
        if g.startswith('m'):
            normalized_gender = 'M'
        elif g.startswith('f'):
            normalized_gender = 'F'
        else:
            normalized_gender = athlete_gender

        if gender and normalized_gender.lower() != gender.lower():
            continue

        key = (athlete.nation_code, athlete.discipline or '', normalized_gender)
        grouped[key] = grouped.get(key, 0) + 1

    # Build live usage from room bookings: booked non-athletes and their single-room usage
    usage_grouped = {}
    single_used_grouped = {}

    bookings = RoomBooking.query.all()
    for booking in bookings:
        for occupant in booking.occupants or []:
            a = occupant.athlete
            if not a:
                continue
            if nation_code and a.nation_code != nation_code:
                continue
            if discipline and (a.discipline or '') != discipline:
                continue

            if (a.function or '').strip().lower() == 'athlete':
                continue

            g = _normalize_gender(a)
            if g == 'male':
                normalized_gender = 'M'
            elif g == 'female':
                normalized_gender = 'F'
            else:
                normalized_gender = (a.gender or a.for_gender or '').strip() or ''
            if not normalized_gender:
                continue
            if gender and normalized_gender.lower() != gender.lower():
                continue

            key = (a.nation_code, a.discipline or '', normalized_gender)
            usage_grouped[key] = usage_grouped.get(key, 0) + 1
            if booking.room_type and booking.room_type.max_persons == 1:
                single_used_grouped[key] = single_used_grouped.get(key, 0) + 1

    for (n_code, disc, g), count in grouped.items():
        quota = compute_official_quota(count)
        single_allowed = compute_single_room_entitlement(quota)
        key = (n_code, disc, g)
        rows.append({
            'nationCode': n_code,
            'discipline': disc,
            'gender': g,
            'athletesEntered': count,
            'officialQuota': quota,
            'singleRoomsAllowed': single_allowed,
            'assignedOfficials': usage_grouped.get(key, 0),
            'singleRoomsUsed': single_used_grouped.get(key, 0),
        })

    return sorted(rows, key=lambda row: (row['nationCode'], row['discipline'], row['gender']))


def _get_grouped_room_bookings_response():
    bookings = RoomBooking.query.order_by(RoomBooking.hotel_id, RoomBooking.room_number, RoomBooking.id).all()
    return jsonify([b.to_dict() for b in bookings])


CRITICAL_ROUTE_ALIASES = [
    '/api/room-bookings/grouped',
    '/api/room-bookings/grouped/',
    '/api/room-assignments/grouped',
    '/api/room-assignments/grouped/',
    '/api/room-assignments',
    '/api/room-assignments/',
    '/api/fis/official-quotas',
    '/api/fis/official-quotas/',
    '/api/official-quotas',
    '/api/official-quotas/',
]

# Initialize database
with app.app_context():
    db.create_all()

    # Lightweight SQLite migration for added columns (no Alembic in this repo)
    def ensure_athlete_columns():
        cols = db.session.execute(text("PRAGMA table_info(athlete)")).fetchall()
        existing = {c[1] for c in cols}  # (cid, name, type, notnull, dflt, pk)

        needed = {
            "athletes_last_seen_at": "DATETIME",
            "roomlist_last_seen_at": "DATETIME",
            "roomlist_changed_at": "DATETIME",
            "roomlist_change_summary": "VARCHAR(500)",
            "roomlist_change_acknowledged_at": "DATETIME",
            "roomlist_change_acknowledged_summary": "VARCHAR(500)",
            "present": "BOOLEAN",
            "arrival_airport_name": "VARCHAR(100)",
            "departure_airport_name": "VARCHAR(100)",
            "additional_items": "VARCHAR(200)",
            "entry_date": "DATETIME",
            "last_update": "DATETIME",
            "entries_sent_date": "DATETIME",
        }

        for name, sql_type in needed.items():
            if name not in existing:
                db.session.execute(text(f"ALTER TABLE athlete ADD COLUMN {name} {sql_type}"))

        db.session.commit()

    ensure_athlete_columns()

    def backfill_room_bookings():
        existing_booking = RoomBooking.query.first()
        if existing_booking:
            return

        assignments = RoomAssignment.query.all()
        booking_map = {}

        for assignment in assignments:
            key = (
                assignment.hotel_id,
                assignment.room_type_id,
                assignment.room_number or '',
                assignment.check_in_date,
                assignment.check_out_date
            )
            booking = booking_map.get(key)
            if booking is None:
                booking = RoomBooking(
                    hotel_id=assignment.hotel_id,
                    room_type_id=assignment.room_type_id,
                    room_number=assignment.room_number,
                    check_in_date=assignment.check_in_date,
                    check_out_date=assignment.check_out_date
                )
                db.session.add(booking)
                db.session.flush()
                booking_map[key] = booking

            athlete_ids = {assignment.athlete_id}
            if assignment.shared_with_athlete_id:
                athlete_ids.add(assignment.shared_with_athlete_id)

            for athlete_id in athlete_ids:
                exists = RoomBookingOccupant.query.filter_by(
                    room_booking_id=booking.id,
                    athlete_id=athlete_id
                ).first()
                if not exists:
                    db.session.add(RoomBookingOccupant(room_booking_id=booking.id, athlete_id=athlete_id))

        db.session.commit()

    backfill_room_bookings()


# ============================================================================
# CSV IMPORT ENDPOINTS
# ============================================================================

def _save_uploaded_excel(file_storage):
    if not file_storage or file_storage.filename == '':
        raise ValueError('No file selected')
    if not file_storage.filename.endswith(('.xlsx', '.xls')):
        raise ValueError('Only Excel files (.xlsx, .xls) are supported')

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx')
    tmp.close()
    file_storage.save(tmp.name)
    return tmp.name


@app.route('/api/import/fis/preview', methods=['POST'])
@app.route('/api/import/fis/preview/', methods=['POST'])
def preview_fis_import():
    uploaded_files = []
    if request.files.get('entriesList'):
        uploaded_files.append(('entriesList', request.files.get('entriesList')))
    if request.files.get('roomListDetailed'):
        uploaded_files.append(('roomListDetailed', request.files.get('roomListDetailed')))
    for file_storage in request.files.getlist('files'):
        uploaded_files.append(('files', file_storage))

    if not uploaded_files:
        return jsonify({'error': 'Please upload the two required FIS Excel files'}), 400

    temp_files = []
    try:
        detected = {'entries': None, 'roomlist': None}
        seen_names = set()
        for field_name, file_storage in uploaded_files:
            if not file_storage or file_storage.filename == '':
                continue
            filename_key = file_storage.filename.lower()
            if filename_key in seen_names:
                continue
            seen_names.add(filename_key)

            tmp_path = _save_uploaded_excel(file_storage)
            temp_files.append(tmp_path)
            if field_name == 'entriesList':
                detected['entries'] = tmp_path
                continue
            if field_name == 'roomListDetailed':
                detected['roomlist'] = tmp_path
                continue

            file_type = detect_fis_file_type(tmp_path)
            if file_type == 'entries' and detected['entries'] is None:
                detected['entries'] = tmp_path
            elif file_type == 'roomlist' and detected['roomlist'] is None:
                detected['roomlist'] = tmp_path

        if not detected['entries'] or not detected['roomlist']:
            return jsonify({
                'error': 'Could not identify both required files. Please upload one ENTRIES-LIST and one ENTRIES-ROOM-LIST-DETAILED file.'
            }), 400

        entries_path = detected['entries']
        room_path = detected['roomlist']
        result = create_fis_import_preview(entries_path, room_path)
        return jsonify(result), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 400
    finally:
        for path in temp_files:
            if path and os.path.exists(path):
                os.unlink(path)


@app.route('/api/import/fis/confirm', methods=['POST'])
@app.route('/api/import/fis/confirm/', methods=['POST'])
def confirm_previewed_fis_import():
    data = request.get_json(silent=True) or {}
    preview_token = data.get('previewToken')
    if not preview_token:
        return jsonify({'error': 'previewToken is required'}), 400

    try:
        result = confirm_fis_import(preview_token)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/import/excel', methods=['POST'])
@app.route('/api/import/excel/', methods=['POST'])
@app.route('/import/excel', methods=['POST'])
@app.route('/import/excel/', methods=['POST'])
def import_excel():
    return jsonify({
        'error': 'Legacy single-file import has been replaced. Use /api/import/fis/preview and /api/import/fis/confirm with both FIS files.'
    }), 410


def import_data_from_csv(csv_content):
    """Parse and import CSV data"""
    lines = csv_content.strip().split('\n')

    # Find section boundaries
    sections = {}
    current_section = None

    for i, line in enumerate(lines):
        line_lower = line.lower().strip()
        if line_lower.startswith('zimmertyp'):
            current_section = 'room_types'
            sections[current_section] = {'start': i, 'headers': lines[i].split()}
        elif line_lower.startswith('hotel'):
            current_section = 'hotels'
            sections[current_section] = {'start': i, 'headers': lines[i].split()}
        elif line_lower.startswith('disziplin'):
            current_section = 'events'
            sections[current_section] = {'start': i, 'headers': lines[i].split()}
        elif line_lower.startswith('athlets'):
            current_section = 'athletes'
            sections[current_section] = {'start': i, 'headers': lines[i].split()}
        elif line_lower.startswith('roomlist'):
            current_section = 'roomlist'
            sections[current_section] = {'start': i, 'headers': lines[i].split()}

    # Import Room Types
    if 'room_types' in sections:
        import_room_types(lines, sections['room_types'], sections.get('hotels', {}).get('start', len(lines)))

    # Import Hotels
    if 'hotels' in sections:
        import_hotels(lines, sections['hotels'], sections.get('events', {}).get('start', len(lines)))

    # Import Events
    if 'events' in sections:
        import_events(lines, sections['events'], sections.get('athletes', {}).get('start', len(lines)))

    # Import Athletes
    if 'athletes' in sections:
        import_athletes(lines, sections['athletes'], sections.get('roomlist', {}).get('start', len(lines)))

    db.session.commit()


def import_room_types(lines, section_info, end_line):
    """Import room types"""
    RoomType.query.delete()

    for i in range(section_info['start'] + 1, end_line):
        if not lines[i].strip():
            continue

        parts = lines[i].split()
        if len(parts) >= 4:
            try:
                # Format: Zimmertyp ZimmerTypID Zimmer MaxPersonen
                # Example: 1 DZ / DU 2
                zimmer_typ_id = int(parts[0])
                zimmer_name = ' '.join(parts[1:-1])
                max_persons = int(parts[-1])

                room_type = RoomType(
                    name=zimmer_name,
                    max_persons=max_persons
                )
                db.session.add(room_type)
            except (ValueError, IndexError):
                continue

    db.session.flush()


def import_hotels(lines, section_info, end_line):
    """Import hotels and room inventories"""
    hotels_dict = {}

    for i in range(section_info['start'] + 1, end_line):
        if not lines[i].strip():
            continue

        parts = lines[i].split()
        if len(parts) < 8:
            continue

        try:
            hotel_name = parts[0]
            zimmer_typ = parts[1]
            von = datetime.strptime(parts[2], '%d.%m.%Y').date()
            bis = datetime.strptime(parts[3], '%d.%m.%Y').date()
            zimmer_count = int(parts[4])
            ort = parts[5]
            region = parts[6]
            hp = parts[7].lower() == 'ja'
            sr = parts[8].lower() == 'ja' if len(parts) > 8 else False

            # Get or create hotel
            if hotel_name not in hotels_dict:
                hotel = Hotel.query.filter_by(name=hotel_name).first()
                if not hotel:
                    hotel = Hotel(
                        name=hotel_name,
                        location=ort,
                        region=region
                    )
                    db.session.add(hotel)
                    db.session.flush()
                hotels_dict[hotel_name] = hotel
            else:
                hotel = hotels_dict[hotel_name]

            # Find room type
            room_type = RoomType.query.filter_by(name=zimmer_typ).first()
            if not room_type:
                # Create if not exists
                max_persons = 2 if 'DZ' in zimmer_typ or 'APP' in zimmer_typ else 1
                room_type = RoomType(name=zimmer_typ, max_persons=max_persons)
                db.session.add(room_type)
                db.session.flush()

            # Create inventory
            inventory = HotelRoomInventory(
                hotel_id=hotel.id,
                room_type_id=room_type.id,
                available_from=von,
                available_until=bis,
                room_count=zimmer_count,
                has_half_board=hp,
                has_sr=sr
            )
            db.session.add(inventory)

        except (ValueError, IndexError) as e:
            print(f"Error importing hotel line {i}: {e}")
            continue

    db.session.flush()


def import_events(lines, section_info, end_line):
    """Import events and room demands"""
    events_dict = {}

    for i in range(section_info['start'] + 1, end_line):
        if not lines[i].strip():
            continue

        parts = lines[i].split()
        if len(parts) < 5:
            continue

        try:
            discipline = parts[0]
            zimmer_typ = parts[1]
            von = datetime.strptime(parts[2], '%d.%m.%Y').date()
            bis = datetime.strptime(parts[3], '%d.%m.%Y').date()
            zimmer_count = int(parts[4])

            # Get or create event
            event_key = f"{discipline}_{von}_{bis}"
            if event_key not in events_dict:
                event = Event(
                    discipline=discipline,
                    start_date=von,
                    end_date=bis
                )
                db.session.add(event)
                db.session.flush()
                events_dict[event_key] = event
            else:
                event = events_dict[event_key]

            # Find room type
            room_type = RoomType.query.filter_by(name=zimmer_typ).first()
            if room_type:
                demand = EventRoomDemand(
                    event_id=event.id,
                    room_type_id=room_type.id,
                    room_count=zimmer_count
                )
                db.session.add(demand)

        except (ValueError, IndexError) as e:
            print(f"Error importing event line {i}: {e}")
            continue

    db.session.flush()


def import_athletes(lines, section_info, end_line):
    """Import athletes"""
    Athlete.query.delete()

    for i in range(section_info['start'] + 1, end_line):
        if not lines[i].strip():
            continue

        parts = lines[i].split()
        if len(parts) < 6:
            continue

        try:
            athlete = Athlete(
                function=parts[0] if parts[0] else None,
                competitor_id=parts[1] if len(parts) > 1 else None,
                accred_id=parts[2] if len(parts) > 2 else None,
                fis_code=parts[3] if len(parts) > 3 else None,
                lastname=parts[4] if len(parts) > 4 else '',
                firstname=parts[5] if len(parts) > 5 else '',
                nation_code=parts[6] if len(parts) > 6 else '',
                for_gender=parts[7] if len(parts) > 7 else None,
                gender=parts[8] if len(parts) > 8 else None,
                phone=parts[9] if len(parts) > 9 else None,
                email=parts[10] if len(parts) > 10 else None
            )

            # Parse dates
            if len(parts) > 14 and parts[14]:
                try:
                    athlete.arrival_date = datetime.strptime(parts[14], '%d.%m.%Y').date()
                except:
                    pass

            if len(parts) > 21 and parts[21]:
                try:
                    athlete.departure_date = datetime.strptime(parts[21], '%d.%m.%Y').date()
                except:
                    pass

            if len(parts) > 28:
                athlete.room_type = parts[28]
            if len(parts) > 29:
                athlete.shared_with_name = parts[29]

            db.session.add(athlete)

        except (ValueError, IndexError) as e:
            print(f"Error importing athlete line {i}: {e}")
            continue

    db.session.flush()


# ============================================================================
# API ENDPOINTS
# ============================================================================

# Room Types - CRUD
@app.route('/api/room-types', methods=['GET'])
@app.route('/api/room-types/', methods=['GET'])
@app.route('/room-types', methods=['GET'])
@app.route('/room-types/', methods=['GET'])
def get_room_types():
    room_types = RoomType.query.all()
    return jsonify([rt.to_dict() for rt in room_types])


@app.route('/api/room-types', methods=['POST'])
@app.route('/api/room-types/', methods=['POST'])
@app.route('/room-types', methods=['POST'])
@app.route('/room-types/', methods=['POST'])
def create_room_type():
    data = request.json
    room_type = RoomType(
        name=data['name'],
        max_persons=data['maxPersons']
    )
    db.session.add(room_type)
    db.session.commit()
    return jsonify(room_type.to_dict()), 201


@app.route('/api/room-types/<int:room_type_id>', methods=['PUT'])
@app.route('/api/room-types/<int:room_type_id>/', methods=['PUT'])
@app.route('/room-types/<int:room_type_id>', methods=['PUT'])
@app.route('/room-types/<int:room_type_id>/', methods=['PUT'])
def update_room_type(room_type_id):
    room_type = RoomType.query.get_or_404(room_type_id)
    data = request.json

    if 'name' in data:
        room_type.name = data['name']
    if 'maxPersons' in data:
        room_type.max_persons = data['maxPersons']

    db.session.commit()
    return jsonify(room_type.to_dict())


@app.route('/api/room-types/<int:room_type_id>', methods=['DELETE'])
@app.route('/api/room-types/<int:room_type_id>/', methods=['DELETE'])
@app.route('/room-types/<int:room_type_id>', methods=['DELETE'])
@app.route('/room-types/<int:room_type_id>/', methods=['DELETE'])
def delete_room_type(room_type_id):
    room_type = RoomType.query.get_or_404(room_type_id)
    db.session.delete(room_type)
    db.session.commit()
    return '', 204


# Hotels - CRUD
@app.route('/api/hotels', methods=['GET'])
@app.route('/api/hotels/', methods=['GET'])
@app.route('/hotels', methods=['GET'])
@app.route('/hotels/', methods=['GET'])
def get_hotels():
    hotels = Hotel.query.all()
    return jsonify([h.to_dict() for h in hotels])


@app.route('/api/hotels/<int:hotel_id>', methods=['GET'])
@app.route('/api/hotels/<int:hotel_id>/', methods=['GET'])
@app.route('/hotels/<int:hotel_id>', methods=['GET'])
@app.route('/hotels/<int:hotel_id>/', methods=['GET'])
def get_hotel(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    return jsonify(hotel.to_dict())


@app.route('/api/hotels', methods=['POST'])
@app.route('/api/hotels/', methods=['POST'])
@app.route('/hotels', methods=['POST'])
@app.route('/hotels/', methods=['POST'])
def create_hotel():
    data = request.json
    hotel = Hotel(
        name=data['name'],
        location=data.get('location'),
        region=data.get('region')
    )
    db.session.add(hotel)
    db.session.commit()
    return jsonify(hotel.to_dict()), 201


@app.route('/api/hotels/<int:hotel_id>', methods=['PUT'])
@app.route('/api/hotels/<int:hotel_id>/', methods=['PUT'])
@app.route('/hotels/<int:hotel_id>', methods=['PUT'])
@app.route('/hotels/<int:hotel_id>/', methods=['PUT'])
def update_hotel(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    data = request.json

    if 'name' in data:
        hotel.name = data['name']
    if 'location' in data:
        hotel.location = data['location']
    if 'region' in data:
        hotel.region = data['region']

    db.session.commit()
    return jsonify(hotel.to_dict())


@app.route('/api/hotels/<int:hotel_id>', methods=['DELETE'])
@app.route('/api/hotels/<int:hotel_id>/', methods=['DELETE'])
@app.route('/hotels/<int:hotel_id>', methods=['DELETE'])
@app.route('/hotels/<int:hotel_id>/', methods=['DELETE'])
def delete_hotel(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    db.session.delete(hotel)
    db.session.commit()
    return '', 204


# Hotel Room Inventory
@app.route('/api/hotels/<int:hotel_id>/inventory', methods=['POST'])
@app.route('/api/hotels/<int:hotel_id>/inventory/', methods=['POST'])
@app.route('/hotels/<int:hotel_id>/inventory', methods=['POST'])
@app.route('/hotels/<int:hotel_id>/inventory/', methods=['POST'])
def add_hotel_inventory(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    data = request.json

    inventory = HotelRoomInventory(
        hotel_id=hotel_id,
        room_type_id=int(data['roomTypeId']),
        available_from=datetime.fromisoformat(data['availableFrom']).date(),
        available_until=datetime.fromisoformat(data['availableUntil']).date(),
        room_count=int(data['roomCount']),
        has_half_board=data.get('hasHalfBoard', False),
        has_sr=data.get('hasSR', False)
    )
    db.session.add(inventory)
    db.session.commit()
    return jsonify(inventory.to_dict()), 201


@app.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['DELETE'])
@app.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['DELETE'])
@app.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['DELETE'])
@app.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['DELETE'])
def delete_hotel_inventory(hotel_id, inventory_id):
    inventory = HotelRoomInventory.query.filter_by(
        id=inventory_id,
        hotel_id=hotel_id
    ).first_or_404()
    db.session.delete(inventory)
    db.session.commit()
    return '', 204


# Events - CRUD
@app.route('/api/events', methods=['GET'])
def get_events():
    events = Event.query.all()
    return jsonify([e.to_dict() for e in events])


@app.route('/api/events', methods=['POST'])
def create_event():
    data = request.json
    event = Event(
        discipline=data['discipline'],
        start_date=datetime.fromisoformat(data['startDate']).date(),
        end_date=datetime.fromisoformat(data['endDate']).date()
    )
    db.session.add(event)
    db.session.commit()
    return jsonify(event.to_dict()), 201


@app.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    event = Event.query.get_or_404(event_id)
    data = request.json

    if 'discipline' in data:
        event.discipline = data['discipline']
    if 'startDate' in data:
        event.start_date = datetime.fromisoformat(data['startDate']).date()
    if 'endDate' in data:
        event.end_date = datetime.fromisoformat(data['endDate']).date()

    db.session.commit()
    return jsonify(event.to_dict())


@app.route('/api/events/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    event = Event.query.get_or_404(event_id)
    db.session.delete(event)
    db.session.commit()
    return '', 204


# Event Room Demand
@app.route('/api/events/<int:event_id>/demand', methods=['POST'])
def add_event_demand(event_id):
    event = Event.query.get_or_404(event_id)
    data = request.json

    demand = EventRoomDemand(
        event_id=event_id,
        room_type_id=int(data['roomTypeId']),
        room_count=int(data['roomCount'])
    )
    db.session.add(demand)
    db.session.commit()
    return jsonify(demand.to_dict()), 201


@app.route('/api/events/<int:event_id>/demand/<int:demand_id>', methods=['DELETE'])
def delete_event_demand(event_id, demand_id):
    demand = EventRoomDemand.query.filter_by(
        id=demand_id,
        event_id=event_id
    ).first_or_404()
    db.session.delete(demand)
    db.session.commit()
    return '', 204


# Athletes
@app.route('/api/athletes', methods=['GET'])
@app.route('/api/athletes/', methods=['GET'])
@app.route('/athletes', methods=['GET'])
@app.route('/athletes/', methods=['GET'])
def get_athletes():
    athletes = Athlete.query.all()

    latest_athletes_run = ImportRun.query.filter_by(import_type='athletes').order_by(ImportRun.started_at.desc()).first()
    latest_roomlist_run = ImportRun.query.filter_by(import_type='roomlist').order_by(ImportRun.started_at.desc()).first()

    latest_athletes_at = latest_athletes_run.started_at if latest_athletes_run else None
    latest_roomlist_at = latest_roomlist_run.started_at if latest_roomlist_run else None

    booking_rows = RoomBookingOccupant.query.join(RoomBooking).all()
    assignment_map = {}
    for occupant in booking_rows:
        booking = occupant.room_booking
        athlete = occupant.athlete
        if not booking or not athlete:
            continue
        current = assignment_map.get(athlete.id)
        summary = {
            'hasAssignment': True,
            'hotelName': booking.hotel.name if booking.hotel else None,
            'hotelId': str(booking.hotel_id) if booking.hotel_id else None,
            'roomNumber': booking.room_number,
            'roomTypeName': booking.room_type.name if booking.room_type else None,
            'checkInDate': booking.check_in_date.isoformat() if booking.check_in_date else None,
            'checkOutDate': booking.check_out_date.isoformat() if booking.check_out_date else None,
            'bookingId': str(booking.id),
        }
        if current is None:
            assignment_map[athlete.id] = summary

    result = []
    for a in athletes:
        data = a.to_dict()

        if latest_athletes_at:
            data['missingFromLatestAthletesImport'] = (
                (a.athletes_last_seen_at is None) or (a.athletes_last_seen_at < latest_athletes_at)
            )
        else:
            data['missingFromLatestAthletesImport'] = False

        had_roomlist_data = (
            a.roomlist_last_seen_at is not None
            or a.arrival_date is not None
            or a.departure_date is not None
            or bool(a.room_type)
            or bool(a.shared_with_name)
        )

        if latest_roomlist_at and had_roomlist_data:
            data['missingFromLatestRoomlistImport'] = (
                (a.roomlist_last_seen_at is None) or (a.roomlist_last_seen_at < latest_roomlist_at)
            )
        else:
            data['missingFromLatestRoomlistImport'] = False

        data['assignment'] = assignment_map.get(a.id, {
            'hasAssignment': False,
            'hotelName': None,
            'hotelId': None,
            'roomNumber': None,
            'roomTypeName': None,
            'checkInDate': None,
            'checkOutDate': None,
            'bookingId': None,
        })
        data['hasPendingRoomlistReview'] = bool(
            a.roomlist_changed_at and (
                a.roomlist_change_acknowledged_at is None
                or a.roomlist_change_acknowledged_at < a.roomlist_changed_at
            )
        )
        data['changeTouchesAssignment'] = bool(data['hasPendingRoomlistReview'] and data['assignment']['hasAssignment'])

        result.append(data)

    return jsonify(result)


@app.route('/api/athletes', methods=['POST'])
@app.route('/api/athletes/', methods=['POST'])
@app.route('/athletes', methods=['POST'])
@app.route('/athletes/', methods=['POST'])
def create_athlete():
    data = request.json
    athlete = Athlete(
        lastname=data['lastname'],
        firstname=data['firstname'],
        nation_code=data['nationCode'],
        function=data.get('function')
    )
    db.session.add(athlete)
    db.session.commit()
    return jsonify(athlete.to_dict()), 201


@app.route('/api/athletes/<int:athlete_id>/acknowledge-roomlist-change', methods=['POST'])
@app.route('/api/athletes/<int:athlete_id>/acknowledge-roomlist-change/', methods=['POST'])
def acknowledge_athlete_roomlist_change(athlete_id):
    athlete = Athlete.query.get_or_404(athlete_id)
    if athlete.roomlist_changed_at is None:
        return jsonify({'error': 'No roomlist change to acknowledge'}), 400

    athlete.roomlist_change_acknowledged_at = datetime.utcnow()
    athlete.roomlist_change_acknowledged_summary = athlete.roomlist_change_summary
    db.session.commit()

    data = athlete.to_dict()
    data['hasPendingRoomlistReview'] = False
    return jsonify(data)


# Room Assignments
@app.route('/api/room-bookings/grouped', methods=['GET'])
@app.route('/api/room-bookings/grouped/', methods=['GET'])
@app.route('/room-bookings/grouped', methods=['GET'])
@app.route('/room-bookings/grouped/', methods=['GET'])
@app.route('/api/room-assignments/grouped', methods=['GET'])
@app.route('/api/room-assignments/grouped/', methods=['GET'])
def get_grouped_room_bookings():
    return _get_grouped_room_bookings_response()


@app.route('/api/room-assignments', methods=['GET'])
@app.route('/api/room-assignments/', methods=['GET'])
@app.route('/room-assignments', methods=['GET'])
@app.route('/room-assignments/', methods=['GET'])
def get_room_assignments():
    # Backward-compatible alias. Canonical read endpoint is /api/room-bookings/grouped.
    return _get_grouped_room_bookings_response()


@app.route('/api/fis/official-quotas', methods=['GET'])
@app.route('/api/fis/official-quotas/', methods=['GET'])
@app.route('/fis/official-quotas', methods=['GET'])
@app.route('/fis/official-quotas/', methods=['GET'])
@app.route('/api/official-quotas', methods=['GET'])
@app.route('/api/official-quotas/', methods=['GET'])
def get_official_quotas():
    nation_code = request.args.get('nationCode')
    discipline = request.args.get('discipline')
    gender = request.args.get('gender')
    rows = _build_official_quota_usage_rows(
        nation_code=nation_code,
        discipline=discipline,
        gender=gender
    )
    return jsonify(rows)


@app.route('/api/assignments/planning-view', methods=['GET'])
@app.route('/api/assignments/planning-view/', methods=['GET'])
def get_assignments_planning_view():
    return jsonify(_build_assignment_planning_view())


@app.route('/api/assignments/units/<int:unit_id>/assign', methods=['POST'])
@app.route('/api/assignments/units/<int:unit_id>/assign/', methods=['POST'])
def assign_room_booking_unit(unit_id):
    assignment = FisRoomAssignment.query.get_or_404(unit_id)
    data = request.json or {}
    athlete_ids = [assignment.person1_id]
    if assignment.person2_id:
        athlete_ids.append(assignment.person2_id)

    payload_data = {
        'athleteIds': [str(athlete_id) for athlete_id in athlete_ids],
        'hotelId': data.get('hotelId'),
        'roomTypeId': data.get('roomTypeId'),
        'roomNumber': data.get('roomNumber'),
        'checkInDate': data.get('checkInDate') or (assignment.check_in_date.isoformat() if assignment.check_in_date else None),
        'checkOutDate': data.get('checkOutDate') or (assignment.check_out_date.isoformat() if assignment.check_out_date else None),
    }

    existing_booking = None
    if data.get('assignedBookingId'):
        existing_booking = RoomBooking.query.get(int(data['assignedBookingId']))
    else:
        athlete_id_tuple = tuple(sorted(athlete_ids))
        for booking in RoomBooking.query.all():
            if tuple(_collect_booking_athlete_ids(booking)) == athlete_id_tuple:
                existing_booking = booking
                break

    payload, _, error = _validate_booking_payload(payload_data, existing_booking=existing_booking)
    if error:
        return error
    booking = _save_booking_from_payload(payload, existing_booking=existing_booking)
    _sync_fis_assignment_with_booking(booking)
    return jsonify(booking.to_dict()), 200 if existing_booking else 201


@app.route('/api/assignments/bookings/<int:booking_id>', methods=['PUT'])
@app.route('/api/assignments/bookings/<int:booking_id>/', methods=['PUT'])
def update_assigned_unit(booking_id):
    booking = RoomBooking.query.get_or_404(booking_id)
    data = request.json or {}
    payload_data = {
        'athleteIds': [str(occ.athlete_id) for occ in (booking.occupants or []) if occ.athlete_id],
        'hotelId': data.get('hotelId') or str(booking.hotel_id),
        'roomTypeId': data.get('roomTypeId') or str(booking.room_type_id),
        'roomNumber': data.get('roomNumber'),
        'checkInDate': data.get('checkInDate') or (booking.check_in_date.isoformat() if booking.check_in_date else None),
        'checkOutDate': data.get('checkOutDate') or (booking.check_out_date.isoformat() if booking.check_out_date else None),
    }
    payload, _, error = _validate_booking_payload(payload_data, existing_booking=booking)
    if error:
        return error
    booking = _save_booking_from_payload(payload, existing_booking=booking)
    _sync_fis_assignment_with_booking(booking)
    return jsonify(booking.to_dict())


@app.route('/api/assignments/bookings/<int:booking_id>/unassign', methods=['POST'])
@app.route('/api/assignments/bookings/<int:booking_id>/unassign/', methods=['POST'])
def unassign_room_booking_unit(booking_id):
    booking = RoomBooking.query.get_or_404(booking_id)
    _clear_fis_assignment_booking_link(booking)
    db.session.delete(booking)
    db.session.commit()
    return jsonify({'success': True, 'bookingId': str(booking_id)})


@app.route('/api/debug/routes', methods=['GET'])
def get_debug_routes():
    is_production = (
        str(app.config.get('ENV', '')).lower() == 'production'
        or os.getenv('FLASK_ENV', '').lower() == 'production'
    )
    if is_production:
        return jsonify({'error': 'Not found'}), 404

    available_routes = sorted(
        [rule.rule for rule in app.url_map.iter_rules() if rule.rule in CRITICAL_ROUTE_ALIASES]
    )
    return jsonify({
        'availableRoutes': available_routes
    })


@app.route('/api/room-assignments', methods=['POST'])
@app.route('/api/room-assignments/', methods=['POST'])
@app.route('/room-assignments', methods=['POST'])
@app.route('/room-assignments/', methods=['POST'])
def create_room_assignment():
    data = request.json
    payload, _, error = _validate_booking_payload(data)
    if error:
        return error
    booking = _save_booking_from_payload(payload)
    return jsonify(booking.to_dict()), 201


@app.route('/api/room-assignments/<int:assignment_id>', methods=['PUT'])
@app.route('/api/room-assignments/<int:assignment_id>/', methods=['PUT'])
@app.route('/room-assignments/<int:assignment_id>', methods=['PUT'])
@app.route('/room-assignments/<int:assignment_id>/', methods=['PUT'])
def update_room_assignment(assignment_id):
    booking = RoomBooking.query.get_or_404(assignment_id)
    data = request.json
    payload, _, error = _validate_booking_payload(data, existing_booking=booking)
    if error:
        return error
    booking = _save_booking_from_payload(payload, existing_booking=booking)
    return jsonify(booking.to_dict())


@app.route('/api/room-assignments/<int:assignment_id>', methods=['DELETE'])
@app.route('/api/room-assignments/<int:assignment_id>/', methods=['DELETE'])
@app.route('/room-assignments/<int:assignment_id>', methods=['DELETE'])
@app.route('/room-assignments/<int:assignment_id>/', methods=['DELETE'])
def delete_room_assignment(assignment_id):
    booking = RoomBooking.query.get_or_404(assignment_id)
    db.session.delete(booking)
    db.session.commit()
    return '', 204




@app.route('/api/hotels/capacity-overview', methods=['GET'])
def get_hotels_capacity_overview():
    hotel_id = request.args.get('hotel_id', type=int)
    room_type_id = request.args.get('room_type_id', type=int)
    nation = request.args.get('nation')
    discipline = request.args.get('discipline')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    start_date = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else None
    end_date = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else None

    inventory_query = HotelRoomInventory.query.join(RoomType)
    if hotel_id:
        inventory_query = inventory_query.filter(HotelRoomInventory.hotel_id == hotel_id)
    if room_type_id:
        inventory_query = inventory_query.filter(HotelRoomInventory.room_type_id == room_type_id)
    if start_date and end_date:
        inventory_query = inventory_query.filter(
            HotelRoomInventory.available_from <= end_date,
            HotelRoomInventory.available_until >= start_date
        )

    booking_query = RoomBookingOccupant.query.join(RoomBooking).join(Athlete).join(RoomType, RoomBooking.room_type_id == RoomType.id)
    if hotel_id:
        booking_query = booking_query.filter(RoomBooking.hotel_id == hotel_id)
    if room_type_id:
        booking_query = booking_query.filter(RoomBooking.room_type_id == room_type_id)
    if nation:
        booking_query = booking_query.filter(Athlete.nation_code == nation)
    if discipline:
        booking_query = booking_query.filter(Athlete.discipline == discipline)
    if start_date and end_date:
        booking_query = booking_query.filter(
            RoomBooking.check_in_date.isnot(None),
            RoomBooking.check_out_date.isnot(None),
            RoomBooking.check_in_date <= end_date,
            RoomBooking.check_out_date >= start_date
        )

    hotel_map = {}

    for inv in inventory_query.all():
        hid = inv.hotel_id
        if hid not in hotel_map:
            hotel_map[hid] = {
                'hotel': {'id': str(inv.hotel.id), 'name': inv.hotel.name, 'location': inv.hotel.location, 'region': inv.hotel.region},
                'roomTypes': {},
                'totals': {'inventoryRooms': 0, 'inventoryBeds': 0, 'occupiedRooms': 0, 'occupiedBeds': 0}
            }

        rt_id = str(inv.room_type.id)
        rt_entry = hotel_map[hid]['roomTypes'].setdefault(rt_id, {
            'roomType': inv.room_type.to_dict(),
            'inventoryRooms': 0,
            'inventoryBeds': 0,
            'occupiedBeds': 0
        })
        rt_entry['inventoryRooms'] += inv.room_count
        rt_entry['inventoryBeds'] += inv.room_count * inv.room_type.max_persons

    for occ in booking_query.all():
        booking = occ.room_booking
        if not booking:
            continue
        hid = booking.hotel_id
        if hid not in hotel_map:
            hotel_map[hid] = {
                'hotel': {'id': str(booking.hotel.id), 'name': booking.hotel.name, 'location': booking.hotel.location, 'region': booking.hotel.region},
                'roomTypes': {},
                'totals': {'inventoryRooms': 0, 'inventoryBeds': 0, 'occupiedRooms': 0, 'occupiedBeds': 0}
            }

        rt_id = str(booking.room_type.id)
        rt_entry = hotel_map[hid]['roomTypes'].setdefault(rt_id, {
            'roomType': booking.room_type.to_dict(),
            'inventoryRooms': 0,
            'inventoryBeds': 0,
            'occupiedBeds': 0
        })
        rt_entry['occupiedBeds'] += 1

    result = []
    for hdata in hotel_map.values():
        room_types = []
        for rt in hdata['roomTypes'].values():
            occ_rooms = (rt['occupiedBeds'] + rt['roomType']['maxPersons'] - 1) // rt['roomType']['maxPersons'] if rt['roomType']['maxPersons'] > 0 else 0
            rt['occupiedRooms'] = occ_rooms
            rt['remainingRooms'] = max(0, rt['inventoryRooms'] - occ_rooms)
            rt['remainingBeds'] = max(0, rt['inventoryBeds'] - rt['occupiedBeds'])
            room_types.append(rt)

            hdata['totals']['inventoryRooms'] += rt['inventoryRooms']
            hdata['totals']['inventoryBeds'] += rt['inventoryBeds']
            hdata['totals']['occupiedRooms'] += occ_rooms
            hdata['totals']['occupiedBeds'] += rt['occupiedBeds']

        hdata['totals']['remainingRooms'] = max(0, hdata['totals']['inventoryRooms'] - hdata['totals']['occupiedRooms'])
        hdata['totals']['remainingBeds'] = max(0, hdata['totals']['inventoryBeds'] - hdata['totals']['occupiedBeds'])
        hdata['roomTypes'] = room_types
        result.append(hdata)

    return jsonify(result)


@app.route('/api/hotels/<int:hotel_id>/reservations', methods=['GET'])
def get_hotel_reservations(hotel_id):
    room_type_id = request.args.get('room_type_id', type=int)
    nation = request.args.get('nation')
    discipline = request.args.get('discipline')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    start_date = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else None
    end_date = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else None

    q = RoomAssignment.query.join(Athlete).join(RoomType).filter(RoomAssignment.hotel_id == hotel_id)
    if room_type_id:
        q = q.filter(RoomAssignment.room_type_id == room_type_id)
    if nation:
        q = q.filter(Athlete.nation_code == nation)
    if discipline:
        q = q.filter(Athlete.discipline == discipline)
    if start_date and end_date:
        q = q.filter(RoomAssignment.check_in_date <= end_date, RoomAssignment.check_out_date >= start_date)

    assignments = q.order_by(RoomAssignment.check_in_date.asc().nullslast()).all()
    rows = []
    for a in assignments:
        rows.append({
            'assignmentId': str(a.id),
            'roomNumber': a.room_number,
            'roomType': a.room_type.to_dict(),
            'occupancy': 2 if a.shared_with else 1,
            'guestName': f"{a.athlete.firstname} {a.athlete.lastname}",
            'sharedWithName': f"{a.shared_with.firstname} {a.shared_with.lastname}" if a.shared_with else None,
            'nationCode': a.athlete.nation_code,
            'discipline': a.athlete.discipline,
            'checkInDate': a.check_in_date.isoformat() if a.check_in_date else None,
            'checkOutDate': a.check_out_date.isoformat() if a.check_out_date else None,
            'specialNotes': a.athlete.special_meal
        })
    return jsonify(rows)

# Statistics & Analytics
@app.route('/api/analytics/room-availability', methods=['GET'])
def get_room_availability():
    """Compare room demand vs availability - normalized to EZ/DZ"""
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    if start_date:
        start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
    if end_date:
        end_date = datetime.strptime(end_date, '%Y-%m-%d').date()

    # Get all room types
    room_types = RoomType.query.all()

    # Accumulate beds for EZ and DZ
    ez_available = 0
    dz_available = 0
    ez_demand = 0
    dz_demand = 0

    for rt in room_types:
        # Calculate available rooms
        query = HotelRoomInventory.query.filter_by(room_type_id=rt.id)
        if start_date and end_date:
            query = query.filter(
                HotelRoomInventory.available_from <= end_date,
                HotelRoomInventory.available_until >= start_date
            )

        inventories = query.all()
        for inv in inventories:
            beds = inv.room_count * rt.max_persons
            if rt.max_persons == 1:
                ez_available += inv.room_count
            else:
                # DZ: beds / 2
                dz_available += beds // 2

        # Calculate demand
        demand_query = EventRoomDemand.query.filter_by(room_type_id=rt.id)
        if start_date and end_date:
            demand_query = demand_query.join(Event).filter(
                Event.start_date <= end_date,
                Event.end_date >= start_date
            )

        demands = demand_query.all()
        for demand in demands:
            beds = demand.room_count * rt.max_persons
            if rt.max_persons == 1:
                ez_demand += demand.room_count
            else:
                # DZ: beds / 2
                dz_demand += beds // 2

    # Return normalized EZ/DZ
    result = [
        {
            'roomType': {'id': 'ez', 'name': 'EZ / DU', 'maxPersons': 1},
            'available': ez_available,
            'demand': ez_demand,
            'difference': ez_available - ez_demand
        },
        {
            'roomType': {'id': 'dz', 'name': 'DZ / DU', 'maxPersons': 2},
            'available': dz_available,
            'demand': dz_demand,
            'difference': dz_available - dz_demand
        }
    ]

    return jsonify(result)


@app.route('/api/analytics/occupancy-timeline', methods=['GET'])
def get_occupancy_timeline():
    """Get room occupancy over time"""
    # Get all events with their demands
    events = Event.query.all()

    timeline = []
    for event in events:
        event_data = {
            'discipline': event.discipline,
            'startDate': event.start_date.isoformat(),
            'endDate': event.end_date.isoformat(),
            'demands': []
        }

        for demand in event.room_demands:
            event_data['demands'].append({
                'roomType': demand.room_type.name,
                'roomCount': demand.room_count,
                'maxPersons': demand.room_type.max_persons,
                'totalBeds': demand.room_count * demand.room_type.max_persons
            })

        timeline.append(event_data)

    return jsonify(timeline)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
