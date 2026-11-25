"""Person HTTP routes; updates, authentication and mutation auditing remain in app."""
from accommodation_requirements import NO_BOOKABLE_DEMAND
from accommodation_scope import event_query, event_get

from datetime import datetime
import json

from flask import Blueprint, jsonify, request

from models import db, Athlete, ImportRun, ImportSession, ImportSessionVersion, ImportSessionEvent, RoomBooking, RoomBookingOccupant
from stay_window import assess_stay, assess_booked_stay, load_stay_schedule
from accommodation_scope import accommodation_event_id
from accommodation_coverage import person_accommodation_coverage


athletes = Blueprint('athletes', __name__)


@athletes.route('/api/athletes', methods=['GET'])
@athletes.route('/api/athletes/', methods=['GET'])
@athletes.route('/athletes', methods=['GET'])
@athletes.route('/athletes/', methods=['GET'])
def get_athletes():
    schedule = load_stay_schedule(accommodation_event_id())
    athletes = event_query(Athlete).options(db.selectinload(Athlete.competitions)).all()

    # One PostgreSQL DISTINCT ON query replaces the two latest-run lookups,
    # keeping the total read budget unchanged after adding the event schedule.
    latest = {row.import_type: row.started_at for row in event_query(ImportRun)
        .filter(ImportRun.import_type.in_(['athletes','roomlist']))
        .order_by(ImportRun.import_type,ImportRun.started_at.desc())
        .distinct(ImportRun.import_type).all()}
    latest_athletes_at = latest.get('athletes')
    latest_roomlist_at = latest.get('roomlist')

    # Assignment summaries belong to the athlete read model.  Eager-loading
    # keeps their query count constant as the number of people and rooms grows.
    booking_rows = event_query(RoomBookingOccupant).options(
        db.joinedload(RoomBookingOccupant.athlete),
        db.joinedload(RoomBookingOccupant.room_booking).joinedload(RoomBooking.hotel),
        db.joinedload(RoomBookingOccupant.room_booking).joinedload(RoomBooking.room_type),
        db.joinedload(RoomBookingOccupant.room_booking).joinedload(RoomBooking.occupants),
    ).all()
    assignment_map = {}
    bookings_by_person = {}
    for occupant in booking_rows:
        booking = occupant.room_booking
        athlete = occupant.athlete
        if not booking or not athlete:
            continue
        bookings_by_person.setdefault(athlete.id, []).append(booking)
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
            'countsAsSingle': booking.effective_counts_as_single,
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

    manual_nations = {a.nation_code for a in athletes if a.accommodation_requirement_source == 'MANUAL'}
    reviews_by_nation = {}
    if manual_nations:
        for nation, review in (db.session.query(ImportSession.nation, ImportSessionVersion)
                .join(ImportSession, ImportSessionVersion.session_id == ImportSession.id)
                .join(ImportSessionEvent, ImportSessionEvent.version_id == ImportSessionVersion.id)
                .filter(ImportSession.event_id == accommodation_event_id(), ImportSession.nation.in_(manual_nations),
                        ImportSessionEvent.event_type == 'IMPORTED').order_by(ImportSessionEvent.id.desc())):
            reviews_by_nation.setdefault(nation, []).append(review)

    source_cache = {}
    result = []
    for identity, records in people.items():
        a = max(records, key=lambda row: (row.updated_at or row.created_at or datetime.min, row.id))
        data = a.to_dict()
        record_ids = {record.id for record in records}
        data['id'] = str(min(record_ids))
        data['sourceRecordIds'] = [str(value) for value in sorted(record_ids)]
        data['accommodationCoverage'] = person_accommodation_coverage(
            a.arrival_date, a.departure_date,
            [booking for record_id in record_ids for booking in bookings_by_person.get(record_id, [])], a.accommodation_requirement)
        competitions = {competition.id: competition for record in records for competition in record.competitions}
        actual_bookings = [booking for record_id in record_ids for booking in bookings_by_person.get(record_id, [])]
        data['stayWindow'] = (assess_booked_stay(actual_bookings,list(competitions.values()),schedule,a.accommodation_requirement)
            if actual_bookings else assess_stay(a.arrival_date,a.departure_date,list(competitions.values()),schedule,a.accommodation_requirement))
        data['competitions'] = [competition.to_dict() for competition in sorted(competitions.values(), key=lambda item: item.name)]
        data['disciplines'] = [competition.name for competition in sorted(competitions.values(), key=lambda item: item.name)]
        if not data['disciplines']:
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
            'countsAsSingle': False,
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
            'CONFLICT' if data['accommodationCoverage']['coverageStatus'] == 'CONFLICT' and a.accommodation_requirement in NO_BOOKABLE_DEMAND else
            'NO_ROOM' if a.accommodation_requirement in NO_BOOKABLE_DEMAND else
            'REVIEW_ASSIGNMENT' if data['hasPendingRoomlistReview'] else
            'NEW_PERSON' if 'NEW_ATHLETE' in import_types and not data['assignment']['hasAssignment'] else
            'OPEN_ASSIGNMENT' if not data['assignment']['hasAssignment'] else
            'CURRENT'
        )

        if a.accommodation_requirement_source == 'MANUAL':
            requests = reported_accommodation_requests(a, reviews_by_nation.get(a.nation_code, []), source_cache)
            add_accommodation_decision(data, a, requests)
        result.append(data)

    return jsonify(result)


