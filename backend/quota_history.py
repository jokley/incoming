"""Read-only compatibility at the immutable historical approval boundary.

Detailed 2027 labels are frozen evidence of the old catalogue, never operative
membership. Intersect their exact codes with the person's current memberships;
ambiguous/unresolvable records remain review work rather than guessed groups.
"""
from competitions import COMPETITIONS, normalize_competition_ids
from quota_service import normalize_gender

CATALOGUE_IDENTITIES = {(c.import_code, c.code) for c in COMPETITIONS}

LEGACY_CODES = {
    'Parallel': {'6170', '6172', '6177', '6178', '6180'},
    'Snowboard Halfpipe': {'6174', '6175'},
    'Snowboard Big Air': {'6182', '6183'},
    'Snowboard Slopestyle': {'6188', '6190'},
    'Snowboard Cross': {'6191', '6192', '6193'},
    'Freeski Halfpipe': {'8171', '8172'},
    'Freeski Big Air': {'8178', '8181'},
    'Moguls': {'8179', '8183', '8186', '8187', '8188'},
    'Ski Cross': {'8180', '8184', '8185'},
    'Aerials': {'8193', '8194', '8195'},
    'Freeski Slopestyle': {'8196', '8197'},
}


# Frozen compatibility for the approved 1B transition, not a quota algorithm.
# A later configuration change outside these targets requires a new decision.
LEGACY_CANONICAL_TARGETS = {
    'Parallel': 'Snowboard', 'Snowboard Halfpipe': 'Snowboard',
    'Snowboard Big Air': 'Snowboard', 'Snowboard Slopestyle': 'Snowboard',
    'Snowboard Cross': 'Snowboard', 'Freeski Halfpipe': 'Freestyle',
    'Freeski Big Air': 'Freestyle', 'Moguls': 'Freestyle',
    'Ski Cross': 'Freestyle', 'Aerials': 'Freestyle', 'Freeski Slopestyle': 'Freestyle',
}


def person_keys(person):
    """Stable import identities, including the exact name-key fallback."""
    from imports.identity import build_name_key
    return {str(value) for value in (person.fis_code, person.competitor_id,
        build_name_key(person.lastname, person.firstname, person.nation_code)) if value}


def historical_approval_groups(details, person, person_key=None):
    """Read immutable evidence; unknown provenance never means a current label."""
    if (details.get('nationCode') != person.nation_code
            or normalize_gender(details.get('gender')) != normalize_gender(person.gender or person.for_gender)):
        return set()
    keys = {str(person_key)} if person_key is not None else person_keys(person)
    candidates = [c for c in details.get('singleRoomCandidates', []) if str(c.get('personKey')) in keys]
    if len(candidates) > 1:
        return set()
    candidate = candidates[0] if candidates else {}
    ids = {str(value) for value in candidate.get('competitionIds', [])}
    codes = set(candidate.get('competitionImportCodes') or [])
    label = details.get('discipline')
    canonical = details.get('quotaMembershipVersion') == 1
    # Before versioned canonical evidence, only frozen legacy provenance is
    # supported. String equality with a present-day group is never proof.
    if not canonical and label not in LEGACY_CODES:
        return set()
    supported = list(person.competitions)
    if ids:
        supported = [c for c in supported if str(c.id) in ids]
    elif codes:
        supported = [c for c in supported if c.import_code in codes]
    else:
        return set()
    if canonical:
        # Exact identity AND the reviewed group must still match. A mapping
        # change requires new review, even when the Competition ID survives.
        supported = [c for c in supported if c.quota_discipline == label]
    else:
        supported = [c for c in supported if c.code in LEGACY_CODES[label]
                     and (c.import_code, c.code) in CATALOGUE_IDENTITIES
                     and c.quota_discipline == LEGACY_CANONICAL_TARGETS[label]]
    return {(person.nation_code or '', c.quota_discipline,
             normalize_gender(person.gender or person.for_gender))
            for c in supported if c.quota_discipline}


def historical_approval_evidence(approval):
    """Read saved version evidence into a transient copy; never rewrite history."""
    import json
    from copy import deepcopy
    from models import ImportSession, ImportSessionVersion, db
    details = json.loads(approval.quota_details_json or '{}')
    if details.get('quotaMembershipVersion') == 1 or details.get('discipline') not in LEGACY_CODES:
        return details
    if not approval.version_id:
        return details
    session = db.session.get(ImportSession, approval.session_id)
    if not session or (session.status not in {'IMPORTED', 'REPLACED', 'ARCHIVED'}
            and (not session.current_version_id or session.current_version_id == approval.version_id)):
        # An editable current preview is not immutable evidence of what was
        # reviewed. Missing decision evidence must remain unresolved here.
        return details
    version = db.session.get(ImportSessionVersion, approval.version_id)
    if not version:
        return details
    people = json.loads(version.preview_json or '{}').get('people', [])
    result = deepcopy(details)
    candidates = result.setdefault('singleRoomCandidates', [])
    for key in json.loads(approval.approved_person_keys_json or '[]'):
        existing = [c for c in candidates if c.get('personKey') == key]
        if len(existing) > 1 or (existing and (existing[0].get('competitionIds') or existing[0].get('competitionImportCodes'))):
            continue
        matches = [p for p in people if p.get('matchKey') == key]
        if len(matches) != 1:
            continue
        evidence = matches[0]
        candidate = existing[0] if existing else {'personKey': key}
        if not existing:
            candidates.append(candidate)
        candidate['competitionIds'] = list(evidence.get('competitionIds') or [])
        candidate['competitionImportCodes'] = list(evidence.get('competitionImportCodes') or [])
    return result


def applicable_approval_groups(approval, person, person_key=None, roster=None):
    """Selected historical person + immutable evidence + exact current membership."""
    import json
    if not approval or approval.decision != 'APPROVED':
        return set()
    selected = {str(value) for value in json.loads(approval.approved_person_keys_json or '[]')}
    if person_key is not None and str(person_key) not in person_keys(person):
        return set()
    keys = {str(person_key)} if person_key is not None else person_keys(person)
    matched = selected & keys
    if len(matched) != 1:
        return set()
    if len(selected) > 1:
        if roster is None:
            from models import Athlete
            roster = Athlete.query.filter_by(nation_code=person.nation_code).all()
        details = historical_approval_evidence(approval)
        for key in selected:
            people = [p for p in roster if key in person_keys(p)]
            if len(people) != 1 or not historical_approval_groups(details, people[0], key):
                return set()
    return historical_approval_groups(historical_approval_evidence(approval),
                                      person, next(iter(matched)))


def approved_quota_disciplines(person):
    """API projection; person-level status alone cannot authorize a group."""
    if person.single_room_status != 'APPROVED_EXTRA' or person.single_room_quota_exempt_reason:
        return []
    return sorted({group[1] for group in applicable_approval_groups(person.single_room_decision, person)})


def preview_approval_person(person):
    """Current DB-resolved preview evidence, never a static catalogue lookup."""
    from types import SimpleNamespace
    from models import Competition
    ids = normalize_competition_ids(person.get('competitionIds') or [])
    competitions = Competition.query.filter(Competition.id.in_(ids)).all() if ids else []
    return SimpleNamespace(nation_code=person.get('nationCode'), gender=person.get('gender'),
        for_gender=person.get('forGender'), fis_code=person.get('fisCode'),
        competitor_id=person.get('competitorId'), lastname=person.get('lastname'),
        firstname=person.get('firstname'), competitions=competitions)
