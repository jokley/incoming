"""Optional event-owned competition link to the existing planning calendar."""
from alembic import op
import sqlalchemy as sa
revision = '20261028_01'
down_revision = '20261026_01'
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint('uq_accommodation_event_owner_identity','event',['id','championship_event_id'])
    op.add_column('event_competition',sa.Column('accommodation_event_id',sa.Integer(),nullable=True))
    op.create_index('ix_event_competition_accommodation_event_id','event_competition',['accommodation_event_id'])
    op.create_foreign_key('fk_event_competition_accommodation_period','event_competition','event',
        ['accommodation_event_id','event_id'],['id','championship_event_id'],ondelete='RESTRICT')


def downgrade():
    if op.get_bind().execute(sa.text('SELECT count(*) FROM event_competition WHERE accommodation_event_id IS NOT NULL')).scalar():
        raise RuntimeError('Planning period links exist; refusing destructive downgrade.')
    op.drop_constraint('fk_event_competition_accommodation_period','event_competition',type_='foreignkey')
    op.drop_index('ix_event_competition_accommodation_event_id',table_name='event_competition')
    op.drop_column('event_competition','accommodation_event_id')
    op.drop_constraint('uq_accommodation_event_owner_identity','event',type_='unique')
