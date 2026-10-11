"""Central quota evaluation shared by import previews and live disposition."""

from fis_rules import compute_official_quota, compute_single_room_entitlement


def evaluate_athlete_quota_usage(people):
    """Report base 36/20 limits, independently of accommodation/workflow rules.

    Input memberships are canonical ``topLevelDisciplines`` resolved through
    the selected catalogue mapping. Identity is the persisted personId or the
    parser's matchKey, never an entry count. Article 8.2 eligibility is not
    supported; administrative single-room exemptions have no effect here.
    Unknown/conflicting individual genders remain visible as incomplete data.
    """
    groups = {}
    for person in people:
        if (person.get('function') or '').strip().lower() != 'athlete':
            continue
        for discipline in set(person.get('topLevelDisciplines') or []):
            if discipline not in {'Snowboard', 'Freestyle'}:
                raise ValueError('Athlete quota requires a canonical top-level discipline')
            identity = person.get('personId')
            if identity is None:
                identity = person.get('matchKey')
            if identity is None or identity == '':
                raise ValueError('Athlete quota requires a stable person identity')
            key = (person.get('nationCode') or '', discipline)
            members = groups.setdefault(key, {})
            members.setdefault(str(identity), set()).add(normalize_gender(person.get('gender')))

    rows = []
    for (nation, discipline), members in sorted(groups.items()):
        genders = {'M': 0, 'F': 0}
        unknown = 0
        for values in members.values():
            if len(values) == 1 and next(iter(values)) in genders:
                genders[next(iter(values))] += 1
            else:
                unknown += 1
        total_exceeded = len(members) > 36
        gender_exceeded = {gender: used > 20 for gender, used in genders.items()}
        rows.append({
            'nationCode': nation, 'topLevelDiscipline': discipline,
            'athleteQuotaUsed': len(members), 'athleteQuotaLimit': 36,
            'athleteGenderUsed': genders, 'athleteGenderLimit': 20,
            'athleteQuotaExceeded': total_exceeded,
            'athleteGenderExceeded': gender_exceeded,
            'athleteGenderUnknown': unknown,
            'athleteQuotaStatus': ('EXCEEDED' if total_exceeded or any(gender_exceeded.values())
                                  else 'INCOMPLETE' if unknown else 'WITHIN_BASE_LIMITS'),
            'worldChampionExceptionSupported': False,
        })
    return rows


def normalize_gender(value):
    value = (value or '').strip()
    lowered = value.lower()
    if lowered.startswith('m') or lowered in {'herr', 'herren'}:
        return 'M'
    if lowered.startswith('f') or lowered.startswith('w') or lowered in {'dame', 'damen'}:
        return 'F'
    return value.upper()


def quota_key(person):
    return (
        person.get('nationCode') or '',
        person.get('discipline') or '',
        normalize_gender(person.get('gender') or person.get('forGender')),
    )


def quota_keys(person):
    """Return distinct quota groups; multiple competitions may share a group."""
    disciplines = person.get('quotaDisciplines') or [person.get('discipline') or '']
    return {
        (person.get('nationCode') or '', discipline, normalize_gender(
            person.get('gender') or person.get('forGender')))
        for discipline in disciplines
    }


def disposition_by_quota_group(people, assigned_person_ids=()):
    """Count distinct people and room assignments in every quota group.

    Accommodation remains attached to the person. A person's single assignment
    is therefore visible in each distinct quota discipline they participate in,
    while competitions sharing a quota discipline still contribute only once.
    """
    assigned_person_ids = set(assigned_person_ids)
    totals = {}
    assigned = {}
    for person in people:
        person_id = person.get('personId')
        for key in quota_keys(person):
            if not key[2]:
                continue
            totals[key] = totals.get(key, 0) + 1
            if person_id in assigned_person_ids:
                assigned[key] = assigned.get(key, 0) + 1
    return {
        key: {'peopleTotal': total, 'peopleAssigned': assigned.get(key, 0)}
        for key, total in totals.items()
    }


def single_room_usage_by_quota_group(people, single_room_person_ids=(), exempt_person_ids=()):
    """Count persisted quota-single overrides once per person and quota group."""
    single_room_person_ids = set(single_room_person_ids)
    exempt_person_ids = set(exempt_person_ids)
    usage = {}
    for person in people:
        if (person.get('personId') not in single_room_person_ids
                or person.get('personId') in exempt_person_ids):
            continue
        for key in quota_keys(person):
            if key[2]:
                usage[key] = usage.get(key, 0) + 1
    return usage


def evaluate_quota_usage(people, assigned_people=()):
    """Return quota rows for a roster and its assigned officials.

    ``people`` is the authoritative roster. ``assigned_people`` contains one
    record per assigned official and may carry ``countsAsSingle``. Keeping this
    calculation free of database concerns lets previews project the same rules
    that the disposition applies to persisted records.
    """
    athletes = {}
    assigned = {}
    singles = {}
    exempt_singles = {}
    keys = set()
    for person in people:
        for key in quota_keys(person):
            if not key[2]:
                continue
            keys.add(key)
            if (person.get('function') or '').strip().lower() == 'athlete':
                athletes[key] = athletes.get(key, 0) + 1
    for person in assigned_people:
        is_athlete = (person.get('function') or '').strip().lower() == 'athlete'
        # Athlete room requests follow every distinct quota discipline from the
        # person's competition memberships. Officials intentionally retain the
        # existing single-discipline assignment semantics.
        person_keys = quota_keys(person) if is_athlete else {quota_key(person)}
        for key in person_keys:
            if not key[2]:
                continue
            keys.add(key)
            if not is_athlete:
                assigned[key] = assigned.get(key, 0) + 1
            if person.get('countsAsSingle') and person.get('singleRoomQuotaExemptReason'):
                exempt_singles[key] = exempt_singles.get(key, 0) + 1
            elif person.get('countsAsSingle'):
                singles[key] = singles.get(key, 0) + 1

    rows = []
    for nation, discipline, gender in sorted(keys):
        key = (nation, discipline, gender)
        official_quota = compute_official_quota(athletes.get(key, 0))
        rows.append({
            'nationCode': nation,
            'discipline': discipline,
            'gender': gender,
            'athletesEntered': athletes.get(key, 0),
            'officialQuota': official_quota,
            'singleRoomsAllowed': compute_single_room_entitlement(official_quota),
            'assignedOfficials': assigned.get(key, 0),
            'singleRoomsUsed': singles.get(key, 0),
            'quotaExemptSingleRooms': exempt_singles.get(key, 0),
        })
    return rows


def quota_violations(rows):
    return [row for row in rows if (
        row['assignedOfficials'] > row['officialQuota']
        or row['singleRoomsUsed'] > row['singleRoomsAllowed']
    )]
