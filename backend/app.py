from flask import Flask, g, request, jsonify, send_from_directory, send_file, has_request_context
from flask_cors import CORS
from models import db, AuditEvent, RoomType, Hotel, HotelRoomInventory, Event, EventRoomDemand, Athlete, Nation, RoomAssignment, RoomBooking, RoomBookingOccupant, ImportRun, FisRoomAssignment, ImportSession, ImportSessionVersion, ImportSessionEvent, ImportApproval
from auth import load_user_from_request, current_user
from fis_rules import compute_official_quota, compute_single_room_entitlement, is_supported_discipline
from datetime import datetime
import os
import csv
import io
import tempfile
import json
import zipfile
from pathlib import Path
import uuid
import time
from contextlib import contextmanager
from functools import wraps
from sqlalchemy import text, func, event
from sqlalchemy.engine import Engine
from excel_import import InvalidExcelFileError, create_fis_import_preview, confirm_fis_import, detect_fis_file_type
from generate_test_files import generate_mock_files
from scenario_generator import SCENARIOS, generate_scenario

app = Flask(__name__)
if os.environ.get('CORS_ORIGINS'):
    CORS(app, origins=[origin.strip() for origin in os.environ['CORS_ORIGINS'].split(',')])

# Database configuration
basedir = os.path.abspath(os.path.dirname(__file__))
mock_files_dir = os.path.join(basedir, 'mock_fis_files')
data_dir = os.environ.get('APP_DATA_DIR', os.path.join(basedir, 'data'))
os.makedirs(data_dir, exist_ok=True)
database_path = os.environ.get('DATABASE_PATH', os.path.join(data_dir, 'freestyle_wm_new.db'))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + database_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)


def _is_assignment_request():
    return (request.path.startswith('/api/assignments/')
            or request.path.startswith('/api/official-quota')
            or request.path.startswith('/api/fis/official-quotas'))


@app.before_request
def start_assignment_performance_measurement():
    if _is_assignment_request():
        g.assignment_perf = {'api_started': time.perf_counter(), 'db': 0.0, 'queries': 0}


@event.listens_for(Engine, 'before_cursor_execute')
def _measure_query_start(conn, cursor, statement, parameters, context, executemany):
    if has_request_context() and hasattr(g, 'assignment_perf'):
        context._assignment_query_started = time.perf_counter()


@event.listens_for(Engine, 'after_cursor_execute')
def _measure_query_end(conn, cursor, statement, parameters, context, executemany):
    started = getattr(context, '_assignment_query_started', None)
    if started is not None and has_request_context() and hasattr(g, 'assignment_perf'):
        g.assignment_perf['db'] += (time.perf_counter() - started) * 1000
        g.assignment_perf['queries'] += 1


@contextmanager
def _assignment_phase(name):
    started = time.perf_counter()
    try:
        yield
    finally:
        if hasattr(g, 'assignment_perf'):
            g.assignment_perf[name] = g.assignment_perf.get(name, 0.0) + (time.perf_counter() - started) * 1000


def _assignment_jsonify(payload):
    with _assignment_phase('serialization'):
        return jsonify(payload)


def _measure_assignment_logic(function):
    @wraps(function)
    def measured(*args, **kwargs):
        with _assignment_phase('assignment'):
            return function(*args, **kwargs)
    return measured


@app.after_request
def report_assignment_performance(response):
    perf = getattr(g, 'assignment_perf', None)
    if not perf:
        return response
    perf['api'] = (time.perf_counter() - perf['api_started']) * 1000
    perf['response_bytes'] = response.calculate_content_length() or 0
    names = ('api', 'db', 'quota', 'rooms', 'assignment', 'serialization')
    response.headers['Server-Timing'] = ', '.join(
        f'{name};dur={perf.get(name, 0):.2f}' for name in names
    )
    response.headers['X-Assignment-Query-Count'] = str(perf['queries'])
    response.headers['X-Response-Size'] = str(perf['response_bytes'])
    app.logger.info('assignment_performance %s', json.dumps({
        key: round(value, 2) if isinstance(value, float) else value
        for key, value in perf.items() if key != 'api_started'
    }))
    return response


def _required_permission():
    if request.path == '/api/auth/me':
        return None
    if request.path.startswith('/api/audit-events'):
        return 'audit.read'
    if request.path.startswith('/api/admin/'):
        return 'admin.reset'
    if request.method in {'GET', 'HEAD', 'OPTIONS'}:
        return 'data.read'
    if request.path.startswith('/api/import/'):
        return 'imports.write'
    if request.path.startswith('/api/assignments/') or request.path.startswith('/api/room-assignments'):
        return 'assignments.write'
    return 'data.write'


RESET_TARGETS = {
    'imports': ('Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen'),
    'operations': ('Athleten', 'Assignments', 'Zimmerpartner', 'Prüfmarkierungen', 'Dispositionsstatus'),
    'all': ('Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen', 'Rücksprachen',
            'Athleten', 'Assignments', 'Zimmerpartner', 'Prüfmarkierungen', 'Quotenstatus',
            'Dispositionsstatus', 'temporäre Analysen', 'generierte Listen', 'Workflow-Status'),
}


@app.route('/api/admin/test-data/reset', methods=['POST'])
def reset_test_data():
    """Remove dynamic test data in one transaction while preserving reference data."""
    scope = (request.get_json(silent=True) or {}).get('scope')
    if scope not in RESET_TARGETS:
        return jsonify({'error': 'INVALID_SCOPE', 'message': 'Unbekannter Reset-Umfang'}), 400
    counts = {}
    try:
        if scope in {'operations', 'all'}:
            for label, model in (
                ('Zimmerbelegungen', RoomBookingOccupant), ('Buchungen', RoomBooking),
                ('Assignments', RoomAssignment), ('FIS Assignments', FisRoomAssignment),
                ('Athleten', Athlete),
            ):
                counts[label] = model.query.delete(synchronize_session=False)
        if scope in {'imports', 'all'}:
            counts['Import-Läufe'] = ImportRun.query.delete(synchronize_session=False)
            counts['Genehmigungen'] = ImportApproval.query.delete(synchronize_session=False)
            counts['Import Historie'] = ImportSessionEvent.query.delete(synchronize_session=False)
            counts['Import Versionen'] = ImportSessionVersion.query.delete(synchronize_session=False)
            counts['Import Sessions'] = ImportSession.query.delete(synchronize_session=False)
        db.session.commit()
    except Exception:
        db.session.rollback()
        app.logger.exception('Dynamic data reset failed')
        return jsonify({'error': 'RESET_FAILED', 'message': 'Reset konnte nicht sicher ausgeführt werden'}), 500
    return jsonify({'scope': scope, 'deleted': list(RESET_TARGETS[scope]), 'counts': counts})


@app.route('/api/admin/scenarios', methods=['GET'])
def list_scenarios():
    """Return immutable scenario metadata; generation happens only on demand."""
    return jsonify([scenario.public_dict() for scenario in SCENARIOS])


