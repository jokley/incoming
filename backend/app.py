from quota_rules import rules_for_event
from accommodation_scope import event_query, event_get, accommodation_event_id, ownership_clause, require_event_object, event_audit_refs
from accommodation_requirements import requirement_projection, RequirementConflict, set_requirement, resolve_requirement, apply_preview_requirements, require_assignable, accommodation_metrics
from flask import Flask, g, request, jsonify, has_request_context
from flask_cors import CORS
from models import db, AuditEvent, RoomType, Hotel, HotelRoomInventory, AccommodationEvent, Event, EventCompetition, EventRoomDemand, Athlete, Competition, RoomAssignment, RoomBooking, RoomBookingOccupant, ImportRun, FisRoomAssignment, ImportSession, ImportSessionVersion, ImportSessionEvent, ImportApproval
from auth import load_user_from_request, current_user
from quota_history import historical_approval_groups, applicable_approval_groups, approved_quota_disciplines, approved_quota_contexts, person_keys, quota_person
from competitions import quota_disciplines
from accommodation_coverage import booking_intervals_overlap, person_accommodation_coverage
from accommodation_mutations import lock_accommodation_writes, physical_room_usage
from routes.accommodation_segments import accommodation_segments
from quota_service import (quota_keys, disposition_by_quota_group, evaluate_quota_usage,
                           normalize_gender, QuotaGenderValidationError)
from datetime import datetime
import hashlib
import os
import re
import csv
import tempfile
import json
from pathlib import Path
import uuid
import time
from contextlib import contextmanager
from functools import wraps
from sqlalchemy import text, func, event, or_
from sqlalchemy.engine import Engine
from excel_import import (ImportValidationError, InvalidExcelFileError,
                          PREVIEW_STORE, apply_active_single_room_decision, confirm_fis_import,
                          create_fis_import_preview, detect_fis_file_type,
                          normalize_event_id, recalculate_fis_import_preview,
                          quota_requirement_errors,
                          validate_fis_import_token)
from accommodation_rates import rate_projection, validate_category, apply_preview_rates, function_groups
from simulation import DEFAULT_PERSON_COUNT, SIMULATION_OWNER, build_assignment_units, build_people
from config import RuntimeSettings
from logging_config import configure_logging
from database_admin import database_admin
from routes.hotels import hotels
from routes.events import events
from routes.athletes import athletes
from routes.room_types import room_types
from routes.analytics import analytics
from routes.competitions import competitions
from routes.admin_scenarios import admin_scenarios
from routes.import_mock_files import import_mock_files
from routes.booking_reads import booking_reads
from routes.identity import identity
from routes.audit_events import audit_events
from routes.world_champions import world_champions
from world_champions import audit_status, persisted_manual_revision

settings = RuntimeSettings.from_environment()
configure_logging(settings.log_level)
app = Flask(__name__)
settings.apply(app)
if settings.cors_origins:
    CORS(app, origins=list(settings.cors_origins))

app.config['MOCK_FILES_DIR'] = str(settings.mock_files_dir)
db.init_app(app)
app.register_blueprint(database_admin)
app.register_blueprint(hotels)
app.register_blueprint(events)
app.register_blueprint(athletes)
app.register_blueprint(room_types)
app.register_blueprint(analytics)
app.register_blueprint(competitions)
app.register_blueprint(admin_scenarios)
app.register_blueprint(import_mock_files)
app.register_blueprint(booking_reads)
app.register_blueprint(identity)
app.register_blueprint(audit_events)
app.register_blueprint(world_champions)
app.register_blueprint(accommodation_segments)


from event_ownership_runtime import OperationalEventError, validate_operational_import_event, configured_event_id


from imports.event_context import import_event_id, validate_session_event, revalidate_confirmation_event
from imports.workflow import refresh_plan, require_review, completed_result, load_version_preview, lock_import_snapshot, present_plan
from imports.change_plan import encoded, verify_plan


@app.errorhandler(ImportValidationError)
def import_context_error(error):
    db.session.rollback()
    return jsonify(error.to_dict()), 409


def validate_import_request_context():
    """Bind only import routes; never a server-global active event.

    Explicit request event must match the owning session. Legacy clients may use
    the configured single event, or derive it from a validated owning session.
    """
    if request.method == 'OPTIONS' or not request.path.startswith('/api/import/'):
        return
    data = request.get_json(silent=True) or {} if request.is_json else {}
    values = [v for v in (request.args.get('eventId'), request.form.get('eventId'), data.get('eventId'), request.headers.get('X-Championship-Event-ID')) if v is not None]
    if request.path.rstrip('/') == '/api/import/fis/preview' and not request.form.get('sessionId'):
        # Endpoint retains its existing EVENT_REQUIRED / 400 / 404 validation.
        if len(values) > 1 and len({str(v) for v in values}) != 1:
            raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Widersprüchliche Request-Event-IDs.')
        return
    selected = normalize_event_id(values[0]) if values else None
    if any(normalize_event_id(v) != selected for v in values):
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Widersprüchliche Request-Event-IDs.')
    if selected is not None:
        selected = validate_operational_import_event(selected)
    args = request.view_args or {}
    session_id = args.get('session_id') or request.form.get('sessionId')
    session = db.session.get(ImportSession, normalize_event_id(session_id)) if session_id else None
    if session_id and session is None:
        return jsonify(error='IMPORT_SESSION_NOT_FOUND'), 404
    if args.get('approval_id') is not None:
        approval = db.session.get(ImportApproval, args['approval_id'])
        if approval is None:
            return jsonify(error='IMPORT_APPROVAL_NOT_FOUND'), 404
        if session and approval.session_id != session.id:
            raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Genehmigung gehört zu einer anderen Session.')
        session = session or approval.session
    token = data.get('previewToken')
    if token:
        raw = PREVIEW_STORE.get(token)
        if raw is not None and raw.get('eventId') is not None and not raw.get('errors'):
            token_event = normalize_event_id(raw.get('eventId'))
            if selected is not None and token_event != selected:
                raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Token und Request gehören zu verschiedenen Events.')
            selected = token_event
    if session:
        selected = selected if selected is not None else app.config.get('OPERATIONAL_EVENT_ID') or session.event_id
        validate_session_event(session, event_id=selected)
        _import_session_raw_preview(session)
        for version in session.versions:
            validate_session_event(session, json.loads(version.preview_json or '{}'), selected)
    if selected is None:
        if request.path.rstrip('/') == '/api/import/sessions':
            selected = import_event_id()
        else:
            return
    selected = validate_operational_import_event(selected)
    revalidate_confirmation_event(selected, [], validate_codes=False)
    g.import_event_id = selected


@app.errorhandler(OperationalEventError)
def operational_event_error(error):
    db.session.rollback()
    return jsonify(error='OPERATIONAL_EVENT_REQUIRED', message=str(error)), 409


@app.errorhandler(RequirementConflict)
def requirement_conflict_response(error):
    db.session.rollback()
    return jsonify(error=error.code, reasonCode=error.code, message=error.message), 409


@app.errorhandler(QuotaGenderValidationError)
def quota_gender_review_response(error):
    # A malformed legacy athlete may also be encountered while changing an
    # exemption. Roll back that operation rather than saving partial state.
    db.session.rollback()
    return jsonify({'error': str(error), 'code': 'QUOTA_GENDER_REVIEW_REQUIRED',
                    'validationErrors': error.errors}), 409


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
            or request.path.startswith('/api/room-assignments')
            or request.path.startswith('/api/official-quota')
            or request.path.startswith('/api/fis/official-quotas'))


@app.before_request
def start_assignment_performance_measurement():
    performance_enabled = os.environ.get(
        'ASSIGNMENT_PERFORMANCE_ENABLED', 'true').lower() != 'false'
    if _is_assignment_request() and performance_enabled:
        g.assignment_perf = {
            'api_started': time.perf_counter(),
            'db': 0.0,
            'queries': 0,
            'method': request.method,
            'path': request.path,
        }


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
        mutation = request.method in {'POST', 'PUT', 'DELETE', 'PATCH'}
        try:
            if mutation:
                lock_accommodation_writes()
            with _assignment_phase('assignment'):
                return function(*args, **kwargs)
        except Exception:
            if mutation:
                db.session.rollback()
            raise
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
    response.headers['X-Assignment-Measurement'] = 'sprint-1'
    response.headers['Access-Control-Expose-Headers'] = (
        'Server-Timing, X-Assignment-Query-Count, X-Response-Size, '
        'X-Assignment-Measurement'
    )
    app.logger.info('assignment_performance %s', json.dumps({
        key: round(value, 2) if isinstance(value, float) else value
        for key, value in perf.items() if key != 'api_started'
    }))
    return response


def _canonical_api_path():
    """Resolve registered compatibility aliases for the shared security hooks.

    Do not infer API access from a resource prefix alone: the same endpoint and
    method must be registered under /api. Keep request.path for audit provenance.
    """
    if request.path.startswith('/api/'):
        return request.path
    if request.url_rule is not None:
        canonical_rule = '/api' + request.url_rule.rule
        if any(rule.rule == canonical_rule and request.method in rule.methods
               for rule in app.url_map.iter_rules(request.endpoint)):
            return '/api' + request.path
    return None


def _required_permission():
    path = g.api_path
    if path == '/api/assignments/availability':
        return 'data.read'
    if path == '/api/auth/me':
        return None
    if path.startswith('/api/audit-events'):
        return 'audit.read'
    if path.startswith('/api/admin/'):
        return 'admin.reset'
    if request.method in {'GET', 'HEAD', 'OPTIONS'}:
        return 'data.read'
    if path.startswith('/api/import/'):
        return 'imports.write'
    if path.startswith('/api/assignments/') or path.startswith('/api/room-assignments'):
        return 'assignments.write'
    return 'data.write'