def reported_accommodation_requests(athlete, reviews=None, cache=None):
    cache = {} if cache is None else cache
    identity = athlete.fis_code or athlete.competitor_id
    if identity:
        if reviews is None:
            reviews = (ImportSessionVersion.query.join(ImportSession, ImportSessionVersion.session_id == ImportSession.id)
            .join(ImportSessionEvent, ImportSessionEvent.version_id == ImportSessionVersion.id)
            .filter(ImportSession.event_id == athlete.event_id, ImportSession.nation == athlete.nation_code,
                    ImportSessionEvent.event_type == 'IMPORTED')
            .order_by(ImportSessionEvent.id.desc()))
        for review in reviews:
            if review.id not in cache:
                cache[review.id] = (review, json.loads(review.preview_json or '{}'))
            _, preview = cache[review.id]
            person = next((p for p in preview.get('people', []) if p.get('matchKey') == identity), None)
            if not person:
                continue
            if person.get('sourceRows') and preview.get('submissionSources'):
                requests = []
                families = {version_id: family for family, version_id in preview.get('submissionSources', {}).items()}
                for row in person.get('sourceRows', []):
                    source_id = row['versionId']
                    if source_id not in cache:
                        source = db.session.get(ImportSessionVersion, source_id)
                        cache[source_id] = (source, json.loads(source.preview_json or '{}') if source else {})
                    source, source_preview = cache[source_id]
                    if not source or source.session_id != review.session_id:
                        continue
                    original = next((p for p in source_preview.get('people', [])
                                     if p.get('sourceRowNumber', p.get('rowNumber')) == row.get('row')), None)
                    if original is None:
                        continue
                    evidence = original.get('entryAccommodationSource') or original
                    rooms = [(room, ref.get('row')) for room in preview.get('rooms', [])
                             if identity in (room.get('person1Key'), room.get('person2Key'))
                             for ref in room.get('sourceRows', []) if ref.get('versionId') == source.id]
                    partner = evidence.get('sharedWithName')
                    if not partner and len(rooms) == 1:
                        room = rooms[0][0]
                        partner = room.get('person2Name') if identity == room.get('person1Key') else room.get('person1Name')
                    requests.append(dict(family=families.get(source.id), version=source.version, entryRow=row.get('row'),
                        roomType=evidence.get('roomType'), partner=partner,
                        arrivalDate=evidence.get('arrivalDate') or original.get('arrivalDate'),
                        departureDate=evidence.get('departureDate') or original.get('departureDate'),
                        roomRows=[number for _, number in rooms if number is not None]))
                return requests
            evidence = person.get('entryAccommodationSource') or person
            return [dict(family=(preview.get('replacementScope') or {}).get('family'), version=review.version,
                entryRow=evidence.get('row', person.get('rowNumber')), roomType=evidence.get('roomType'),
                partner=evidence.get('sharedWithName'), arrivalDate=person.get('arrivalDate'),
                departureDate=person.get('departureDate'), roomRows=[])]
    return []


