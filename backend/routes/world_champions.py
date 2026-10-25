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
    from accommodation_mutations import lock_accommodation_writes
    from imports.workflow import lock_import_snapshot
    lock_accommodation_writes();lock_import_snapshot()
    values = row.to_dict() if row.id else {'active': True, 'titleType': 'INDIVIDUAL', 'entitlementEnabled': True}
    if row.id and data != row.to_dict():
        from models import WorldChampionRecognition
        from world_champions import recognition_protected
        owners={row.event_id}|{r.event_id for r in WorldChampionRecognition.query.filter_by(title_id=row.id)}
        if any(recognition_protected(owner,row) for owner in owners):
            return jsonify(error='TITLE_REVIEW_REQUIRED',message='Verwendeter Ursprungstitel bleibt geschützt; gesonderte Prüfung erforderlich.'),409
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
        if not row.id and WorldChampion.query.filter_by(fis_code=values['fisCode'],championship=values['championship'],championship_year=values['championshipYear'],discipline=values['discipline'],title_type=values['titleType']).first():
            return jsonify(error='TITLE_EXISTS',message='Zentraler Ursprungstitel existiert bereits; vorhandenen Titel anerkennen statt kopieren.'),409
        for key, attribute in FIELDS.items():
            setattr(row, attribute, values[key])
        db.session.add(row)
        if not row.id:
            db.session.flush()
            from models import WorldChampionRecognition
            db.session.add(WorldChampionRecognition(event_id=row.event_id,title_id=row.id,active=row.active,created_by=getattr(__import__('auth').current_user(),'username',None)))
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


@world_champions.route('/api/admin/world-champion-titles',methods=['GET'])
def title_catalogue():
    # Global reference metadata, not person/booking records. Existing admin role
    # and an authorized active event are still mandatory at the composition root.
    return jsonify([row.to_dict() for row in WorldChampion.query.order_by(WorldChampion.name,WorldChampion.id)])


@world_champions.route('/api/admin/events/<int:event_id>/world-champions',methods=['GET','POST'])
def event_champions(event_id):
    from models import WorldChampionRecognition
    from world_champions import recognition_protected
    from quota_rules import fingerprint
    if request.method=='GET':
        links=WorldChampionRecognition.query.filter_by(event_id=event_id).all()
        return jsonify({'recognitions':[{'titleId':str(r.title_id),'active':r.active} for r in links]})
    from accommodation_mutations import lock_accommodation_writes
    from imports.workflow import lock_import_snapshot
    lock_accommodation_writes();lock_import_snapshot()
    data=request.get_json(silent=True) or {}
    try:
        title_id=int(data['titleId']);active=data['active']
        if type(active) is not bool:raise ValueError('Aktivstatus muss boolesch sein.')
        title=db.session.get(WorldChampion,title_id)
        if title is None:raise ValueError('Titel existiert nicht.')
        link=db.session.get(WorldChampionRecognition,(event_id,title_id))
        if not active and recognition_protected(event_id,title):
            return jsonify(error='RECOGNITION_REVIEW_REQUIRED',message='Event enthält Importhistorie oder eine bestehende Ausnahme. Gesonderte Prüfung erforderlich; keine Daten geändert.'),409
        if active and (not title.active or not title.entitlement_enabled):
            raise ValueError('Nur aktive, für EZ-Ausnahmen geeignete Ursprungstitel anerkennen.')
        old=link.active if link else False
        if link is None:
            link=WorldChampionRecognition(event_id=event_id,title_id=title_id,active=active,created_by=getattr(__import__('auth').current_user(),'username',None));db.session.add(link)
        else:link.active=active
        from world_champions import audit_recognition
        audit_recognition(event_id,title_id,old,active)
        db.session.commit()
        return jsonify(titleId=str(title_id),active=active)
    except (ValueError,KeyError,TypeError) as error:
        db.session.rollback();return jsonify(error=str(error)),400