RESET_TARGETS = {
    'activities': ('Aktivitäten', 'Audit-Log', 'Workflowhistorie', 'Systemereignisse'),
    'imports': ('Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen'),
    'athletes': ('Athleten', 'Zimmerpartner', 'Prüfmarkierungen'),
    'assignments': ('Zimmerbelegungen', 'Assignments', 'Dispositionsstatus'),
    'all': ('Aktivitäten', 'Audit-Log', 'Workflowhistorie', 'Systemereignisse',
            'Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen', 'Rücksprachen',
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
    owner = accommodation_event_id()
    if scope in {'activities', 'imports', 'all'}:
        # Historical/global audit rows have no reliable event FK yet (PR5).
        # Even an otherwise empty second championship can own old audit evidence.
        if Event.query.filter(Event.id != owner).first():
            raise OperationalEventError('Global history cleanup is disabled with multiple championships')
        for model in (Athlete, RoomBooking, HotelRoomInventory, ImportSession, ImportRun):
            if model.query.filter(model.event_id != owner).first():
                raise OperationalEventError('Global history cleanup is disabled while another event contains operational data')
    try:
        if scope in {'activities', 'all'}:
            counts['Aktivitäten / Audit-Log'] = AuditEvent.query.delete(synchronize_session=False)
            counts['Workflowhistorie'] = ImportSessionEvent.query.delete(synchronize_session=False)
            event_query(FisRoomAssignment).update(
                {FisRoomAssignment.import_run_id: None}, synchronize_session=False)
            counts['Systemereignisse'] = ImportRun.query.delete(synchronize_session=False)
        if scope in {'assignments', 'athletes', 'all'}:
            # Athlete deletion also has to detach all dependent assignments.
            models = (
                ('Zimmerbelegungen', RoomBookingOccupant), ('Buchungen', RoomBooking),
                ('Assignments', RoomAssignment), ('FIS Assignments', FisRoomAssignment),
            )
            if scope in {'athletes', 'all'}:
                models += (('Athleten', Athlete),)
            for label, model in models:
                counts[label] = event_query(model).delete(synchronize_session=False)
        if scope in {'imports', 'all'}:
            # Break nullable cycle links before deleting children and parents.
            ImportSession.query.update(
                {ImportSession.current_version_id: None},
                synchronize_session=False,
            )
            # Establish the session/version cycle break in PostgreSQL before
            # any dependent bulk DELETE is issued.
            db.session.flush()
            event_query(Athlete).update(
                {Athlete.single_room_decision_id: None}, synchronize_session=False)
            event_query(FisRoomAssignment).update(
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


def _delete_simulation_data():
    """Delete only explicitly owned rows and return auditable row counts."""
    booking_ids = [row[0] for row in db.session.query(RoomBooking.id).filter(ownership_clause(RoomBooking, accommodation_event_id())).filter_by(
        created_by=SIMULATION_OWNER).all()]
    athlete_ids = [row[0] for row in db.session.query(Athlete.id).filter(ownership_clause(Athlete, accommodation_event_id())).filter_by(
        created_by=SIMULATION_OWNER).all()]
    counts = {'roomAssignments': 0, 'people': 0}
    if booking_ids:
        counts['roomAssignmentOccupants'] = event_query(RoomBookingOccupant).filter(
            RoomBookingOccupant.room_booking_id.in_(booking_ids)).delete(synchronize_session=False)
        counts['roomAssignments'] = event_query(RoomBooking).filter(
            RoomBooking.id.in_(booking_ids)).delete(synchronize_session=False)
    if athlete_ids:
        # Defensive cleanup for simulation people manually assigned after a run.
        extra_memberships = event_query(RoomBookingOccupant).filter(
            RoomBookingOccupant.athlete_id.in_(athlete_ids)).all()
        extra_booking_ids = {membership.room_booking_id for membership in extra_memberships}
        for membership in extra_memberships:
            db.session.delete(membership)
        db.session.flush()
        for booking_id in extra_booking_ids:
            if not event_query(RoomBookingOccupant).filter_by(room_booking_id=booking_id).first():
                booking = event_get(RoomBooking, booking_id)
                if booking:
                    db.session.delete(booking)
                    counts['roomAssignments'] += 1
        counts['people'] = event_query(Athlete).filter(Athlete.id.in_(athlete_ids)).delete(
            synchronize_session=False)
    return counts


@app.route('/api/admin/simulation', methods=['POST'])
def create_simulation():
    """Replace the owned data set and persist its bookings directly through the ORM."""
    started = time.perf_counter()
    timings = {}
    try:
        step_started = time.perf_counter()
        deleted = _delete_simulation_data()
        timings['Delete simulation'] = (time.perf_counter() - step_started) * 1000

        step_started = time.perf_counter()
        people = [Athlete(**values) for values in build_people(DEFAULT_PERSON_COUNT)]
        db.session.add_all(people)
        timings['Generate people'] = (time.perf_counter() - step_started) * 1000

        step_started = time.perf_counter()
        db.session.flush()
        timings['Flush'] = (time.perf_counter() - step_started) * 1000

        step_started = time.perf_counter()
        inventories = event_query(HotelRoomInventory).options(
            db.joinedload(HotelRoomInventory.room_type)).order_by(
                HotelRoomInventory.hotel_id, HotelRoomInventory.room_type_id,
                HotelRoomInventory.available_from, HotelRoomInventory.id).all()
        existing_bookings = event_query(RoomBooking).with_entities(
            RoomBooking.hotel_id, RoomBooking.room_type_id,
            RoomBooking.check_in_date, RoomBooking.check_out_date,
        ).filter(
            RoomBooking.check_in_date.isnot(None),
            RoomBooking.check_out_date.isnot(None),
        ).all()
        timings['Load inventory'] = (time.perf_counter() - step_started) * 1000

        step_started = time.perf_counter()
        assignment_units = build_assignment_units(people)
        timings['Build assignment units'] = (time.perf_counter() - step_started) * 1000

        step_started = time.perf_counter()
        assignments = 0
        assigned_people = 0
        hotel_ids = set()
        bookings_by_slot = {}
        for hotel_id, room_type_id, check_in_date, check_out_date in existing_bookings:
            bookings_by_slot.setdefault((hotel_id, room_type_id), []).append(
                (check_in_date, check_out_date))
        candidate_slots = []
        seen_slots = set()
        for inventory in sorted(inventories, key=lambda item: (
                item.room_type.max_persons, item.hotel_id, item.room_type_id, item.id)):
            slot_key = (inventory.hotel_id, inventory.room_type_id)
            if slot_key not in seen_slots:
                seen_slots.add(slot_key)
                candidate_slots.append(inventory)
        for unit_index, unit in enumerate(assignment_units, start=1):
            candidates = sorted(candidate_slots, key=lambda item: (
                item.room_type.max_persons != len(unit), item.room_type.max_persons,
                item.hotel_id, item.room_type_id))
            for inventory in candidates:
                if inventory.room_type.max_persons < len(unit):
                    continue
                check_in_date = unit[0].arrival_date
                check_out_date = unit[0].departure_date
                inventory_rooms = sum(
                    item.room_count for item in inventories
                    if item.hotel_id == inventory.hotel_id
                    and item.room_type_id == inventory.room_type_id
                    and item.available_from <= check_in_date
                    and item.available_until >= check_out_date
                )
                if inventory_rooms <= 0:
                    continue
                slot_bookings = bookings_by_slot.setdefault(
                    (inventory.hotel_id, inventory.room_type_id), [])
                used_rooms = sum(
                    existing_start <= check_out_date and existing_end >= check_in_date
                    for existing_start, existing_end in slot_bookings
                )
                if used_rooms >= inventory_rooms:
                    continue
                counts_as_single = (
                    inventory.room_type.max_persons == 1
                    or (inventory.room_type.max_persons == 2 and len(unit) == 1
                        and unit[0].single_room_status in {'IN_QUOTA', 'APPROVED_EXTRA'})
                )
                booking = RoomBooking(
                    created_by=SIMULATION_OWNER,
                    hotel_id=inventory.hotel_id,
                    room_type_id=inventory.room_type_id,
                    room_number=f'SIM-{unit_index:04d}',
                    check_in_date=check_in_date,
                    check_out_date=check_out_date,
                    counts_as_single=counts_as_single,
                    occupants=[RoomBookingOccupant(athlete_id=person.id) for person in unit],
                )
                db.session.add(booking)
                slot_bookings.append((check_in_date, check_out_date))
                assignments += 1
                assigned_people += len(unit)
                hotel_ids.add(inventory.hotel_id)
                break
        timings['Assignments'] = (time.perf_counter() - step_started) * 1000

        step_started = time.perf_counter()
        db.session.commit()
        timings['Commit'] = (time.perf_counter() - step_started) * 1000
    except Exception:
        db.session.rollback()
        app.logger.exception('Simulation generation failed')
        return jsonify({'error': 'SIMULATION_FAILED',
                        'message': 'Simulation konnte nicht sicher erzeugt werden'}), 500
    total_duration_ms = (time.perf_counter() - started) * 1000
    timings['Total'] = total_duration_ms
    app.logger.info(
        'simulation_generation_performance\n%s',
        '\n'.join(f'{label + ":":<28}{duration:>12,.0f} ms'
                  for label, duration in timings.items()),
    )
    return jsonify({
        'peopleCreated': len(people),
        'hotelsUsed': len(hotel_ids),
        'roomAssignmentsCreated': assignments,
        'peopleUnassigned': len(people) - assigned_people,
        'durationMs': round(total_duration_ms),
        'replaced': deleted,
    }), 201


@app.route('/api/admin/simulation', methods=['DELETE'])
def delete_simulation():
    try:
        deleted = _delete_simulation_data()
        db.session.commit()
    except Exception:
        db.session.rollback()
        app.logger.exception('Simulation deletion failed')
        return jsonify({'error': 'SIMULATION_DELETE_FAILED',
                        'message': 'Simulation konnte nicht sicher gelöscht werden'}), 500
    return jsonify({'deleted': deleted})


@app.before_request
def authenticate_api_request():
    # Bind validation caches to this HTTP request even in nested test/app contexts.
    g._validated_accommodation_owner = None
    g.import_event_id = None
    g._quota_event_record = None
    g.api_path = _canonical_api_path()
    if g.api_path is None or request.method == 'OPTIONS':
        return None
    g.current_user = load_user_from_request()
    g.request_id = request.headers.get('X-Request-ID', str(uuid.uuid4()))[:100]
    if g.current_user is None:
        return jsonify({'error': 'UNAUTHENTICATED', 'message': 'Authentication required'}), 401
    permission = _required_permission()
    if permission and not g.current_user.has_permission(permission):
        return jsonify({'error': 'FORBIDDEN', 'message': 'Insufficient permissions'}), 403
    # Explicit UI context is validated after authentication/permissions and before
    # object snapshots or mutations. Legacy clients retain the configured owner.
    header_owner = request.headers.get('X-Championship-Event-ID')
    if header_owner is not None:
        owner = normalize_event_id(header_owner)
        validate_operational_import_event(owner)
        if owner != configured_event_id():
            raise OperationalEventError('Request event conflicts with the operational championship')
        record = db.session.get(Event, owner)
        if record is None or not record.active:
            raise OperationalEventError('Operational event is missing or inactive')
        g._validated_accommodation_owner = owner
        g._quota_event_record = record
    if g.api_path != '/api/assignments/availability' and request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} and (
            g.api_path.startswith('/api/assignments/') or g.api_path.startswith('/api/room-assignments')):
        lock_accommodation_writes()
    # Keep the fachliche description of objects that may be deleted by the
    # endpoint. This snapshot is request-local and contains no transport data.
    g.audit_snapshot = None
    if request.method in {'PUT', 'PATCH', 'DELETE', 'POST'}:
        parts = [part for part in g.api_path.split('/') if part]
        numeric = [int(part) for part in parts if part.isdigit()]
        try:
            if g.api_path.startswith('/api/assignments/bookings/') and numeric:
                booking = event_get(RoomBooking, numeric[0])
                g.audit_snapshot = booking.to_dict() if booking else None
            elif g.api_path.startswith('/api/room-assignments/') and numeric:
                booking = event_get(RoomBooking, numeric[0])
                g.audit_snapshot = booking.to_dict() if booking else None
            elif g.api_path.startswith('/api/hotels/') and numeric:
                hotel = event_get(Hotel, numeric[0])
                g.audit_snapshot = hotel.to_dict() if hotel else None
            elif g.api_path.startswith('/api/athletes/') and numeric:
                athlete = event_get(Athlete, numeric[0])
                g.audit_snapshot = athlete.to_dict() if athlete else None
            elif g.api_path.startswith('/api/room-types/') and numeric:
                room_type = db.session.get(RoomType, numeric[0])
                g.audit_snapshot = room_type.to_dict() if room_type else None
        except (ValueError, TypeError):
            g.audit_snapshot = None
    return None


app.before_request(validate_import_request_context)


def _audit_entity():
    parts = [part for part in g.api_path.removeprefix('/api/').split('/') if part]
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
        segment_operation = '/segments' in request.path or request.path.endswith('/split')
        booking = (response.get('booking') or snapshot or {}) if segment_operation else response
        occupants = booking.get('occupants') or []
        athletes = [item.get('athlete') or {} for item in occupants]
        athlete_ids = payload.get('athleteIds') or [a.get('id') for a in athletes]
        if segment_operation:
            athlete_ids = [item['personId'] for item in response.get('people', [])] or [response.get('personId')]
            athletes = [athlete for athlete in athletes if str(athlete.get('id')) in athlete_ids]
        path_ids = [part for part in request.path.split('/') if part.isdigit()]
        if '/occupants/' in request.path and path_ids:
            athlete_ids = [path_ids[-1]]
        for index, athlete_id in enumerate(filter(None, athlete_ids)):
            ref('personId' if index == 0 else f'personId{index + 1}', athlete_id)
        booking_id = booking.get('id') or (response.get('bookingId') if segment_operation else None) or (path_ids[0] if path_ids else entity_id)
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
            title = 'Quotenbewertung auf EZ gesetzt' if set(payload) == {'countsAsSingle'} and payload.get('countsAsSingle') else ('Quotenbewertung auf DZ gesetzt' if set(payload) == {'countsAsSingle'} else 'Zimmerpartner geändert')
        else:
            title = 'Zimmer zugewiesen'
        if segment_operation:
            title = 'Unterkunftszuweisung entfernt' if request.method == 'DELETE' else 'Unterkunftszuweisung bearbeitet' if request.method == 'PUT' else 'Unterkunftszuweisung hinzugefügt'
        if request.path.endswith('/split'):
            title = 'Zuweisung geteilt'
            details.append(f"Teilungsdatum: {response.get('splitDate', '')}; Personen: {', '.join(str(value) for value in payload.get('athleteIds', []))}")
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
            hotel = event_get(Hotel, int(hotel_id)) if hotel_id else None
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
        if 'accommodationRateCategory' in payload:
            old_rate = (snapshot or {}).get('accommodationRateCategory', 'STANDARD')
            details.append(f"Unterkunftstarif: {old_rate} → {response.get('accommodationRateCategory')}")
        if 'singleRoomQuotaExemptReason' in payload:
            labels = {'WORLD_CHAMPION': 'Weltmeister', 'OTHER': 'EZ-Ausnahme'}
            old_reason = (snapshot or {}).get('singleRoomQuotaExemptReason') if isinstance(snapshot, dict) else None
            new_reason = response.get('singleRoomQuotaExemptReason')
            if not new_reason:
                title = 'EZ-Sonderstatus entfernt'
            elif old_reason and old_reason != new_reason:
                title = f"EZ-Sonderstatus geändert: {labels.get(old_reason, old_reason)} → {labels.get(new_reason, new_reason)}"
            else:
                title = f"EZ-Sonderstatus gesetzt: {labels.get(new_reason, new_reason)}"

    elif entity_type == 'admin' and '/world-champions' in request.path:
        ref('worldChampionId', entity_id or response.get('id'))
        ref('eventId', response.get('eventId'))
        label = response.get('name') or 'World Champion'
        category = 'Administration'
        title = 'Weltmeisterreferenz angelegt' if action == 'create' else 'Weltmeisterreferenz geändert'
        details.extend([str(response.get('fisCode') or ''), str(response.get('championship') or ''),
                        str(response.get('championshipYear') or '')])

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
            decision_id = ids[-1]
            current_decision_ids = {
                str(item.get('id')) for item in response.get('approvals', [])
                if item.get('id') is not None
            }
            # A completed decision revision creates a new immutable decision;
            # link the audit activity to that current record, not the
            # superseded id from the PATCH URL.
            if current_decision_ids and decision_id not in current_decision_ids:
                decision_id = max(current_decision_ids, key=int)
            ref('decisionId', decision_id)
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
    if getattr(g,'atomic_import_audit',False):
        response.headers['X-Request-ID']=getattr(g,'request_id','')
        return response
    user = current_user()
    if getattr(g, 'api_path', None) == '/api/assignments/availability':
        return response
    if (user is None or request.method not in {'POST', 'PUT', 'PATCH', 'DELETE'}
            or not getattr(g, 'api_path', None) or response.status_code >= 400):
        return response
    try:
        entity_type, entity_id = _audit_entity()
        payload = request.get_json(silent=True)
        if payload:
            payload = {key: value for key, value in payload.items()
                       if key.lower() not in {'password', 'token', 'previewtoken', 'secret'}}
        if payload and 'accommodationRequirement' in payload and isinstance(getattr(g, 'audit_snapshot', None), dict):
            payload = {**payload, 'accommodation_requirement': {'old': g.audit_snapshot.get('accommodationRequirement', 'REQUIRED'), 'new': (response.get_json(silent=True) or {}).get('accommodationRequirement')},
                'accommodation_requirement_source': {'old': g.audit_snapshot.get('accommodationRequirementSource', 'DEFAULT'), 'new': (response.get_json(silent=True) or {}).get('accommodationRequirementSource')}}
        if payload and 'accommodationRateCategory' in payload and isinstance(getattr(g, 'audit_snapshot', None), dict):
            payload = {**payload, 'accommodation_rate_category': {
                'old': g.audit_snapshot.get('accommodationRateCategory', 'STANDARD'),
                'new': payload['accommodationRateCategory']}}
        action = {'POST': 'create', 'PUT': 'update', 'PATCH': 'update', 'DELETE': 'delete'}[request.method]
        if 'unassign' in g.api_path:
            action = 'unassign'
        elif '/assign' in g.api_path:
            action = 'assign'
        elif g.api_path.startswith('/api/import/'):
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
            entity_refs_json=(event_audit_refs(business['entity_refs'])
                if app.config.get('OPERATIONAL_EVENT_ID') else json.dumps(business['entity_refs'], ensure_ascii=False)),
        ))
        db.session.commit()
    except Exception:
        app.logger.exception('Unable to write audit event')
        db.session.rollback()
    response.headers['X-Request-ID'] = getattr(g, 'request_id', '')
    return response


def ensure_reference_data():
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
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

    hotel_map = {hotel.name: hotel for hotel in event_query(Hotel).all()}
    inventory_keys = {
        (inv.hotel_id, inv.room_type_id, inv.available_from, inv.available_until, inv.room_count)
        for inv in event_query(HotelRoomInventory).all()
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
        for event in event_query(AccommodationEvent).all()
    }
    existing_demands = {
        (demand.event_id, demand.room_type_id, demand.room_count)
        for demand in event_query(EventRoomDemand).all()
    }

    for discipline, start_date, end_date, demands in events_seed:
        event_key = (discipline, datetime.fromisoformat(start_date).date(), datetime.fromisoformat(end_date).date())
        event = event_map.get(event_key)
        if event is None:
            event = AccommodationEvent(discipline=discipline, start_date=event_key[1], end_date=event_key[2])
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
    return booking_intervals_overlap(start_a, end_a, start_b, end_b)


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
    for athlete in event_query(Athlete).filter(Athlete.id.in_(set(athlete_ids))).all():
        if _has_pending_roomlist_review(athlete):
            athlete.roomlist_change_acknowledged_at = now
            athlete.roomlist_change_acknowledged_summary = athlete.roomlist_change_summary


