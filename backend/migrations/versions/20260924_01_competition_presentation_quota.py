"""add competition display and quota metadata

Revision ID: 20260924_01
Revises: 20260922_01
"""
from alembic import op
import sqlalchemy as sa

revision = '20260924_01'
down_revision = '20260922_01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('competition', sa.Column('display_name', sa.String(120), nullable=True))
    op.add_column('competition', sa.Column('quota_discipline', sa.String(120), nullable=True))
    op.execute('UPDATE competition SET display_name = name, quota_discipline = name')
    op.alter_column('competition', 'display_name', nullable=False)
    op.alter_column('competition', 'quota_discipline', nullable=False)
    op.create_index('ix_competition_quota_discipline', 'competition', ['quota_discipline'])


def downgrade():
    op.drop_index('ix_competition_quota_discipline', table_name='competition')
    op.drop_column('competition', 'quota_discipline')
    op.drop_column('competition', 'display_name')
