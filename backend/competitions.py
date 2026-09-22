"""Official FIS competition catalogue.

Import columns are opaque identifiers.  Their meaning must only be obtained
from this table; no parser may derive sport, discipline or gender from a code.
"""

COMPETITIONS = (
    ('WSC_HP_W_6175', 'HP-W', "Women's Halfpipe", 'Snowboard', 'W', False),
    ('WSC_HP_M_6174', 'HP-M', "Men's Halfpipe", 'Snowboard', 'M', False),
    ('WSC_PSL_W_6178', 'PSL-W', "Women's Parallel Slalom", 'Snowboard', 'W', False),
    ('WSC_PSL_M_6177', 'PSL-M', "Men's Parallel Slalom", 'Snowboard', 'M', False),
    ('WSC_PRT_A_6180', 'PRT-X', 'Mixed Parallel Team', 'Snowboard', 'A', True),
    ('WSC_BA_W_6183', 'BA-W', "Women's Big Air", 'Snowboard', 'W', False),
    ('WSC_BA_M_6182', 'BA-M', "Men's Big Air", 'Snowboard', 'M', False),
    ('WSC_SS_W_6190', 'SS-W', "Women's Slopestyle", 'Snowboard', 'W', False),
    ('WSC_SS_M_6188', 'SS-M', "Men's Slopestyle", 'Snowboard', 'M', False),
    ('WSC_SBX_W_6192', 'SBX-W', "Women's Snowboard Cross", 'Snowboard', 'W', False),
    ('WSC_SBX_M_6191', 'SBX-M', "Men's Snowboard Cross", 'Snowboard', 'M', False),
    ('WSC_BXT_A_6193', 'BXT-X', 'Mixed Snowboard Cross Team', 'Snowboard', 'A', True),
    ('WSC_PGS_W_6172', 'PGS-W', "Women's Parallel Giant Slalom", 'Snowboard', 'W', False),
    ('WSC_PGS_M_6170', 'PGS-M', "Men's Parallel Giant Slalom", 'Snowboard', 'M', False),
    ('WSC_AE_W_8234', 'AE-W', "Women's Aerials", 'Freestyle Ski', 'W', False),
    ('WSC_AE_M_8233', 'AE-M', "Men's Aerials", 'Freestyle Ski', 'M', False),
    ('WSC_AET_A_8226', 'AET-X', 'Mixed Aerials Team', 'Freestyle Ski', 'A', True),
    ('WSC_MO_W_8213', 'MO-W', "Women's Moguls", 'Freestyle Ski', 'W', False),
    ('WSC_MO_M_8212', 'MO-M', "Men's Moguls", 'Freestyle Ski', 'M', False),
    ('WSC_DM_W_8218', 'DM-W', "Women's Dual Moguls", 'Freestyle Ski', 'W', False),
    ('WSC_DM_M_8217', 'DM-M', "Men's Dual Moguls", 'Freestyle Ski', 'M', False),
)

COMPETITION_BY_IMPORT_CODE = {row[0]: row for row in COMPETITIONS}