def _change_touches_assignment_for_athlete(athlete):
    return bool(_has_pending_roomlist_review(athlete) and event_query(RoomBookingOccupant).filter_by(athlete_id=athlete.id).first())


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
    athletes = event_query(Athlete).order_by(
        Athlete.nation_code,
        Athlete.discipline,
        Athlete.gender,
        Athlete.room_type,
        Athlete.lastname,
        Athlete.firstname,
        Athlete.id,
    ).all()
    bookings = event_query(RoomBooking).options(db.joinedload(RoomBooking.occupants).joinedload(RoomBookingOccupant.athlete), db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()
    booking_index = {}
    athlete_booking_index = {}
    for booking in bookings:
        from accommodation_scope import validate_serialized_ownership
        validate_serialized_ownership(booking)
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

    athletes = [a for a in athletes if a.accommodation_requirement != 'NO_ROOM']
    athletes_by_name_and_nation = {k: [a for a in values if a.accommodation_requirement != 'NO_ROOM'] for k, values in athletes_by_name_and_nation.items()}
    athletes_by_name = {k: [a for a in values if a.accommodation_requirement != 'NO_ROOM'] for k, values in athletes_by_name.items()}
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
                'quotaDisciplines': quota_disciplines(athlete.competitions),
                'approvedQuotaDisciplines': approved_quota_disciplines(athlete),
                'approvedQuotaContexts': approved_quota_contexts(athlete),
                'gender': normalize_gender(athlete.gender),
                **rate_projection(athlete),
                **requirement_projection(athlete),
                'function': athlete.function,
                'specialMeal': athlete.special_meal,
                'roomType': athlete.room_type,
                'arrivalDate': athlete.arrival_date.isoformat() if athlete.arrival_date else None,
                'departureDate': athlete.departure_date.isoformat() if athlete.departure_date else None,
                'importChangeTypes': json.loads(athlete.import_change_types_json) if athlete.import_change_types_json else [],
                'importChangeDetails': json.loads(athlete.import_change_details_json) if athlete.import_change_details_json else [],
                'statusBadges': _status_badges_for_athlete(type('A', (), {
                    'hasPendingRoomlistReview': pending_review,
                    'changeTouchesAssignment': assigned_change,
                    'special_meal': athlete.special_meal,
                    'room_type': athlete.room_type,
                })()),
                'single_room_status': athlete.single_room_status or 'NONE',
                'singleRoomQuotaExemptReason': athlete.single_room_quota_exempt_reason,
                'single_room_decision_id': str(athlete.single_room_decision_id) if athlete.single_room_decision_id else None,
                'hasPendingReview': assigned_change,
                'changeTouchesAssignment': assigned_change,
                'isAssigned': bool(athlete_booking),
                'accommodationCoverage': person_accommodation_coverage(
                    athlete.arrival_date, athlete.departure_date,
                    athlete_booking_index.get(athlete.id, []), athlete.accommodation_requirement),
                'assignedBookingId': str(athlete_booking.id) if athlete_booking else None,
                'assignedHotelId': str(athlete_booking.hotel_id) if athlete_booking else None,
                'assignedHotelName': athlete_booking.hotel.name if athlete_booking and athlete_booking.hotel else None,
                'assignedRoomTypeId': str(athlete_booking.room_type_id) if athlete_booking else None,
                'assignedRoomNumber': athlete_booking.room_number if athlete_booking else None,
                'countsAsSingle': bool(athlete_booking.counts_as_single) if athlete_booking else False,
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
            'assignedHotelName': shared_booking.hotel.name if shared_booking and shared_booking.hotel and is_fully_assigned else None,
            'assignedRoomTypeId': str(shared_booking.room_type_id) if shared_booking and is_fully_assigned else None,
            'assignedRoomNumber': shared_booking.room_number if shared_booking and is_fully_assigned else None,
            'hasAnyAssigned': has_any_assigned,
            'isFullyAssigned': is_fully_assigned,
            'allowedRoomTypeLabels': ['single', 'double'] if len(occupants) == 1 else [_room_type_label(room_type)],
        })
    return units, bookings


def _build_unit_validations(unit, hotel_sections, bookings_by_slot):
    validations = []
    for hotel_section in hotel_sections:
        for slot in hotel_section['slots']:
            slot_copy = dict(slot)
            covers_requested_range = True
            date_coverage = slot['dateCoverage']
            if (date_coverage['availableFrom'] and date_coverage['availableUntil']
                    and unit.get('checkInDate') and unit.get('checkOutDate')):
                covers_requested_range = (
                    date_coverage['availableFrom'] <= unit['checkInDate']
                    and date_coverage['availableUntil'] >= unit['checkOutDate'])
            slot_copy['dateCoverage'] = dict(date_coverage)
            slot_copy['dateCoverage']['coversRequestedRange'] = covers_requested_range
            relevant_bookings = bookings_by_slot.get(
                (slot['hotelId'], slot['roomTypeId'], slot['roomNumber'] or ''),
                [],
            )
            validations.append({
                'slotId': slot['slotId'],
                **_calculate_unit_validation(unit, slot_copy, relevant_bookings),
            })
    return validations


