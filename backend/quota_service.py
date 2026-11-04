"""Central quota evaluation shared by import previews and live disposition."""

from fis_rules import compute_official_quota, compute_single_room_entitlement
from competitions import athlete_top_level_discipline


def evaluate_athlete_quota_usage(people, rules=None):
    """Evaluate event athlete limits independently of accommodation rules.

    Input memberships are canonical ``quotaDisciplines`` resolved through
    the selected catalogue mapping. Identity is the persisted personId or the
    parser's matchKey, never an entry count. Article 8.2 eligibility is not
    supported; administrative single-room exemptions have no effect here.
    Unknown/conflicting individual genders remain visible as incomplete data.
    """
    from quota_rules import evaluation_rules
    rules = evaluation_rules(rules)
    groups = {}
    for person in people:
        if (person.get('function') or '').strip().lower() != 'athlete':
            continue
        for discipline in set(person.get('athleteQuotaFamilies', [athlete_top_level_discipline(group) for group in person.get('quotaDisciplines') or []])) - {None}:
            identity = person.get('personId')
            if identity is None:
                identity = person.get('matchKey')
            if identity is None or identity == '':
                raise ValueError('Athlete quota requires a stable person identity')
            key = (person.get('nationCode') or '', discipline)
            members = groups.setdefault(key, {})
            gender = normalize_gender(person.get('gender'))
            # Preserve the established athleteQuotaChecks API's F label.
            members.setdefault(str(identity), set()).add('F' if gender == 'W' else gender)

    rows = []
    for (nation, discipline), members in sorted(groups.items()):
        genders = {'M': 0, 'F': 0}
        unknown = 0
        for values in members.values():
            if len(values) == 1 and next(iter(values)) in genders:
                genders[next(iter(values))] += 1
            else:
                unknown += 1
        rule = rules['athletes'][discipline]
        if not rule['enabled']:
            continue
        total_exceeded = len(members) > rule['totalLimit']
        gender_exceeded = {gender: used > rule['genderLimit'] for gender, used in genders.items()}
        rows.append({
            'nationCode': nation, 'topLevelDiscipline': discipline,
            'athleteQuotaUsed': len(members), 'athleteQuotaLimit': rule['totalLimit'],
            'athleteGenderUsed': genders, 'athleteGenderLimit': rule['genderLimit'],
            'athleteQuotaExceeded': total_exceeded,
            'athleteGenderExceeded': gender_exceeded,
            'athleteGenderUnknown': unknown,
            'athleteQuotaStatus': ('EXCEEDED' if total_exceeded or any(gender_exceeded.values())
                                  else 'INCOMPLETE' if unknown else 'WITHIN_BASE_LIMITS'),
            'worldChampionExceptionSupported': False,
        })
    return rows


def normalize_gender(value):
    if not isinstance(value, str):
        return ''
    value = (value or '').strip()
    lowered = value.lower()
    if lowered in {'m', 'male', 'man', 'men', 'herr', 'herren'}:
        return 'M'
    if lowered in {'w', 'f', 'female', 'woman', 'women', 'dame', 'damen'}:
        return 'W'
    return value.upper()


def is_athlete(person):
    return (person.get('function') or '').strip().lower() == 'athlete'


class QuotaGenderValidationError(ValueError):
    def __init__(self, errors):
        self.errors = errors
        super().__init__('Quota evaluation requires valid athlete gender M/W')


def quota_gender_errors(people):
    """Invalid/conflicting athlete gender is review work, never an A allowance."""
    errors = []
    genders = {}
    for index, person in enumerate(people):
        if not is_athlete(person) or not person.get('quotaDisciplines'):
            continue
        identity = person.get('personId')
        if identity is None:
            identity = person.get('matchKey')
        identity = ('row', index) if identity is None else ('person', str(identity))
        gender = normalize_gender(person.get('gender'))
        genders.setdefault(identity, set()).add(gender)
        if gender not in {'M', 'W'}:
            errors.append({'code': 'ENTRY_QUOTA_GENDER_INVALID',
                'message': 'Athlete.gender must be M or W for quota evaluation',
                'details': {'personKey': person.get('matchKey'),
                            'personId': person.get('personId'), 'gender': person.get('gender')}})
    for identity, values in genders.items():
        if len(values) > 1:
            errors.append({'code': 'ENTRY_QUOTA_GENDER_CONFLICT',
                'message': 'Conflicting personal genders for one athlete identity',
                'details': {'identity': identity[1]}})
    return errors


