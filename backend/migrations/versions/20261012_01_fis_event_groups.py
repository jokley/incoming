"""Configure the six FIS Event Groups; preserve identities and immutable history.

Revision ID: 20261012_01
Revises: 20261011_01
"""
from alembic import op
from quota_catalogue import reconcile_quota_catalogue

revision = '20261012_01'
down_revision = '20261011_01'
branch_labels = None
depends_on = None

# Frozen exact (import_code, code) identities; unknown/custom rows stay untouched.
MAPPING = (
    ('WSC_PGS_M_6170', '6170', 'Snowboard Alpine'),
    ('WSC_PGS_W_6172', '6172', 'Snowboard Alpine'),
    ('WSC_HP_M_6174', '6174', 'Snowboard Park & Pipe'),
    ('WSC_HP_W_6175', '6175', 'Snowboard Park & Pipe'),
    ('WSC_PSL_M_6177', '6177', 'Snowboard Alpine'),
    ('WSC_PSL_W_6178', '6178', 'Snowboard Alpine'),
    ('WSC_PRT_A_6180', '6180', 'Snowboard Alpine'),
    ('WSC_BA_M_6182', '6182', 'Snowboard Park & Pipe'),
    ('WSC_BA_W_6183', '6183', 'Snowboard Park & Pipe'),
    ('WSC_SS_M_6188', '6188', 'Snowboard Park & Pipe'),
    ('WSC_SS_W_6190', '6190', 'Snowboard Park & Pipe'),
    ('WSC_SBX_M_6191', '6191', 'Snowboard Cross'),
    ('WSC_SBX_W_6192', '6192', 'Snowboard Cross'),
    ('WSC_BXT_A_6193', '6193', 'Snowboard Cross'),
    ('WSC_HP_M_8171', '8171', 'Freeski Park & Pipe'),
    ('WSC_HP_W_8172', '8172', 'Freeski Park & Pipe'),
    ('WSC_BA_M_8178', '8178', 'Freeski Park & Pipe'),
    ('WSC_MO_M_8179', '8179', 'Freestyle'),
    ('WSC_SX_M_8180', '8180', 'Ski Cross'),
    ('WSC_BA_W_8181', '8181', 'Freeski Park & Pipe'),
    ('WSC_MO_W_8183', '8183', 'Freestyle'),
    ('WSC_SX_W_8184', '8184', 'Ski Cross'),
    ('WSC_SXT_A_8185', '8185', 'Ski Cross'),
    ('WSC_DM_M_8186', '8186', 'Freestyle'),
    ('WSC_DM_W_8187', '8187', 'Freestyle'),
    ('WSC_DMT_A_8188', '8188', 'Freestyle'),
    ('WSC_AE_M_8193', '8193', 'Freestyle'),
    ('WSC_AE_W_8194', '8194', 'Freestyle'),
    ('WSC_AET_A_8195', '8195', 'Freestyle'),
    ('WSC_SS_M_8196', '8196', 'Freeski Park & Pipe'),
    ('WSC_SS_W_8197', '8197', 'Freeski Park & Pipe'),
)


def upgrade():
    reconcile_quota_catalogue(op.get_bind(), MAPPING)


def downgrade():
    # Reverting configured data could overwrite subsequent administrative edits.
    # Historical decisions are immutable in both directions.
    pass