def _build_assignment_planning_view(validation_keys=None, assignment_interval=None):
    with _assignment_phase('assignment'):
        units, bookings = _build_room_booking_units()
    rooms_started = time.perf_counter()
    hotels = event_query(Hotel).options(db.joinedload(Hotel.room_inventories).joinedload(HotelRoomInventory.room_type)).all()

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
        for inventory in ([] if hotel.accommodation_type == 'EXTERNAL' else hotel.room_inventories or []):
            by_room_type.setdefault(inventory.room_type_id, {'roomType': inventory.room_type, 'inventories': []})
            by_room_type[inventory.room_type_id]['inventories'].append(inventory)

        slots = []
        for room_type_id, payload in by_room_type.items():
            relevant_bookings = bookings_by_hotel_room_type.get((hotel.id, room_type_id), [])
            slots.extend(_build_virtual_slots(hotel, payload['roomType'], payload['inventories'], relevant_bookings))

        hotel_sections.append({
            'hotelId': str(hotel.id),
            'hotelName': hotel.name,
            'accommodationType': hotel.accommodation_type,
            'externalBookings': [booking.to_dict() for booking in bookings if booking.hotel_id == hotel.id] if hotel.accommodation_type == 'EXTERNAL' else [],
            'location': hotel.location,
            'region': hotel.region,
            'comment': hotel.comment,
            'inventoryComments': [
                {'id': str(inv.id), 'roomTypeId': str(inv.room_type_id),
                 'availableFrom': inv.available_from.isoformat(),
                 'availableUntil': inv.available_until.isoformat(), 'comment': inv.comment}
                for inv in sorted(hotel.room_inventories or [], key=lambda row: row.id)
                if inv.comment and inv.comment.strip()
            ],
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
                                    'quotaDisciplines': quota_disciplines(occ.athlete.competitions),
                                    'approvedQuotaDisciplines': approved_quota_disciplines(occ.athlete),
                                    'approvedQuotaContexts': approved_quota_contexts(occ.athlete),
                                    'gender': normalize_gender(occ.athlete.gender),
                                    **rate_projection(occ.athlete),
                                    **requirement_projection(occ.athlete),
                                    'function': occ.athlete.function,
                                    'arrivalDate': occ.athlete.arrival_date.isoformat() if occ.athlete.arrival_date else None,
                                    'departureDate': occ.athlete.departure_date.isoformat() if occ.athlete.departure_date else None,
                                    'hasPendingReview': _has_pending_roomlist_review(occ.athlete) or occ.athlete.accommodation_requirement == 'NO_ROOM',
                                    'importChangeTypes': json.loads(occ.athlete.import_change_types_json) if occ.athlete.import_change_types_json else [],
                                    'importChangeDetails': json.loads(occ.athlete.import_change_details_json) if occ.athlete.import_change_details_json else [],
                                    'single_room_status': occ.athlete.single_room_status or 'NONE',
                                    'singleRoomQuotaExemptReason': occ.athlete.single_room_quota_exempt_reason,
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
        unit_key = unit['unitId']
        validation_unit = {**unit, **(assignment_interval or {})}
        if assignment_interval:
            validation_unit['assignedBookingId'] = None
        if validation_keys is None or unit_key in validation_keys:
            validation_by_unit[unit_key] = _build_unit_validations(
                validation_unit, hotel_sections, bookings_by_slot)

        for occupant in unit.get('occupants', []):
            partial_key = f"{unit_key}:athlete:{occupant['athleteId']}"
            if validation_keys is None or partial_key in validation_keys:
                partial_unit = _build_partial_unit_variant(validation_unit, occupant)
                validation_by_unit[partial_key] = _build_unit_validations(
                    partial_unit, hotel_sections, bookings_by_slot)

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


def _validate_booking_payload(data, existing_booking=None, person_booking_exclusion_id=None, allow_single_join=False):
    if existing_booking is not None:
        require_event_object(existing_booking)
    athlete_ids = data.get('athleteIds', [])
    if not isinstance(athlete_ids, list) or len(athlete_ids) < 1 or len(athlete_ids) > 4:
        return None, None, _booking_error('INVALID_OCCUPANTS', 'athleteIds must include between 1 and 4 athlete IDs')

    hotel_id = int(data['hotelId'])
    hotel = event_get(Hotel, hotel_id, required=True)
    external = hotel.accommodation_type == 'EXTERNAL'
    room_type_id = int(data['roomTypeId']) if data.get('roomTypeId') else None
    room_type = RoomType.query.get_or_404(room_type_id) if room_type_id else None
    if not external and not room_type:
        return None, None, _booking_error('ROOM_TYPE_REQUIRED', 'Standard accommodation requires a room type')

    unique_athlete_ids = []
    for athlete_id in athlete_ids:
        int_id = int(athlete_id)
        if int_id not in unique_athlete_ids:
            unique_athlete_ids.append(int_id)

    if not external and len(unique_athlete_ids) > room_type.max_persons:
        return None, None, _booking_error('CAPACITY_EXCEEDED', f'Room type max occupancy is {room_type.max_persons}')

    if (existing_booking and not external and existing_booking.counts_as_single
            and data.get('countsAsSingle', True) and not allow_single_join
            and not set(unique_athlete_ids).issubset({o.athlete_id for o in existing_booking.occupants})):
        return None, None, _booking_error('ROOM_SINGLE_USE', 'Zimmer ist durch EZ-Nutzung gesperrt.')

    athletes = event_query(Athlete).filter(Athlete.id.in_(unique_athlete_ids)).all()
    if len(athletes) != len(unique_athlete_ids):
        return None, None, _booking_error('ATHLETE_NOT_FOUND', 'One or more athletes not found')

    from accommodation_split import SplitError
    try:
        for person in athletes:
            require_assignable(person)
    except SplitError as error:
        return None, None, _booking_error(error.code, error.message)
    if external:
        from external_accommodation import ensure_external_create_allowed
        from accommodation_split import SplitError
        try:
            ensure_external_create_allowed(unique_athlete_ids,
                person_booking_exclusion_id or (existing_booking.id if existing_booking else None))
        except SplitError as error:
            return None, None, _booking_error(error.code, error.message)

    try:
        check_in_date = datetime.fromisoformat(data['checkInDate']).date() if data.get('checkInDate') else None
        check_out_date = datetime.fromisoformat(data['checkOutDate']).date() if data.get('checkOutDate') else None
    except (ValueError, TypeError):
        return None, None, _booking_error('INVALID_DATES', 'Booking dates must be valid ISO dates')
    if not check_in_date or not check_out_date:
        return None, None, _booking_error('MISSING_DATES', 'Booking requires check-in and check-out dates')
    if check_in_date >= check_out_date:
        return None, None, _booking_error('INVALID_DATES', 'Check-in must be before check-out')

    # Exclude only the booking being edited/moved, never another segment.
    person_bookings = event_query(RoomBooking).join(RoomBookingOccupant).filter(
        RoomBookingOccupant.athlete_id.in_(unique_athlete_ids),
        RoomBooking.check_in_date < check_out_date,
        RoomBooking.check_out_date > check_in_date)
    person_exclusion = person_booking_exclusion_id or (existing_booking.id if existing_booking else None)
    if person_exclusion:
        person_bookings = person_bookings.filter(RoomBooking.id != person_exclusion)
    if person_bookings.first():
        return None, None, _booking_error('PERSON_BOOKING_OVERLAP',
            'Der gewählte Zeitraum überschneidet sich mit einer bestehenden Zuweisung. Bitte zuerst die betroffene Zuweisung anpassen oder entfernen.'
            if external else 'Person already has accommodation during this period')

    if not external:
        from assignment_availability import inventory_guard
        inventories = event_query(HotelRoomInventory).filter_by(hotel_id=hotel_id, room_type_id=room_type_id).all()
        query = event_query(RoomBooking).filter_by(hotel_id=hotel_id, room_type_id=room_type_id).filter(
            RoomBooking.check_in_date < check_out_date, RoomBooking.check_out_date > check_in_date)
        if existing_booking:
            query = query.filter(RoomBooking.id != existing_booking.id)
        other_bookings = query.all()
        failure = inventory_guard(inventories, other_bookings, check_in_date, check_out_date)
        if failure:
            return None, None, _booking_error(*failure)
        if data.get('roomNumber') and any(
            (_planned_room_key(b.room_number) or b.room_number) == (_planned_room_key(data['roomNumber']) or data['roomNumber'])
            and _dates_overlap(b.check_in_date,b.check_out_date,check_in_date,check_out_date)
            for b in other_bookings):
            return None, None, _booking_error('ROOM_BOOKING_OVERLAP', 'Zimmer ist im benötigten Zeitraum nicht verfügbar.')

    return {
        'hotel_id': hotel_id,
        'room_type_id': room_type_id,
        'room_number': data.get('roomNumber'),
        'check_in_date': check_in_date,
        'check_out_date': check_out_date,
        'athlete_ids': unique_athlete_ids,
        'counts_as_single': bool(data.get(
            'countsAsSingle', existing_booking.counts_as_single if existing_booking else False)),
    }, room_type, None


def _initialize_new_booking_counts_as_single(data, *, people=None):
    """Default only NEW bookings; explicit flags and saved overrides always win."""
    if 'countsAsSingle' in data:
        return data
    from accommodation_defaults import default_counts_as_single
    athlete_ids = {int(athlete_id) for athlete_id in data.get('athleteIds', [])}
    if people is None:
        people = event_query(Athlete).filter(Athlete.id.in_(athlete_ids)).all()
    hotel = event_get(Hotel, int(data['hotelId'])) if data.get('hotelId') else None
    room_type = db.session.get(RoomType, int(data['roomTypeId'])) if data.get('roomTypeId') else None
    capacity = room_type.max_persons if room_type and not (hotel and hotel.accommodation_type == 'EXTERNAL') else None
    initialized = dict(data)
    initialized['countsAsSingle'] = default_counts_as_single(capacity, len(athlete_ids),
        single_request=any(_room_type_label(person.room_type) == 'single' for person in people),
        approved_extra=any(person.single_room_status == 'APPROVED_EXTRA' for person in people))
    return initialized


def _save_booking_from_payload(payload, existing_booking=None, commit=True):
    if existing_booking is not None:
        require_event_object(existing_booking)
    if existing_booking is None:
        booking = RoomBooking(
            event_id=accommodation_event_id(),
            created_by=payload.get('created_by'),
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
        event_query(RoomBookingOccupant).filter_by(room_booking_id=booking.id).delete()

    for athlete_id in payload['athlete_ids']:
        db.session.add(RoomBookingOccupant(room_booking_id=booking.id, athlete_id=athlete_id))
    db.session.flush()
    _acknowledge_import_changes(payload['athlete_ids'])
    if commit:
        db.session.commit()
    else:
        db.session.flush()
    return booking


def _detach_athletes_from_existing_bookings(athlete_ids, exclude_booking_id=None):
    for athlete_id in athlete_ids:
        memberships = event_query(RoomBookingOccupant).filter_by(athlete_id=athlete_id).all()
        for membership in memberships:
            booking = membership.room_booking
            if not booking:
                continue
            if exclude_booking_id and booking.id == exclude_booking_id:
                continue
            db.session.delete(membership)
            db.session.flush()
            remaining = event_query(RoomBookingOccupant).filter_by(room_booking_id=booking.id).count()
            if remaining == 0:
                db.session.delete(booking)
    # The caller saves and commits the entire replacement operation atomically.
    db.session.flush()


def _build_official_quota_usage_rows(nation_code=None, discipline=None, gender=None):
    athletes = event_query(Athlete)
    if nation_code:
        athletes = athletes.filter(Athlete.nation_code == nation_code)
    # Allocate across all eligible groups before applying display filters.
    athletes = athletes.all()
    roster = [{'personId': a.id, 'nationCode': a.nation_code, 'discipline': a.discipline,
               'quotaDisciplines': quota_disciplines(a.competitions),
               'gender': a.gender, 'forGender': a.for_gender,
               **rate_projection(a), **requirement_projection(a), 'name': f'{a.firstname} {a.lastname}'.strip(),
               'function': a.function, 'matchKey': a.fis_code or a.competitor_id or next(iter(sorted(person_keys(a))), str(a.id)),
               'singleRoomQuotaExemptReason': a.single_room_quota_exempt_reason} for a in athletes]

    # Aggregate every booking membership once. A person with any persisted
    # counts_as_single booking consumes one physical single at most; additional
    # bookings never multiply the person or alter the flags themselves.
    booking_by_athlete = {}
    athlete_ids = [athlete.id for athlete in athletes]
    membership_rows = []
    if athlete_ids:
        membership_rows = db.session.query(
            RoomBookingOccupant.athlete_id,
            RoomBooking.counts_as_single,
        ).filter(ownership_clause(RoomBooking, accommodation_event_id())).filter(ownership_clause(RoomBookingOccupant, accommodation_event_id())).join(
            RoomBooking,
            RoomBooking.id == RoomBookingOccupant.room_booking_id,
        ).filter(
            RoomBookingOccupant.athlete_id.in_(athlete_ids),
        ).order_by(RoomBookingOccupant.id).all()
    for athlete_id, counts_as_single in membership_rows:
        booking_by_athlete[athlete_id] = booking_by_athlete.get(athlete_id, False) or bool(counts_as_single)

    # The persisted assignment flag is the sole source of truth for operational
    # quota usage. The physical room type and import entitlement stay unchanged.
    assigned = []
    for athlete, person in zip(athletes, roster):
        if athlete.id not in booking_by_athlete:
            continue
        evidence = applicable_approval_groups(athlete.single_room_decision, athlete, roster=athletes)
        assigned.append({**person, 'countsAsSingle': booking_by_athlete[athlete.id],
            'singleRoomStatus': athlete.single_room_status,
            'approvedQuotaContexts': [{'nationCode': n, 'discipline': d, 'gender': g}
                for n, d, g in sorted(evidence)] if athlete.single_room_status == 'APPROVED_EXTRA' else []})
    rows = evaluate_quota_usage(roster, assigned,rules_for_event(accommodation_event_id()))
    disposition = disposition_by_quota_group(roster, booking_by_athlete)
    allocation_by_person = {item['personId']: item for row in rows for item in row['singleRoomAllocations']}
    approved_by_key = {}
    implemented_by_key = {}
    unresolved_approvals = []
    for athlete, person in zip(athletes, roster):
        allocation = allocation_by_person.get(athlete.id)
        groups = {tuple(allocation['context'])} if allocation else set()
        if athlete.single_room_entitlement == 'APPROVED_EXTRA':
            approved_groups = applicable_approval_groups(athlete.single_room_decision, athlete, roster=athletes)
            if not approved_groups and athlete.single_room_decision_id:
                unresolved_approvals.append(athlete.single_room_decision_id)
            reviewed = approved_groups & groups if groups else set(sorted(approved_groups)[:1])
            for key in reviewed:
                approved_by_key.setdefault(key, set()).add(athlete.id)
        if athlete.single_room_entitlement and booking_by_athlete.get(athlete.id, False):
            for key in groups:
                implemented_by_key.setdefault(key, set()).add(athlete.id)
    approval_state = {}
    approval_rows = db.session.query(
        ImportApproval.quota_details_json,
        ImportApproval.decision,
        ImportSession.nation,
        ImportSession.discipline,
        ImportApproval.id,
        ImportApproval.approved_person_keys_json,
        ImportApproval,
    ).join(
        ImportSession,
        (ImportSession.id == ImportApproval.session_id)
        & (ImportSession.current_version_id == ImportApproval.version_id),
    ).filter(ImportSession.event_id == accommodation_event_id()).filter(~ImportApproval.id.in_(
        db.session.query(ImportSessionEvent.approval_id).filter(
            ImportSessionEvent.session_id.in_(db.select(ImportSession.id).where(ImportSession.event_id == accommodation_event_id())),
            ImportSessionEvent.event_type == 'QUOTA_DECISION_REVISED_FROM',
            ImportSessionEvent.approval_id.isnot(None),
        )
    )).all()
    people_by_key = {}
    for athlete in athletes:
        for identity in person_keys(athlete):
            if identity:
                people_by_key.setdefault(str(identity), {})[athlete.id] = athlete
    for details_json, decision, session_nation, session_discipline, approval_id, selected_json, approval in approval_rows:
        details = json.loads(details_json or '{}')
        if details.get('decisionKind')=='ATHLETE_QUOTA' or approval.approval_type == 'QUOTA_OFFICIALS_EXCEEDED' or approval.description.startswith('Officials überschritten'):
            continue
        if nation_code and (details.get('nationCode') or session_nation) != nation_code:
            continue
        groups = set()
        selected = json.loads(selected_json or '[]') if decision == 'APPROVED' else [
            c.get('personKey') for c in details.get('singleRoomCandidates', [])]
        unresolved = not selected
        for identity in selected:
            matches = list(people_by_key.get(str(identity), {}).values())
            applicable = set()
            if len(matches) == 1:
                applicable = (applicable_approval_groups(approval, matches[0], identity, athletes)
                    if decision == 'APPROVED' else historical_approval_groups(details, matches[0], identity, athletes))
            if not applicable:
                unresolved = True
            groups |= applicable
        if unresolved:
            unresolved_approvals.append(approval_id)
            continue
        for key in groups:
            state = approval_state.setdefault(key, {'pending': set(), 'approved': set()})
            state['approved' if decision == 'APPROVED' else 'pending'].add(approval_id)
    invalid_decisions = set(unresolved_approvals)
    decision_by_person = {a.id: a.single_room_decision_id for a in athletes}
    for key, person_ids in approved_by_key.items():
        approved_by_key[key] = {person_id for person_id in person_ids
            if decision_by_person[person_id] not in invalid_decisions}
    if unresolved_approvals:
        app.logger.warning('Quota approvals require membership review: %s', sorted(set(unresolved_approvals)))
    all_person_bookings = {}
    for booking in event_query(RoomBooking).options(db.selectinload(RoomBooking.occupants), db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all():
        for membership in booking.occupants:
            all_person_bookings.setdefault(membership.athlete_id, []).append(booking)
    coverage_by_id = {str(a.id): person_accommodation_coverage(a.arrival_date, a.departure_date, all_person_bookings.get(a.id, []), a.accommodation_requirement) for a in athletes}
    allowance_contexts = {(r['nationCode'], r['discipline'], r['gender']) for r in rows}
    for row in rows:
        key = (row['nationCode'], row['discipline'], row['gender'])
        context_people = [p for p in roster if key in quota_keys(p, allowance_contexts=allowance_contexts)]
        row.update(accommodation_metrics(context_people, coverage_by_id))
        row['functionGroups'] = function_groups(context_people, booking_by_athlete)
        row['specialRateCount'] = sum(p['accommodationRateCategory'] == 'SPECIAL' for group in row['functionGroups'] for p in group['people'])
        row.update(disposition.get(key, {'peopleTotal': 0, 'peopleAssigned': 0}))
        row['approvedExtraSingleRooms'] = len(approved_by_key.get(key, set()))
        row['requiredSingleRooms'] = row['singleRoomsUsed']
        row['implementedSingleRooms'] = len(implemented_by_key.get(key, set()))
        row['remainingSingleRooms'] = max(0, row['requiredSingleRooms'] - row['implementedSingleRooms'])
        decisions = approval_state.get(key, {'pending': set(), 'approved': set()})
        row['openApprovals'] = len(decisions['pending']) if row['singleRoomsPending'] > 0 else 0
        row['approvedExceptions'] = len(decisions['approved'])
        row['unresolvedHistoricalApprovalIds'] = sorted(set(unresolved_approvals))
        row['quotaStatus'] = ('DECISION_REQUIRED' if row['singleRoomsPending'] > 0 else
            'EXCEPTION_APPROVED' if decisions['approved'] else 'FULFILLED')
    return [row for row in rows if (not gender or row['gender'] == normalize_gender(gender))
            and (not discipline or row['discipline'] == discipline)]


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
    lock_accommodation_writes()
    raw_event_id = request.form.get('eventId') or request.headers.get('X-Championship-Event-ID')
    if not raw_event_id:
        return jsonify({'error': 'EVENT_REQUIRED', 'message': 'Bitte ein Event für den Import auswählen.'}), 400
    try:
        event_id = normalize_event_id(raw_event_id)
    except ImportValidationError as exc:
        return jsonify(exc.to_dict()), 400
    event_id = validate_operational_import_event(event_id)
    event_context = Event.query.options(
        db.selectinload(Event.competition_mappings).joinedload(EventCompetition.competition)
    ).filter_by(id=event_id).first()
    if not event_context:
        return jsonify({'error': 'EVENT_NOT_FOUND', 'event_id': event_id,
                        'message': 'Das ausgewählte Event wurde nicht gefunden.'}), 404
    if not event_context.active:
        return jsonify({'error': 'EVENT_INACTIVE', 'event_id': event_id,
                        'message': f'Event {event_context.name} ist inaktiv.'}), 422
    g.import_event_id = event_context.id
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
        source_hash = hashlib.sha256(
            Path(entries_path).read_bytes() + b'\0' + Path(room_path).read_bytes()
            + b'\0event:' + str(event_context.id).encode('ascii')
        ).hexdigest()
        from imports.read_context import ImportReadContext
        read_context=ImportReadContext(event_context.id)
        result = create_fis_import_preview(entries_path, room_path, event_context,read_context=read_context)
        session_id = request.form.get('sessionId')
        if request.form.get('createSession') == 'true' or session_id:
            nations = sorted({person.get('nationCode') for person in result['people'] if person.get('nationCode')})
            if not nations and session_id:
                owner=db.session.get(ImportSession,normalize_event_id(session_id))
                validate_session_event(owner,event_id=event_context.id)
                nations=[owner.nation]
            if len(nations) != 1:
                return jsonify({'error': 'Eine Import Session muss genau eine Nation enthalten.', 'nations': nations}), 400
            nation = nations[0]
            user = current_user()
            session = ImportSession.query.get(int(session_id)) if session_id else None
            if session:
                validate_session_event(session, event_id=event_context.id)
            if session and session.nation != nation:
                return jsonify({'error': 'Eine Version kann nur zur Session derselben Nation hinzugefügt werden.'}), 409
            if not session:
                # There is exactly one durable workflow per nation, including completed workflows.
                session = ImportSession.query.filter_by(event_id=event_context.id, nation=nation).first()
            if session and session.current_version:
                previous_preview = json.loads(session.current_version.preview_json or '{}')
                keys = {p.get('matchKey') for p in result['people']}
                commands = {key: value for key, value in previous_preview.get('singleRoomQuotaExemptOverrides', {}).items()
                            if key in keys and value in {None, 'WORLD_CHAMPION'}}
                if commands:
                    result['singleRoomQuotaExemptOverrides'] = commands
                    result['carriedSingleRoomQuotaExemptKeys'] = list(commands)
                    result['singleRoomQuotaExemptOverrideRevisions'] = {key: value for key, value in previous_preview.get('singleRoomQuotaExemptOverrideRevisions', {}).items() if key in commands}
                    recalculate_fis_import_preview(result)
                    raw = PREVIEW_STORE.get(result['previewToken'])
                    if raw is not None:
                        raw['singleRoomQuotaExemptOverrides'] = dict(commands)
                        raw['carriedSingleRoomQuotaExemptKeys'] = list(commands)
                        raw['singleRoomQuotaExemptOverrideRevisions'] = dict(result['singleRoomQuotaExemptOverrideRevisions'])
                        recalculate_fis_import_preview(raw)
            quota_issues = [
                issue for issue in result['warnings']
                if issue.get('code') == 'QUOTA_SINGLE_ROOMS_EXCEEDED'
                and (issue.get('code') != 'QUOTA_SINGLE_ROOMS_EXCEEDED'
                     or (issue.get('details') or {}).get('openExcessCount',
                                                        (issue.get('details') or {}).get('excessCount', 0)) > 0)
            ]
            preserved_issues = [
                issue for issue in result['warnings']
                if issue.get('code') == 'QUOTA_SINGLE_ROOMS_EXCEEDED'
                and (issue.get('details') or {}).get('preservedApprovedPeople')
            ]
            status = 'DRAFT' if result['errors'] else ('WAITING_FOR_NATION' if quota_issues else 'PROFESSIONALLY_REVIEWED')
            if session and any(version.source_hash==source_hash for version in session.versions):
                result['knownFiles']=True
                result['message']='Bekannte Dateien wurden erneut gegen den aktuellen Stand geprüft.'
            is_new = session is None
            if is_new:
                session = ImportSession(event_id=event_context.id, nation=nation, discipline=result.get('detectedDiscipline'),
                    status='DRAFT')
                db.session.add(session)
                db.session.flush()
            next_version = session.next_version_number()
            session.discipline = result.get('detectedDiscipline')
            # A new version has already completed its technical preview here.
            # Its workflow state must therefore be derived from the current
            # result, not from the mere fact that the session existed before.
            # In particular, an unchanged valid list has no open decision and
            # can proceed directly to professional approval.
            session.status = status
            session.approved_at = session.approved_by = None
            version = ImportSessionVersion(session_id=session.id, version=next_version,
                preview_token=result['previewToken'], preview_json=json.dumps(result, ensure_ascii=False),
                entries_filename=detected_names['entries'], room_filename=detected_names['roomlist'],
                source_hash=source_hash,
                uploaded_by=user.username)
            db.session.add(version)
            db.session.flush()
            session.current_version = version
            for person in result['people']:
                if person.get('singleRoomExemptionSource') == 'AUTO_REFERENCE' and person.get('worldChampionReferences'):
                    audit_status(person.get('matchKey'), 'AUTO_REFERENCE', 'WORLD_CHAMPION', user.username,
                        person['worldChampionReferences'], result.get('eventId'), person.get('fisCode'),
                        person.get('existingAthleteId'), session.id)
                    db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id,
                        event_type='WORLD_CHAMPION_AUTO_REFERENCE', title='Weltmeisterstatus automatisch angewendet',
                        description=json.dumps({'fisCode': person.get('fisCode'), 'references': person['worldChampionReferences']}, ensure_ascii=False), username=user.username))
            for issue in preserved_issues:
                details = issue.get('details') or {}
                people = details.get('preservedApprovedPeople') or []
                db.session.add(ImportApproval(
                    session_id=session.id, version_id=version.id, nation=nation,
                    approval_type='PRESERVED_APPROVED_EXTRA',
                    description='Bestehende Genehmigung übernommen',
                    quota_details_json=json.dumps(details, ensure_ascii=False),
                    approved_person_keys_json=json.dumps([item['personKey'] for item in people]),
                    decision='APPROVED', username=user.username))
            db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id,
                event_type='VERSION_RECEIVED', title=f'Version {next_version} erhalten',
                description='Neue Meldeliste gespeichert; technische Prüfung abgeschlossen.' if not result['errors'] else 'Neue Meldeliste gespeichert; technische Fehler gefunden.',
                username=user.username))
            for issue in quota_issues:
                details = dict(issue.get('details') or {})
                combination = ' • '.join(filter(None, [details.get('nationCode'), details.get('discipline'), details.get('gender')]))
                is_single_room = issue.get('code') == 'QUOTA_SINGLE_ROOMS_EXCEEDED'
                if is_single_room and 'openExcessCount' in details:
                    preserved_keys = {
                        item.get('personKey')
                        for item in details.get('preservedApprovedPeople', [])
                    }
                    details['excessCount'] = details['openExcessCount']
                    details['singleRoomCandidates'] = [
                        item for item in details.get('singleRoomCandidates', [])
                        if item.get('personKey') not in preserved_keys
                    ]
                current = details.get('importedSingleRooms') if is_single_room else details.get('importedOfficials')
                allowed = details.get('singleRoomsAllowed') if is_single_room else details.get('officialQuota')
                quota_title = f"{'Single Rooms' if is_single_room else 'Officials'} überschritten ({current} / {allowed})"
                db.session.add(ImportApproval(session_id=session.id, version_id=version.id, nation=nation,
                    approval_type=issue.get('code', 'QUOTA'), description=quota_title,
                    quota_details_json=json.dumps(details, ensure_ascii=False), decision='PENDING', username=user.username))
                db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id, event_type='QUOTA_VIOLATION',
                    title=quota_title,
                    description=combination, username=user.username))
            if not quota_issues and not result['errors'] and not any(row.get('decisionStatus')=='PENDING' for row in result.get('athleteQuotaChecks',[])):
                db.session.add(ImportSessionEvent(session_id=session.id, version_id=version.id, event_type='QUOTA_PASSED',
                    title='Quote erfüllt', description='Alle Kombinationen aus Nation, Disziplin und Gender sind erfüllt.',
                    username=user.username))
            reviewed=refresh_plan(session,result,read_context=read_context,recalculate=False)
            present_plan(result,reviewed['changePlan'])
            result['planStale']=False
            db.session.commit()
            result['session'] = session.to_dict(include_preview=True)
        return jsonify(result), 200
    except ImportValidationError as exc:
        db.session.rollback()
        return jsonify(exc.to_dict()), 422
    except (InvalidExcelFileError, ValueError) as exc:
        db.session.rollback()
        return jsonify({'error': 'INVALID_IMPORT_FILE', 'message': str(exc)}), 400
    except Exception:
        db.session.rollback()
        app.logger.exception('Unexpected FIS preview failure for event %s', event_id)
        return jsonify({'error': 'INTERNAL_SERVER_ERROR',
                        'message': 'Die Importvorschau konnte technisch nicht erstellt werden.'}), 500
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
        # Preserve token errors before resolving workflow eligibility. A cached
        # token alone is not authority to import a nation snapshot.
        raw_preview = validate_fis_import_token(preview_token)
        session = ImportSession.query.join(
            ImportSessionVersion, ImportSession.current_version_id == ImportSessionVersion.id,
        ).filter(ImportSessionVersion.preview_token == preview_token).first()
        if session is None:
            return jsonify({'error': 'Preview token is not linked to a current import session version'}), 409
        validate_session_event(session, raw_preview, import_event_id())
        response = app.make_response(import_approved_session(session.id))
        if response.status_code == 200:
            # Keep the direct endpoint's established response shape while the
            # shared workflow records completion and applies approved decisions.
            result = response.get_json()
            result.pop('session', None)
            return jsonify(result), 200
        return response
    except ImportValidationError as exc:
        db.session.rollback()
        return jsonify(exc.to_dict()), 422
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': 'INVALID_IMPORT', 'message': str(exc)}), 400
    except Exception:
        db.session.rollback()
        app.logger.exception('Unexpected FIS confirmation failure')
        return jsonify({'error': 'INTERNAL_SERVER_ERROR'}), 500