def athlete_quota_contexts(people):
    return {key for person in people if is_athlete(person) for key in quota_keys(person)}


def quota_key(person, roster=()):
    """Compatibility for callers requiring exactly one canonical membership."""
    keys = quota_keys(person, roster)
    if len(keys) != 1:
        raise ValueError('Expected exactly one mapped quota membership')
    return next(iter(keys))


def quota_keys(person, roster=(), *, allowance_contexts=None):
    """Athlete M/W keys; Officials follow active athlete contexts in their groups.

    An Official supports each active gender context in the same nation/group.
    Their personal gender, forGender and Competition.gender are irrelevant.
    Without athlete evidence there is no allowance context to assign them to.
    """
    disciplines = person.get('quotaDisciplines') or []
    nation = person.get('nationCode') or ''
    if is_athlete(person):
        gender = normalize_gender(person.get('gender'))
        return {(nation, discipline, gender) for discipline in disciplines
                if gender in {'M', 'W'}}
    contexts = athlete_quota_contexts(roster) if allowance_contexts is None else allowance_contexts
    return {key for key in contexts
            if key[0] == nation and key[1] in disciplines}


def has_quota_membership(person, roster=()):
    return bool(quota_keys(person, roster))


def _distinct_memberships(people, roster=None):
    roster = people if roster is None else roster
    errors = quota_gender_errors(roster)
    if errors:
        raise QuotaGenderValidationError(errors)
    contexts = athlete_quota_contexts(roster)
    seen = set()
    for index, person in enumerate(people):
        identity = person.get('personId')
        if identity is None:
            identity = person.get('matchKey')
        # Unpersisted synthetic input rows without an identity remain separate.
        identity = ('row', index) if identity is None else ('person', str(identity))
        for key in quota_keys(person, allowance_contexts=contexts):
            if key[2] and (identity, key) not in seen:
                seen.add((identity, key))
                yield person, key


def disposition_by_quota_group(people, assigned_person_ids=()):
    """Count distinct people and room assignments in every quota group.

    Accommodation remains attached to the person. A person's single assignment
    is therefore visible in each distinct quota discipline they participate in,
    while competitions sharing a quota discipline still contribute only once.
    """
    assigned_person_ids = set(assigned_person_ids)
    totals = {}
    assigned = {}
    for person, key in _distinct_memberships(people):
        totals[key] = totals.get(key, 0) + 1
        if person.get('personId') in assigned_person_ids:
            assigned[key] = assigned.get(key, 0) + 1
    return {
        key: {'peopleTotal': total, 'peopleAssigned': assigned.get(key, 0)}
        for key, total in totals.items()
    }


def person_identity(person, index=0):
    identity = person.get('personId')
    if identity is None:
        identity = person.get('matchKey')
    return str(identity) if identity is not None else f'row:{index}'


def allocate_single_rooms(people, capacities, roster=None):
    """Deterministic maximum bipartite matching of physical people to slots.

    Contexts describe eligibility, not copies of the booked person. Exempt and
    reliably approved-extra people consume no normal slot. Every result has one
    routing context at most, including pending people, so row totals are additive.
    """
    roster = people if roster is None else roster
    errors = quota_gender_errors(roster)
    if errors:
        raise QuotaGenderValidationError(errors)
    contexts = athlete_quota_contexts(roster)
    members = {}
    for index, person in enumerate(people):
        if not person.get('countsAsSingle'):
            continue
        identity = person_identity(person, index)
        eligible = quota_keys(person, allowance_contexts=contexts) & set(capacities)
        if identity not in members:
            members[identity] = {'person': person, 'eligible': set(), 'approved': set()}
        item = members[identity]
        item['eligible'] |= eligible
        item['approved'] |= {(c['nationCode'], c['discipline'], normalize_gender(c['gender']))
            for c in (person.get('approvedQuotaContexts') or [])
            if person.get('singleRoomStatus') == 'APPROVED_EXTRA'} & eligible
    ordered = sorted(members, key=lambda identity: (
        len(members[identity]['eligible']),
        str(members[identity]['person'].get('matchKey') or members[identity]['person'].get('fisCode') or identity),
        identity))
    slots = {context: [(context, i) for i in range(max(0, int(capacity)))]
             for context, capacity in sorted(capacities.items())}
    owners, assigned = {}, {}

    def augment(identity, seen):
        for context in sorted(members[identity]['eligible']):
            for slot in slots[context]:
                if slot in seen:
                    continue
                seen.add(slot)
                previous = owners.get(slot)
                if previous is None or augment(previous, seen):
                    owners[slot] = identity
                    assigned[identity] = slot
                    return True
        return False

    for identity in ordered:
        item = members[identity]
        if not item['person'].get('singleRoomQuotaExemptReason') and not item['approved']:
            augment(identity, set())
    result = []
    for identity in ordered:
        item, person = members[identity], members[identity]['person']
        eligible = sorted(item['eligible'])
        if person.get('singleRoomQuotaExemptReason'):
            status, context = 'EXEMPT', next(iter(eligible), None)
        elif item['approved']:
            status, context = 'APPROVED_EXTRA', sorted(item['approved'])[0]
        elif identity in assigned:
            status, context = 'COVERED', assigned[identity][0]
        else:
            status, context = 'PENDING', next(iter(eligible), None)
        result.append({'identity': identity, 'personId': person.get('personId'),
            'personKey': person.get('matchKey'), 'status': status,
            'context': list(context) if context else None,
            'eligibleContexts': [list(key) for key in eligible]})
    return result


