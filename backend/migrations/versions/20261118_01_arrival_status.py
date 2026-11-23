"""Optional operative arrival decision, independent of imported participation."""
from alembic import op
import sqlalchemy as sa

revision = '20261118_01'
down_revision = '20261028_01'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.add_column(sa.Column('arrival_status', sa.String(20), nullable=True))
        batch.create_check_constraint('arrival_status', "arrival_status IS NULL OR arrival_status IN ('UNDECIDED', 'EXPECTED', 'CONFIRMED', 'NOT_TRAVELLING')")


def downgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.drop_constraint('arrival_status', type_='check')
        batch.drop_column('arrival_status')
