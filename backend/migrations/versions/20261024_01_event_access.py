"""Explicit event grants; no implicit grants or changes to existing event data."""
from alembic import op
import sqlalchemy as sa

revision = '20261024_01'
down_revision = '20261023_01'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('event_access',
        sa.Column('username', sa.String(100), primary_key=True),
        sa.Column('event_id', sa.Integer(), sa.ForeignKey('championship_event.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('can_write', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_table('event_access')
