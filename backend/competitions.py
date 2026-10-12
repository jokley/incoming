"""Official 2027 FIS World Championships competition catalogue.

Import columns are opaque identifiers. Their meaning is defined only by the
catalogue below; import code fragments must never be parsed or inferred.
"""

from typing import NamedTuple


def normalize_competition_ids(values):
    """JSON IDs are strings; PostgreSQL integer identities need typed parameters."""
    try:
        if any(isinstance(v, bool) or not str(v).isascii() or not str(v).isdigit() or int(v) <= 0 for v in values):
            return []
        return sorted({int(v) for v in values})
    except (TypeError, ValueError):
        return []


def quota_disciplines(competitions):
    """Distinct configured groups from exact Competition memberships, for every role."""
    return sorted({item.quota_discipline for item in competitions if item.quota_discipline})


def resolve_quota_memberships(person, competition_mapping):
    """Replace derived fields from exact event-mapped import identifiers.

    The legacy API name topLevelDisciplines remains an alias, never a second
    grouping concept. Missing membership produces no operative group.
    """
    codes = person.get('competitionImportCodes') or []
    unknown = set(codes) - set(competition_mapping)
    if unknown:
        raise ValueError(f'Unmapped Competition identities: {sorted(unknown)}')
    groups = quota_disciplines(competition_mapping[code] for code in codes)
    person['competitionIds'] = sorted({str(item.id) for code in codes
        if (item := competition_mapping[code]) is not None and getattr(item, 'id', None) is not None})
    person['competitionMemberships'] = [
        {'competitionId': str(item.id) if getattr(item, 'id', None) is not None else None,
         'importCode': code, 'quotaDiscipline': item.quota_discipline}
        for code in codes for item in [competition_mapping[code]]]
    person['quotaDisciplines'] = groups
    person['topLevelDisciplines'] = list(groups)
    return person


def top_level_discipline(code: str | None) -> str | None:
    """Compatibility lookup for catalogue callers; no numeric-prefix inference."""
    return next((item.quota_discipline for item in COMPETITIONS if item.code == code), None)


class CompetitionDefinition(NamedTuple):
    import_code: str
    code: str
    name: str
    sport: str
    gender: str
    team_competition: bool
    display_name: str
    quota_discipline: str

    @property
    def top_level_discipline(self):
        return self.quota_discipline


