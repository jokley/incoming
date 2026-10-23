"""Uses the same app-wide administration permissions and auditing as Events."""
from accommodation_scope import accommodation_event_id, event_get, event_query
from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError
from models import Event, WorldChampion, db
from competitions import quota_disciplines
from models import Competition
from world_champions import canonical_fis_code

world_champions = Blueprint('world_champions', __name__)
FIELDS = {'eventId': 'event_id', 'fisCode': 'fis_code', 'name': 'name', 'nation': 'nation',
          'gender': 'gender', 'discipline': 'discipline', 'eventGroup': 'event_group',
          'championship': 'championship', 'championshipYear': 'championship_year',
          'titleType': 'title_type', 'entitlementEnabled': 'entitlement_enabled', 'source': 'source', 'active': 'active'}


def save(row, data):
    values = row.to_dict() if row.id else {'active': True, 'titleType': 'INDIVIDUAL', 'entitlementEnabled': True}
    values.update(data)
    if not row.id and 'entitlementEnabled' not in data:
        values['entitlementEnabled'] = values.get('titleType') == 'INDIVIDUAL'
    try:
        values['eventId'] = int(values['eventId'])
        if values['eventId'] != accommodation_event_id():
            raise ValueError('Target Event conflicts with the operational context')
        values['championshipYear'] = int(values['championshipYear'])
        if not db.session.get(Event, values['eventId']):
            raise ValueError('Target Event does not exist')
        if values.get('titleType') not in {'INDIVIDUAL', 'TEAM'}:
            raise ValueError('Invalid title type')
        if values.get('gender') not in {'M', 'W', 'A'}:
            raise ValueError('Invalid gender')
        if values.get('eventGroup') not in quota_disciplines(Competition.query.all()):
            raise ValueError('Select an existing Event Group')
        for key in ('active', 'entitlementEnabled'):
            if not isinstance(values[key], bool):
                raise ValueError(key + ' must be boolean')
        if values['titleType'] == 'TEAM' and values['entitlementEnabled']:
            raise ValueError('Team titles currently have no entitlement')
        for key in ('fisCode', 'name', 'nation', 'discipline', 'championship', 'source'):
            if not isinstance(values.get(key), str) or not values[key].strip():
                raise ValueError(key + ' is required')
            values[key] = values[key].strip()
        values['fisCode'] = canonical_fis_code(values['fisCode'])
        for key, attribute in FIELDS.items():
            setattr(row, attribute, values[key])
        db.session.add(row)
        db.session.commit()
        return jsonify(row.to_dict()), 200 if request.method == 'PUT' else 201
    except (ValueError, KeyError, TypeError) as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify(error='This title already exists for the target Event'), 409


@world_champions.route('/api/admin/world-champions', methods=['GET', 'POST'])
def champions():
    if request.method == 'GET':
        return jsonify([row.to_dict() for row in event_query(WorldChampion).order_by(WorldChampion.name, WorldChampion.id).all()])
    return save(WorldChampion(), request.get_json() or {})


@world_champions.route('/api/admin/world-champions/<int:champion_id>', methods=['GET', 'PUT'])
def champion(champion_id):
    row = event_get(WorldChampion, champion_id, required=True)
    if request.method == 'GET':
        return jsonify(row.to_dict())
    return save(row, request.get_json() or {})
