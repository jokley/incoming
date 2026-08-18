"""Add hotel contact details and inventory comments.

Revision ID: 20260818_01
Revises: 20260815_01
"""
from alembic import op
import sqlalchemy as sa

revision = '20260818_01'
down_revision = '20260815_01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('hotel', sa.Column('contact_person', sa.String(150), nullable=True))
    op.add_column('hotel', sa.Column('email', sa.String(254), nullable=True))
    op.add_column('hotel', sa.Column('phone', sa.String(50), nullable=True))
    op.add_column('hotel_room_inventory', sa.Column('comment', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('hotel_room_inventory', 'comment')
    op.drop_column('hotel', 'phone')
    op.drop_column('hotel', 'email')
    op.drop_column('hotel', 'contact_person')