@app.route('/api/import/sessions', methods=['GET'])
def list_import_sessions():
    configured_event_id()  # Operational history cannot select an event without deployment configuration.
    from sqlalchemy.orm import selectinload
    sessions = ImportSession.query.filter_by(event_id=import_event_id()).options(
        selectinload(ImportSession.current_version), selectinload(ImportSession.versions),
        selectinload(ImportSession.approvals), selectinload(ImportSession.history),
    ).order_by(ImportSession.created_at.desc()).all()
    # Dashboard/history lists show saved workflow evidence, never recalculate
    # every nation's rules as a side effect of reading a summary.
    return jsonify([_current_session_payload(session, resolve_preview=False) for session in sessions])


def _import_session_raw_preview(session):
    # Observe old cache entries for mismatches, but never require them to execute.
    raw=PREVIEW_STORE.get(session.current_version.preview_token) if session.current_version else None
    if raw is not None:validate_session_event(session,raw)
    return raw


def _current_session_preview(session, *, read_context=None):
    """Transient current resolution; stored versions and approvals stay untouched."""
    preview = json.loads(session.current_version.preview_json or '{}') if session.current_version else {}
    if preview:
        validate_session_event(session, preview)
        if read_context is not None and read_context.event_id != session.event_id:
            raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Fremder ReadContext für Importsession.')
        preview['_currentApprovalIds'] = [a.id for a in session.current_approvals]
        if session.status == 'IMPORTED':
            # Reviewed tariffs have already been applied; read the current live
            # person state rather than replaying an obsolete manual override.
            preview.pop('accommodationRateOverrides', None)
            preview.pop('accommodationRequirementOverrides', None)
            preview['carriedSingleRoomQuotaExemptKeys'] = list(preview.get('singleRoomQuotaExemptOverrides', {}))
        try:
            if preview.get('eventId') is None and (any(str(column).upper().startswith('WSC_')
                    for column in preview.get('entriesColumns', [])) or any(
                    str(code).upper().startswith('WSC_') for person in preview.get('people', [])
                    for code in person.get('affirmativeWscColumns', person.get('competitionImportCodes', [])))):
                raise ImportValidationError('IMPORT_EVENT_REQUIRED',
                    'Gespeicherte WSC-Preview benötigt ein aktives Import-Event mit exakten Competition-Zuordnungen.')
            recalculate_fis_import_preview(preview, read_context=read_context)
        except ImportValidationError as exc:
            preview.setdefault('errors', []).append({'code': exc.code, 'message': str(exc), 'details': exc.details})
            preview['isValid'] = False
            preview['quotaChecks'] = []
            preview['athleteQuotaChecks'] = []
            for person in preview.get('people', []):
                for key in ('competitionIds', 'competitionMemberships', 'quotaDisciplines',
                            'topLevelDisciplines', 'athleteTopLevelDisciplines'):
                    person[key] = []
            if 'summary' in preview:
                preview['summary']['validation'] = {'errorCount': len(preview['errors']),
                                                    'warningCount': len(preview.get('warnings', []))}
    return preview


def _current_session_payload(session, include_preview=False, *, read_context=None, resolve_preview=True):
    payload = session.to_dict(include_preview=include_preview)
    if resolve_preview and session.status not in {'REPLACED', 'ARCHIVED', 'CANCELLED'}:
        preview = _current_session_preview(session, read_context=read_context)
        payload['errors'] = len(preview.get('errors', []))
        payload['warnings'] = len(preview.get('warnings', []))
        if preview.get('errors') and session.status != 'IMPORTED':
            payload['status'] = 'DRAFT'
        if include_preview:
            plan=(preview.get('_workflow') or {}).get('plan')
            if plan:present_plan(preview,plan)
            else:preview['changePlan']=None
            preview['planStale']=False
            if plan and session.status!='IMPORTED':
                try:verify_plan(preview,plan)
                except ImportValidationError:preview['planStale']=True
            payload['preview'] = preview
    return payload