COMPETITIONS = (
    CompetitionDefinition('WSC_PGS_M_6170', '6170', "Men's Parallel Giant Slalom", 'Snowboard', 'M', False, 'Parallel Giant Slalom', 'Snowboard'),
    CompetitionDefinition('WSC_PGS_W_6172', '6172', "Women's Parallel Giant Slalom", 'Snowboard', 'W', False, 'Parallel Giant Slalom', 'Snowboard'),
    CompetitionDefinition('WSC_HP_M_6174', '6174', "Men's Halfpipe", 'Snowboard', 'M', False, 'Snowboard Halfpipe', 'Snowboard'),
    CompetitionDefinition('WSC_HP_W_6175', '6175', "Women's Halfpipe", 'Snowboard', 'W', False, 'Snowboard Halfpipe', 'Snowboard'),
    CompetitionDefinition('WSC_PSL_M_6177', '6177', "Men's Parallel Slalom", 'Snowboard', 'M', False, 'Parallel Slalom', 'Snowboard'),
    CompetitionDefinition('WSC_PSL_W_6178', '6178', "Women's Parallel Slalom", 'Snowboard', 'W', False, 'Parallel Slalom', 'Snowboard'),
    CompetitionDefinition('WSC_PRT_A_6180', '6180', 'Mixed Parallel Team', 'Snowboard', 'A', True, 'Parallel Team', 'Snowboard'),
    CompetitionDefinition('WSC_BA_M_6182', '6182', "Men's Big Air", 'Snowboard', 'M', False, 'Snowboard Big Air', 'Snowboard'),
    CompetitionDefinition('WSC_BA_W_6183', '6183', "Women's Big Air", 'Snowboard', 'W', False, 'Snowboard Big Air', 'Snowboard'),
    CompetitionDefinition('WSC_SS_M_6188', '6188', "Men's Slopestyle", 'Snowboard', 'M', False, 'Snowboard Slopestyle', 'Snowboard'),
    CompetitionDefinition('WSC_SS_W_6190', '6190', "Women's Slopestyle", 'Snowboard', 'W', False, 'Snowboard Slopestyle', 'Snowboard'),
    CompetitionDefinition('WSC_SBX_M_6191', '6191', "Men's Snowboard Cross", 'Snowboard', 'M', False, 'Snowboard Cross', 'Snowboard'),
    CompetitionDefinition('WSC_SBX_W_6192', '6192', "Women's Snowboard Cross", 'Snowboard', 'W', False, 'Snowboard Cross', 'Snowboard'),
    CompetitionDefinition('WSC_BXT_A_6193', '6193', 'Mixed Snowboard Cross Team', 'Snowboard', 'A', True, 'Snowboard Cross Team', 'Snowboard'),
    CompetitionDefinition('WSC_HP_M_8171', '8171', "Men's Freeski Halfpipe", 'Freeski', 'M', False, 'Freeski Halfpipe', 'Freestyle'),
    CompetitionDefinition('WSC_HP_W_8172', '8172', "Women's Freeski Halfpipe", 'Freeski', 'W', False, 'Freeski Halfpipe', 'Freestyle'),
    CompetitionDefinition('WSC_BA_M_8178', '8178', "Men's Freeski Big Air", 'Freeski', 'M', False, 'Freeski Big Air', 'Freestyle'),
    CompetitionDefinition('WSC_MO_M_8179', '8179', "Men's Moguls", 'Freestyle Ski', 'M', False, 'Moguls', 'Freestyle'),
    CompetitionDefinition('WSC_SX_M_8180', '8180', "Men's Ski Cross", 'Freestyle Ski', 'M', False, 'Ski Cross', 'Freestyle'),
    CompetitionDefinition('WSC_BA_W_8181', '8181', "Women's Freeski Big Air", 'Freeski', 'W', False, 'Freeski Big Air', 'Freestyle'),
    CompetitionDefinition('WSC_MO_W_8183', '8183', "Women's Moguls", 'Freestyle Ski', 'W', False, 'Moguls', 'Freestyle'),
    CompetitionDefinition('WSC_SX_W_8184', '8184', "Women's Ski Cross", 'Freestyle Ski', 'W', False, 'Ski Cross', 'Freestyle'),
    CompetitionDefinition('WSC_SXT_A_8185', '8185', 'Ski Cross Team', 'Freestyle Ski', 'A', True, 'Ski Cross Team', 'Freestyle'),
    CompetitionDefinition('WSC_DM_M_8186', '8186', "Men's Dual Moguls", 'Freestyle Ski', 'M', False, 'Dual Moguls', 'Freestyle'),
    CompetitionDefinition('WSC_DM_W_8187', '8187', "Women's Dual Moguls", 'Freestyle Ski', 'W', False, 'Dual Moguls', 'Freestyle'),
    CompetitionDefinition('WSC_DMT_A_8188', '8188', 'Dual Moguls Team', 'Freestyle Ski', 'A', True, 'Dual Moguls Team', 'Freestyle'),
    CompetitionDefinition('WSC_AE_M_8193', '8193', "Men's Aerials", 'Freestyle Ski', 'M', False, 'Aerials', 'Freestyle'),
    CompetitionDefinition('WSC_AE_W_8194', '8194', "Women's Aerials", 'Freestyle Ski', 'W', False, 'Aerials', 'Freestyle'),
    CompetitionDefinition('WSC_AET_A_8195', '8195', 'Aerials Team', 'Freestyle Ski', 'A', True, 'Aerials Team', 'Freestyle'),
    CompetitionDefinition('WSC_SS_M_8196', '8196', "Men's Freeski Slopestyle", 'Freeski', 'M', False, 'Freeski Slopestyle', 'Freestyle'),
    CompetitionDefinition('WSC_SS_W_8197', '8197', "Women's Freeski Slopestyle", 'Freeski', 'W', False, 'Freeski Slopestyle', 'Freestyle'),
)

COMPETITION_BY_IMPORT_CODE = {row.import_code: row for row in COMPETITIONS}
