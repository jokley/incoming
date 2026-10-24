"""Add draft event rules, without binding or modifying any existing data.

Revision ID: 20261023_01
Revises: 20261022_01
"""
from alembic import op
import sqlalchemy as sa
revision = '20261023_01'
down_revision = '20261022_01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('championship_event', sa.Column('is_world_championship',sa.Boolean(),nullable=False,server_default=sa.false()))
    op.add_column('championship_event', sa.Column('quota_rules_json',sa.Text()))
    op.add_column('championship_event', sa.Column('quota_rules_revision',sa.Integer(),nullable=False,server_default='0'))
    op.add_column('championship_event', sa.Column('quota_rules_fixed_at',sa.DateTime()))
    op.add_column('championship_event', sa.Column('quota_rules_fixed_by',sa.String(100)))


def downgrade():
    # Do not silently discard binding policy/evidence on downgrade.
    connection=op.get_bind()
    if connection.execute(sa.text('SELECT count(*) FROM championship_event WHERE quota_rules_fixed_at IS NOT NULL')).scalar():
        raise RuntimeError('Fixed quota rules exist; downgrade requires a reviewed recovery procedure.')
    for name in ('quota_rules_fixed_by','quota_rules_fixed_at','quota_rules_revision','quota_rules_json','is_world_championship'):
        op.drop_column('championship_event', name)
