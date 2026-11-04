"""Add optional whole-edition selection; no grants or existing data changes."""
from alembic import op
import sqlalchemy as sa
revision = '20261025_02'
down_revision = '20261025_01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('championship_event', sa.Column('world_champion_list_json', sa.Text(), nullable=True))


def downgrade():
    if op.get_bind().execute(sa.text('SELECT count(*) FROM championship_event WHERE world_champion_list_json IS NOT NULL')).scalar():
        raise RuntimeError('Retain recorded list selections during application rollback.')
    op.drop_column('championship_event','world_champion_list_json')
