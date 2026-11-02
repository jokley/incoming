"""Read-only WSC 2027 numerical evidence; never allocation, approval or admission.

WSC 8.3/8.11: four per medal event/gender, not the training limits.
WSC 8.2: verified personal titles, exact event; SS/BA use one distinct pool.
"""
import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse
from competitions import competition_title_discipline
from imports.normalization import canonical_fis_code
from quota_service import is_athlete, normalize_gender


@lru_cache(maxsize=1)
def verified_titles():
    return json.loads((Path(__file__).parent / 'reference_data/engadin_2025_world_champions.json').read_text())


def active_competitions(event, competitions):
    """Exact event-owned IDs; catalogue names and event codex prefixes are irrelevant."""
    return {str(m.competition_id): competitions[m.competition_id]
            for m in getattr(event, 'competition_mappings', [])
            if m.active and m.event_id == event.id and m.competition_id in competitions
            and competitions[m.competition_id].active}


def _identity(person, index):
    # Same persisted/import identity namespaces as the existing quota overview.
    persisted = person.get('existingAthleteId')
    if persisted is None:
        persisted = person.get('personId')
    if persisted is not None:
        return ('persisted', str(persisted))
    fis = canonical_fis_code(person.get('fisCode'))
    return ('fis', fis) if fis else ('import', str(person['matchKey'])) if person.get('matchKey') else ('unresolved', index)


def _sport_config(event):
    try:
        config = json.loads(getattr(event, 'quota_rules_json', None) or '{}').get('sportEntryRules')
        if config is None:
            return None, None
        if (not isinstance(config, dict) or config.get('schemaVersion') != 1
                or not isinstance(config.get('competitions'), list) or not isinstance(config.get('pools'), list)):
            return None, 'Sportregelkonfiguration unvollständig.'
        if not getattr(event, 'quota_rules_fixed_at', None):
            return config, 'Sportregelentwurf ist nicht fixiert.'
        if config.get('enabled') is not True:
            return config, 'Sportprüfung ist für dieses Event deaktiviert.'
        if (any(not isinstance(r, dict) or not r.get('competitionId') or not isinstance(r.get('titleReferences'), list)
                or any(not isinstance(t, dict) for t in r['titleReferences']) for r in config['competitions'])
                or any(not isinstance(p, dict) for p in config['pools'])):
            return config, 'Sportregelkonfiguration unvollständig.'
        ids = [r.get('competitionId') for r in config['competitions']]
        if len(ids) != len(set(ids)):
            return config, 'Competition-Regeln sind nicht eindeutig.'
        return config, None
    except (TypeError, ValueError, AttributeError):
        return None, 'Sportregelkonfiguration unvollständig.'