@app.route('/api/import/sessions/<int:session_id>', methods=['GET'])
def get_import_session(session_id):
    configured_event_id()
    return jsonify(_current_session_payload(ImportSession.query.get_or_404(session_id), include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/accommodation-requirements/<path:person_key>', methods=['PATCH'])
def stage_accommodation_requirement(session_id, person_key):
    from copy import deepcopy
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    lock_accommodation_writes()
    session = ImportSession.query.filter_by(id=session_id).with_for_update().first_or_404()
    if session.status in {'APPROVED', 'IMPORTED', 'REPLACED', 'ARCHIVED', 'CANCELLED'} or not session.current_version:
        return jsonify(error='The current import version is no longer editable'), 409
    data = request.get_json(silent=True) or {}
    if 'accommodationRequirement' not in data or (data['accommodationRequirement'] is not None and (not isinstance(data['accommodationRequirement'], str) or data['accommodationRequirement'] not in {'REQUIRED', 'NO_ROOM'})):
        return jsonify(error='accommodationRequirement must be REQUIRED, NO_ROOM or null'), 400
    preview = json.loads(session.current_version.preview_json or '{}')
    validate_session_event(session, preview)
    _import_session_raw_preview(session)
    target = next((p for p in preview.get('people', []) if p.get('matchKey') == person_key), None)
    if target is None:
        return jsonify(error='Person is not part of the current import version'), 404
    existing = _find_existing_athlete(target, _build_existing_athlete_maps(event_id=session.event_id))
    old = {key: target.get(key) for key in ('accommodationRequirement', 'accommodationRequirementSource')}
    preview.setdefault('accommodationRequirementOverrides', {})[person_key] = {
        'requirement': data['accommodationRequirement'], 'base': requirement_projection(existing)}
    preview['_currentApprovalIds'] = [a.id for a in session.current_approvals]
    raw = _import_session_raw_preview(session)
    staged_raw = deepcopy(raw) if raw else None
    try:
        recalculate_fis_import_preview(preview)
        if any(e.get('code') == 'ACCOMMODATION_REQUIREMENT_BOOKINGS' and e.get('details', {}).get('personKey') == person_key for e in preview.get('errors', [])):
            raise RequirementConflict('NO_ROOM_HAS_BOOKINGS', 'Für diese Person bestehen Unterkunftszuweisungen. Bitte diese zuerst ausdrücklich entfernen.')
        if staged_raw:
            staged_raw['accommodationRequirementOverrides'] = preview['accommodationRequirementOverrides']
            staged_raw['_currentApprovalIds'] = preview['_currentApprovalIds']
            recalculate_fis_import_preview(staged_raw)
    except ImportValidationError as exc:
        db.session.rollback()
        return jsonify(exc.to_dict()), 409
    target = next(p for p in preview['people'] if p['matchKey'] == person_key)
    new = {key: target.get(key) for key in old}
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id,
        event_type='ACCOMMODATION_REQUIREMENT_MANUAL', title='Unterkunftsbedarf manuell geändert',
        description=json.dumps({'personKey': person_key, 'old': old, 'new': new, 'released': data['accommodationRequirement'] is None}, ensure_ascii=False), username=current_user().username))
    for approval in list(session.current_approvals):
        details = json.loads(approval.quota_details_json or '{}')
        if approval.decision == 'PENDING' and (details.get('singleRoomCandidates') or 'Single Rooms' in approval.description):
            db.session.delete(approval)
    for issue in preview.get('warnings', []):
        if issue['code'] == 'QUOTA_SINGLE_ROOMS_EXCEEDED' and issue.get('details', {}).get('openExcessCount', issue.get('details', {}).get('excessCount', 0)) > 0:
            details = dict(issue['details'])
            preserved = {p['personKey'] for p in details.get('preservedApprovedPeople', [])}
            details['singleRoomCandidates'] = [p for p in details.get('singleRoomCandidates', []) if p['personKey'] not in preserved]
            details['excessCount'] = details.get('openExcessCount', details.get('excessCount', 0))
            db.session.add(ImportApproval(session_id=session.id, version_id=session.current_version_id,
                nation=session.nation, approval_type=issue['code'], description=issue['message'],
                quota_details_json=json.dumps(details, ensure_ascii=False), decision='PENDING', username=current_user().username))
    session.current_version.preview_json = json.dumps(preview, ensure_ascii=False)
    db.session.flush()
    db.session.expire(session, ['approvals'])
    session.status = ('DRAFT' if preview.get('errors') else 'WAITING_FOR_NATION'
        if any(a.decision == 'PENDING' for a in session.current_approvals) else 'PROFESSIONALLY_REVIEWED')
    refresh_plan(session)
    db.session.commit()
    if staged_raw:
        PREVIEW_STORE[session.current_version.preview_token] = staged_raw
    return jsonify(_current_session_payload(session, include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/accommodation-rates/<path:person_key>', methods=['PATCH'])
def stage_accommodation_rate(session_id, person_key):
    session = ImportSession.query.filter_by(id=session_id).with_for_update().first_or_404()
    if session.status in {'APPROVED', 'IMPORTED', 'REPLACED', 'ARCHIVED', 'CANCELLED'} or not session.current_version:
        return jsonify({'error': 'The current import version is no longer editable'}), 409
    try:
        category = validate_category((request.get_json(silent=True) or {}).get('accommodationRateCategory'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    preview = json.loads(session.current_version.preview_json or '{}')
    validate_session_event(session, preview)
    _import_session_raw_preview(session)
    target = next((p for p in preview.get('people', []) if p.get('matchKey') == person_key), None)
    if target is None:
        return jsonify({'error': 'Person is not part of the current import version'}), 404
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    existing = _find_existing_athlete(target, _build_existing_athlete_maps(event_id=session.event_id))
    old_category = target.get('accommodationRateCategory', 'STANDARD')
    override = {'category': category, 'base': rate_projection(existing)}
    preview.setdefault('accommodationRateOverrides', {})[person_key] = override
    try:
        apply_preview_rates([target], {person_key: override})
    except ImportValidationError as exc:
        db.session.rollback()
        return jsonify(exc.to_dict()), 409
    session.current_version.preview_json = json.dumps(preview, ensure_ascii=False)
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id,
        event_type='ACCOMMODATION_RATE_MANUAL', title='Unterkunftstarif manuell geändert',
        description=f"{person_key}: {old_category} → {category}", username=current_user().username))
    refresh_plan(session)
    db.session.commit()
    raw = _import_session_raw_preview(session)
    if raw is not None:
        raw['accommodationRateOverrides'] = preview['accommodationRateOverrides']
        raw_target = next((p for p in raw['people'] if p.get('matchKey') == person_key), None)
        if raw_target is not None:
            raw_target.update({k: target[k] for k in ('accommodationRateCategory', 'accommodationRateSource')})
    return jsonify(_current_session_payload(session, include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/single-room-exemptions/<path:person_key>', methods=['PATCH'])
def stage_single_room_quota_exemption(session_id, person_key):
    lock_accommodation_writes()
    """Stage an exemption in review state without changing the live person.

    The stored JSON projection and the typed confirmation cache are updated
    together because reviewers must see the same derived quota state that a
    later confirmation will consume.  Pending approval tasks are disposable
    derivations and may be rebuilt; completed decisions remain audit records and
    are only superseded when the confirmed person state is eventually applied.
    """
    session = ImportSession.query.get_or_404(session_id)
    if session.status in {'APPROVED', 'IMPORTED', 'REPLACED', 'ARCHIVED', 'CANCELLED'}:
        return jsonify({'error': 'The current import version is no longer editable'}), 409
    if not session.current_version:
        return jsonify({'error': 'Import session has no current version'}), 409
    data = request.get_json(silent=True) or {}
    reason = data.get('reason')
    if reason not in {None, 'WORLD_CHAMPION'}:
        return jsonify({'error': 'reason must be WORLD_CHAMPION or null'}), 400
    preview = json.loads(session.current_version.preview_json or '{}')
    validate_session_event(session, preview)
    _import_session_raw_preview(session)
    if person_key not in {person.get('matchKey') for person in preview.get('people', [])}:
        return jsonify({'error': 'Person is not part of the current import version'}), 404
    from excel_import import apply_single_room_quota_exemptions
    apply_single_room_quota_exemptions(preview['people'], preview.get('singleRoomQuotaExemptOverrides'), preview.get('eventId'),
        preview.get('carriedSingleRoomQuotaExemptKeys', []),
        preview.get('singleRoomQuotaExemptOverrideRevisions', {}))
    target = next(person for person in preview['people'] if person.get('matchKey') == person_key)
    if target.get('singleRoomQuotaExemptReason') == 'OTHER':
        return jsonify({'error': 'Historical OTHER requires documented workflow review'}), 409
    if (target.get('function') or '').strip().lower() != 'athlete':
        return jsonify({'error': 'World Champion status applies only to Athletes'}), 400
    audit_status(person_key, 'MANUAL_SET' if reason else 'MANUAL_REMOVE', reason, current_user().username, event_id=preview.get('eventId'), fis_code=target.get('fisCode'), person_id=target.get('existingAthleteId'), session_id=session.id)
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id,
        event_type='WORLD_CHAMPION_MANUAL', title='Weltmeisterstatus manuell geändert',
        description=f'{person_key}: {reason or "MANUAL_REMOVE"}', username=current_user().username))
    preview['_currentApprovalIds'] = [a.id for a in session.current_approvals]
    overrides = preview.setdefault('singleRoomQuotaExemptOverrides', {})
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    existing = _find_existing_athlete(target, _build_existing_athlete_maps(event_id=session.event_id))
    preview.setdefault('singleRoomQuotaExemptOverrideRevisions', {})[person_key] = persisted_manual_revision(existing)
    overrides[person_key] = reason
    preview['carriedSingleRoomQuotaExemptKeys'] = [key for key in preview.get('carriedSingleRoomQuotaExemptKeys', []) if key != person_key]
    try:
        recalculate_fis_import_preview(preview)
    except ImportValidationError as exc:
        return jsonify(exc.to_dict()), 400
    session.current_version.preview_json = json.dumps(preview, ensure_ascii=False)
    raw_preview = _import_session_raw_preview(session)
    if raw_preview is not None:
        raw_preview['_currentApprovalIds'] = [a.id for a in session.current_approvals]
        raw_preview.setdefault('singleRoomQuotaExemptOverrides', {})[person_key] = reason
        raw_preview['carriedSingleRoomQuotaExemptKeys'] = list(preview['carriedSingleRoomQuotaExemptKeys'])
        raw_preview['singleRoomQuotaExemptOverrideRevisions'] = dict(preview['singleRoomQuotaExemptOverrideRevisions'])
        recalculate_fis_import_preview(raw_preview)

    # Pending tasks are derived review state and may be rebuilt. Completed
    # decisions remain immutable; an exemption merely supersedes active use.
    other_open_approval = False
    for approval in list(session.current_approvals):
        approval_details = json.loads(approval.quota_details_json or '{}')
        is_single_approval = bool(approval_details.get('singleRoomCandidates')) or 'Single Rooms' in approval.description
        if approval.decision == 'PENDING' and is_single_approval:
            db.session.delete(approval)
        elif approval.decision == 'PENDING':
            other_open_approval = True
    db.session.flush()
    quota_issues = [issue for issue in preview.get('warnings', [])
                    if issue.get('code') == 'QUOTA_SINGLE_ROOMS_EXCEEDED'
                    and (issue.get('details') or {}).get(
                        'openExcessCount', (issue.get('details') or {}).get('excessCount', 0)) > 0]
    for issue in quota_issues:
        details = dict(issue.get('details') or {})
        is_single = issue.get('code') == 'QUOTA_SINGLE_ROOMS_EXCEEDED'
        if is_single and 'openExcessCount' in details:
            preserved_keys = {item.get('personKey') for item in details.get('preservedApprovedPeople', [])}
            details['excessCount'] = details['openExcessCount']
            details['singleRoomCandidates'] = [item for item in details.get('singleRoomCandidates', [])
                                               if item.get('personKey') not in preserved_keys]
        current = details.get('importedSingleRooms') if is_single else details.get('importedOfficials')
        allowed = details.get('singleRoomsAllowed') if is_single else details.get('officialQuota')
        db.session.add(ImportApproval(
            session_id=session.id, version_id=session.current_version_id,
            nation=session.nation, approval_type=issue.get('code', 'QUOTA'),
            description=f"{'Single Rooms' if is_single else 'Officials'} überschritten ({current} / {allowed})",
            quota_details_json=json.dumps(details, ensure_ascii=False),
            decision='PENDING', username=current_user().username))
    session.status = ('WAITING_FOR_NATION'
                      if quota_issues or other_open_approval
                      else 'PROFESSIONALLY_REVIEWED')
    refresh_plan(session)
    db.session.commit()
    return jsonify(_current_session_payload(session, include_preview=True))


@app.route('/api/import/approvals/<int:approval_id>', methods=['GET'])
def get_import_approval(approval_id):
    """Return the canonical, read-only projection of one business decision."""
    configured_event_id()
    approval = ImportApproval.query.get_or_404(approval_id)
    session = approval.session
    version = next((item for item in session.versions if item.id == approval.version_id), None)
    decision_details=json.loads(approval.quota_details_json or '{}')
    candidates = (decision_details.get('singleRoomCandidates') or decision_details.get('candidates') or [])
    linked = Athlete.query.filter_by(event_id=session.event_id, single_room_decision_id=approval.id).all()
    people = [{
        'id': athlete.id, 'name': f'{athlete.firstname} {athlete.lastname}'.strip(),
        'nation': athlete.nation_code, 'singleRoomStatus': athlete.single_room_status or 'NONE',
    } for athlete in linked]
    linked_names = {person['name'] for person in people}
    approved_keys = set(json.loads(approval.approved_person_keys_json or '[]'))
    for candidate in candidates:
        if candidate.get('name') not in linked_names and candidate.get('personKey') in approved_keys:
            people.append({'id': candidate.get('personKey'), 'name': candidate.get('name') or '—',
                           'nation': approval.nation, 'singleRoomStatus': None if decision_details.get('decisionKind')=='ATHLETE_QUOTA' else 'APPROVED_EXTRA'})
    payload = approval.to_dict()
    payload.update({'discipline': payload['quotaDetails'].get('family') or payload['quotaDetails'].get('discipline'), 'gender': payload['quotaDetails'].get('gender'),
                    'importVersion': version.version if version else None,
                    'importSession': {'id': str(session.id), 'nation': session.nation},
                    'people': people})
    if approval.version_id == session.current_version_id and session.status not in {'IMPORTED', 'REPLACED', 'ARCHIVED', 'CANCELLED'}:
        preview = _current_session_preview(session)
        payload['validationErrors'] = preview.get('errors', [])
        payload['isValid'] = not payload['validationErrors']
    return jsonify(payload)


@app.route('/api/import/sessions/<int:session_id>/approvals/<int:approval_id>', methods=['PATCH'])
def decide_import_approval(session_id, approval_id):
    lock_accommodation_writes()
    session = ImportSession.query.get_or_404(session_id)
    approval = ImportApproval.query.filter_by(
        id=approval_id, session_id=session.id,
        version_id=session.current_version_id,
    ).first_or_404()
    if approval.id not in {item.id for item in session.current_approvals}:
        return jsonify({'error': 'This decision has been superseded'}), 404
    preview = _current_session_preview(session)
    if preview.get('errors'):
        return jsonify({'error': 'Blockierende Fehler müssen zuerst behoben werden.',
                        'validationErrors': preview['errors']}), 409
    requirements = quota_requirement_errors(preview, session.current_approvals, require_approved=False)
    if requirements:
        return jsonify({'error': 'QUOTA_REQUIREMENTS_UNREVIEWED', 'validationErrors': requirements}), 409
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
    if details.get('decisionKind')=='ATHLETE_QUOTA':
        from athlete_quota import validated_extent
        completed=approval.decision=='APPROVED'
        current_row=next((row for row in preview.get('athleteQuotaChecks',[]) if row['evidence']['scopeDigest']==details.get('scopeDigest')),None)
        if current_row is None:
            return jsonify(error='ATHLETE_DECISION_SCOPE_STALE'),409
        bounds={key:current_row['uncoveredExtent'][key]+(details.get('approvedExtent',{}).get(key,0) if completed else 0) for key in ('total','M','F')}
        if decision=='APPROVED':
            try:details,approved_person_keys=validated_extent({**details,'uncoveredExtent':bounds},data,allow_zero=completed)
            except ValueError as exc:return jsonify(error=str(exc)),400
        if completed and session.status in {'IMPORTED','ARCHIVED','REPLACED'}:
            from imports.workflow import fork_review_version
            fork_review_version(session,preview,current_user().username)
    is_single_room_approval = bool(details.get('singleRoomCandidates')) or 'Single Rooms' in approval.description
    if is_single_room_approval and decision == 'APPROVED':
        other_approved = {key for key, evidence in preview.get('preservedSingleRoomApprovals', {}).items()
                          if evidence.get('decisionId') != approval.id}
        valid_keys = {person.get('personKey') for person in details.get('singleRoomCandidates', [])} - other_approved
        maximum = len(json.loads(approval.approved_person_keys_json or '[]')) if approval.decision == 'APPROVED' else details.get('excessCount', 0)
        if (not isinstance(approved_person_keys, list) or not approved_person_keys
                or len(set(approved_person_keys)) != len(approved_person_keys)
                or len(approved_person_keys) > maximum
                or not set(approved_person_keys) <= valid_keys):
            return jsonify({'error': 'Select one or more unresolved extra single-room persons, up to the remaining excess'}), 400
    username = current_user().username
    superseded_decision_id = approval.id
    was_completed = approval.decision == 'APPROVED'
    if was_completed and decision != 'APPROVED':
        return jsonify({'error': 'A completed approval can only revise its approved persons'}), 400
    old_keys = json.loads(approval.approved_person_keys_json or '[]')
    if was_completed:
        # Never rewrite the evidence behind a completed business decision.  A
        # changed person selection becomes a new current approval while history
        # links the superseded selection; otherwise an audit performed later
        # could not reconstruct who was approved at the original decision time.
        old_names = {person.get('personKey'): person.get('name') or person.get('personKey')
                     for person in details.get('singleRoomCandidates', [])}
        db.session.add(ImportSessionEvent(
            session_id=session.id, version_id=session.current_version_id,
            approval_id=approval.id, event_type='QUOTA_DECISION_REVISED_FROM',
            title='Vorherige Quotenauswahl',
            description=', '.join(old_names.get(key, key) for key in old_keys),
            username=username))
        approval = ImportApproval(
            session_id=session.id, version_id=session.current_version_id,
            nation=approval.nation, approval_type=approval_type or approval.approval_type,
            description=approval.description, decision=decision,
            quota_details_json=json.dumps(details, ensure_ascii=False),
            approved_person_keys_json=json.dumps(approved_person_keys),
            approval_method=method, approval_by=approval_by, approval_date=approval_date,
            contact_subject=str(data.get('contactSubject') or '').strip() or None,
            cost_coverage=str(data.get('costCoverage') or '').strip() or None,
            deadline_at=deadline_at, comment=data.get('comment'), username=username)
        db.session.add(approval)
        db.session.flush()
        if is_single_room_approval and decision == 'APPROVED':
            current_preview = json.loads(session.current_version.preview_json or '{}')
            try:
                apply_active_single_room_decision(
                    details, approved_person_keys, approval.id, current_preview.get('people', []), superseded_decision_id)
            except ImportValidationError as exc:
                db.session.rollback()
                return jsonify(exc.to_dict()), 400
    else:
        approval.quota_details_json=json.dumps(details,ensure_ascii=False)
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
        approval.username = username
        approval.created_at = datetime.utcnow()
    if not was_completed:
        session.status = ('EXCEPTION_APPROVED'
                          if all(a.decision == 'APPROVED' for a in session.current_approvals)
                          else 'WAITING_FOR_NATION')
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='NATION_CONTACT',
        title=f'Rückfrage an Nation per {"E-Mail" if method == "EMAIL" else "Telefon"}',
        description=f'{approval_by}' + (f' · {data.get("contactSubject")}' if data.get('contactSubject') else ''),
        username=username))
    result_title = ('Neue Meldeliste angekündigt' if decision == 'NEW_LIST_ANNOUNCED' else
                    ('Organisatorische Freigabe' if approval_type == 'ORGANIZER_APPROVED' else 'Ausnahme durch Nation genehmigt'))
    person_count = len(approved_person_keys)
    selected_names = {person.get('personKey'): person.get('name') or person.get('personKey')
                      for person in details.get('singleRoomCandidates', [])}
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id,
        approval_id=approval.id,
        event_type='QUOTA_DECISION_REVISED' if was_completed else 'QUOTA_DECISION',
        title='Quotenauswahl geändert' if was_completed else result_title,
        description=(', '.join(selected_names.get(key, key) for key in approved_person_keys)
                     if was_completed else
                     f'{person_count} betroffene {"Person" if person_count == 1 else "Personen"}'),
        username=username))
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='STATUS_CHANGED',
        title='Status', description='Warten auf Nation' if decision == 'NEW_LIST_ANNOUNCED' else 'Ausnahme genehmigt',
        username=username))
    db.session.flush()
    if is_single_room_approval and decision == 'APPROVED':
        for key in approved_person_keys:
            db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id,
                approval_id=approval.id, event_type='SINGLE_ROOM_PERSON_APPROVED',
                title='Zusätzliches Einzelzimmer genehmigt', description=str(key), username=username))
        # A completed batch remains immutable; the remainder is a new task.
        previous_status = session.status
        reconcile_single_room_tasks(session)
        if was_completed and not any(a.decision == 'PENDING' for a in session.current_approvals):
            session.status = previous_status
    refresh_plan(session)
    db.session.commit()
    return jsonify(_current_session_payload(session, include_preview=True))


