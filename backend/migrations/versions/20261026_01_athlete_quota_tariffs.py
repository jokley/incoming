"""Allow explicit approval-owned tariffs; preserve all existing values."""
from alembic import op
import sqlalchemy as sa
revision = '20261026_01'
down_revision = '20261025_02'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.add_column(sa.Column('accommodation_rate_approval_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_athlete_rate_approval', 'import_approval', ['accommodation_rate_approval_id'], ['id'])
        batch.create_index('ix_athlete_accommodation_rate_approval_id', ['accommodation_rate_approval_id'])
        batch.drop_constraint('accommodation_rate_source', type_='check')
        batch.create_check_constraint('accommodation_rate_source', "accommodation_rate_source IN ('DEFAULT', 'MANUAL', 'APPROVAL')")


def downgrade():
    # Dropping provenance would destroy traceability. Require an explicit recovery
    # plan if the new source has actually been used.
    if op.get_bind().execute(sa.text("SELECT count(*) FROM athlete WHERE accommodation_rate_source='APPROVAL' OR accommodation_rate_approval_id IS NOT NULL")).scalar():
        raise RuntimeError('Approval-owned tariffs exist; refusing destructive downgrade.')
    with op.batch_alter_table('athlete') as batch:
        batch.drop_constraint('accommodation_rate_source', type_='check')
        batch.create_check_constraint('accommodation_rate_source', "accommodation_rate_source IN ('DEFAULT', 'MANUAL')")
        batch.drop_index('ix_athlete_accommodation_rate_approval_id')
        batch.drop_constraint('fk_athlete_rate_approval', type_='foreignkey')
        batch.drop_column('accommodation_rate_approval_id')