@app.route('/api/admin/scenarios/<number>/generate', methods=['POST'])
def download_scenario(number):
    """Build one self-contained, deterministic scenario archive in memory."""
    memory_file = io.BytesIO()
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            generated = generate_scenario(number, Path(tmp_dir))
            with zipfile.ZipFile(memory_file, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(generated['root'].rglob('*')):
                    if not path.is_file():
                        continue
                    info = zipfile.ZipInfo(str(path.relative_to(generated['root'].parent)), (2027, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o600 << 16
                    archive.writestr(info, path.read_bytes())
    except KeyError:
        return jsonify({'error': 'SCENARIO_NOT_FOUND', 'message': 'Unbekanntes Szenario'}), 404
    memory_file.seek(0)
    return send_file(memory_file, mimetype='application/zip', as_attachment=True,
                     download_name=f'wm-scenario-{number}.zip')


@app.before_request
def authenticate_api_request():
    if not request.path.startswith('/api/') or request.method == 'OPTIONS':
        return None
    g.current_user = load_user_from_request()
    g.request_id = request.headers.get('X-Request-ID', str(uuid.uuid4()))[:100]
    if g.current_user is None:
        return jsonify({'error': 'UNAUTHENTICATED', 'message': 'Authentication required'}), 401
    permission = _required_permission()
    if permission and not g.current_user.has_permission(permission):
        return jsonify({'error': 'FORBIDDEN', 'message': 'Insufficient permissions'}), 403
    return None


def _audit_entity():
    parts = [part for part in request.path.removeprefix('/api/').split('/') if part]
    entity_type = parts[0] if parts else 'api'
    entity_id = next((part for part in parts[1:] if part.isdigit()), None)
    return entity_type, entity_id


@app.after_request
def audit_successful_mutation(response):
    user = current_user()
    if (user is None or request.method not in {'POST', 'PUT', 'PATCH', 'DELETE'}
            or not request.path.startswith('/api/') or response.status_code >= 400):
        return response
    try:
        entity_type, entity_id = _audit_entity()
        payload = request.get_json(silent=True)
        if payload:
            payload = {key: value for key, value in payload.items()
                       if key.lower() not in {'password', 'token', 'previewtoken', 'secret'}}
        action = {'POST': 'create', 'PUT': 'update', 'PATCH': 'update', 'DELETE': 'delete'}[request.method]
        if 'unassign' in request.path:
            action = 'unassign'
        elif '/assign' in request.path:
            action = 'assign'
        elif request.path.startswith('/api/import/'):
            action = 'import'
        db.session.add(AuditEvent(
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            groups_json=json.dumps(list(user.groups)),
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            request_id=g.request_id,
            method=request.method,
            path=request.path,
            changes_json=json.dumps(payload, ensure_ascii=False, default=str) if payload else None,
        ))
        db.session.commit()
    except Exception:
        app.logger.exception('Unable to write audit event')
        db.session.rollback()
    response.headers['X-Request-ID'] = getattr(g, 'request_id', '')
    return response


def ensure_reference_data():
    room_types_seed = [
        ('DZ / DU', 2),
        ('EZ / DU', 1),
        ('3BZ / DU', 2),
        ('4BZ / DU', 2),
        ('APP: 1 DZ + DU', 2),
        ('APP: 2 DZ + DU', 2),
        ('APP: 2 DZ + 2 DU', 4),
        ('APP: 3 DZ + 2 DU', 4),
    ]

    hotels_seed = [
        ('Alpenlodge', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-22', 31, True, False),
        ('Cube Alpine Stay', 'Bürs', 'Bludenz', 'DZ / DU', '2027-03-04', '2027-03-22', 17, False, False),
        ('Cube Alpine Stay', 'Bürs', 'Bludenz', 'APP: 3 DZ + 2 DU', '2027-03-04', '2027-03-22', 4, False, False),
        ('Cube Alpine Stay', 'Bürs', 'Bludenz', 'APP: 2 DZ + 2 DU', '2027-03-04', '2027-03-22', 6, False, False),
        ('Hotel Daneu', 'Nüziders', 'Bludenz', 'DZ / DU', '2027-03-03', '2027-03-22', 9, True, True),
        ('Hotel Daneu', 'Nüziders', 'Bludenz', 'EZ / DU', '2027-03-03', '2027-03-22', 5, True, True),
        ('Hotel Garni Madrisa', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-21', 9, True, True),
        ('Hotel Garni Madrisa', 'Brand', 'Bludenz', 'EZ / DU', '2027-03-07', '2027-03-21', 2, True, True),
        ('Hotel Lagant', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-21', 30, True, True),
        ('Hotel Lün', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-22', 12, False, False),
        ('Hotel Lün', 'Brand', 'Bludenz', 'APP: 2 DZ + 2 DU', '2027-03-07', '2027-03-22', 3, False, False),
        ('Hotel Sarotla', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-22', 40, True, True),
        ('Hotel Sonne', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-21', 11, True, False),
        ('Hotel Sonne', 'Brand', 'Bludenz', 'EZ / DU', '2027-03-07', '2027-03-21', 3, True, False),
        ('Naturhotel Till', 'Satteins', 'Bludenz', 'DZ / DU', '2027-03-04', '2027-03-22', 9, True, True),
        ('Naturhotel Till', 'Satteins', 'Bludenz', 'EZ / DU', '2027-03-04', '2027-03-22', 9, True, True),
        ('Rössle', 'Braz', 'Bludenz', 'DZ / DU', '2027-03-14', '2027-03-21', 10, True, True),
        ('Rössle', 'Braz', 'Bludenz', 'EZ / DU', '2027-03-14', '2027-03-21', 1, True, True),
        ('Val Blu GmbH', 'Bludenz', 'Bludenz', 'DZ / DU', '2027-03-04', '2027-03-22', 26, True, True),
        ('Hotel Löwen', 'Feldkirch', 'Feldkirch', 'DZ / DU', '2027-03-03', '2027-03-22', 21, True, True),
        ('BergSPA & Hotel Zamangspitze', 'St. Gallenkirch', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 5, True, True),
        ('BergSPA & Hotel Zamangspitze', 'St. Gallenkirch', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-22', 5, True, True),
        ('Chalet Sonne', 'Vandans', 'Montafon', 'DZ / DU', '2027-03-14', '2027-03-22', 27, True, False),
        ('Chalet Sonne', 'Vandans', 'Montafon', 'EZ / DU', '2027-03-14', '2027-03-22', 6, True, False),
        ('Christophorus', 'Partenen', 'Montafon', 'DZ / DU', '2027-03-06', '2027-03-22', 2, False, True),
        ('Christophorus', 'Partenen', 'Montafon', 'EZ / DU', '2027-03-06', '2027-03-22', 1, False, True),
    ]

    events_seed = [
        ('Big Air', '2027-03-07', '2027-03-14', [('DZ / DU', 141), ('EZ / DU', 139)]),
        ('Aerials', '2027-03-15', '2027-03-21', [('DZ / DU', 50), ('EZ / DU', 50)]),
        ('Moguls', '2027-03-12', '2027-03-20', [('DZ / DU', 57), ('EZ / DU', 56)]),
        ('Parallel', '2027-03-04', '2027-03-11', [('DZ / DU', 57), ('EZ / DU', 56)]),
        ('Slopestyle', '2027-03-12', '2027-03-21', [('DZ / DU', 142), ('EZ / DU', 140)]),
        ('Snowboard Cross', '2027-03-16', '2027-03-22', [('DZ / DU', 60), ('EZ / DU', 59)]),
        ('Ski Cross', '2027-03-09', '2027-03-15', [('DZ / DU', 54), ('EZ / DU', 53)]),
    ]

    changed = False

    room_type_map = {room_type.name: room_type for room_type in RoomType.query.all()}
    for name, max_persons in room_types_seed:
        if name not in room_type_map:
            room_type = RoomType(name=name, max_persons=max_persons)
            db.session.add(room_type)
            db.session.flush()
            room_type_map[name] = room_type
            changed = True

    hotel_map = {hotel.name: hotel for hotel in Hotel.query.all()}
    inventory_keys = {
        (inv.hotel_id, inv.room_type_id, inv.available_from, inv.available_until, inv.room_count)
        for inv in HotelRoomInventory.query.all()
    }

    for hotel_name, location, region, room_type_name, date_from, date_to, room_count, has_hp, has_sr in hotels_seed:
        hotel = hotel_map.get(hotel_name)
        if hotel is None:
            hotel = Hotel(name=hotel_name, location=location, region=region)
            db.session.add(hotel)
            db.session.flush()
            hotel_map[hotel_name] = hotel
            changed = True

        room_type = room_type_map.get(room_type_name)
        if room_type is None:
            continue

        key = (
            hotel.id,
            room_type.id,
            datetime.fromisoformat(date_from).date(),
            datetime.fromisoformat(date_to).date(),
            room_count,
        )
        if key in inventory_keys:
            continue

        db.session.add(HotelRoomInventory(
            hotel_id=hotel.id,
            room_type_id=room_type.id,
            available_from=key[2],
            available_until=key[3],
            room_count=room_count,
            has_half_board=has_hp,
            has_sr=has_sr,
        ))
        inventory_keys.add(key)
        changed = True

    event_map = {
        (event.discipline, event.start_date, event.end_date): event
        for event in Event.query.all()
    }
    existing_demands = {
        (demand.event_id, demand.room_type_id, demand.room_count)
        for demand in EventRoomDemand.query.all()
    }

    for discipline, start_date, end_date, demands in events_seed:
        event_key = (discipline, datetime.fromisoformat(start_date).date(), datetime.fromisoformat(end_date).date())
        event = event_map.get(event_key)
        if event is None:
            event = Event(discipline=discipline, start_date=event_key[1], end_date=event_key[2])
            db.session.add(event)
            db.session.flush()
            event_map[event_key] = event
            changed = True

        for room_type_name, room_count in demands:
            room_type = room_type_map.get(room_type_name)
            if room_type is None:
                continue
            demand_key = (event.id, room_type.id, room_count)
            if demand_key in existing_demands:
                continue
            db.session.add(EventRoomDemand(
                event_id=event.id,
                room_type_id=room_type.id,
                room_count=room_count,
            ))
            existing_demands.add(demand_key)
            changed = True

    if changed:
        db.session.commit()


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
            warnings.append({'code': 'NATION_MISMATCH', 'level': 'warning', 'message': 'Zimmerpartner haben unterschiedliche Nationen'})
        g1 = _normalize_gender(athletes[0])
        g2 = _normalize_gender(athletes[1])
        if not g1 or not g2:
            warnings.append({'code': 'GENDER_UNKNOWN', 'level': 'warning', 'message': 'Geschlecht eines Zimmerpartners ist unbekannt'})
        elif g1 != g2:
            warnings.append({'code': 'GENDER_MISMATCH', 'level': 'warning', 'message': 'Zimmerpartner haben unterschiedliches Geschlecht'})
    return warnings


def _calculate_unit_validation(unit, slot, existing_bookings):
    blocking_messages = []
    warning_messages = []
    unit_room_type = _room_type_label(unit['roomType'])
    slot_room_type = _room_type_label(slot['roomTypeName'])
    allowed_room_type_labels = unit.get('allowedRoomTypeLabels') or [unit_room_type]
    occupant_count = len(unit.get('occupants', []))

    if occupant_count <= 1 and slot['capacity'] < 1:
        blocking_messages.append('Slot hat keine Kapazität')
    elif occupant_count == 2 and slot['capacity'] < 2:
        blocking_messages.append('Slot passt nicht für DZ-Einheit')
    elif unit_room_type == 'appartment' and slot['capacity'] < max(1, occupant_count):
        blocking_messages.append('Slot passt nicht für Apartment-Einheit')

    if unit_room_type and slot_room_type and slot_room_type not in allowed_room_type_labels and not (unit_room_type == 'appartment' and slot_room_type == 'appartment'):
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


def _find_booking_for_athlete(booking_map, athlete_id):
    bookings = booking_map.get(athlete_id) or []
    return bookings[0] if bookings else None


def _same_booking_for_all(bookings):
    filtered = [booking for booking in bookings if booking]
    if not filtered:
        return None
    first_id = filtered[0].id
    if all(booking.id == first_id for booking in filtered):
        return filtered[0]
    return None


def list_mock_fis_files():
    if not os.path.isdir(mock_files_dir):
        return []

    pairs = {}
    for filename in os.listdir(mock_files_dir):
        if not filename.lower().endswith(('.xlsx', '.xls')):
            continue
        upper = filename.upper()
        if upper.startswith('ENTRIES-LIST_'):
            discipline_key = filename.split('ENTRIES-LIST_', 1)[1].rsplit('.', 1)[0]
            entry = pairs.setdefault(discipline_key, {'disciplineKey': discipline_key})
            entry['entriesFile'] = filename
        elif upper.startswith('ENTRIES-ROOM-LIST-DETAILED_'):
            discipline_key = filename.split('ENTRIES-ROOM-LIST-DETAILED_', 1)[1].rsplit('.', 1)[0]
            entry = pairs.setdefault(discipline_key, {'disciplineKey': discipline_key})
            entry['roomFile'] = filename

    result = []
    for discipline_key, entry in sorted(pairs.items()):
        label = discipline_key
        if label.startswith('2027_WM_'):
            label = label.split('2027_WM_', 1)[1]
        label = label.replace('_', ' ').title()
        result.append({
            'discipline': label,
            'disciplineKey': discipline_key,
            'entriesFile': entry.get('entriesFile'),
            'roomFile': entry.get('roomFile'),
            'entriesDownloadUrl': f"/api/import/fis/mock-files/{entry['entriesFile']}" if entry.get('entriesFile') else None,
            'roomDownloadUrl': f"/api/import/fis/mock-files/{entry['roomFile']}" if entry.get('roomFile') else None,
        })
    return result


def _room_category_label(room_type_name):
    normalized = _room_type_label(room_type_name)
    if normalized == 'single':
        return 'ez'
    if normalized == 'double':
        return 'dz'
    return normalized


def _build_partial_unit_variant(unit, occupant):
    return {
        **unit,
        'occupants': [occupant],
        'occupantCount': 1,
        'allowedRoomTypeLabels': ['single', 'double'],
        'roomType': occupant.get('roomType') or unit['roomType'],
        'roomTypeLabel': 'single',
    }


def _build_room_booking_units():
    fis_assignments = FisRoomAssignment.query.options(
        db.joinedload(FisRoomAssignment.person1),
        db.joinedload(FisRoomAssignment.person2),
    ).order_by(FisRoomAssignment.check_in_date.asc().nullslast(), FisRoomAssignment.id.asc()).all()
    bookings = RoomBooking.query.options(db.joinedload(RoomBooking.occupants).joinedload(RoomBookingOccupant.athlete), db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()
    booking_index = {}
    athlete_booking_index = {}
    for booking in bookings:
        booking_index[tuple(_collect_booking_athlete_ids(booking))] = booking
        for occupant in booking.occupants or []:
            athlete_booking_index.setdefault(occupant.athlete_id, []).append(booking)

    units = []
    for assignment in fis_assignments:
        athletes = [assignment.person1]
        if assignment.person2:
            athletes.append(assignment.person2)
        athlete_ids = sorted([athlete.id for athlete in athletes if athlete])
        linked_booking = booking_index.get(tuple(athlete_ids))
        occupants = []
        athlete_level_bookings = []
        for athlete in athletes:
            if not athlete:
                continue
            pending_review = _has_pending_roomlist_review(athlete)
            athlete_booking = _find_booking_for_athlete(athlete_booking_index, athlete.id)
            # athlete_booking was populated from the eagerly loaded booking set above;
            # reusing it avoids one existence query per athlete.
            assigned_change = bool(pending_review and athlete_booking)
            athlete_level_bookings.append(athlete_booking)
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
                'isAssigned': bool(athlete_booking),
                'assignedBookingId': str(athlete_booking.id) if athlete_booking else None,
                'assignedHotelId': str(athlete_booking.hotel_id) if athlete_booking else None,
                'assignedRoomTypeId': str(athlete_booking.room_type_id) if athlete_booking else None,
                'assignedRoomNumber': athlete_booking.room_number if athlete_booking else None,
            })

        warnings = _derive_assignment_warnings(athletes, assignment.room_type)
        shared_booking = linked_booking or _same_booking_for_all(athlete_level_bookings)
        has_any_assigned = any(booking is not None for booking in athlete_level_bookings)
        is_fully_assigned = all(booking is not None for booking in athlete_level_bookings) if athlete_level_bookings else False
        units.append({
            'unitId': str(assignment.id),
            'sourceRowKey': assignment.source_row_key,
            'nationCode': athletes[0].nation_code if athletes and athletes[0] else '',
            'occupants': occupants,
            'roomType': assignment.room_type,
            'roomTypeLabel': _room_type_label(assignment.room_type),
            'roomCategoryLabel': _room_category_label(assignment.room_type),
            'occupantCount': len(occupants),
            'checkInDate': assignment.check_in_date.isoformat() if assignment.check_in_date else None,
            'checkOutDate': assignment.check_out_date.isoformat() if assignment.check_out_date else None,
            'specialMealFlags': [occ['specialMeal'] for occ in occupants if occ.get('specialMeal')],
            'statusBadges': sorted({badge for occ in occupants for badge in occ.get('statusBadges', [])}),
            'assignmentWarnings': warnings,
            'assignedBookingId': str(shared_booking.id) if shared_booking and is_fully_assigned else None,
            'assignedHotelId': str(shared_booking.hotel_id) if shared_booking and is_fully_assigned else None,
            'assignedRoomTypeId': str(shared_booking.room_type_id) if shared_booking and is_fully_assigned else None,
            'assignedRoomNumber': shared_booking.room_number if shared_booking and is_fully_assigned else None,
            'hasAnyAssigned': has_any_assigned,
            'isFullyAssigned': is_fully_assigned,
            'allowedRoomTypeLabels': ['single', 'double'] if len(occupants) == 1 else [_room_type_label(assignment.room_type)],
        })
    return units, bookings


def _build_assignment_planning_view():
    with _assignment_phase('assignment'):
        units, bookings = _build_room_booking_units()
    rooms_started = time.perf_counter()
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

    bookings_by_hotel_room_type = {}
    bookings_by_slot = {}
    for booking in bookings:
        hotel_room_type_key = (booking.hotel_id, booking.room_type_id)
        bookings_by_hotel_room_type.setdefault(hotel_room_type_key, []).append(booking)
        slot_key = (str(booking.hotel_id), str(booking.room_type_id), booking.room_number or '')
        bookings_by_slot.setdefault(slot_key, []).append(booking)

    hotel_sections = []
    for hotel in hotels:
        by_room_type = {}
        for inventory in hotel.room_inventories or []:
            by_room_type.setdefault(inventory.room_type_id, {'roomType': inventory.room_type, 'inventories': []})
            by_room_type[inventory.room_type_id]['inventories'].append(inventory)

        slots = []
        for room_type_id, payload in by_room_type.items():
            relevant_bookings = bookings_by_hotel_room_type.get((hotel.id, room_type_id), [])
            slots.extend(_build_virtual_slots(hotel, payload['roomType'], payload['inventories'], relevant_bookings))

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
                            'countsAsSingle': bool(booking.counts_as_single),
                            'capacity': slot['capacity'],
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
    if hasattr(g, 'assignment_perf'):
        g.assignment_perf['rooms'] = (time.perf_counter() - rooms_started) * 1000

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
                relevant_bookings = bookings_by_slot.get(
                    (slot['hotelId'], slot['roomTypeId'], slot['roomNumber'] or ''),
                    [],
                )
                validation = _calculate_unit_validation(unit, slot_copy, relevant_bookings)
                validations.append({
                    'slotId': slot['slotId'],
                    **validation,
                })
        validation_by_unit[unit['unitId']] = validations

        for occupant in unit.get('occupants', []):
            partial_validations = []
            partial_unit = _build_partial_unit_variant(unit, occupant)
            for hotel_section in hotel_sections:
                for slot in hotel_section['slots']:
                    slot_copy = dict(slot)
                    covers_requested_range = True
                    if slot['dateCoverage']['availableFrom'] and slot['dateCoverage']['availableUntil'] and partial_unit.get('checkInDate') and partial_unit.get('checkOutDate'):
                        covers_requested_range = slot['dateCoverage']['availableFrom'] <= partial_unit['checkInDate'] and slot['dateCoverage']['availableUntil'] >= partial_unit['checkOutDate']
                    slot_copy['dateCoverage'] = dict(slot['dateCoverage'])
                    slot_copy['dateCoverage']['coversRequestedRange'] = covers_requested_range
                    relevant_bookings = bookings_by_slot.get(
                        (slot['hotelId'], slot['roomTypeId'], slot['roomNumber'] or ''),
                        [],
                    )
                    partial_validation = _calculate_unit_validation(partial_unit, slot_copy, relevant_bookings)
                    partial_validations.append({
                        'slotId': slot['slotId'],
                        **partial_validation,
                    })
            validation_by_unit[f"{unit['unitId']}:athlete:{occupant['athleteId']}"] = partial_validations

        if unit.get('isFullyAssigned'):
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
        'counts_as_single': bool(data.get('countsAsSingle', False)),
    }, room_type, None


def _save_booking_from_payload(payload, existing_booking=None):
    if existing_booking is None:
        booking = RoomBooking(
            hotel_id=payload['hotel_id'],
            room_type_id=payload['room_type_id'],
            room_number=payload['room_number'],
            check_in_date=payload['check_in_date'],
            check_out_date=payload['check_out_date'],
            counts_as_single=payload.get('counts_as_single', False),
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
        booking.counts_as_single = payload.get('counts_as_single', False)
        RoomBookingOccupant.query.filter_by(room_booking_id=booking.id).delete()

    for athlete_id in payload['athlete_ids']:
        db.session.add(RoomBookingOccupant(room_booking_id=booking.id, athlete_id=athlete_id))
    db.session.commit()
    return booking


def _detach_athletes_from_existing_bookings(athlete_ids, exclude_booking_id=None):
    for athlete_id in athlete_ids:
        memberships = RoomBookingOccupant.query.filter_by(athlete_id=athlete_id).all()
        for membership in memberships:
            booking = membership.room_booking
            if not booking:
                continue
            if exclude_booking_id and booking.id == exclude_booking_id:
                continue
            db.session.delete(membership)
            db.session.flush()
            remaining = RoomBookingOccupant.query.filter_by(room_booking_id=booking.id).count()
            if remaining == 0:
                db.session.delete(booking)
    db.session.commit()


def _refresh_fis_assignment_links():
    booking_memberships = RoomBookingOccupant.query.options(db.joinedload(RoomBookingOccupant.room_booking)).all()
    athlete_booking_map = {}
    for membership in booking_memberships:
        if membership.room_booking:
            athlete_booking_map.setdefault(membership.athlete_id, []).append(membership.room_booking)

    assignments = FisRoomAssignment.query.all()
    for assignment in assignments:
        person1_bookings = athlete_booking_map.get(assignment.person1_id, [])
        if assignment.person2_id:
            person2_bookings = athlete_booking_map.get(assignment.person2_id, [])
            shared_booking = None
            for first_booking in person1_bookings:
                if any(second_booking.id == first_booking.id for second_booking in person2_bookings):
                    shared_booking = first_booking
                    break
            if shared_booking:
                assignment.hotel_id = shared_booking.hotel_id
                assignment.room_number = shared_booking.room_number
            else:
                assignment.hotel_id = None
                assignment.room_number = None
        else:
            booking = person1_bookings[0] if person1_bookings else None
            assignment.hotel_id = booking.hotel_id if booking else None
            assignment.room_number = booking.room_number if booking else None
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

    bookings = RoomBooking.query.options(
        db.joinedload(RoomBooking.occupants).joinedload(RoomBookingOccupant.athlete),
        db.joinedload(RoomBooking.room_type),
    ).all()
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
            if booking.room_type and (booking.room_type.max_persons == 1 or booking.counts_as_single):
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

    def ensure_room_booking_columns():
        cols = db.session.execute(text("PRAGMA table_info(room_booking)")).fetchall()
        existing = {c[1] for c in cols}
        needed = {
            "counts_as_single": "BOOLEAN DEFAULT 0",
        }
        for name, sql_type in needed.items():
            if name not in existing:
                db.session.execute(text(f"ALTER TABLE room_booking ADD COLUMN {name} {sql_type}"))
        db.session.commit()

    ensure_room_booking_columns()

    def ensure_import_approval_columns():
        cols = db.session.execute(text("PRAGMA table_info(import_approval)")).fetchall()
        existing = {c[1] for c in cols}
        needed = {
            "approval_method": "VARCHAR(20)", "approval_by": "VARCHAR(200)",
            "approval_date": "DATETIME", "contact_subject": "VARCHAR(300)",
            "deadline_at": "DATETIME",
        }
        for name, sql_type in needed.items():
            if name not in existing:
                db.session.execute(text(f"ALTER TABLE import_approval ADD COLUMN {name} {sql_type}"))
        db.session.commit()

    ensure_import_approval_columns()

    def ensure_event_planning_columns():
        """Keep existing SQLite installations compatible with person-based planning."""
        cols = db.session.execute(text("PRAGMA table_info(event)")).fetchall()
        existing = {c[1] for c in cols}
        if "person_demand" not in existing:
            db.session.execute(text("ALTER TABLE event ADD COLUMN person_demand INTEGER NOT NULL DEFAULT 0"))
        if "single_room_percentage" not in existing:
            db.session.execute(text("ALTER TABLE event ADD COLUMN single_room_percentage INTEGER NOT NULL DEFAULT 50"))
        # The ORM-based reference-data setup must only run after every mapped
        # Event column exists in an older database.
        db.session.commit()
        ensure_reference_data()
        # Preserve the capacity represented by legacy room demands as the initial input.
        db.session.execute(text("""
            UPDATE event SET person_demand = COALESCE((
                SELECT SUM(d.room_count * rt.max_persons)
                FROM event_room_demand d JOIN room_type rt ON rt.id = d.room_type_id
                WHERE d.event_id = event.id
            ), 0) WHERE person_demand = 0
        """))
        db.session.commit()

    ensure_event_planning_columns()

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

            try:
                file_type = detect_fis_file_type(tmp_path, display_name=file_storage.filename)
            except InvalidExcelFileError as exc:
                return jsonify({
                    'error': str(exc),
                    'details': {
                        'filename': file_storage.filename,
                        'field': field_name,
                    },
                }), 400
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
        session_id = request.form.get('sessionId')
        if request.form.get('createSession') == 'true' or session_id:
            nations = sorted({person.get('nationCode') for person in result['people'] if person.get('nationCode')})
            if len(nations) != 1:
                return jsonify({'error': 'Eine Import Session muss genau eine Nation enthalten.', 'nations': nations}), 400
            nation = nations[0]
            quota_issues = [issue for issue in result['warnings'] if issue.get('code', '').startswith('QUOTA_')]
            status = 'DRAFT' if result['errors'] else ('WAITING_FOR_NATION' if quota_issues else 'PROFESSIONALLY_REVIEWED')
            user = current_user()
            session = ImportSession.query.get(int(session_id)) if session_id else None
            if session and session.nation != nation:
                return jsonify({'error': 'Eine Version kann nur zur Session derselben Nation hinzugefügt werden.'}), 409
            if session and session.status == 'IMPORTED':
                return jsonify({'error': 'Eine importierte Session kann keine neue Version erhalten.'}), 409
            if not session:
                # Reuse the nation's active workflow rather than creating parallel imports.
                session = ImportSession.query.filter_by(nation=nation).filter(
                    ImportSession.status.notin_(['IMPORTED', 'ARCHIVED', 'REPLACED'])).order_by(ImportSession.created_at.desc()).first()
            is_new = session is None
            if is_new:
                session = ImportSession(nation=nation, discipline=result.get('detectedDiscipline'), version=0,
                    status='DRAFT', uploaded_by=user.username)
                db.session.add(session)
                db.session.flush()
            session.version += 1
            session.discipline = result.get('detectedDiscipline')
            session.status = status if is_new else ('DRAFT' if result['errors'] else 'NEW_LIST_RECEIVED')
            session.preview_token, session.preview_json = result['previewToken'], json.dumps(result, ensure_ascii=False)
            session.uploaded_by = user.username
            session.approved_at = session.approved_by = None
            session.approvals.clear()
            db.session.add(ImportSessionVersion(session_id=session.id, version=session.version,
                preview_token=result['previewToken'], preview_json=session.preview_json, uploaded_by=user.username))
            db.session.add(ImportSessionEvent(session_id=session.id, event_type='VERSION_RECEIVED',
                title=f'Version {session.version} erhalten',
                description='Neue Meldeliste gespeichert; technische Prüfung abgeschlossen.' if not result['errors'] else 'Neue Meldeliste gespeichert; technische Fehler gefunden.',
                username=user.username))
            for issue in quota_issues:
                details = issue.get('details') or {}
                combination = ' • '.join(filter(None, [details.get('nationCode'), details.get('discipline'), details.get('gender')]))
                db.session.add(ImportApproval(session_id=session.id, nation=nation,
                    approval_type=issue.get('code', 'QUOTA'), description=issue.get('message', ''),
                    decision='PENDING', username=user.username))
                db.session.add(ImportSessionEvent(session_id=session.id, event_type='QUOTA_VIOLATION',
                    title='Single Room Quote verletzt' if issue.get('code') == 'QUOTA_SINGLE_ROOMS_EXCEEDED' else 'Official Quote verletzt',
                    description=combination, username=user.username))
            if not quota_issues and not result['errors']:
                db.session.add(ImportSessionEvent(session_id=session.id, event_type='QUOTA_PASSED',
                    title='Quote erfüllt', description='Alle Kombinationen aus Nation, Disziplin und Gender sind erfüllt.',
                    username=user.username))
            db.session.commit()
            result['session'] = session.to_dict(include_preview=True)
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


@app.route('/api/import/sessions', methods=['GET'])
def list_import_sessions():
    sessions = ImportSession.query.order_by(ImportSession.created_at.desc()).all()
    return jsonify([session.to_dict() for session in sessions])


@app.route('/api/import/sessions/<int:session_id>', methods=['GET'])
def get_import_session(session_id):
    return jsonify(ImportSession.query.get_or_404(session_id).to_dict(include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/approvals/<int:approval_id>', methods=['PATCH'])
def decide_import_approval(session_id, approval_id):
    session = ImportSession.query.get_or_404(session_id)
    approval = ImportApproval.query.filter_by(id=approval_id, session_id=session.id).first_or_404()
    data = request.get_json(silent=True) or {}
    decision = data.get('decision')
    if decision not in {'APPROVED', 'NEW_LIST_ANNOUNCED'}:
        return jsonify({'error': 'decision must be APPROVED or NEW_LIST_ANNOUNCED'}), 400
    approval_type = data.get('approvalType')
    if decision == 'APPROVED' and approval_type not in {'NATION_APPROVED', 'ORGANIZER_APPROVED'}:
        return jsonify({'error': 'approvalType must identify the approving party'}), 400
    method = data.get('approvalMethod', 'EMAIL')
    if method not in {'EMAIL', 'PHONE'}:
        return jsonify({'error': 'approvalMethod must be EMAIL or PHONE'}), 400
    approval_by = str(data.get('approvalBy') or '').strip()
    if not approval_by:
        return jsonify({'error': 'approvalBy is required'}), 400
    try:
        approval_date = datetime.fromisoformat(str(data.get('approvalDate')).replace('Z', '+00:00')).replace(tzinfo=None)
        deadline_at = datetime.fromisoformat(str(data.get('deadlineAt')).replace('Z', '+00:00')).replace(tzinfo=None) if data.get('deadlineAt') else None
    except (TypeError, ValueError):
        return jsonify({'error': 'approvalDate or deadlineAt is invalid'}), 400
    if approval_type == 'ORGANIZER_APPROVED' and not deadline_at:
        return jsonify({'error': 'deadlineAt is required for organizer approval'}), 400
    approval.decision = decision
    approval.approval_type = approval_type or approval.approval_type
    approval.approval_method = method
    approval.approval_by = approval_by
    approval.approval_date = approval_date
    approval.contact_subject = str(data.get('contactSubject') or '').strip() or None
    approval.deadline_at = deadline_at
    approval.comment = data.get('comment')
    approval.username = current_user().username
    approval.created_at = datetime.utcnow()
    session.status = 'EXCEPTION_APPROVED' if all(a.decision == 'APPROVED' for a in session.approvals) else 'WAITING_FOR_NATION'
    db.session.add(ImportSessionEvent(session_id=session.id, event_type='NATION_CONTACT',
        title=f'Rückfrage an Nation per {"E-Mail" if method == "EMAIL" else "Telefon"}',
        description=f'{approval_by}' + (f' · {data.get("contactSubject")}' if data.get('contactSubject') else ''),
        username=current_user().username))
    result_title = ('Neue Meldeliste angekündigt' if decision == 'NEW_LIST_ANNOUNCED' else
                    ('Organisatorische Freigabe' if approval_type == 'ORGANIZER_APPROVED' else 'Ausnahme durch Nation genehmigt'))
    db.session.add(ImportSessionEvent(session_id=session.id, event_type='QUOTA_DECISION',
        title=result_title, description=data.get('comment'), username=current_user().username))
    db.session.add(ImportSessionEvent(session_id=session.id, event_type='STATUS_CHANGED',
        title='Status', description='Warten auf Nation' if decision == 'NEW_LIST_ANNOUNCED' else 'Ausnahme genehmigt',
        username=current_user().username))
    db.session.commit()
    return jsonify(session.to_dict(include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/approve', methods=['POST'])
def approve_import_session(session_id):
    session = ImportSession.query.get_or_404(session_id)
    preview = json.loads(session.preview_json or '{}')
    if preview.get('errors'):
        return jsonify({'error': 'Blockierende Fehler müssen zuerst behoben werden.'}), 409
    if any(approval.decision != 'APPROVED' for approval in session.approvals):
        return jsonify({'error': 'Alle erforderlichen Entscheidungen müssen getroffen werden.'}), 409
    if session.status in {'IMPORTED', 'REPLACED', 'ARCHIVED'}:
        return jsonify({'error': 'Diese Session kann nicht mehr freigegeben werden.'}), 409
    session.status, session.approved_at = 'APPROVED', datetime.utcnow()
    session.approved_by = current_user().username
    db.session.add(ImportSessionEvent(session_id=session.id, event_type='APPROVED',
        title='Import freigegeben', description='Technische und fachliche Prüfung abgeschlossen.',
        username=current_user().username))
    db.session.commit()
    return jsonify(session.to_dict(include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/import', methods=['POST'])
def import_approved_session(session_id):
    session = ImportSession.query.get_or_404(session_id)
    if session.status != 'APPROVED' or not session.approved_at:
        return jsonify({'error': 'Die Session muss vor dem Import explizit freigegeben werden.'}), 409
    try:
        result = confirm_fis_import(session.preview_token)
        now = datetime.utcnow()
        session.status, session.imported_at = 'IMPORTED', now
        db.session.add(ImportSessionEvent(session_id=session.id, event_type='IMPORTED',
            title=f'Version {session.version} importiert',
            description='Operative Dispositionen wurden nicht verändert.', username=current_user().username))
        db.session.commit()
        result['session'] = session.to_dict()
        return jsonify(result)
    except Exception as exc:
        db.session.rollback()
        session.status, session.error_message = 'ERROR', str(exc)
        db.session.commit()
        return jsonify({'error': str(exc)}), 400


@app.route('/api/import/sessions/<int:session_id>/archive', methods=['POST'])
def archive_import_session(session_id):
    session = ImportSession.query.get_or_404(session_id)
    if session.status not in {'IMPORTED', 'REPLACED', 'ERROR'}:
        return jsonify({'error': 'Nur abgeschlossene Sessions können archiviert werden.'}), 409
    session.status, session.archived_at = 'ARCHIVED', datetime.utcnow()
    db.session.commit()
    return jsonify(session.to_dict())


@app.route('/api/import/sessions/<int:session_id>/history', methods=['POST'])
def add_import_session_history(session_id):
    session = ImportSession.query.get_or_404(session_id)
    data = request.get_json(silent=True) or {}
    description = str(data.get('description') or '').strip()
    if not description:
        return jsonify({'error': 'description is required'}), 400
    event = ImportSessionEvent(session_id=session.id, event_type='NOTE',
        title=str(data.get('title') or 'Rücksprache dokumentiert'), description=description,
        username=current_user().username)
    db.session.add(event)
    if data.get('waitingForNation'):
        session.status = 'WAITING_FOR_NATION'
    db.session.commit()
    return jsonify(session.to_dict(include_preview=True)), 201


@app.route('/api/import/fis/mock-files', methods=['GET'])
@app.route('/api/import/fis/mock-files/', methods=['GET'])
def get_mock_fis_files():
    return jsonify(list_mock_fis_files())


@app.route('/api/import/fis/mock-files/<path:filename>', methods=['GET'])
@app.route('/api/import/fis/mock-files/<path:filename>/', methods=['GET'])
def download_mock_fis_file(filename):
    return send_from_directory(mock_files_dir, filename, as_attachment=True)


@app.route('/api/import/fis/mock-files/download-all', methods=['GET'])
@app.route('/api/import/fis/mock-files/download-all/', methods=['GET'])
def download_all_mock_fis_files():
    memory_file = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp_dir:
        generated = generate_mock_files(Path(tmp_dir))
        with zipfile.ZipFile(memory_file, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in generated:
                entries_path = entry.get('entries_path')
                room_path = entry.get('room_path')
                if entries_path and os.path.exists(entries_path):
                    archive.write(entries_path, arcname=os.path.basename(entries_path))
                if room_path and os.path.exists(room_path):
                    archive.write(room_path, arcname=os.path.basename(room_path))

    memory_file.seek(0)
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name='fis-mock-files.zip',
    )


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

@app.route('/api/auth/me', methods=['GET'])
def get_authenticated_user():
    return jsonify(current_user().to_dict())


@app.route('/api/audit-events', methods=['GET'])
def get_audit_events():
    page = max(request.args.get('page', 1, type=int), 1)
    per_page = min(max(request.args.get('perPage', 50, type=int), 1), 200)
    query = AuditEvent.query
    if request.args.get('username'):
        query = query.filter(AuditEvent.username == request.args['username'])
    if request.args.get('action'):
        query = query.filter(AuditEvent.action == request.args['action'])
    if request.args.get('entityType'):
        query = query.filter(AuditEvent.entity_type == request.args['entityType'])
    result = query.order_by(AuditEvent.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        'items': [event.to_dict() for event in result.items],
        'page': result.page,
        'perPage': result.per_page,
        'total': result.total,
        'pages': result.pages,
    })

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


@app.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['PUT'])
@app.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['PUT'])
@app.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['PUT'])
@app.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['PUT'])
def update_hotel_inventory(hotel_id, inventory_id):
    inventory = HotelRoomInventory.query.filter_by(id=inventory_id, hotel_id=hotel_id).first_or_404()
    data = request.json
    inventory.room_type_id = int(data['roomTypeId'])
    inventory.available_from = datetime.fromisoformat(data['availableFrom']).date()
    inventory.available_until = datetime.fromisoformat(data['availableUntil']).date()
    inventory.room_count = int(data['roomCount'])
    inventory.has_half_board = data.get('hasHalfBoard', False)
    inventory.has_sr = data.get('hasSR', False)
    db.session.commit()
    return jsonify(inventory.to_dict())


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
        end_date=datetime.fromisoformat(data['endDate']).date(),
        person_demand=max(0, int(data['personDemand'])),
        single_room_percentage=max(0, min(100, int(data.get('singleRoomPercentage', 50))))
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
    if 'personDemand' in data:
        event.person_demand = max(0, int(data['personDemand']))
    if 'singleRoomPercentage' in data:
        event.single_room_percentage = max(0, min(100, int(data['singleRoomPercentage'])))

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
    return jsonify({'error': 'Zimmerbedarf wird automatisch aus Personenbedarf und Belegungsstrategie berechnet.'}), 405


@app.route('/api/events/<int:event_id>/demand/<int:demand_id>', methods=['DELETE'])
def delete_event_demand(event_id, demand_id):
    return jsonify({'error': 'Berechneter Zimmerbedarf kann nicht manuell geändert werden.'}), 405


# Athletes
@app.route('/api/nations', methods=['GET'])
@app.route('/api/nations/', methods=['GET'])
def get_nations():
    """Return the canonical, uncached nation master data for every filter."""
    nations = Nation.query.order_by(Nation.code).all()
    response = jsonify([nation.to_dict() for nation in nations])
    response.headers['Cache-Control'] = 'no-store'
    return response


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

    # Legacy databases may contain one row per import/event.  The public athlete
    # resource represents people and is therefore grouped by the existing FIS
    # identity. Rows without a FIS code remain distinct for backwards
    # compatibility until their authoritative identifier arrives.
    people = {}
    for athlete in athletes:
        identity = ('fis', athlete.fis_code.strip().upper()) if athlete.fis_code else ('legacy', athlete.id)
        people.setdefault(identity, []).append(athlete)

    result = []
    for identity, records in people.items():
        a = max(records, key=lambda row: (row.updated_at or row.created_at or datetime.min, row.id))
        data = a.to_dict()
        record_ids = {record.id for record in records}
        data['id'] = str(min(record_ids))
        data['sourceRecordIds'] = [str(value) for value in sorted(record_ids)]
        data['disciplines'] = sorted({record.discipline for record in records if record.discipline})
        data['stays'] = [
            {
                'arrivalDate': record.arrival_date.isoformat() if record.arrival_date else None,
                'departureDate': record.departure_date.isoformat() if record.departure_date else None,
                'discipline': record.discipline,
            }
            for record in records
            if record.arrival_date or record.departure_date
        ]

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

        assignments = [assignment_map[value] for value in record_ids if value in assignment_map]
        data['assignments'] = assignments
        data['assignment'] = assignments[0] if assignments else {
            'hasAssignment': False,
            'hotelName': None,
            'hotelId': None,
            'roomNumber': None,
            'roomTypeName': None,
            'checkInDate': None,
            'checkOutDate': None,
            'bookingId': None,
        }
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
    with _assignment_phase('quota'):
        rows = _build_official_quota_usage_rows(
            nation_code=nation_code,
            discipline=discipline,
            gender=gender
        )
    return _assignment_jsonify(rows)


@app.route('/api/assignments/planning-view', methods=['GET'])
@app.route('/api/assignments/planning-view/', methods=['GET'])
def get_assignments_planning_view():
    return _assignment_jsonify(_build_assignment_planning_view())


@app.route('/api/assignments/units/<int:unit_id>/assign', methods=['POST'])
@app.route('/api/assignments/units/<int:unit_id>/assign/', methods=['POST'])
@_measure_assignment_logic
def assign_room_booking_unit(unit_id):
    assignment = FisRoomAssignment.query.get_or_404(unit_id)
    data = request.json or {}
    allowed_athlete_ids = [assignment.person1_id]
    if assignment.person2_id:
        allowed_athlete_ids.append(assignment.person2_id)
    raw_athlete_ids = data.get('athleteIds') or [str(athlete_id) for athlete_id in allowed_athlete_ids]
    athlete_ids = sorted({int(athlete_id) for athlete_id in raw_athlete_ids})
    if not athlete_ids or any(athlete_id not in allowed_athlete_ids for athlete_id in athlete_ids):
        return _booking_error('INVALID_OCCUPANTS', 'athleteIds must belong to the selected FIS room unit')

    payload_data = {
        'athleteIds': [str(athlete_id) for athlete_id in athlete_ids],
        'hotelId': data.get('hotelId'),
        'roomTypeId': data.get('roomTypeId'),
        'roomNumber': data.get('roomNumber'),
        'checkInDate': data.get('checkInDate') or (assignment.check_in_date.isoformat() if assignment.check_in_date else None),
        'checkOutDate': data.get('checkOutDate') or (assignment.check_out_date.isoformat() if assignment.check_out_date else None),
        'countsAsSingle': data.get('countsAsSingle', False),
    }

    existing_booking = None
    if data.get('assignedBookingId'):
        existing_booking = RoomBooking.query.get(int(data['assignedBookingId']))
    else:
        athlete_id_tuple = tuple(sorted(athlete_ids))
        for booking in RoomBooking.query.options(db.joinedload(RoomBooking.occupants)).all():
            if tuple(_collect_booking_athlete_ids(booking)) == athlete_id_tuple:
                existing_booking = booking
                break

    payload, _, error = _validate_booking_payload(payload_data, existing_booking=existing_booking)
    if error:
        return error
    _detach_athletes_from_existing_bookings(payload['athlete_ids'], exclude_booking_id=existing_booking.id if existing_booking else None)
    booking = _save_booking_from_payload(payload, existing_booking=existing_booking)
    _refresh_fis_assignment_links()
    return _assignment_jsonify(booking.to_dict()), 200 if existing_booking else 201


@app.route('/api/assignments/bookings/<int:booking_id>', methods=['PUT'])
@app.route('/api/assignments/bookings/<int:booking_id>/', methods=['PUT'])
@_measure_assignment_logic
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
        'countsAsSingle': data.get('countsAsSingle', booking.counts_as_single),
    }
    payload, _, error = _validate_booking_payload(payload_data, existing_booking=booking)
    if error:
        return error
    _detach_athletes_from_existing_bookings(payload['athlete_ids'], exclude_booking_id=booking.id)
    booking = _save_booking_from_payload(payload, existing_booking=booking)
    _refresh_fis_assignment_links()
    return jsonify(booking.to_dict())


@app.route('/api/assignments/bookings/<int:booking_id>/unassign', methods=['POST'])
@app.route('/api/assignments/bookings/<int:booking_id>/unassign/', methods=['POST'])
@_measure_assignment_logic
def unassign_room_booking_unit(booking_id):
    booking = RoomBooking.query.get_or_404(booking_id)
    db.session.delete(booking)
    db.session.commit()
    _refresh_fis_assignment_links()
    return jsonify({'success': True, 'bookingId': str(booking_id)})


@app.route('/api/assignments/bookings/<int:booking_id>/occupants/<int:athlete_id>/unassign', methods=['POST'])
@app.route('/api/assignments/bookings/<int:booking_id>/occupants/<int:athlete_id>/unassign/', methods=['POST'])
@_measure_assignment_logic
def unassign_room_booking_occupant(booking_id, athlete_id):
    booking = RoomBooking.query.get_or_404(booking_id)
    membership = RoomBookingOccupant.query.filter_by(room_booking_id=booking.id, athlete_id=athlete_id).first()
    if not membership:
        return jsonify({'error': 'Not found', 'message': 'Occupant is not part of the booking'}), 404

    db.session.delete(membership)
    db.session.flush()
    remaining = RoomBookingOccupant.query.filter_by(room_booking_id=booking.id).count()
    if remaining == 0:
        db.session.delete(booking)
    db.session.commit()
    _refresh_fis_assignment_links()
    return jsonify({'success': True, 'bookingId': str(booking_id), 'athleteId': str(athlete_id)})


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