def reconcile_single_room_tasks(session):
    preview = _current_session_preview(session)
    for item in list(session.current_approvals):
        details = json.loads(item.quota_details_json or '{}')
        if item.decision == 'PENDING' and (details.get('singleRoomCandidates') or 'Single Rooms' in item.description):
            db.session.delete(item)
    db.session.flush()
    for issue in preview.get('warnings', []):
        if issue.get('code') != 'QUOTA_SINGLE_ROOMS_EXCEEDED':
            continue
        details = dict(issue['details'])
        remaining = details.get('openExcessCount', details.get('excessCount', 0))
        if not remaining:
            continue
        approved = {p['personKey'] for p in details.get('preservedApprovedPeople', [])}
        details['singleRoomCandidates'] = [p for p in details['singleRoomCandidates'] if p['personKey'] not in approved]
        details['excessCount'] = remaining
        db.session.add(ImportApproval(session_id=session.id, version_id=session.current_version_id,
            nation=session.nation, approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED',
            description=f"Zusätzliche EZ · {details['discipline']} · {details['gender']}",
            quota_details_json=json.dumps(details, ensure_ascii=False), decision='PENDING', username=current_user().username))
    db.session.flush()
    db.session.expire(session, ['approvals'])
    session.status = 'WAITING_FOR_NATION' if any(a.decision != 'APPROVED' for a in session.current_approvals) else 'EXCEPTION_APPROVED'


