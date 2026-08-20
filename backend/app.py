from flask import Flask, g, request, jsonify, send_from_directory, send_file, has_request_context
from flask_cors import CORS
from models import db, AuditEvent, RoomType, Hotel, HotelRoomInventory, Event, EventRoomDemand, Athlete, RoomAssignment, RoomBooking, RoomBookingOccupant, ImportRun, FisRoomAssignment, ImportSession, ImportSessionVersion, ImportSessionEvent, ImportApproval
from auth import load_user_from_request, current_user
from quota_service import evaluate_quota_usage
from datetime import datetime
import hashlib
import os
import re
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
from scenario_generator import SCENARIOS, generate_complete_suite, generate_scenario
from config import RuntimeSettings
from logging_config import configure_logging
from database_admin import database_admin

settings = RuntimeSettings.from_environment()
configure_logging(settings.log_level)
app = Flask(__name__)
settings.apply(app)
if settings.cors_origins:
    CORS(app, origins=list(settings.cors_origins))

mock_files_dir = str(settings.mock_files_dir)
db.init_app(app)
app.register_blueprint(database_admin)


@app.route('/health', methods=['GET'])
def health_check():
    """Report application and selected database connectivity for orchestration."""
    try:
        db.session.execute(text('SELECT 1'))
    except Exception:
        db.session.rollback()
        app.logger.exception('Database health check failed')
        return jsonify({'status': 'unhealthy', 'databaseBackend': 'postgresql'}), 503
    return jsonify({'status': 'healthy', 'databaseBackend': 'postgresql'})


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
    'athletes': ('Athleten', 'Zimmerpartner', 'Prüfmarkierungen'),
    'assignments': ('Zimmerbelegungen', 'Assignments', 'Dispositionsstatus'),
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
        if scope in {'assignments', 'athletes', 'all'}:
            # Athlete deletion also has to detach all dependent assignments.
            models = (
                ('Zimmerbelegungen', RoomBookingOccupant), ('Buchungen', RoomBooking),
                ('Assignments', RoomAssignment), ('FIS Assignments', FisRoomAssignment),
            )
            if scope in {'athletes', 'all'}:
                models += (('Athleten', Athlete),)
            for label, model in models:
                counts[label] = model.query.delete(synchronize_session=False)
        if scope in {'imports', 'all'}:
            # Break nullable cycle links before deleting children and parents.
            ImportSession.query.update(
                {ImportSession.current_version_id: None},
                synchronize_session=False,
            )
            # Establish the session/version cycle break in PostgreSQL before
            # any dependent bulk DELETE is issued.
            db.session.flush()
            Athlete.query.update(
                {Athlete.single_room_decision_id: None}, synchronize_session=False)
            FisRoomAssignment.query.update(
                {FisRoomAssignment.import_run_id: None}, synchronize_session=False)
            counts['Import Historie'] = ImportSessionEvent.query.delete(synchronize_session=False)
            counts['Genehmigungen'] = ImportApproval.query.delete(synchronize_session=False)
            counts['Import Versionen'] = ImportSessionVersion.query.delete(synchronize_session=False)
            counts['Import Sessions'] = ImportSession.query.delete(synchronize_session=False)
            counts['Import-Läufe'] = ImportRun.query.delete(synchronize_session=False)
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


