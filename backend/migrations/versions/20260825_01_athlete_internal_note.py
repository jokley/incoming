"""separate athlete import remarks from internal notes

Revision ID: 20260825_01
Revises: 20260824_01
Create Date: 2026-08-25
"""

from alembic import op
import sqlalchemy as sa


revision = '20260825_01'
down_revision = '20260824_01'
branch_labels = None
depends_on = None


def upgrade():
    # Nullable by design: existing FIS Additional Items remain untouched and
    # no imported text is reclassified as an internal operational note.
    op.add_column('athlete', sa.Column('internal_note', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('athlete', 'internal_note')
