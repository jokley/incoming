"""add competition memberships

Revision ID: 20260922_01
Revises: 20260825_01
"""
from alembic import op
import sqlalchemy as sa

revision = '20260922_01'
down_revision = '20260825_01'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('competition',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('import_code', sa.String(50), nullable=False),
        sa.Column('code', sa.String(30), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('sport', sa.String(80), nullable=False),
        sa.Column('gender', sa.String(10), nullable=False),
        sa.Column('team_competition', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint('import_code', name='uq_competition_import_code'),
        sa.UniqueConstraint('code', name='uq_competition_code'))
    op.create_index('ix_competition_import_code', 'competition', ['import_code'])
    op.create_index('ix_competition_sport', 'competition', ['sport'])
    op.create_table('athlete_competition',
        sa.Column('athlete_id', sa.Integer(), sa.ForeignKey('athlete.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('competition_id', sa.Integer(), sa.ForeignKey('competition.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()))


def downgrade():
    op.drop_table('athlete_competition')
    op.drop_index('ix_competition_sport', table_name='competition')
    op.drop_index('ix_competition_import_code', table_name='competition')
    op.drop_table('competition')
