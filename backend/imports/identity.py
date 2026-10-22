"""Event-scoped import identities. Ambiguity is a blocker, never a merge."""
from models import Athlete
from .normalization import normalize_string, normalize_whitespace, canonical_fis_code
from .event_context import ImportValidationError, import_event_id


def build_name_key(lastname, firstname, nationcode=''):
    return '|'.join(normalize_string(v) for v in (lastname, firstname, nationcode))


def _build_existing_athlete_maps(athletes=None, *, event_id=None):
    event_id = import_event_id(event_id)
    if athletes is None:
        athletes = Athlete.query.filter_by(event_id=event_id).order_by(Athlete.id).all()
    maps = {'event_id': event_id, 'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}}
    for athlete in athletes:
        if athlete.event_id != event_id:
            raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Personenindex enthält ein fremdes Event.')
        for kind, key in (
            ('by_fis_code', canonical_fis_code(athlete.fis_code)),
            ('by_competitor_id', normalize_whitespace(athlete.competitor_id)),
            ('by_name_key', build_name_key(athlete.lastname, athlete.firstname, athlete.nation_code)),
        ):
            if key:
                maps[kind].setdefault(key, []).append(athlete)
    return maps


def _find_existing_athlete(person_record, athlete_maps):
    def conflict(reason, candidates):
        raise ImportValidationError('IMPORT_IDENTITY_CONFLICT', reason,
            event_id=athlete_maps.get('event_id'), details={
                'personKey': person_record.get('matchKey'),
                'candidateIds': sorted({p.id for p in candidates})})
    if (person_record.get('eventId') is not None and athlete_maps.get('event_id') is not None
            and import_event_id(person_record['eventId']) != athlete_maps['event_id']):
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Person und Identitätsindex gehören zu verschiedenen Events.')
    fis = canonical_fis_code(person_record.get('fisCode'))
    staff = normalize_whitespace(person_record.get('competitorId'))
    candidates = []
    for kind, key in (('by_fis_code', fis), ('by_competitor_id', staff)):
        hits = athlete_maps[kind].get(key, []) if key else []
        if len(hits) > 1:
            conflict('Mehrdeutiger starker Identifier; manuelle Identitätsprüfung erforderlich.', hits)
        candidates.extend(hits)
    unique = {p.id: p for p in candidates}
    if len(unique) > 1:
        conflict('FIS-Code und Competitor-/Staff-ID verweisen auf verschiedene Personen.', candidates)
    if not unique:
        # Names are only evidence when complete, nation-scoped and unique.
        if not all(person_record.get(k) for k in ('lastname', 'firstname', 'nationCode')):
            return None
        hits = athlete_maps['by_name_key'].get(build_name_key(person_record['lastname'],
            person_record['firstname'], person_record['nationCode']), [])
        if len(hits) > 1:
            conflict('Mehrdeutiger Name innerhalb des Events und der Nation.', hits)
        candidates = hits
    if not candidates:
        return None
    person = candidates[0]
    if ((fis and person.fis_code and fis != canonical_fis_code(person.fis_code))
            or (staff and person.competitor_id and staff != normalize_whitespace(person.competitor_id))):
        conflict('Vorhandene starke Identität widerspricht den Importdaten.', [person])
    return person


def validate_people_identities(people, maps):
    seen, targets = {}, {}
    for person in people:
        for kind, value in (('fis', canonical_fis_code(person.get('fisCode'))),
                            ('staff', normalize_whitespace(person.get('competitorId')))):
            if not value:
                continue
            key = (kind, value)
            if key in seen:
                raise ImportValidationError('IMPORT_IDENTITY_CONFLICT',
                    'Starker Identifier wird von mehreren Importzeilen verwendet.', event_id=maps['event_id'])
            seen[key] = person
        existing = _find_existing_athlete(person, maps)
        if existing:
            if existing.id in targets:
                raise ImportValidationError('IMPORT_IDENTITY_CONFLICT',
                    'Mehrere Importzeilen passen zu derselben Person.', event_id=maps['event_id'])
            targets[existing.id] = person


def _index_people(people):
    by_name = {}
    by_name_no_nation = {}
    by_competitor_id = {}
    for person in people:
        key = build_name_key(person['lastname'], person['firstname'], person['nationCode'])
        by_name[key] = person if key not in by_name else None
        no_nation = build_name_key(person['lastname'], person['firstname'], '')
        by_name_no_nation[no_nation] = person if no_nation not in by_name_no_nation else None
        if person.get('competitorId'):
            key = str(person['competitorId'])
            by_competitor_id[key] = person if key not in by_competitor_id else None
    return {'by_name': by_name, 'by_name_no_nation': by_name_no_nation, 'by_competitor_id': by_competitor_id}
