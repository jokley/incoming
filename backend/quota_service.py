"""Central quota evaluation shared by import previews and live disposition."""

from fis_rules import compute_official_quota, compute_single_room_entitlement


def normalize_gender(value):
    value = (value or '').strip()
    lowered = value.lower()
    if lowered.startswith('m'):
        return 'M'
    if lowered.startswith('f') or lowered.startswith('w'):
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
    keys = set()
    for person in people:
        for key in quota_keys(person):
            if not key[2]:
                continue
            keys.add(key)
            if (person.get('function') or '').strip().lower() == 'athlete':
                athletes[key] = athletes.get(key, 0) + 1
    for person in assigned_people:
        if (person.get('function') or '').strip().lower() == 'athlete':
            continue
        key = quota_key(person)
        if not key[2]:
            continue
        keys.add(key)
        assigned[key] = assigned.get(key, 0) + 1
        if person.get('countsAsSingle'):
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
        })
    return rows


def quota_violations(rows):
    return [row for row in rows if (
        row['assignedOfficials'] > row['officialQuota']
        or row['singleRoomsUsed'] > row['singleRoomsAllowed']
    )]