def add_accommodation_decision(data, athlete, requests):
    from accommodation_requirements import source_requirement, accommodation_wish

    requirement = athlete.accommodation_requirement
    manual = athlete.accommodation_requirement_source == 'MANUAL'
    current = accommodation_wish(requirement, athlete.room_type, athlete.shared_with_name)
    matches = []
    if manual and requirement != 'UNRESOLVED':
        for reported in requests:
            source = source_requirement([reported['roomType']])[0]
            if source:
                matches.append(current == accommodation_wish(source, reported['roomType'], reported['partner']))
                reported['matchesDecision'] = matches[-1]

    deviation = False in matches
    if requirement == 'UNRESOLVED':
        label = 'Unterkunft klären'
    elif requirement == 'NO_DISPO':
        label = 'Nicht disponieren'
    elif manual:
        label = 'Abweichung FIS' if deviation else 'FIS-Meldung bestätigt' if matches else 'Manuell festgelegt'
    else:
        label = 'FIS-Meldung' if requests else None
    data.update(accommodationDecisionLabel=label, hasFisAccommodationDeviation=deviation)


@athletes.route('/api/athletes/<int:athlete_id>', methods=['GET'])
@athletes.route('/api/athletes/<int:athlete_id>/', methods=['GET'])
def get_athlete(athlete_id):
    athlete = event_get(Athlete, athlete_id, required=True)
    bookings = event_query(RoomBooking).join(RoomBookingOccupant).filter(
        RoomBookingOccupant.athlete_id == athlete.id).options(
            db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()
    data = athlete.to_dict()
    schedule = load_stay_schedule(athlete.event_id)
    data['stayWindow'] = (assess_booked_stay(bookings,athlete.competitions,schedule,athlete.accommodation_requirement)
        if bookings else assess_stay(athlete.arrival_date,athlete.departure_date,athlete.competitions,schedule,athlete.accommodation_requirement))
    data['accommodationCoverage'] = person_accommodation_coverage(
        athlete.arrival_date, athlete.departure_date, bookings, athlete.accommodation_requirement)
    coverage = data['accommodationCoverage']['coverageStatus']
    data['workflowStatus'] = ('CONFLICT' if athlete.accommodation_requirement in NO_BOOKABLE_DEMAND and coverage == 'CONFLICT' else
        'NO_ROOM' if athlete.accommodation_requirement in NO_BOOKABLE_DEMAND else
        'CURRENT' if coverage == 'FULLY_ASSIGNED' else 'OPEN_ASSIGNMENT')
    data['reportedAccommodationRequests'] = reported_accommodation_requests(athlete)
    add_accommodation_decision(data, athlete, data['reportedAccommodationRequests'])
    return jsonify(data)


@athletes.route('/api/athletes', methods=['POST'])
@athletes.route('/api/athletes/', methods=['POST'])
@athletes.route('/athletes', methods=['POST'])
@athletes.route('/athletes/', methods=['POST'])
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


@athletes.route('/api/athletes/<int:athlete_id>/acknowledge-roomlist-change', methods=['POST'])
@athletes.route('/api/athletes/<int:athlete_id>/acknowledge-roomlist-change/', methods=['POST'])
def acknowledge_athlete_roomlist_change(athlete_id):
    athlete = event_get(Athlete, athlete_id, required=True)
    if athlete.roomlist_changed_at is None:
        return jsonify({'error': 'No roomlist change to acknowledge'}), 400

    athlete.roomlist_change_acknowledged_at = datetime.utcnow()
    athlete.roomlist_change_acknowledged_summary = athlete.roomlist_change_summary
    db.session.commit()

    data = athlete.to_dict()
    data['hasPendingRoomlistReview'] = False
    return jsonify(data)


@athletes.route('/api/athletes/arrival-planning', methods=['GET'])
def get_arrival_planning():
    from arrival_planning import project
    return jsonify(project(request.args.get('nationCode') or None))


@athletes.route('/api/athletes/arrival-planning/<area_id>', methods=['PUT'])
def save_arrival_forecast(area_id):
    from arrival_planning import save, ForecastConflict
    from auth import current_user
    try:
        return jsonify(save(area_id,request.get_json(silent=True) or {},current_user().username))
    except ForecastConflict as exc:
        return jsonify(error='STALE_ARRIVAL_FORECAST',message=str(exc)),409
    except (ValueError,TypeError) as exc:
        db.session.rollback()
        return jsonify(error='INVALID_ARRIVAL_FORECAST',message=str(exc)),400
