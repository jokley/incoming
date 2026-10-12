"""Configure canonical 2027 quota groups without changing Competition identity.

Revision ID: 20261011_01
Revises: 20261001_01
"""
from alembic import op
from quota_catalogue import reconcile_quota_catalogue

revision = '20261011_01'
down_revision = '20261001_01'
branch_labels = None
depends_on = None

# Frozen exact catalogue identities. Unknown rows are intentionally untouched.
MAPPING = (
    ('WSC_PGS_M_6170', '6170', 'Snowboard'),
    ('WSC_PGS_W_6172', '6172', 'Snowboard'),
    ('WSC_HP_M_6174', '6174', 'Snowboard'),
    ('WSC_HP_W_6175', '6175', 'Snowboard'),
    ('WSC_PSL_M_6177', '6177', 'Snowboard'),
    ('WSC_PSL_W_6178', '6178', 'Snowboard'),
    ('WSC_PRT_A_6180', '6180', 'Snowboard'),
    ('WSC_BA_M_6182', '6182', 'Snowboard'),
    ('WSC_BA_W_6183', '6183', 'Snowboard'),
    ('WSC_SS_M_6188', '6188', 'Snowboard'),
    ('WSC_SS_W_6190', '6190', 'Snowboard'),
    ('WSC_SBX_M_6191', '6191', 'Snowboard'),
    ('WSC_SBX_W_6192', '6192', 'Snowboard'),
    ('WSC_BXT_A_6193', '6193', 'Snowboard'),
    ('WSC_HP_M_8171', '8171', 'Freestyle'),
    ('WSC_HP_W_8172', '8172', 'Freestyle'),
    ('WSC_BA_M_8178', '8178', 'Freestyle'),
    ('WSC_MO_M_8179', '8179', 'Freestyle'),
    ('WSC_SX_M_8180', '8180', 'Freestyle'),
    ('WSC_BA_W_8181', '8181', 'Freestyle'),
    ('WSC_MO_W_8183', '8183', 'Freestyle'),
    ('WSC_SX_W_8184', '8184', 'Freestyle'),
    ('WSC_SXT_A_8185', '8185', 'Freestyle'),
    ('WSC_DM_M_8186', '8186', 'Freestyle'),
    ('WSC_DM_W_8187', '8187', 'Freestyle'),
    ('WSC_DMT_A_8188', '8188', 'Freestyle'),
    ('WSC_AE_M_8193', '8193', 'Freestyle'),
    ('WSC_AE_W_8194', '8194', 'Freestyle'),
    ('WSC_AET_A_8195', '8195', 'Freestyle'),
    ('WSC_SS_M_8196', '8196', 'Freestyle'),
    ('WSC_SS_W_8197', '8197', 'Freestyle'),
)


def upgrade():
    reconcile_quota_catalogue(op.get_bind(), MAPPING)


def downgrade():
    # A data configuration cannot safely be reverted after later administrative
    # mapping edits. Historical approvals are never rewritten in either direction.
    pass
