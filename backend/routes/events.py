"""Event HTTP routes; authentication and mutation auditing remain app-wide."""

from datetime import datetime

from flask import Blueprint, jsonify, request

from excel_import import ImportValidationError, normalize_event_id
from models import db, AccommodationEvent, Event, EventCompetition, EventRoomDemand, Competition


events = Blueprint('events', __name__)


# Events - CRUD
@events.route('/api/events', methods=['GET'])
def get_events():
    events = AccommodationEvent.query.options(
        db.selectinload(AccommodationEvent.room_demands).joinedload(EventRoomDemand.room_type)
    ).all()
    return jsonify([e.to_dict() for e in events])


@events.route('/api/events', methods=['POST'])
def create_event():
    data = request.json
    event = AccommodationEvent(
        discipline=data['discipline'],
        start_date=datetime.fromisoformat(data['startDate']).date(),
        end_date=datetime.fromisoformat(data['endDate']).date(),
        person_demand=max(0, int(data['personDemand'])),
        single_room_percentage=max(0, min(100, int(data.get('singleRoomPercentage', 50))))
    )
    db.session.add(event)
    db.session.commit()
    return jsonify(event.to_dict()), 201


@events.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    event = AccommodationEvent.query.get_or_404(event_id)
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


@events.route('/api/events/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    event = AccommodationEvent.query.get_or_404(event_id)
    db.session.delete(event)
    db.session.commit()
    return '', 204


# Event Room Demand
@events.route('/api/events/<int:event_id>/demand', methods=['POST'])
def add_event_demand(event_id):
    return jsonify({'error': 'Zimmerbedarf wird automatisch aus Personenbedarf und Belegungsstrategie berechnet.'}), 405


@events.route('/api/events/<int:event_id>/demand/<int:demand_id>', methods=['DELETE'])
def delete_event_demand(event_id, demand_id):
    return jsonify({'error': 'Berechneter Zimmerbedarf kann nicht manuell geändert werden.'}), 405


# Championship event administration.  The existing /api/events endpoints stay
# dedicated to accommodation demand until that domain is scoped in a later sprint.
@events.route('/api/championship-events', methods=['GET'])
def list_active_championship_events():
    return jsonify([event.to_dict() for event in Event.query.filter_by(active=True).order_by(Event.year, Event.name).all()])


@events.route('/api/admin/events', methods=['GET', 'POST'])
def administer_events():
    if request.method == 'GET':
        return jsonify([event.to_dict() for event in Event.query.order_by(Event.year, Event.name).all()])
    data = request.get_json() or {}
    if not str(data.get('name', '')).strip():
        return jsonify({'error': 'Name ist erforderlich.'}), 400
    event = Event(name=data['name'].strip(), year=data.get('year'),
                  active=bool(data.get('active', True)), fis_event_id=data.get('fisEventId'),
                  sector_code=data.get('sectorCode'))
    db.session.add(event)
    db.session.commit()
    return jsonify(event.to_dict()), 201


@events.route('/api/admin/events/<int:event_id>', methods=['GET', 'PUT'])
def administer_event(event_id):
    event_record = Event.query.get_or_404(event_id)
    if request.method == 'GET':
        return jsonify(event_record.to_dict(include_mappings=True))
    data = request.get_json() or {}
    for source, target in (('name', 'name'), ('year', 'year'), ('active', 'active'),
                           ('fisEventId', 'fis_event_id'), ('sectorCode', 'sector_code')):
        if source in data:
            setattr(event_record, target, data[source])
    db.session.commit()
    return jsonify(event_record.to_dict(include_mappings=True))


@events.route('/api/admin/events/<int:event_id>/competitions', methods=['POST'])
def add_event_competition(event_id):
    Event.query.get_or_404(event_id)
    data = request.get_json() or {}
    Competition.query.get_or_404(data.get('competitionId'))
    mapping = EventCompetition(event_id=event_id, competition_id=data['competitionId'],
        fis_codex=str(data.get('fisCodex', '')).strip(), import_code=str(data.get('importCode', '')).strip(),
        official_name=str(data.get('officialName', '')).strip(), active=bool(data.get('active', True)))
    if not all((mapping.fis_codex, mapping.import_code, mapping.official_name)):
        return jsonify({'error': 'Official Name, Codex und Import Code sind erforderlich.'}), 400
    db.session.add(mapping)
    db.session.commit()
    return jsonify(mapping.to_dict()), 201


@events.route('/api/admin/events/<int:event_id>/competitions/<int:mapping_id>', methods=['PUT'])
def update_event_competition(event_id, mapping_id):
    mapping = EventCompetition.query.filter_by(id=mapping_id, event_id=event_id).first_or_404()
    data = request.get_json() or {}
    for source, target in (('officialName', 'official_name'), ('fisCodex', 'fis_codex'),
                           ('importCode', 'import_code'), ('active', 'active')):
        if source in data:
            setattr(mapping, target, data[source])
    db.session.commit()
    return jsonify(mapping.to_dict())


@events.route('/api/admin/events/<int:event_id>/copy-mappings', methods=['POST'])
def copy_event_competitions(event_id):
    target = Event.query.get_or_404(event_id)
    try:
        source_event_id = normalize_event_id((request.get_json() or {}).get('sourceEventId'))
    except ImportValidationError as exc:
        return jsonify(exc.to_dict()), 400
    source = Event.query.get_or_404(source_event_id)
    existing = {row.competition_id for row in target.competition_mappings}
    copies = [EventCompetition(event_id=target.id, competition_id=row.competition_id,
        fis_codex=row.fis_codex, import_code=row.import_code,
        official_name=row.official_name, active=row.active)
        for row in source.competition_mappings if row.competition_id not in existing]
    db.session.add_all(copies)
    db.session.commit()
    return jsonify({'created': len(copies), 'event': target.to_dict(include_mappings=True)})
