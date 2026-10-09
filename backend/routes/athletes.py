"""Person HTTP routes; updates, authentication and mutation auditing remain in app."""

from datetime import datetime

from flask import Blueprint, jsonify, request

from models import db, Athlete, ImportRun, RoomBooking, RoomBookingOccupant


athletes = Blueprint('athletes', __name__)


@athletes.route('/api/athletes', methods=['GET'])
@athletes.route('/api/athletes/', methods=['GET'])
@athletes.route('/athletes', methods=['GET'])
@athletes.route('/athletes/', methods=['GET'])
def get_athletes():
    athletes = Athlete.query.options(db.selectinload(Athlete.competitions)).all()

    latest_athletes_run = ImportRun.query.filter_by(import_type='athletes').order_by(ImportRun.started_at.desc()).first()
    latest_roomlist_run = ImportRun.query.filter_by(import_type='roomlist').order_by(ImportRun.started_at.desc()).first()

    latest_athletes_at = latest_athletes_run.started_at if latest_athletes_run else None
    latest_roomlist_at = latest_roomlist_run.started_at if latest_roomlist_run else None

    # Assignment summaries belong to the athlete read model.  Eager-loading
    # keeps their query count constant as the number of people and rooms grows.
    booking_rows = RoomBookingOccupant.query.options(
        db.joinedload(RoomBookingOccupant.athlete),
        db.joinedload(RoomBookingOccupant.room_booking).joinedload(RoomBooking.hotel),
        db.joinedload(RoomBookingOccupant.room_booking).joinedload(RoomBooking.room_type),
    ).all()
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
            'countsAsSingle': bool(booking.counts_as_single),
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
        competitions = {competition.id: competition for record in records for competition in record.competitions}
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
            'REVIEW_ASSIGNMENT' if data['hasPendingRoomlistReview'] else
            'NEW_PERSON' if 'NEW_ATHLETE' in import_types and not data['assignment']['hasAssignment'] else
            'OPEN_ASSIGNMENT' if not data['assignment']['hasAssignment'] else
            'CURRENT'
        )

        result.append(data)

    return jsonify(result)


@athletes.route('/api/athletes/<int:athlete_id>', methods=['GET'])
@athletes.route('/api/athletes/<int:athlete_id>/', methods=['GET'])
def get_athlete(athlete_id):
    return jsonify(Athlete.query.get_or_404(athlete_id).to_dict())


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
    athlete = Athlete.query.get_or_404(athlete_id)
    if athlete.roomlist_changed_at is None:
        return jsonify({'error': 'No roomlist change to acknowledge'}), 400

    athlete.roomlist_change_acknowledged_at = datetime.utcnow()
    athlete.roomlist_change_acknowledged_summary = athlete.roomlist_change_summary
    db.session.commit()

    data = athlete.to_dict()
    data['hasPendingRoomlistReview'] = False
    return jsonify(data)
