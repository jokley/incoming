"""Import identity indices; room-list matching keeps its separate path."""
from models import Athlete

from .normalization import normalize_string


def build_name_key(lastname, firstname, nationcode=''):
    return '|'.join([
        normalize_string(lastname),
        normalize_string(firstname),
        normalize_string(nationcode),
    ])


def _build_existing_athlete_maps(athletes=None):
    if athletes is None:
        athletes = Athlete.query.all()
    maps = {
        'by_fis_code': {},
        'by_competitor_id': {},
        'by_name_key': {},
    }
    for athlete in athletes:
        if athlete.fis_code:
            # FIS code is the domain identity.  Keep the oldest productive row as
            # the canonical target when legacy imports left duplicates behind.
            maps['by_fis_code'].setdefault(str(athlete.fis_code).strip().upper(), athlete)
        if athlete.competitor_id:
            maps['by_competitor_id'][str(athlete.competitor_id)] = athlete
        maps['by_name_key'][build_name_key(athlete.lastname, athlete.firstname, athlete.nation_code)] = athlete
    return maps


def _find_existing_athlete(person_record, athlete_maps):
    fis_code = person_record.get('fisCode')
    if fis_code:
        return athlete_maps['by_fis_code'].get(str(fis_code).strip().upper())
    competitor_id = person_record.get('competitorId')
    if competitor_id:
        existing = athlete_maps['by_competitor_id'].get(str(competitor_id))
        return existing
    return athlete_maps['by_name_key'].get(build_name_key(
        person_record.get('lastname'),
        person_record.get('firstname'),
        person_record.get('nationCode'),
    ))


def _index_people(people):
    by_name = {}
    by_name_no_nation = {}
    by_competitor_id = {}
    for person in people:
        key = build_name_key(person['lastname'], person['firstname'], person['nationCode'])
        by_name[key] = person
        by_name_no_nation[build_name_key(person['lastname'], person['firstname'], '')] = person
        if person.get('competitorId'):
            by_competitor_id[str(person['competitorId'])] = person
    return {'by_name': by_name, 'by_name_no_nation': by_name_no_nation, 'by_competitor_id': by_competitor_id}