@app.route('/api/admin/scenarios/complete/generate', methods=['POST'])
def download_complete_scenarios():
    """Build the complete chronological regression workspace."""
    memory_file = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = generate_complete_suite(Path(tmp_dir))
        with zipfile.ZipFile(memory_file, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(root.rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(root.parent))
    memory_file.seek(0)
    return send_file(memory_file, mimetype='application/zip', as_attachment=True,
                     download_name='Kompletter_Testordner.zip')


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
    # Keep the fachliche description of objects that may be deleted by the
    # endpoint. This snapshot is request-local and contains no transport data.
    g.audit_snapshot = None
    if request.method in {'PUT', 'PATCH', 'DELETE', 'POST'}:
        parts = [part for part in request.path.split('/') if part]
        numeric = [int(part) for part in parts if part.isdigit()]
        try:
            if request.path.startswith('/api/assignments/bookings/') and numeric:
                booking = db.session.get(RoomBooking, numeric[0])
                g.audit_snapshot = booking.to_dict() if booking else None
            elif request.path.startswith('/api/room-assignments/') and numeric:
                booking = db.session.get(RoomBooking, numeric[0])
                g.audit_snapshot = booking.to_dict() if booking else None
            elif request.path.startswith('/api/hotels/') and numeric:
                hotel = db.session.get(Hotel, numeric[0])
                g.audit_snapshot = hotel.to_dict() if hotel else None
            elif request.path.startswith('/api/athletes/') and numeric:
                athlete = db.session.get(Athlete, numeric[0])
                g.audit_snapshot = athlete.to_dict() if athlete else None
            elif request.path.startswith('/api/room-types/') and numeric:
                room_type = db.session.get(RoomType, numeric[0])
                g.audit_snapshot = room_type.to_dict() if room_type else None
        except (ValueError, TypeError):
            g.audit_snapshot = None
    return None


def _audit_entity():
    parts = [part for part in request.path.removeprefix('/api/').split('/') if part]
    entity_type = parts[0] if parts else 'api'
    entity_id = next((part for part in parts[1:] if part.isdigit()), None)
    return entity_type, entity_id


def _business_activity(entity_type, entity_id, action, payload, response):
    """Turn a successful mutation into a stable, presentation-ready domain event."""
    payload, response = payload or {}, response if isinstance(response, dict) else {}
    snapshot = getattr(g, 'audit_snapshot', None)
    if isinstance(snapshot, dict):
        # Response values describe the new state; snapshot values fill details
        # that a delete/unassign response can no longer return.
        response = {**snapshot, **response}
    refs, details = {}, []
    category, title, label = 'Stammdaten', 'Stammdaten geändert', 'Stammdaten'

    def ref(name, value):
        if value is not None:
            refs[name] = str(value)

    if entity_type in {'assignments', 'room-assignments'}:
        category = 'Disposition'
        booking = response
        occupants = booking.get('occupants') or []
        athletes = [item.get('athlete') or {} for item in occupants]
        athlete_ids = payload.get('athleteIds') or [a.get('id') for a in athletes]
        path_ids = [part for part in request.path.split('/') if part.isdigit()]
        if '/occupants/' in request.path and path_ids:
            athlete_ids = [path_ids[-1]]
        for index, athlete_id in enumerate(filter(None, athlete_ids)):
            ref('personId' if index == 0 else f'personId{index + 1}', athlete_id)
        booking_id = booking.get('id') or (path_ids[0] if path_ids else entity_id)
        ref('bookingId', booking_id)
        hotel = booking.get('hotel') or {}
        room_type = booking.get('roomType') or {}
        ref('hotelId', hotel.get('id') or payload.get('hotelId'))
        ref('roomId', booking_id)
        names = [' '.join(filter(None, [a.get('firstname'), a.get('lastname')])).strip() for a in athletes]
        label = ', '.join(filter(None, names)) or 'Zimmerbelegung'
        if 'unassign' in request.path or action == 'delete':
            title = 'Zimmerzuweisung entfernt'
        elif request.method == 'PUT':
            title = 'EZ-Markierung gesetzt' if set(payload) == {'countsAsSingle'} and payload.get('countsAsSingle') else ('EZ-Markierung entfernt' if set(payload) == {'countsAsSingle'} else 'Zimmerpartner geändert')
        else:
            title = 'Zimmer zugewiesen'
        if hotel.get('name'):
            details.append(f"Hotel: {hotel['name']}")
        room = ' – '.join(filter(None, [room_type.get('name'), booking.get('roomNumber')]))
        if room:
            details.append(f'Zimmer: {room}')

    elif entity_type == 'hotels':
        hotel_id = entity_id or response.get('id')
        ref('hotelId', hotel_id)
        label = response.get('name') or payload.get('name') or 'Hotel'
        if '/inventory' in request.path:
            category = 'Hotels'
            ref('roomId', response.get('id') or (request.path.rstrip('/').split('/')[-1] if request.path.rstrip('/').split('/')[-1].isdigit() else None))
            title = {'create': 'Zimmerkontingent erstellt', 'update': 'Zimmerkontingent geändert', 'delete': 'Zimmerkontingent entfernt'}.get(action, 'Zimmerkontingent geändert')
            hotel = Hotel.query.get(int(hotel_id)) if hotel_id else None
            label = hotel.name if hotel else label
            room_type_id = response.get('roomTypeId') or payload.get('roomTypeId')
            room_type = RoomType.query.get(int(room_type_id)) if room_type_id else None
            if room_type:
                details.append(room_type.name)
            count = response.get('roomCount', payload.get('roomCount'))
            if count is not None:
                details.append(f'{count} Zimmer')
        else:
            category = 'Hotels'
            title = {'create': 'Hotel angelegt', 'update': 'Hotel bearbeitet', 'delete': 'Hotel entfernt'}.get(action, 'Hotel bearbeitet')

    elif entity_type == 'athletes':
        athlete_id = entity_id or response.get('id')
        ref('personId', athlete_id)
        label = ' '.join(filter(None, [response.get('firstname') or payload.get('firstname'), response.get('lastname') or payload.get('lastname')])).strip() or 'Athlet'
        title = 'Athlet angelegt' if action == 'create' else 'Athlet bearbeitet'

    elif entity_type == 'events':
        ref('eventId', entity_id or response.get('id'))
        label = response.get('discipline') or payload.get('discipline') or 'Event'
        title = 'Event geändert' if action != 'create' else 'Event angelegt'

    elif entity_type == 'room-types':
        ref('roomTypeId', entity_id or response.get('id'))
        label = response.get('name') or payload.get('name') or 'Zimmertyp'
        title = 'Zimmertyp geändert' if action != 'create' else 'Zimmertyp angelegt'

    elif entity_type == 'import':
        category = 'Entscheidungen' if '/approvals/' in request.path else 'Import'
        ids = [part for part in request.path.split('/') if part.isdigit()]
        session_id = ids[0] if '/sessions/' in request.path and ids else response.get('id')
        ref('importSessionId', session_id)
        if '/approvals/' in request.path and ids:
            ref('decisionId', ids[-1])
        ref('nationId', response.get('nation') or payload.get('nation'))
        label = response.get('nation') or payload.get('nation') or 'Importsession'
        if request.path.endswith('/approve'):
            title = 'Import freigegeben'
        elif request.path.endswith('/import'):
            title = 'Import durchgeführt'
        elif '/approvals/' in request.path:
            title = 'Einzelzimmerentscheidung getroffen'
            if payload.get('decision') == 'APPROVED':
                title = 'Einzelzimmerentscheidung genehmigt'
            if payload.get('costCoverage'):
                details.append('Mehrpreis genehmigt')
        elif response.get('status') == 'TECHNICALLY_REVIEWED':
            title = 'Import technisch geprüft'
        elif response.get('status') == 'PROFESSIONALLY_REVIEWED':
            title = 'Import fachlich geprüft'
        else:
            title = 'Import erstellt' if action == 'create' else 'Import bearbeitet'

    else:
        # Administrative/debug endpoints are not part of the business chronicle.
        return None
    return {'category': category, 'activity': title, 'entity_label': label,
            'details': details, 'entity_refs': refs}


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
        response_payload = response.get_json(silent=True)
        business = _business_activity(entity_type, entity_id, action, payload, response_payload)
        if business is None:
            return response
        # The primary reference remains available for old consumers; all target
        # references live in entityRefs and do not have to be reconstructed from URLs.
        primary_id = next(iter(business['entity_refs'].values()), entity_id)
        db.session.add(AuditEvent(
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            groups_json=json.dumps(list(user.groups)),
            action=action,
            entity_type=entity_type,
            entity_id=primary_id,
            request_id=g.request_id,
            method=request.method,
            path=request.path,
            changes_json=json.dumps(payload, ensure_ascii=False, default=str) if payload else None,
            activity=business['activity'], category=business['category'],
            entity_label=business['entity_label'],
            details_json=json.dumps(business['details'], ensure_ascii=False),
            entity_refs_json=json.dumps(business['entity_refs'], ensure_ascii=False),
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


def _acknowledge_import_changes(athlete_ids):
    """Mark imported changes reviewed as part of an assignment save."""
    now = datetime.utcnow()
    for athlete in Athlete.query.filter(Athlete.id.in_(set(athlete_ids))).all():
        if _has_pending_roomlist_review(athlete):
            athlete.roomlist_change_acknowledged_at = now
            athlete.roomlist_change_acknowledged_summary = athlete.roomlist_change_summary


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
        blocking_messages.append('Zimmer hat keine Kapazität')
    elif occupant_count == 2 and slot['capacity'] < 2:
        blocking_messages.append('Zimmer passt nicht für DZ-Einheit')
    elif unit_room_type == 'appartment' and slot['capacity'] < max(1, occupant_count):
        blocking_messages.append('Zimmer passt nicht für Apartment-Einheit')

    if unit_room_type and slot_room_type and slot_room_type not in allowed_room_type_labels and not (unit_room_type == 'appartment' and slot_room_type == 'appartment'):
        blocking_messages.append(f'{unit["roomType"]} passt nicht auf {slot["roomTypeName"]}')

    if not slot['dateCoverage']['coversRequestedRange']:
        warning_messages.append('Kontingent-Zeitraum deckt den gewünschten Aufenthalt nicht vollständig ab')

    for booking in existing_bookings:
        if booking.id == unit.get('assignedBookingId'):
            continue
        if str(booking.hotel_id) != str(slot['hotelId']) or str(booking.room_type_id) != str(slot['roomTypeId']):
            continue
        if (_planned_room_key(booking.room_number) or booking.room_number or '') != (slot['roomNumber'] or ''):
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


def _planned_room_number(index):
    """Return the stable, user-facing identifier for an inventory room."""
    return f'Zimmer {index:02d}'


def _planned_room_key(room_number):
    """Match legacy Slot labels to their Zimmer successor during replanning."""
    match = re.fullmatch(r'(?:Slot|Zimmer)\s+(\d+)', (room_number or '').strip(), re.IGNORECASE)
    return _planned_room_number(int(match.group(1))) if match else None


def _build_virtual_slots(hotel, room_type, inventories, bookings):
    slot_count = sum(inv.room_count for inv in inventories)
    relevant_bookings = [
        booking for booking in bookings
        if booking.hotel_id == hotel.id and booking.room_type_id == room_type.id
    ]
    bookings_by_room_number = {}
    unmatched_bookings = []
    for booking in relevant_bookings:
        key = _planned_room_key(booking.room_number)
        if key:
            bookings_by_room_number.setdefault(key, []).append(booking)
        else:
            unmatched_bookings.append(booking)
    slots = []
    for index in range(slot_count):
        room_number = _planned_room_number(index + 1)
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
    athletes = Athlete.query.order_by(
        Athlete.nation_code,
        Athlete.discipline,
        Athlete.gender,
        Athlete.room_type,
        Athlete.lastname,
        Athlete.firstname,
        Athlete.id,
    ).all()
    bookings = RoomBooking.query.options(db.joinedload(RoomBooking.occupants).joinedload(RoomBookingOccupant.athlete), db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()
    booking_index = {}
    athlete_booking_index = {}
    for booking in bookings:
        booking_index[tuple(_collect_booking_athlete_ids(booking))] = booking
        for occupant in booking.occupants or []:
            athlete_booking_index.setdefault(occupant.athlete_id, []).append(booking)

    def normalized_name(value):
        return ' '.join((value or '').replace(',', ' ').strip().lower().split())

    def athlete_name_keys(athlete):
        return {
            normalized_name(f'{athlete.firstname} {athlete.lastname}'),
            normalized_name(f'{athlete.lastname} {athlete.firstname}'),
        }

    athletes_by_name_and_nation = {}
    athletes_by_name = {}
    for athlete in athletes:
        for name_key in athlete_name_keys(athlete):
            athletes_by_name_and_nation.setdefault((name_key, athlete.nation_code or ''), []).append(athlete)
            athletes_by_name.setdefault(name_key, []).append(athlete)

    def find_requested_partner(athlete):
        requested_name = normalized_name(athlete.shared_with_name)
        if not requested_name:
            return None
        same_nation = athletes_by_name_and_nation.get((requested_name, athlete.nation_code or ''), [])
        candidates = same_nation or athletes_by_name.get(requested_name, [])
        candidates = [candidate for candidate in candidates if candidate.id != athlete.id]
        return candidates[0] if len(candidates) == 1 else None

    consumed_ids = set()
    projected_groups = []
    for athlete in athletes:
        if athlete.id in consumed_ids:
            continue
        occupants = [athlete]
        partner = find_requested_partner(athlete)
        if partner and partner.id not in consumed_ids:
            occupants.append(partner)
            consumed_ids.add(partner.id)
        consumed_ids.add(athlete.id)
        projected_groups.append(occupants)

    units = []
    for unit_athletes in projected_groups:
        athlete_ids = sorted(athlete.id for athlete in unit_athletes)
        room_type = next((athlete.room_type for athlete in unit_athletes if athlete.room_type), 'unknown')
        check_in_date = min((athlete.arrival_date for athlete in unit_athletes if athlete.arrival_date), default=None)
        check_out_date = max((athlete.departure_date for athlete in unit_athletes if athlete.departure_date), default=None)
        identity = '|'.join([
            ','.join(str(athlete_id) for athlete_id in athlete_ids),
            _room_type_label(room_type),
            check_in_date.isoformat() if check_in_date else '',
            check_out_date.isoformat() if check_out_date else '',
        ])
        unit_id = f'athlete-unit-{hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]}'
        linked_booking = booking_index.get(tuple(athlete_ids))
        occupants = []
        athlete_level_bookings = []
        for athlete in unit_athletes:
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
                'importChangeTypes': json.loads(athlete.import_change_types_json) if athlete.import_change_types_json else [],
                'importChangeDetails': json.loads(athlete.import_change_details_json) if athlete.import_change_details_json else [],
                'statusBadges': _status_badges_for_athlete(type('A', (), {
                    'hasPendingRoomlistReview': pending_review,
                    'changeTouchesAssignment': assigned_change,
                    'special_meal': athlete.special_meal,
                    'room_type': athlete.room_type,
                })()),
                'single_room_status': athlete.single_room_status or 'NONE',
                'single_room_decision_id': str(athlete.single_room_decision_id) if athlete.single_room_decision_id else None,
                'hasPendingReview': assigned_change,
                'changeTouchesAssignment': assigned_change,
                'isAssigned': bool(athlete_booking),
                'assignedBookingId': str(athlete_booking.id) if athlete_booking else None,
                'assignedHotelId': str(athlete_booking.hotel_id) if athlete_booking else None,
                'assignedRoomTypeId': str(athlete_booking.room_type_id) if athlete_booking else None,
                'assignedRoomNumber': athlete_booking.room_number if athlete_booking else None,
            })

        warnings = _derive_assignment_warnings(unit_athletes, room_type)
        shared_booking = linked_booking or _same_booking_for_all(athlete_level_bookings)
        has_any_assigned = any(booking is not None for booking in athlete_level_bookings)
        is_fully_assigned = all(booking is not None for booking in athlete_level_bookings) if athlete_level_bookings else False
        units.append({
            'unitId': unit_id,
            'sourceRowKey': unit_id,
            'nationCode': unit_athletes[0].nation_code if unit_athletes else '',
            'occupants': occupants,
            'roomType': room_type,
            'roomTypeLabel': _room_type_label(room_type),
            'roomCategoryLabel': _room_category_label(room_type),
            'occupantCount': len(occupants),
            'checkInDate': check_in_date.isoformat() if check_in_date else None,
            'checkOutDate': check_out_date.isoformat() if check_out_date else None,
            'specialMealFlags': [occ['specialMeal'] for occ in occupants if occ.get('specialMeal')],
            'statusBadges': sorted({badge for occ in occupants for badge in occ.get('statusBadges', [])}),
            'assignmentWarnings': warnings,
            'assignedBookingId': str(shared_booking.id) if shared_booking and is_fully_assigned else None,
            'assignedHotelId': str(shared_booking.hotel_id) if shared_booking and is_fully_assigned else None,
            'assignedRoomTypeId': str(shared_booking.room_type_id) if shared_booking and is_fully_assigned else None,
            'assignedRoomNumber': shared_booking.room_number if shared_booking and is_fully_assigned else None,
            'hasAnyAssigned': has_any_assigned,
            'isFullyAssigned': is_fully_assigned,
            'allowedRoomTypeLabels': ['single', 'double'] if len(occupants) == 1 else [_room_type_label(room_type)],
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
        slot_key = (str(booking.hotel_id), str(booking.room_type_id), _planned_room_key(booking.room_number) or booking.room_number or '')
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
                            'roomNumber': slot['roomNumber'],
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
                                    'firstname': occ.athlete.firstname,
                                    'lastname': occ.athlete.lastname,
                                    'discipline': occ.athlete.discipline,
                                    'gender': _normalize_gender(occ.athlete),
                                    'hasPendingReview': _has_pending_roomlist_review(occ.athlete),
                                    'importChangeTypes': json.loads(occ.athlete.import_change_types_json) if occ.athlete.import_change_types_json else [],
                                    'importChangeDetails': json.loads(occ.athlete.import_change_details_json) if occ.athlete.import_change_details_json else [],
                                    'single_room_status': occ.athlete.single_room_status or 'NONE',
                                    'single_room_decision_id': str(occ.athlete.single_room_decision_id) if occ.athlete.single_room_decision_id else None,
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

    existing_athlete_count = Athlete.query.filter(Athlete.id.in_(unique_athlete_ids)).count()
    if existing_athlete_count != len(unique_athlete_ids):
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


def _automatic_exclusive_occupancy(room_type, athlete_ids):
    """Derive the operational EZ flag without changing the business decision."""
    if not room_type or room_type.max_persons != 2 or len(athlete_ids) != 1:
        return False
    athlete = db.session.get(Athlete, athlete_ids[0])
    return bool(athlete and athlete.single_room_status in {'IN_QUOTA', 'APPROVED_EXTRA'})


def _sync_exclusive_occupancy(booking):
    athlete_ids = sorted(row[0] for row in db.session.query(RoomBookingOccupant.athlete_id).filter_by(room_booking_id=booking.id).all())
    booking.counts_as_single = _automatic_exclusive_occupancy(booking.room_type, athlete_ids)


def _save_booking_from_payload(payload, existing_booking=None, manual_single_override=False):
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
    db.session.flush()
    if not manual_single_override:
        _sync_exclusive_occupancy(booking)
    _acknowledge_import_changes(payload['athlete_ids'])
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
            else:
                _sync_exclusive_occupancy(booking)
    db.session.commit()


def _build_official_quota_usage_rows(nation_code=None, discipline=None, gender=None):
    athletes = Athlete.query
    if nation_code:
        athletes = athletes.filter(Athlete.nation_code == nation_code)
    if discipline:
        athletes = athletes.filter(Athlete.discipline == discipline)

    athletes = athletes.all()
    roster = [{'nationCode': a.nation_code, 'discipline': a.discipline, 'gender': a.gender,
               'forGender': a.for_gender, 'function': a.function} for a in athletes]
    # The professional import result is authoritative. The eventual room type
    # selected by disposition cannot create quota usage or additional costs.
    assigned = [{'nationCode': a.nation_code, 'discipline': a.discipline,
        'gender': a.gender, 'forGender': a.for_gender, 'function': a.function,
        'countsAsSingle': bool(a.single_room_entitlement)} for a in athletes
        if (a.function or '').strip().lower() != 'athlete']
    rows = evaluate_quota_usage(roster, assigned)
    approved_by_key = {}
    implemented_by_key = {}
    for athlete in athletes:
        if athlete.single_room_entitlement == 'APPROVED_EXTRA':
            key = (athlete.nation_code or '', athlete.discipline or '', _normalize_gender(athlete))
            approved_by_key[key] = approved_by_key.get(key, 0) + 1
        if athlete.single_room_entitlement:
            membership = RoomBookingOccupant.query.filter_by(athlete_id=athlete.id).first()
            booking = membership.room_booking if membership else None
            if (booking and len(booking.occupants) == 1
                    and (booking.counts_as_single
                         or (booking.room_type and booking.room_type.max_persons == 1))):
                key = (athlete.nation_code or '', athlete.discipline or '', _normalize_gender(athlete))
                implemented_by_key[key] = implemented_by_key.get(key, 0) + 1
    approval_state = {}
    for session in ImportSession.query.all():
        for approval in session.approvals:
            details = json.loads(approval.quota_details_json or '{}')
            key = (details.get('nationCode') or session.nation or '',
                   details.get('discipline') or session.discipline or '',
                   details.get('gender') or '')
            state = approval_state.setdefault(key, {'pending': 0, 'approved': 0})
            state['approved' if approval.decision == 'APPROVED' else 'pending'] += 1
    for row in rows:
        key = (row['nationCode'], row['discipline'], row['gender'])
        row['approvedExtraSingleRooms'] = approved_by_key.get(key, 0)
        row['requiredSingleRooms'] = row['singleRoomsUsed']
        row['implementedSingleRooms'] = implemented_by_key.get(key, 0)
        row['remainingSingleRooms'] = max(0, row['requiredSingleRooms'] - row['implementedSingleRooms'])
        decisions = approval_state.get(key, {'pending': 0, 'approved': 0})
        row['openApprovals'] = decisions['pending']
        row['approvedExceptions'] = decisions['approved']
        row['quotaStatus'] = ('DECISION_REQUIRED' if decisions['pending'] else
            'EXCEPTION_APPROVED' if decisions['approved'] else 'FULFILLED')
    return [row for row in rows if not gender or row['gender'].lower() == gender.lower()]


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
        detected_names = {'entries': None, 'roomlist': None}
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
                detected_names['entries'] = file_storage.filename
                continue
            if field_name == 'roomListDetailed':
                detected['roomlist'] = tmp_path
                detected_names['roomlist'] = file_storage.filename
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
                detected_names['entries'] = file_storage.filename
            elif file_type == 'roomlist' and detected['roomlist'] is None:
                detected['roomlist'] = tmp_path
                detected_names['roomlist'] = file_storage.filename

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
            if not session:
                # There is exactly one durable workflow per nation, including completed workflows.
                session = ImportSession.query.filter_by(nation=nation).first()
            is_new = session is None
            if is_new:
                session = ImportSession(nation=nation, discipline=result.get('detectedDiscipline'),
                    status='DRAFT')
                db.session.add(session)
                db.session.flush()
            next_version = session.next_version_number()
            session.discipline = result.get('detectedDiscipline')
            session.status = status if is_new else ('DRAFT' if result['errors'] else 'NEW_LIST_RECEIVED')
            session.approved_at = session.approved_by = None
            session.approvals.clear()
            version = ImportSessionVersion(session_id=session.id, version=next_version,
                preview_token=result['previewToken'], preview_json=json.dumps(result, ensure_ascii=False),
                entries_filename=detected_names['entries'], room_filename=detected_names['roomlist'],
                uploaded_by=user.username)
            db.session.add(version)
            db.session.flush()
            session.current_version = version
            db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id,
                event_type='VERSION_RECEIVED', title=f'Version {next_version} erhalten',
                description='Neue Meldeliste gespeichert; technische Prüfung abgeschlossen.' if not result['errors'] else 'Neue Meldeliste gespeichert; technische Fehler gefunden.',
                username=user.username))
            for issue in quota_issues:
                details = issue.get('details') or {}
                combination = ' • '.join(filter(None, [details.get('nationCode'), details.get('discipline'), details.get('gender')]))
                is_single_room = issue.get('code') == 'QUOTA_SINGLE_ROOMS_EXCEEDED'
                current = details.get('importedSingleRooms') if is_single_room else details.get('importedOfficials')
                allowed = details.get('singleRoomsAllowed') if is_single_room else details.get('officialQuota')
                quota_title = f"{'Single Rooms' if is_single_room else 'Officials'} überschritten ({current} / {allowed})"
                db.session.add(ImportApproval(session_id=session.id, version_id=version.id, nation=nation,
                    approval_type=issue.get('code', 'QUOTA'), description=quota_title,
                    quota_details_json=json.dumps(details, ensure_ascii=False), decision='PENDING', username=user.username))
                db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id, event_type='QUOTA_VIOLATION',
                    title=quota_title,
                    description=combination, username=user.username))
            if not quota_issues and not result['errors']:
                db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id, event_type='QUOTA_PASSED',
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