def project_entries(people, competitions, event, titles=None):
    if not event or not event.is_world_championship or event.year != 2027:
        return {}
    active = active_competitions(event, competitions)
    titles = verified_titles() if titles is None else titles
    config, config_error = _sport_config(event)
    rules = {str(r['competitionId']): r for r in config['competitions']} if config and not config_error else {}
    if rules.keys() - active.keys():
        config_error = 'Konfigurierte Competition ist nicht aktiv diesem Event zugeordnet.'
    memberships, identity_facts = {}, {}
    for index, person in enumerate(people):
        if not is_athlete(person):
            continue
        identity_facts.setdefault(_identity(person,index),set()).add((person.get('nationCode'),normalize_gender(person.get('gender'))))
        for cid in {str(m.get('competitionId')) for m in person.get('competitionMemberships', [])}:
            memberships.setdefault(cid, []).append((_identity(person, index), person))
    nations = sorted({p.get('nationCode') or '' for p in people if is_athlete(p)})
    result, champion_ids = {}, {}
    for cid in sorted(active.keys() | memberships.keys()):
        comp = active.get(cid)
        discipline = competition_title_discipline(comp) if comp and not comp.team_competition else None
        team = bool(comp and comp.team_competition)
        rule = rules.get(cid)
        error = config_error
        if not comp:
            error = 'Competition ist nicht aktiv und eindeutig diesem Event zugeordnet.'
        elif not team and not discipline:
            error = 'Keine eindeutige belegte Einzelwettbewerbsregel für diese Competition.'
        if rule and not team:
            if rule.get('enabled') is not True:
                error = 'Einzelwettbewerbsprüfung ist deaktiviert.'
            elif type(rule.get('regularLimit')) is not int or rule['regularLimit'] != 4:
                error = 'Konfigurierter Grenzwert entspricht nicht dem belegten WM-2027-Regelwert 4.'
        refs = rule.get('titleReferences', []) if rule else titles
        if rule and config.get('titleEdition') != {'championship': 'Engadin', 'year': 2025}:
            refs = []  # No assumed year-minus-two or invented championship equivalence.
        rows = []
        for nation in nations:
            roster = {}
            for identity, person in memberships.get(cid, []):
                if (person.get('nationCode') or '') == nation:
                    roster.setdefault(identity, []).append(person)
            invalid = any(identity[0] == 'unresolved' or len(identity_facts[identity])>1 or any(not p.get('nationCode') or not p.get('matchKey')
                or (not team and comp and normalize_gender(p.get('gender')) != normalize_gender(comp.gender))
                for p in records) for identity, records in roster.items())
            reason = (None if team else error) or ('Personenidentität oder Geschlecht nicht eindeutig.' if invalid else None)
            champions = []
            ids = set()
            if not reason and not team:
                for identity, records in roster.items():
                    matches = [t for t in refs if t.get('sourceVerified') is True and urlparse(str(t.get('source') or '')).scheme == 'https' and urlparse(str(t.get('source') or '')).netloc
                        and t.get('titleType') == 'INDIVIDUAL' and t.get('entitlementEnabled', True) is True
                        and t.get('championshipYear') == 2025 and t.get('championship') == 'Engadin'
                        and t.get('discipline') == discipline and t.get('eventGroup') == comp.quota_discipline
                        and t.get('nation') == nation and normalize_gender(t.get('gender')) == normalize_gender(comp.gender)
                        and all(p.get('fisCode') and canonical_fis_code(t.get('fisCode')) == canonical_fis_code(p['fisCode']) for p in records)]
                    if matches:
                        ids.add(identity)
                        champions.append(dict(personKey=records[0]['matchKey'], source=matches[0]['source']))
            champion_ids[(cid, nation)] = ids
            reported = len(roster)
            above = max(0, reported - 4) if not team and not reason else 0
            unverified = max(0, above - len(ids))
            status = ('INCOMPLETE' if reason else 'TEAM_RULE' if team else 'REVIEW_REQUIRED' if unverified
                      else 'TITLE_COVERED' if above else 'NUMERIC_OK')
            rows.append(dict(nation=nation, reported=reported, regularMax=4 if not team and not reason else None,
                aboveRegular=above, championStarters=len(ids), unverifiedAdditional=unverified,
                personKeys=sorted({p['matchKey'] for records in roster.values() for p in records if p.get('matchKey')}),
                champions=champions, sharedPoolReported=None, allocationConfirmed=False, status=status,
                reason=reason or ('Teamwettbewerb benötigt eine gesonderte Teamregel.' if team else
                    'Numerische Prüfung nach WSC 8.3/8.11; keine endgültige FIS-Startfreigabe.')))
        result[cid] = rows

    # The existing SS/BA union, for both sports. Personal identities consume a
    # pool slot once, even with two starts or two references for the same title.
    for cid, comp in active.items():
        discipline = competition_title_discipline(comp) if not comp.team_competition else None
        if discipline not in {'SS', 'BA'}:
            if rules.get(cid, {}).get('poolId'):
                for row in result[cid]:
                    row.update(status='INCOMPLETE', regularMax=None, reason='Für diesen konfigurierten Pool ist keine WM-2027-Regel belegt.')
            continue
        pool_ids = {key for key, c in active.items() if not c.team_competition and c.sport == comp.sport
                    and c.gender == comp.gender and competition_title_discipline(c) in {'SS', 'BA'}}
        pool_error = len(pool_ids) != 2
        configured_pool_ids = {rules.get(key, {}).get('poolId') for key in pool_ids} - {None}
        if configured_pool_ids:
            pool_id = next(iter(configured_pool_ids))
            configured = {key for key, r in rules.items() if r.get('poolId') == pool_id and r.get('enabled') is True}
            definitions = [p for p in config['pools'] if p.get('id') == pool_id]
            pool_error |= (len(configured_pool_ids) != 1 or configured != pool_ids or len(definitions) != 1
                           or type(definitions[0].get('regularLimit')) is not int or definitions[0]['regularLimit'] != 4)
        for row in result[cid]:
            nation = row['nation']
            pool_people = {identity for key in pool_ids for identity, p in memberships.get(key, []) if p.get('nationCode') == nation}
            pool_champions = set().union(*(champion_ids.get((key, nation), set()) for key in pool_ids))
            row.update(sharedPoolReported=len(pool_people), sharedPoolRegularMax=4, sharedPoolChampionStarters=len(pool_champions),
                sharedPoolUnverifiedAdditional=max(0, len(pool_people)-4-len(pool_champions)),
                poolPersonKeys=sorted({p['matchKey'] for key in pool_ids for _, p in memberships.get(key, [])
                                      if p.get('nationCode') == nation and p.get('matchKey')}))
            incomplete_pool = any(r['status']=='INCOMPLETE' and r['reported'] for key in pool_ids for r in result[key] if r['nation']==nation)
            if pool_error or incomplete_pool:
                row.update(status='INCOMPLETE', regularMax=None, reason='Gemeinsamer SS/BA-Pool ist nicht vollständig und regelkonform gemappt.')
            elif row['status'] != 'INCOMPLETE' and row['sharedPoolUnverifiedAdditional']:
                row.update(status='REVIEW_REQUIRED', reason='Gemeinsamer SS/BA-Pool über regulärem Wert: persönliche Zusatzrechte und FIS-Zuteilung prüfen.')
    return result