def single_room_usage_by_quota_group(people, single_room_person_ids=(), exempt_person_ids=()):
    """Physical usage partitioned once across eligible entitlement contexts."""
    singles, exemptions = set(single_room_person_ids), set(exempt_person_ids)
    assigned = [{**p, 'countsAsSingle': p.get('personId') in singles,
        'singleRoomQuotaExemptReason': 'OTHER' if p.get('personId') in exemptions else None}
        for p in people]
    return {(r['nationCode'], r['discipline'], r['gender']): r['singleRoomsUsed']
            for r in evaluate_quota_usage(people, assigned) if r['singleRoomsUsed']}


def evaluate_quota_usage(people, assigned_people=(), rules=None):
    """Return quota rows for a roster and its assigned officials.

    ``people`` is the authoritative roster. ``assigned_people`` contains one
    record per assigned official and may carry ``countsAsSingle``. Keeping this
    calculation free of database concerns lets previews project the same rules
    that the disposition applies to persisted records.
    """
    from quota_rules import evaluation_rules
    rules = evaluation_rules(rules)
    errors = quota_gender_errors(people)
    if errors:
        raise QuotaGenderValidationError(errors)
    athletes = {}
    assigned = {}
    keys = set()
    for person, key in _distinct_memberships(people):
        keys.add(key)
        if (person.get('function') or '').strip().lower() == 'athlete':
            athletes[key] = athletes.get(key, 0) + 1
    for person, key in _distinct_memberships(assigned_people, people):
        keys.add(key)
        if (person.get('function') or '').strip().lower() != 'athlete':
            assigned[key] = assigned.get(key, 0) + 1

    rows = []
    for nation, discipline, gender in sorted(keys):
        key = (nation, discipline, gender)
        official_quota = compute_official_quota(athletes.get(key, 0), rules['officials']['allowance'])
        rows.append({
            'nationCode': nation,
            'discipline': discipline,
            'gender': gender,
            'athletesEntered': athletes.get(key, 0),
            'officialQuota': official_quota,
            'singleRoomsAllowed': compute_single_room_entitlement(official_quota, rules['singleRooms']),
            'assignedOfficials': assigned.get(key, 0),
            'singleRoomsUsed': 0,
            'quotaExemptSingleRooms': 0,
        })
    capacities = {(r['nationCode'], r['discipline'], r['gender']): r['singleRoomsAllowed'] for r in rows}
    allocation = allocate_single_rooms(assigned_people, capacities, people)
    for row in rows:
        key = [row['nationCode'], row['discipline'], row['gender']]
        routed = [p for p in allocation if p['context'] == key]
        row['singleRoomsUsed'] = sum(p['status'] != 'EXEMPT' for p in routed)
        row['quotaExemptSingleRooms'] = sum(p['status'] == 'EXEMPT' for p in routed)
        row['singleRoomAllocations'] = routed
        row['singleRoomsCovered'] = sum(p['status'] == 'COVERED' for p in routed)
        row['singleRoomsPending'] = sum(p['status'] == 'PENDING' for p in routed)
    return rows


def quota_violations(rows):
    """Only unresolved physical single-room excess requires a decision."""
    return [row for row in rows if row['singleRoomsPending'] > 0]
