"""Add explicit ownership markers for disposable simulation data.

Revision ID: 20260824_01
Revises: 20260822_01
"""
from alembic import op
import sqlalchemy as sa

revision = '20260824_01'
down_revision = '20260822_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('athlete', sa.Column('created_by', sa.String(50), nullable=True))
    op.create_index('ix_athlete_created_by', 'athlete', ['created_by'])
    op.add_column('room_booking', sa.Column('created_by', sa.String(50), nullable=True))
    op.create_index('ix_room_booking_created_by', 'room_booking', ['created_by'])


def downgrade() -> None:
    op.drop_index('ix_room_booking_created_by', table_name='room_booking')
    op.drop_column('room_booking', 'created_by')
    op.drop_index('ix_athlete_created_by', table_name='athlete')
    op.drop_column('athlete', 'created_by')
