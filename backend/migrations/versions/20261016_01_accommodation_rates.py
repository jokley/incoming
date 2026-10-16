"""Person-owned accommodation tariff and provenance."""
from alembic import op
import sqlalchemy as sa
revision = '20261016_01'
down_revision = '20261015_01'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.add_column(sa.Column('accommodation_rate_category', sa.String(10), nullable=False, server_default='STANDARD'))
        batch.add_column(sa.Column('accommodation_rate_source', sa.String(10), nullable=False, server_default='DEFAULT'))
        batch.create_check_constraint('accommodation_rate_category', "accommodation_rate_category IN ('STANDARD', 'SPECIAL')")
        batch.create_check_constraint('accommodation_rate_source', "accommodation_rate_source IN ('DEFAULT', 'MANUAL')")


def downgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.drop_constraint('accommodation_rate_source', type_='check')
        batch.drop_constraint('accommodation_rate_category', type_='check')
        batch.drop_column('accommodation_rate_source')
        batch.drop_column('accommodation_rate_category')
