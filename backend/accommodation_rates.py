"""Person-owned tariff metadata, independent of accommodation/quota rules."""
CATEGORIES = {'STANDARD', 'SPECIAL'}


def rate_projection(person):
    return {'accommodationRateCategory': getattr(person, 'accommodation_rate_category', None) or 'STANDARD',
            'accommodationRateSource': getattr(person, 'accommodation_rate_source', None) or 'DEFAULT'}


def validate_category(value):
    if not isinstance(value, str) or value not in CATEGORIES:
        raise ValueError('accommodationRateCategory must be STANDARD or SPECIAL')
    return value


def resolve_rate(person, override=None):
    from imports.event_context import ImportValidationError
    current = rate_projection(person)
    if override:
        if override['base'] != current:
            raise ImportValidationError('ACCOMMODATION_RATE_STALE',
                'Unterkunftstarif wurde zwischenzeitlich geändert. Bitte Tarif erneut prüfen.')
        return {'accommodationRateCategory': validate_category(override['category']),
                'accommodationRateSource': 'MANUAL'}
    return current


def apply_preview_rates(people, overrides=None):
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    maps = _build_existing_athlete_maps()
    for person in people:
        existing = _find_existing_athlete(person, maps)
        person.update(resolve_rate(existing, (overrides or {}).get(person.get('matchKey'))))


def function_groups(people, assigned_ids=()):
    """Raw Function labels, distinct persisted/source identities per context."""
    groups, seen = {}, set()
    for person in people:
        identity = person.get('personId', person.get('matchKey'))
        if identity in seen:
            continue
        seen.add(identity)
        label = person.get('function')
        groups.setdefault(label, []).append({
            'personId': str(identity), 'name': person.get('name', ''),
            'isAssigned': identity in assigned_ids,
            'accommodationRateCategory': person.get('accommodationRateCategory', 'STANDARD'),
            'accommodationRateSource': person.get('accommodationRateSource', 'DEFAULT')})
    return [{'function': label, 'count': len(members),
             'people': sorted(members, key=lambda p: (p['name'], p['personId']))}
            for label, members in sorted(groups.items(), key=lambda item: item[0] or '')]
