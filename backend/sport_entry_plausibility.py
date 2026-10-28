"""Read-only numerical SB Park & Pipe plausibility for WSC 2027.

Not FIS allocation/qualification, not accommodation quota or approval evidence.
Exact verified 2025 individual titles apply only to the event won (WSC 8.2).
SS/BA share one allocation pool; no transfer of a title to the other medal event.
"""
import json
from functools import lru_cache
from pathlib import Path
from imports.normalization import canonical_fis_code
from quota_service import is_athlete

EVENTS = {'Snowboard Halfpipe': 'HP', 'Snowboard Slopestyle': 'SS', 'Snowboard Big Air': 'BA'}


@lru_cache(maxsize=1)
def verified_titles():
    # Existing checked-in FIS references; no seeding or change to EZ recognition.
    return json.loads((Path(__file__).parent / 'reference_data/engadin_2025_world_champions.json').read_text())


def project_entries(people, competitions, event, titles=None):
    if not event or not event.is_world_championship or event.year != 2027:
        return {}
    titles = verified_titles() if titles is None else titles
    result = {}
    for comp in competitions.values():
        discipline = EVENTS.get(comp.display_name)
        if not discipline or comp.sport != 'Snowboard' or comp.team_competition or comp.gender not in {'M', 'W', 'F'}:
            continue
        members = {str(p['matchKey']): p for p in people if is_athlete(p) and any(
            str(m.get('competitionId')) == str(comp.id) for m in p.get('competitionMemberships', []))}
        rows = []
        for nation in sorted({p.get('nationCode') for p in members.values() if p.get('nationCode')}):
            roster = {key: p for key, p in members.items() if p.get('nationCode') == nation}
            champions = []
            for key, person in roster.items():
                matches = [t for t in titles if t.get('sourceVerified') is True and t.get('source')
                    and t.get('titleType') == 'INDIVIDUAL' and t.get('entitlementEnabled') is True
                    and t.get('championshipYear') == 2025 and t.get('championship') == 'Engadin'
                    and t.get('discipline') == discipline and t.get('eventGroup') == comp.quota_discipline
                    and t.get('nation') == nation and (t.get('gender') or '').replace('F', 'W') == comp.gender.replace('F', 'W')
                    and (person.get('gender') or '').replace('F', 'W') == comp.gender.replace('F', 'W')
                    and person.get('fisCode') and canonical_fis_code(t.get('fisCode')) == canonical_fis_code(person['fisCode'])]
                if matches:
                    champions.append(dict(personKey=key, source=matches[0]['source']))
            # One shared roster, never the sum of SS and BA entries.
            pool_ids = {str(c.id) for c in competitions.values() if c.sport == 'Snowboard'
                and c.display_name in {'Snowboard Slopestyle', 'Snowboard Big Air'}
                and c.gender == comp.gender and not c.team_competition}
            pool = {str(p['matchKey']) for p in people if is_athlete(p) and p.get('nationCode') == nation
                and any(str(m.get('competitionId')) in pool_ids for m in p.get('competitionMemberships', []))}
            rows.append(dict(nation=nation, reported=len(roster), regularMax=4,
                aboveRegular=max(0, len(roster)-4), championStarters=len(champions),
                unverifiedAdditional=max(0, len(roster)-4-len(champions)),
                personKeys=sorted(roster), champions=champions,
                sharedPoolReported=len(pool) if discipline in {'SS', 'BA'} else None,
                allocationConfirmed=False))
        result[str(comp.id)] = rows
    return result
