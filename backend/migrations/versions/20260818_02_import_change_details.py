"""Persist decision-relevant import change details.

Revision ID: 20260818_02
Revises: 20260818_01
"""
from alembic import op
import sqlalchemy as sa

revision = '20260818_02'
down_revision = '20260818_01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('athlete', sa.Column('import_change_details_json', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('athlete', 'import_change_details_json')