@app.route('/api/import/approvals/<int:approval_id>', methods=['GET'])
def get_import_approval(approval_id):
    """Return the canonical, read-only projection of one business decision."""
    approval = ImportApproval.query.get_or_404(approval_id)
    session = approval.session
    version = next((item for item in session.versions if item.id == approval.version_id), None)
    candidates = (json.loads(approval.quota_details_json or '{}').get('singleRoomCandidates') or [])
    linked = Athlete.query.filter_by(single_room_decision_id=approval.id).all()
    people = [{
        'id': athlete.id, 'name': f'{athlete.firstname} {athlete.lastname}'.strip(),
        'nation': athlete.nation_code, 'singleRoomStatus': athlete.single_room_status or 'NONE',
    } for athlete in linked]
    linked_names = {person['name'] for person in people}
    approved_keys = set(json.loads(approval.approved_person_keys_json or '[]'))
    for candidate in candidates:
        if candidate.get('name') not in linked_names and candidate.get('personKey') in approved_keys:
            people.append({'id': candidate.get('personKey'), 'name': candidate.get('name') or '—',
                           'nation': approval.nation, 'singleRoomStatus': 'APPROVED_EXTRA'})
    payload = approval.to_dict()
    payload.update({'discipline': session.discipline, 'gender': payload['quotaDetails'].get('gender'),
                    'importVersion': version.version if version else None,
                    'importSession': {'id': str(session.id), 'nation': session.nation},
                    'people': people})
    return jsonify(payload)


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
    approved_person_keys = data.get('approvedPersonKeys') or []
    details = json.loads(approval.quota_details_json or '{}')
    is_single_room_approval = bool(details.get('singleRoomCandidates')) or 'Single Rooms' in approval.description
    if is_single_room_approval and decision == 'APPROVED':
        valid_keys = {person.get('personKey') for person in details.get('singleRoomCandidates', [])}
        if len(set(approved_person_keys)) != details.get('excessCount') or not set(approved_person_keys) <= valid_keys:
            return jsonify({'error': 'Exactly the affected extra single-room persons must be selected'}), 400
    approval.decision = decision
    approval.approval_type = approval_type or approval.approval_type
    approval.approval_method = method
    approval.approval_by = approval_by
    approval.approval_date = approval_date
    approval.contact_subject = str(data.get('contactSubject') or '').strip() or None
    approval.cost_coverage = str(data.get('costCoverage') or '').strip() or None
    approval.deadline_at = deadline_at
    approval.approved_person_keys_json = json.dumps(approved_person_keys)
    approval.comment = data.get('comment')
    approval.username = current_user().username
    approval.created_at = datetime.utcnow()
    session.status = 'EXCEPTION_APPROVED' if all(a.decision == 'APPROVED' for a in session.approvals) else 'WAITING_FOR_NATION'
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='NATION_CONTACT',
        title=f'Rückfrage an Nation per {"E-Mail" if method == "EMAIL" else "Telefon"}',
        description=f'{approval_by}' + (f' · {data.get("contactSubject")}' if data.get('contactSubject') else ''),
        username=current_user().username))
    result_title = ('Neue Meldeliste angekündigt' if decision == 'NEW_LIST_ANNOUNCED' else
                    ('Organisatorische Freigabe' if approval_type == 'ORGANIZER_APPROVED' else 'Ausnahme durch Nation genehmigt'))
    person_count = len(approved_person_keys)
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id,
        approval_id=approval.id, event_type='QUOTA_DECISION', title=result_title,
        description=f'{person_count} betroffene {"Person" if person_count == 1 else "Personen"}',
        username=current_user().username))
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='STATUS_CHANGED',
        title='Status', description='Warten auf Nation' if decision == 'NEW_LIST_ANNOUNCED' else 'Ausnahme genehmigt',
        username=current_user().username))
    db.session.commit()
    return jsonify(session.to_dict(include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/approve', methods=['POST'])
def approve_import_session(session_id):
    session = ImportSession.query.get_or_404(session_id)
    preview = json.loads(session.current_version.preview_json or '{}') if session.current_version else {}
    if preview.get('errors'):
        return jsonify({'error': 'Blockierende Fehler müssen zuerst behoben werden.'}), 409
    if any(approval.decision != 'APPROVED' for approval in session.approvals):
        return jsonify({'error': 'Alle erforderlichen Entscheidungen müssen getroffen werden.'}), 409
    if session.status in {'IMPORTED', 'REPLACED', 'ARCHIVED'}:
        return jsonify({'error': 'Diese Session kann nicht mehr freigegeben werden.'}), 409
    session.status, session.approved_at = 'APPROVED', datetime.utcnow()
    session.approved_by = current_user().username
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='APPROVED',
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
        if not session.current_version:
            return jsonify({'error': 'Die Session besitzt keine aktuelle Version.'}), 409
        approved_extra_decisions = {
            key: approval.id for approval in session.approvals
            if approval.decision == 'APPROVED' and approval.approval_type in {'NATION_APPROVED', 'ORGANIZER_APPROVED'}
            for key in json.loads(approval.approved_person_keys_json or '[]')
        }
        result = confirm_fis_import(session.current_version.preview_token, approved_extra_decisions)
        now = datetime.utcnow()
        session.status, session.imported_at = 'IMPORTED', now
        db.session.add(ImportSessionEvent(session_id=session.id, event_type='IMPORTED',
            version_id=session.current_version.id,
            title=f'Version {session.current_version.version} importiert',
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
    event = ImportSessionEvent(session_id=session.id,
        version_id=session.current_version.id if session.current_version else None, event_type='NOTE',
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
    usage_count = HotelRoomInventory.query.filter_by(room_type_id=room_type_id).count()
    if usage_count:
        return jsonify({
            'error': 'ROOM_TYPE_IN_USE',
            'message': f'Dieser Zimmertyp wird aktuell in {usage_count} Zimmerkontingenten verwendet.',
            'usageCount': usage_count,
        }), 409
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
        region=data.get('region'),
        contact_person=data.get('contactPerson'),
        email=data.get('email'),
        phone=data.get('phone'),
        comment=data.get('comment')
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
    if 'contactPerson' in data:
        hotel.contact_person = data['contactPerson']
    if 'email' in data:
        hotel.email = data['email']
    if 'phone' in data:
        hotel.phone = data['phone']
    if 'comment' in data:
        hotel.comment = data['comment']

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
        has_sr=data.get('hasSR', False),
        comment=data.get('comment')
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
    inventory.comment = data.get('comment')
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
        raw_pending_review = bool(
            a.roomlist_changed_at and (
                a.roomlist_change_acknowledged_at is None
                or a.roomlist_change_acknowledged_at < a.roomlist_changed_at
            )
        )
        # Reviews are exclusively follow-up work for an existing disposition.
        # Unassigned/new people always stay in the normal assignment queue.
        data['hasPendingRoomlistReview'] = bool(raw_pending_review and data['assignment']['hasAssignment'])
        data['changeTouchesAssignment'] = data['hasPendingRoomlistReview']
        import_types = data.get('importChangeTypes') or []
        # This is the authoritative workflow classification consumed by every
        # client surface. Import presence/change flags are operational history,
        # not master-data integrity failures. CONFLICT is intentionally reserved
        # for explicit integrity validation and must never be inferred from them.
        data['workflowStatus'] = (
            'REVIEW_ASSIGNMENT' if data['hasPendingRoomlistReview'] else
            'NEW_PERSON' if 'NEW_ATHLETE' in import_types and not data['assignment']['hasAssignment'] else
            'OPEN_ASSIGNMENT' if not data['assignment']['hasAssignment'] else
            'CURRENT'
        )

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


@app.route('/api/assignments/bookings', methods=['POST'])
@app.route('/api/assignments/bookings/', methods=['POST'])
@_measure_assignment_logic
def create_room_booking():
    data = request.json or {}
    payload_data = {
        'athleteIds': data.get('athleteIds') or [],
        'hotelId': data.get('hotelId'),
        'roomTypeId': data.get('roomTypeId'),
        'roomNumber': data.get('roomNumber'),
        'checkInDate': data.get('checkInDate'),
        'checkOutDate': data.get('checkOutDate'),
        'countsAsSingle': data.get('countsAsSingle', False),
    }

    existing_booking = None
    if data.get('assignedBookingId'):
        existing_booking = RoomBooking.query.get_or_404(int(data['assignedBookingId']))
    else:
        athlete_id_tuple = tuple(sorted(int(athlete_id) for athlete_id in payload_data['athleteIds']))
        for booking in RoomBooking.query.options(db.joinedload(RoomBooking.occupants)).all():
            if tuple(_collect_booking_athlete_ids(booking)) == athlete_id_tuple:
                existing_booking = booking
                break

    payload, _, error = _validate_booking_payload(payload_data, existing_booking=existing_booking)
    if error:
        return error
    _detach_athletes_from_existing_bookings(payload['athlete_ids'], exclude_booking_id=existing_booking.id if existing_booking else None)
    booking = _save_booking_from_payload(payload, existing_booking=existing_booking)
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
    # An explicit EZ toggle is the supported manual override. All actual
    # assignment changes continue to derive the flag from occupancy and status.
    manual_single_override = set(data) == {'countsAsSingle'}
    booking = _save_booking_from_payload(payload, existing_booking=booking, manual_single_override=manual_single_override)
    return jsonify(booking.to_dict())


@app.route('/api/assignments/bookings/<int:booking_id>/unassign', methods=['POST'])
@app.route('/api/assignments/bookings/<int:booking_id>/unassign/', methods=['POST'])
@_measure_assignment_logic
def unassign_room_booking_unit(booking_id):
    booking = RoomBooking.query.get_or_404(booking_id)
    _acknowledge_import_changes(_collect_booking_athlete_ids(booking))
    db.session.delete(booking)
    db.session.commit()
    return jsonify({'success': True, 'bookingId': str(booking_id)})


@app.route('/api/assignments/bookings/<int:booking_id>/occupants/<int:athlete_id>/unassign', methods=['POST'])
@app.route('/api/assignments/bookings/<int:booking_id>/occupants/<int:athlete_id>/unassign/', methods=['POST'])
@_measure_assignment_logic
def unassign_room_booking_occupant(booking_id, athlete_id):
    booking = RoomBooking.query.get_or_404(booking_id)
    membership = RoomBookingOccupant.query.filter_by(room_booking_id=booking.id, athlete_id=athlete_id).first()
    if not membership:
        return jsonify({'error': 'Not found', 'message': 'Occupant is not part of the booking'}), 404

    _acknowledge_import_changes([athlete_id])
    db.session.delete(membership)
    db.session.flush()
    remaining = RoomBookingOccupant.query.filter_by(room_booking_id=booking.id).count()
    if remaining == 0:
        db.session.delete(booking)
    else:
        _sync_exclusive_occupancy(booking)
    db.session.commit()
    return jsonify({'success': True, 'bookingId': str(booking_id), 'athleteId': str(athlete_id)})


@app.route('/api/debug/routes', methods=['GET'])
def get_debug_routes():
    is_production = (
        str(app.config.get('ENV', '')).lower() == 'production'
        or app.config.get('RUNTIME_ENV', '').lower() == 'production'
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
    app.run(host='0.0.0.0', port=5000)