@app.route('/api/import/sessions/<int:session_id>/approve', methods=['POST'])
def approve_import_session(session_id):
    lock_accommodation_writes()
    db.session.expire_all()
    session = ImportSession.query.filter_by(id=session_id).with_for_update().first_or_404()
    if session.current_version and (json.loads(session.current_version.preview_json or '{}').get('_workflow') or {}).get('plan'):
        try:require_review(session)
        except ImportValidationError as exc:return jsonify({**exc.to_dict(),'validationErrors':[{'code':exc.code,'message':str(exc)}]}),409
    preview = _current_session_preview(session)
    if preview.get('errors'):
        return jsonify({'error': 'Blockierende Fehler müssen zuerst behoben werden.',
                        'validationErrors': preview['errors']}), 409
    requirements = quota_requirement_errors(preview, session.current_approvals)
    if requirements:
        return jsonify({'error': 'QUOTA_REQUIREMENTS_UNREVIEWED', 'validationErrors': requirements}), 409
    if any(approval.decision != 'APPROVED' for approval in session.current_approvals):
        return jsonify({'error': 'Alle erforderlichen Entscheidungen müssen getroffen werden.'}), 409
    if session.status in {'IMPORTED', 'REPLACED', 'ARCHIVED'}:
        return jsonify({'error': 'Diese Session kann nicht mehr freigegeben werden.'}), 409
    try:stored,workflow,plan=require_review(session)
    except ImportValidationError as exc:return jsonify({**exc.to_dict(),'validationErrors':[{'code':exc.code,'message':str(exc)}]}),409
    data=request.get_json(silent=True) or {}
    if data.get('planDigest')!=plan['digest'] or data.get('snapshotScope')!='FULL_NATION':
        return jsonify(error='IMPORT_SCOPE_CONFIRMATION_REQUIRED',message='Vollständigen Nationen-Snapshot und aktuellen Änderungsplan bestätigen.'),409
    if plan['requiresDestructiveConfirmation'] and data.get('confirmDestructiveChanges') is not True:
        return jsonify(error='IMPORT_DELETION_CONFIRMATION_REQUIRED',message='Entfernungen einschließlich Buchungsfolgen ausdrücklich bestätigen.'),409
    workflow.update(state='APPROVED',approvedDigest=plan['digest'],confirmedScope='FULL_NATION',
        destructiveConfirmed=data.get('confirmDestructiveChanges') is True)
    stored['_workflow']=workflow
    session.current_version.preview_json=encoded(stored)
    session.status, session.approved_at = 'APPROVED', datetime.utcnow()
    session.approved_by = current_user().username
    db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='APPROVED',
        title='Import freigegeben', description='Technische und fachliche Prüfung abgeschlossen.',
        username=current_user().username))
    db.session.commit()
    return jsonify(_current_session_payload(session, include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/import', methods=['POST'])
def import_approved_session(session_id):
    lock_accommodation_writes()
    lock_import_snapshot()
    db.session.expire_all()
    session=ImportSession.query.filter_by(id=session_id).with_for_update().first_or_404()
    data=request.get_json(silent=True) or {}
    if not session.current_version:return jsonify(error='IMPORT_REVIEW_REQUIRED',message='Keine aktuelle Prüfversion.'),409
    if data.get('versionId') is not None and str(data['versionId'])!=str(session.current_version_id):
        return jsonify(error='STALE_PREVIEW',message='Es gibt eine neuere Importversion.'),409
    if session.status in {'APPROVED','IMPORTED'} and data.get('versionId') is None and data.get('previewToken')!=session.current_version.preview_token:
        return jsonify(error='IMPORT_VERSION_REQUIRED',message='Die ausdrücklich geprüfte Importversion muss angegeben werden.'),409
    done=completed_result(session)
    if session.status=='IMPORTED' and done:
        g.atomic_import_audit=True
        return jsonify({**done,'session':session.to_dict(),'idempotent':True})
    if session.status!='APPROVED' or not session.approved_at:
        return jsonify(error='Die Session muss vor dem Import explizit freigegeben werden.'),409
    try:
        preview,workflow,plan=require_review(session,approved=True)
        requirements=quota_requirement_errors(preview,session.current_approvals)
        if preview.get('errors') or requirements:
            raise ImportValidationError('QUOTA_REQUIREMENTS_UNREVIEWED','Aktuelle Validierung benötigt eine neue Prüfung.',details={'requirements':requirements})
        decisions={key:a.id for a in session.current_approvals if a.decision=='APPROVED' and a.approval_type in {
            'NATION_APPROVED','ORGANIZER_APPROVED','PRESERVED_APPROVED_EXTRA'} for key in json.loads(a.approved_person_keys_json or '[]') if json.loads(a.quota_details_json or '{}').get('decisionKind')!='ATHLETE_QUOTA'}
        token=session.current_version.preview_token
        result=confirm_fis_import(token,decisions,confirmer=current_user().username,persisted_preview=preview,change_plan=plan)
        session.status,session.imported_at='IMPORTED',datetime.utcnow()
        workflow.update(state='IMPORTED',result=result)
        preview['_workflow']=workflow
        session.current_version.preview_json=encoded(preview)
        db.session.add(ImportSessionEvent(session_id=session.id,version_id=session.current_version_id,event_type='IMPORTED',
            title=f'Version {session.current_version.version} importiert',
            description=encoded({'summary':result['summary'],'planDigest':plan['digest'],
                'removedPeople':plan['people']['remove'],'approvalEvidence':plan['approvalEvidence']}),username=current_user().username))
        user=current_user()
        db.session.add(AuditEvent(username=user.username,display_name=getattr(user,'display_name',None),
            email=getattr(user,'email',None),groups_json=json.dumps(list(getattr(user,'groups',[]))),
            action='import',entity_type='import',entity_id=str(session.id),request_id=getattr(g,'request_id',str(uuid.uuid4())),
            method='POST',path=request.path,activity='Import durchgeführt',category='Import',entity_label=session.nation,
            details_json=encoded(result['summary']),entity_refs_json=event_audit_refs({'importSessionId':str(session.id),'eventId':str(session.event_id)}, session.event_id)))
        db.session.commit()
        g.atomic_import_audit=True
        PREVIEW_STORE.pop(token,None)
        return jsonify({**result,'session':session.to_dict()})
    except ImportValidationError as exc:
        db.session.rollback()
        return jsonify(exc.to_dict()),409
    except Exception:
        db.session.rollback()
        app.logger.exception('Atomic FIS import failed')
        return jsonify(error='IMPORT_FAILED',message='Import vollständig zurückgerollt.'),400


@app.route('/api/import/sessions/<int:session_id>/archive', methods=['POST'])
def archive_import_session(session_id):
    session = ImportSession.query.get_or_404(session_id)
    if session.status not in {'IMPORTED', 'REPLACED', 'ERROR'}:
        return jsonify({'error': 'Nur abgeschlossene Sessions können archiviert werden.'}), 409
    session.status, session.archived_at = 'ARCHIVED', datetime.utcnow()
    db.session.commit()
    return jsonify(session.to_dict())


@app.route('/api/import/sessions/<int:session_id>/cancel', methods=['POST'])
def cancel_import_session(session_id):
    lock_accommodation_writes()
    db.session.expire_all()
    session=ImportSession.query.filter_by(id=session_id).with_for_update().first_or_404()
    current=session.current_version
    if not current or session.status in {'IMPORTED','REPLACED','ARCHIVED'}:
        return jsonify(error='Eine abgeschlossene Session kann nicht abgebrochen werden.'),409
    data=request.get_json(silent=True) or {}
    if str(data.get('versionId'))!=str(current.id):
        return jsonify(error='STALE_PREVIEW',message='Die abzubrechende Prüfversion muss ausdrücklich angegeben werden.'),409
    preview=load_version_preview(current)
    preview.setdefault('_workflow',{})['state']='CANCELLED'
    current.preview_json=encoded(preview)
    imported_version_ids={h.version_id for h in session.history if h.event_type=='IMPORTED'}
    previous=[v for v in session.versions if v.id!=current.id and
        ((json.loads(v.preview_json or '{}').get('_workflow') or {}).get('state')=='IMPORTED'
         or v.id in imported_version_ids)]
    db.session.add(ImportSessionEvent(session_id=session.id,version_id=current.id,event_type='CANCELLED',
        title='Aktuelle Prüfversion abgebrochen',description='Frühere Versionen, Genehmigungen und operative Daten bleiben erhalten.',username=current_user().username))
    if previous:
        session.current_version=max(previous,key=lambda v:v.version)
        session.status='IMPORTED'
    else:
        session.status='CANCELLED'
    session.approved_at=session.approved_by=None
    session.error_message=None
    db.session.commit()
    PREVIEW_STORE.pop(current.preview_token,None)
    return jsonify(session.to_dict(include_preview=True))


@app.route('/api/import/sessions/<int:session_id>/recheck',methods=['POST'])
def recheck_import_session(session_id):
    lock_accommodation_writes()
    db.session.expire_all()
    session=ImportSession.query.filter_by(id=session_id).with_for_update().first_or_404()
    if not session.current_version:return jsonify(error='IMPORT_REVIEW_REQUIRED'),409
    preview=load_version_preview(session.current_version)
    if session.status in {'IMPORTED','ARCHIVED','REPLACED','CANCELLED'}:
        from imports.workflow import fork_review_version
        preview=fork_review_version(session,preview,current_user().username)
    session.status='PROFESSIONALLY_REVIEWED'
    preview=refresh_plan(session,preview)
    # Existing quota applicability checks remain authoritative. Regenerate pending tasks.
    reconcile_single_room_tasks(session)
    refresh_plan(session)
    db.session.add(ImportSessionEvent(session_id=session.id,version_id=session.current_version_id,event_type='RECHECKED',
        title='Geparste Meldung erneut geprüft',description='Aktueller Datenstand, keine Personenänderung. Excel wird nicht erneut geparst.',username=current_user().username))
    db.session.commit()
    return jsonify(_current_session_payload(session,include_preview=True))


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
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
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
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
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
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
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
                hotel = event_query(Hotel).filter_by(name=hotel_name).first()
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
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
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
                event = AccommodationEvent(
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
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
    event_query(Athlete).delete()

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

# Athletes
def _update_athlete_operations(athlete, data):
    """Update only accommodation-team-owned fields; FIS fields stay read-only."""
    if 'accommodationRateCategory' in data:
        try:
            category = validate_category(data['accommodationRateCategory'])
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    requirement_change = None
    if 'accommodationRequirement' in data:
        lock_accommodation_writes()
        db.session.refresh(athlete)
        g.audit_snapshot = athlete.to_dict()
        value = data['accommodationRequirement']
        if value is not None and (not isinstance(value, str) or value not in {'REQUIRED', 'NO_ROOM'}):
            return jsonify(error='accommodationRequirement must be REQUIRED, NO_ROOM or null'), 400
        requirement_change, _, _ = resolve_requirement(athlete, [athlete.room_type],
            {'requirement': value, 'base': requirement_projection(athlete)})
        if requirement_change['accommodationRequirement'] == 'NO_ROOM':
            from accommodation_requirements import ensure_no_bookings
            ensure_no_bookings(athlete)
    previous_exempt_reason = athlete.single_room_quota_exempt_reason
    protected = {'additionalItems', 'additional_items'}
    if protected.intersection(data):
        return jsonify({'error': 'additionalItems is managed exclusively by the FIS import'}), 400
    for api_key, attribute in (('arrivalDate', 'arrival_date'), ('departureDate', 'departure_date')):
        if api_key in data:
            raw = data[api_key]
            try:
                parsed = datetime.fromisoformat(raw).date() if raw else None
            except (TypeError, ValueError):
                return jsonify({'error': f'{api_key} must be an ISO date'}), 400
            setattr(athlete, attribute, parsed)
    if 'internalNote' in data:
        note = data['internalNote']
        if note is not None and not isinstance(note, str):
            return jsonify({'error': 'internalNote must be a string or null'}), 400
        athlete.internal_note = note.strip() or None if note is not None else None
    if 'singleRoomQuotaExemptReason' in data:
        reason = data['singleRoomQuotaExemptReason']
        if reason not in {None, 'WORLD_CHAMPION'}:
            return jsonify({'error': 'singleRoomQuotaExemptReason must be WORLD_CHAMPION or null'}), 400
        if (athlete.function or '').strip().lower() != 'athlete':
            return jsonify({'error': 'World Champion status applies only to Athletes'}), 400
        if previous_exempt_reason == 'OTHER':
            return jsonify({'error': 'Historical OTHER requires documented workflow review'}), 409
        athlete.single_room_quota_exempt_reason = reason
        athlete.single_room_exemption_source = 'MANUAL_SET' if reason else 'MANUAL_REMOVE'
        audit_status(athlete.id, athlete.single_room_exemption_source, reason, current_user().username, fis_code=athlete.fis_code, person_id=athlete.id)
        if reason:
            # The immutable approval remains in history; only active person state
            # ceases to behave as an approved surcharge.
            if athlete.single_room_decision:
                decision = athlete.single_room_decision
                db.session.add(ImportSessionEvent(
                    session_id=decision.session_id, version_id=decision.version_id,
                    approval_id=decision.id, event_type='QUOTA_DECISION_REVISED_FROM',
                    title='Quotenentscheidung durch EZ-Sonderstatus abgelöst',
                    description=f'{athlete.firstname} {athlete.lastname}'.strip(),
                    username=current_user().username))
            athlete.single_room_status = 'NONE'
            athlete.single_room_entitlement = None
            athlete.single_room_decision_id = None
        elif previous_exempt_reason:
            membership = event_query(RoomBookingOccupant).filter_by(athlete_id=athlete.id).first()
            if membership and membership.room_booking and membership.room_booking.counts_as_single:
                rows = _build_official_quota_usage_rows(nation_code=athlete.nation_code)
                allocation = next((item for row in rows for item in row['singleRoomAllocations']
                    if item['personId'] == athlete.id), None)
                over_quota = allocation is None or allocation['status'] == 'PENDING'
                athlete.single_room_status = 'PENDING_APPROVAL' if over_quota else 'IN_QUOTA'
                athlete.single_room_entitlement = 'IN_QUOTA' if not over_quota else None
                athlete.single_room_decision_id = None
    if athlete.arrival_date and athlete.departure_date and athlete.departure_date < athlete.arrival_date:
        return jsonify({'error': 'departureDate must not be before arrivalDate'}), 400
    if requirement_change:
        set_requirement(athlete, requirement_change['accommodationRequirement'], requirement_change['accommodationRequirementSource'])
    if 'accommodationRateCategory' in data:
        athlete.accommodation_rate_category = category
        athlete.accommodation_rate_source = 'MANUAL'
    db.session.commit()
    from routes.athletes import get_athlete
    return get_athlete(athlete.id)


@app.route('/api/athletes/<int:athlete_id>', methods=['PUT', 'PATCH'])
@app.route('/api/athletes/<int:athlete_id>/', methods=['PUT', 'PATCH'])
def update_athlete(athlete_id):
    athlete = event_get(Athlete, athlete_id, required=True)
    data = request.get_json(silent=True) or {}
    return _update_athlete_operations(athlete, data)


# Room Assignments
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
    try:
        with _assignment_phase('quota'):
            rows = _build_official_quota_usage_rows(
                nation_code=nation_code,
                discipline=discipline,
                gender=gender
            )
    except QuotaGenderValidationError as error:
        return quota_gender_review_response(error)
    return _assignment_jsonify(rows)


@app.route('/api/assignments/availability', methods=['POST'])
def get_assignment_availability():
    from assignment_availability import project, load_context
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict) or not isinstance(payload.get('needs', []), list) or not isinstance(payload.get('populationIds', []), list):
        return jsonify(error='INVALID_NEEDS', message='Offene Zeiträume prüfen.'), 400
    try:
        planning, loaded = load_context()
        return _assignment_jsonify(project(planning,
            payload.get('needs', []), set(map(str, payload.get('populationIds', []))), loaded=loaded))
    except (KeyError, ValueError, TypeError):
        return jsonify(error='INVALID_NEEDS', message='Offene Zeiträume prüfen.'), 400


@app.route('/api/assignments/planning-view', methods=['GET'])
@app.route('/api/assignments/planning-view/', methods=['GET'])
def get_assignments_planning_view():
    include_validations = request.args.get('includeValidations', 'true').lower() != 'false'
    validation_keys = None if include_validations else set()
    return _assignment_jsonify(_build_assignment_planning_view(validation_keys))


@app.route('/api/assignments/planning-view/validations/<path:validation_key>', methods=['GET'])
def get_assignment_planning_validations(validation_key):
    interval = None
    if request.args.get('checkInDate') or request.args.get('checkOutDate'):
        try:
            start = datetime.fromisoformat(request.args['checkInDate']).date()
            end = datetime.fromisoformat(request.args['checkOutDate']).date()
            if start >= end:
                raise ValueError()
            interval = {'checkInDate': start.isoformat(), 'checkOutDate': end.isoformat()}
        except (KeyError, ValueError, TypeError):
            return jsonify(error='INVALID_DATES', message='Gültigen Zeitraum auswählen.'), 400
    if request.args.get('athleteIds'):
        try:
            ids = [str(int(value)) for value in request.args['athleteIds'].split(',')]
            if not interval or len(ids) not in (1, 2) or len(set(ids)) != len(ids):
                raise ValueError()
        except (TypeError, ValueError):
            return jsonify(error='INVALID_OCCUPANTS', message='Personen und Zeitraum prüfen.'), 400
        planning = _build_assignment_planning_view(set())
        index = {p['athleteId']: (p, u) for u in planning['units']['assigned'] + planning['units']['unassigned'] for p in u['occupants']}
        if any(identity not in index or index[identity][0]['accommodationCoverage']['coverageStatus'] == 'CONFLICT'
               or interval not in index[identity][0]['accommodationCoverage']['openIntervals'] for identity in ids):
            return jsonify(error='OPEN_INTERVAL_CHANGED', message='Offener Zeitraum hat sich geändert. Bitte aktualisieren.'), 400
        unit = {**index[ids[0]][1], **interval, 'assignedBookingId': None,
                'occupants': [index[identity][0] for identity in ids],
                'allowedRoomTypeLabels': ['single', 'double'] if len(ids) == 1 else ['double']}
        by_slot = {}
        for booking in event_query(RoomBooking).all():
            key = (str(booking.hotel_id), str(booking.room_type_id), _planned_room_key(booking.room_number) or booking.room_number or '')
            by_slot.setdefault(key, []).append(booking)
        return _assignment_jsonify({'validationKey': validation_key,
            'validations': _build_unit_validations(unit, planning['hotels'], by_slot)})
    planning = _build_assignment_planning_view({validation_key}, assignment_interval=interval)
    validations = planning['validationByUnit'].get(validation_key)
    if validations is None:
        return _assignment_jsonify({
            'error': 'VALIDATION_UNIT_NOT_FOUND',
            'message': 'Die ausgewählte Dispositionseinheit wurde nicht gefunden.',
        }), 404
    return _assignment_jsonify({
        'validationKey': validation_key,
        'validations': validations,
    })


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
    }
    if 'countsAsSingle' in data:
        payload_data['countsAsSingle'] = data['countsAsSingle']

    multiple = db.session.query(RoomBookingOccupant.athlete_id).filter(ownership_clause(RoomBookingOccupant, accommodation_event_id())).filter(
        RoomBookingOccupant.athlete_id.in_([int(value) for value in payload_data['athleteIds']])
    ).group_by(RoomBookingOccupant.athlete_id).having(func.count(RoomBookingOccupant.id) > 1).first()
    if multiple:
        return _booking_error('SEGMENT_OPERATION_REQUIRED', 'Mehrere Aufenthalte vorhanden. Bitte die einzelne Unterkunftszuweisung bearbeiten.')

    existing_booking = None
    if data.get('assignedBookingId'):
        existing_booking = event_get(RoomBooking, int(data['assignedBookingId']), required=True)
    else:
        athlete_id_tuple = tuple(sorted(int(athlete_id) for athlete_id in payload_data['athleteIds']))
        for booking in event_query(RoomBooking).options(db.joinedload(RoomBooking.occupants)).all():
            if tuple(_collect_booking_athlete_ids(booking)) == athlete_id_tuple:
                existing_booking = booking
                break

    if existing_booking is None:
        payload_data = _initialize_new_booking_counts_as_single(payload_data)

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
    booking = event_get(RoomBooking, booking_id, required=True)
    data = request.json or {}
    payload_data = {
        'athleteIds': [str(occ.athlete_id) for occ in (booking.occupants or []) if occ.athlete_id],
        'hotelId': data.get('hotelId') or str(booking.hotel_id),
        'roomTypeId': data.get('roomTypeId') or str(booking.room_type_id),
        'roomNumber': data.get('roomNumber', booking.room_number),
        'checkInDate': data.get('checkInDate') or (booking.check_in_date.isoformat() if booking.check_in_date else None),
        'checkOutDate': data.get('checkOutDate') or (booking.check_out_date.isoformat() if booking.check_out_date else None),
        'countsAsSingle': data.get('countsAsSingle', booking.counts_as_single),
    }
    payload, _, error = _validate_booking_payload(payload_data, existing_booking=booking)
    if error:
        return error
    booking = _save_booking_from_payload(payload, existing_booking=booking)
    return _assignment_jsonify(booking.to_dict())


@app.route('/api/assignments/bookings/<int:booking_id>/unassign', methods=['POST'])
@app.route('/api/assignments/bookings/<int:booking_id>/unassign/', methods=['POST'])
@_measure_assignment_logic
def unassign_room_booking_unit(booking_id):
    booking = event_get(RoomBooking, booking_id, required=True)
    _acknowledge_import_changes(_collect_booking_athlete_ids(booking))
    db.session.delete(booking)
    db.session.commit()
    return _assignment_jsonify({'success': True, 'bookingId': str(booking_id)})


@app.route('/api/assignments/bookings/<int:booking_id>/occupants/<int:athlete_id>/unassign', methods=['POST'])
@app.route('/api/assignments/bookings/<int:booking_id>/occupants/<int:athlete_id>/unassign/', methods=['POST'])
@_measure_assignment_logic
def unassign_room_booking_occupant(booking_id, athlete_id):
    booking = event_get(RoomBooking, booking_id, required=True)
    membership = event_query(RoomBookingOccupant).filter_by(room_booking_id=booking.id, athlete_id=athlete_id).first()
    if not membership:
        return _assignment_jsonify({'error': 'Not found', 'message': 'Occupant is not part of the booking'}), 404

    _acknowledge_import_changes([athlete_id])
    db.session.delete(membership)
    db.session.flush()
    remaining = event_query(RoomBookingOccupant).filter_by(room_booking_id=booking.id).count()
    if remaining == 0:
        db.session.delete(booking)
    db.session.commit()
    return _assignment_jsonify({'success': True, 'bookingId': str(booking_id), 'athleteId': str(athlete_id)})


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
@_measure_assignment_logic
def create_room_assignment():
    data = _initialize_new_booking_counts_as_single(request.json or {})
    payload, _, error = _validate_booking_payload(data)
    if error:
        return error
    booking = _save_booking_from_payload(payload)
    return _assignment_jsonify(booking.to_dict()), 201


@app.route('/api/room-assignments/<int:assignment_id>', methods=['PUT'])
@app.route('/api/room-assignments/<int:assignment_id>/', methods=['PUT'])
@app.route('/room-assignments/<int:assignment_id>', methods=['PUT'])
@app.route('/room-assignments/<int:assignment_id>/', methods=['PUT'])
@_measure_assignment_logic
def update_room_assignment(assignment_id):
    booking = event_get(RoomBooking, assignment_id, required=True)
    data = request.json
    payload, _, error = _validate_booking_payload(data, existing_booking=booking)
    if error:
        return error
    booking = _save_booking_from_payload(payload, existing_booking=booking)
    return _assignment_jsonify(booking.to_dict())


@app.route('/api/room-assignments/<int:assignment_id>', methods=['DELETE'])
@app.route('/api/room-assignments/<int:assignment_id>/', methods=['DELETE'])
@app.route('/room-assignments/<int:assignment_id>', methods=['DELETE'])
@app.route('/room-assignments/<int:assignment_id>/', methods=['DELETE'])
@_measure_assignment_logic
def delete_room_assignment(assignment_id):
    booking = event_get(RoomBooking, assignment_id, required=True)
    db.session.delete(booking)
    db.session.commit()
    return '', 204




if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
