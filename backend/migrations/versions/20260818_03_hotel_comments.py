"""Add hotel master-data comments.

Revision ID: 20260818_03
Revises: 20260818_02
"""
from alembic import op
import sqlalchemy as sa

revision = '20260818_03'
down_revision = '20260818_02'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('hotel', sa.Column('comment', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('hotel', 'comment')
