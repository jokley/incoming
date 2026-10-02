"""add person-level single-room quota exemption

Revision ID: 20261001_01
Revises: 20260924_03
Create Date: 2026-10-01
"""

from alembic import op
import sqlalchemy as sa


revision = '20261001_01'
down_revision = '20260924_03'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('athlete', sa.Column(
        'single_room_quota_exempt_reason', sa.String(length=30), nullable=True))
    op.create_check_constraint(
        'ck_athlete_single_room_quota_exempt_reason', 'athlete',
        "single_room_quota_exempt_reason IS NULL OR "
        "single_room_quota_exempt_reason IN ('WORLD_CHAMPION', 'OTHER')")


def downgrade():
    op.drop_constraint(
        'ck_athlete_single_room_quota_exempt_reason', 'athlete', type_='check')
    op.drop_column('athlete', 'single_room_quota_exempt_reason')
