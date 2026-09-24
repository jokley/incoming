"""Official 2027 FIS World Championships competition catalogue.

Import columns are opaque identifiers. Their meaning is defined only by the
catalogue below; import code fragments must never be parsed or inferred.
"""

from typing import NamedTuple


class CompetitionDefinition(NamedTuple):
    import_code: str
    code: str
    name: str
    sport: str
    gender: str
    team_competition: bool
    display_name: str
    quota_discipline: str


COMPETITIONS = (
    CompetitionDefinition('WSC_PGS_M_6170', '6170', "Men's Parallel Giant Slalom", 'Snowboard', 'M', False, 'Parallel Giant Slalom', 'Parallel'),
    CompetitionDefinition('WSC_PGS_W_6172', '6172', "Women's Parallel Giant Slalom", 'Snowboard', 'W', False, 'Parallel Giant Slalom', 'Parallel'),
    CompetitionDefinition('WSC_HP_M_6174', '6174', "Men's Halfpipe", 'Snowboard', 'M', False, 'Snowboard Halfpipe', 'Snowboard Halfpipe'),
    CompetitionDefinition('WSC_HP_W_6175', '6175', "Women's Halfpipe", 'Snowboard', 'W', False, 'Snowboard Halfpipe', 'Snowboard Halfpipe'),
    CompetitionDefinition('WSC_PSL_M_6177', '6177', "Men's Parallel Slalom", 'Snowboard', 'M', False, 'Parallel Slalom', 'Parallel'),
    CompetitionDefinition('WSC_PSL_W_6178', '6178', "Women's Parallel Slalom", 'Snowboard', 'W', False, 'Parallel Slalom', 'Parallel'),
    CompetitionDefinition('WSC_PRT_A_6180', '6180', 'Mixed Parallel Team', 'Snowboard', 'A', True, 'Parallel Team', 'Parallel'),
    CompetitionDefinition('WSC_BA_M_6182', '6182', "Men's Big Air", 'Snowboard', 'M', False, 'Snowboard Big Air', 'Snowboard Big Air'),
    CompetitionDefinition('WSC_BA_W_6183', '6183', "Women's Big Air", 'Snowboard', 'W', False, 'Snowboard Big Air', 'Snowboard Big Air'),
    CompetitionDefinition('WSC_SS_M_6188', '6188', "Men's Slopestyle", 'Snowboard', 'M', False, 'Snowboard Slopestyle', 'Snowboard Slopestyle'),
    CompetitionDefinition('WSC_SS_W_6190', '6190', "Women's Slopestyle", 'Snowboard', 'W', False, 'Snowboard Slopestyle', 'Snowboard Slopestyle'),
    CompetitionDefinition('WSC_SBX_M_6191', '6191', "Men's Snowboard Cross", 'Snowboard', 'M', False, 'Snowboard Cross', 'Snowboard Cross'),
    CompetitionDefinition('WSC_SBX_W_6192', '6192', "Women's Snowboard Cross", 'Snowboard', 'W', False, 'Snowboard Cross', 'Snowboard Cross'),
    CompetitionDefinition('WSC_BXT_A_6193', '6193', 'Mixed Snowboard Cross Team', 'Snowboard', 'A', True, 'Snowboard Cross Team', 'Snowboard Cross'),
    CompetitionDefinition('WSC_HP_M_8171', '8171', "Men's Freeski Halfpipe", 'Freeski', 'M', False, 'Freeski Halfpipe', 'Freeski Halfpipe'),
    CompetitionDefinition('WSC_HP_W_8172', '8172', "Women's Freeski Halfpipe", 'Freeski', 'W', False, 'Freeski Halfpipe', 'Freeski Halfpipe'),
    CompetitionDefinition('WSC_BA_M_8178', '8178', "Men's Freeski Big Air", 'Freeski', 'M', False, 'Freeski Big Air', 'Freeski Big Air'),
    CompetitionDefinition('WSC_MO_M_8179', '8179', "Men's Moguls", 'Freestyle Ski', 'M', False, 'Moguls', 'Moguls'),
    CompetitionDefinition('WSC_SX_M_8180', '8180', "Men's Ski Cross", 'Freestyle Ski', 'M', False, 'Ski Cross', 'Ski Cross'),
    CompetitionDefinition('WSC_BA_W_8181', '8181', "Women's Freeski Big Air", 'Freeski', 'W', False, 'Freeski Big Air', 'Freeski Big Air'),
    CompetitionDefinition('WSC_MO_W_8183', '8183', "Women's Moguls", 'Freestyle Ski', 'W', False, 'Moguls', 'Moguls'),
    CompetitionDefinition('WSC_SX_W_8184', '8184', "Women's Ski Cross", 'Freestyle Ski', 'W', False, 'Ski Cross', 'Ski Cross'),
    CompetitionDefinition('WSC_SXT_A_8185', '8185', 'Ski Cross Team', 'Freestyle Ski', 'A', True, 'Ski Cross Team', 'Ski Cross'),
    CompetitionDefinition('WSC_DM_M_8186', '8186', "Men's Dual Moguls", 'Freestyle Ski', 'M', False, 'Dual Moguls', 'Moguls'),
    CompetitionDefinition('WSC_DM_W_8187', '8187', "Women's Dual Moguls", 'Freestyle Ski', 'W', False, 'Dual Moguls', 'Moguls'),
    CompetitionDefinition('WSC_DMT_A_8188', '8188', 'Dual Moguls Team', 'Freestyle Ski', 'A', True, 'Dual Moguls Team', 'Moguls'),
    CompetitionDefinition('WSC_AE_M_8193', '8193', "Men's Aerials", 'Freestyle Ski', 'M', False, 'Aerials', 'Aerials'),
    CompetitionDefinition('WSC_AE_W_8194', '8194', "Women's Aerials", 'Freestyle Ski', 'W', False, 'Aerials', 'Aerials'),
    CompetitionDefinition('WSC_AET_A_8195', '8195', 'Aerials Team', 'Freestyle Ski', 'A', True, 'Aerials Team', 'Aerials'),
    CompetitionDefinition('WSC_SS_M_8196', '8196', "Men's Freeski Slopestyle", 'Freeski', 'M', False, 'Freeski Slopestyle', 'Freeski Slopestyle'),
    CompetitionDefinition('WSC_SS_W_8197', '8197', "Women's Freeski Slopestyle", 'Freeski', 'W', False, 'Freeski Slopestyle', 'Freeski Slopestyle'),
)

COMPETITION_BY_IMPORT_CODE = {row.import_code: row for row in COMPETITIONS}
