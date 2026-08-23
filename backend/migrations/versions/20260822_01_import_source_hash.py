"""add import source fingerprint

Revision ID: 20260822_01
Revises: 20260818_03
"""
from alembic import op
import sqlalchemy as sa

revision = '20260822_01'
down_revision = '20260818_03'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('import_session_version', sa.Column('source_hash', sa.String(length=64), nullable=True))
    op.create_index('ix_import_session_version_source_hash', 'import_session_version', ['source_hash'])


def downgrade():
    op.drop_index('ix_import_session_version_source_hash', table_name='import_session_version')
    op.drop_column('import_session_version', 'source_hash')
