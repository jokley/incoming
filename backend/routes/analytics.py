"""Analytics HTTP routes; authentication remains app-wide."""
from accommodation_scope import event_query

from datetime import datetime
import json

from flask import Blueprint, jsonify, request

from models import AccommodationEvent, EventRoomDemand, HotelRoomInventory, RoomType, Hotel


analytics = Blueprint('analytics', __name__)


# Statistics & Analytics
@analytics.route('/api/analytics/room-availability', methods=['GET'])
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
        query = event_query(HotelRoomInventory).filter_by(room_type_id=rt.id).join(Hotel).filter(Hotel.accommodation_type == 'STANDARD')
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
        demand_query = event_query(EventRoomDemand).filter_by(room_type_id=rt.id)
        if start_date and end_date:
            demand_query = demand_query.join(AccommodationEvent).filter(
                AccommodationEvent.start_date <= end_date,
                AccommodationEvent.end_date >= start_date
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


@analytics.route('/api/analytics/occupancy-timeline', methods=['GET'])
def get_occupancy_timeline():
    """Get room occupancy over time"""
    # Get all events with their demands
    events = event_query(AccommodationEvent).all()

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


@analytics.route('/api/analytics/import-demand', methods=['GET'])
def get_import_demand():
    """Read the event's current source set without opening or updating reviews."""
    from accommodation_scope import accommodation_event_id
    from arrival_planning import operative_projection, project_import_people
    from excel_import import recalculate_fis_import_preview
    from imports.change_plan import encoded
    from imports.event_context import ImportValidationError
    from imports.identity import _find_existing_athlete
    from imports.read_context import ImportReadContext
    from imports.workflow import (imported_submission_ids, load_version_preview, merge_submission_previews,
                                  require_submission_sources, review_approvals, submission_heads)
    from models import ImportSession, db

    event_id = accommodation_event_id()
    context = ImportReadContext(event_id)
    sessions = event_query(ImportSession).filter(
        ImportSession.status.notin_(('ARCHIVED', 'REPLACED', 'CANCELLED'))
    ).options(db.selectinload(ImportSession.versions), db.selectinload(ImportSession.history),
              db.selectinload(ImportSession.approvals)).order_by(ImportSession.nation).all()
    nations = []
    for session in sessions:
        if not session.current_version:
            continue
        try:
            preview = load_version_preview(session.current_version)
            heads = submission_heads(session)
            scope = (preview.get('replacementScope') or {}).get('kind')
            stale_composition = False
            using_current_version = True
            if scope == 'SPORT_FAMILY' and heads:
                selected = preview.get('submissionSources') or {}
                current = {family: version.id for family, version in heads.items()}
                if selected == current:
                    try:
                        require_submission_sources(session, preview)
                    except ImportValidationError:
                        stale_composition = True
                        using_current_version = False
                        preview = merge_submission_previews(list(heads.values()), read_context=context, read_only=True)
                elif len(heads) != 1 or session.current_version_id not in current.values():
                    stale_composition = bool(selected)
                    using_current_version = False
                    preview = merge_submission_previews(list(heads.values()), read_context=context, read_only=True)
            if using_current_version and session.current_version_id in imported_submission_ids(session):
                preview.pop('accommodationRequirementOverrides', None)
                preview.pop('accommodationRateOverrides', None)
            preview['_currentApprovalIds'] = [a.id for a in review_approvals(session, preview)]
            recalculate_fis_import_preview(preview, read_context=context)
            people = preview['people']
            evaluation = preview.get('evaluationPeople', people)
            for person in evaluation:
                existing = _find_existing_athlete(person, context.athlete_maps)
                person['existingAthleteId'] = existing.id if existing else None
            if evaluation is not people:
                matched_ids = {p['matchKey']: p['existingAthleteId'] for p in evaluation}
                for person in people:
                    person['existingAthleteId'] = matched_ids.get(person['matchKey'])
            selection = operative_projection(project_import_people(evaluation, context, session.nation))
            people_fields = ('matchKey', 'existingAthleteId', 'function', 'nationCode', 'arrivalDate', 'departureDate',
                             'roomType', 'sharedWithName', 'accommodationRequirement', 'accommodationRequirementReviewRequired')
            room_fields = ('person1Key', 'person2Key', 'roomType', 'checkInDate', 'checkOutDate', 'sharedWithRawName')
            nations.append(dict(nation=session.nation,
                people=[{key: p.get(key) for key in people_fields} for p in people],
                rooms=[{key: r.get(key) for key in room_fields} for r in preview['rooms']],
                excludedIds=selection['replacedPersonIds'],
                provisional=bool(preview.get('errors') or selection['conflicts'] or scope not in {'FULL_NATION', 'SPORT_FAMILY'} or stale_composition or len(evaluation) > len(people))))
        except ImportValidationError as exc:
            nations.append(dict(nation=session.nation, people=[], rooms=[], excludedIds=[],
                                provisional=True, conflict=exc.code))

    return jsonify(json.loads(encoded(nations)))
