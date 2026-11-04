"""Person accommodation requirement; legacy reconciliation is explicit, not migration DML."""
from alembic import op
import sqlalchemy as sa
revision = '20261016_02'
down_revision = '20261016_01'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.add_column(sa.Column('accommodation_requirement_import_value', sa.String(10), nullable=True))
        batch.create_check_constraint('accommodation_requirement_import_value', "accommodation_requirement_import_value IS NULL OR accommodation_requirement_import_value IN ('REQUIRED', 'NO_ROOM')")
        batch.add_column(sa.Column('accommodation_requirement', sa.String(10), nullable=False, server_default='REQUIRED'))
        batch.add_column(sa.Column('accommodation_requirement_source', sa.String(10), nullable=False, server_default='DEFAULT'))
        batch.create_check_constraint('accommodation_requirement', "accommodation_requirement IN ('REQUIRED', 'NO_ROOM')")
        batch.create_check_constraint('accommodation_requirement_source', "accommodation_requirement_source IN ('DEFAULT', 'IMPORT', 'MANUAL')")


def downgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.drop_constraint('accommodation_requirement_import_value', type_='check')
        batch.drop_column('accommodation_requirement_import_value')
        batch.drop_constraint('accommodation_requirement_source', type_='check')
        batch.drop_constraint('accommodation_requirement', type_='check')
        batch.drop_column('accommodation_requirement_source')
        batch.drop_column('accommodation_requirement')
