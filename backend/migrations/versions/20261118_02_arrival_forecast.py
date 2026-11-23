"""Independent operative athlete totals; no FIS person or reservation changes."""
from alembic import op
import sqlalchemy as sa
revision='20261118_02'
down_revision='20261118_01'
branch_labels=None
depends_on=None


def upgrade():
    op.create_table('athlete_arrival_forecast',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('event_id',sa.Integer(),sa.ForeignKey('championship_event.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('nation_code',sa.String(10),nullable=False),
        sa.Column('discipline',sa.String(100),nullable=False),
        sa.Column('gender',sa.String(1),nullable=False),
        sa.Column('expected_total',sa.Integer()),
        sa.Column('check_in_date',sa.Date()),sa.Column('check_out_date',sa.Date()),sa.Column('note',sa.Text()),
        sa.Column('revision',sa.Integer(),server_default='1',nullable=False),
        sa.Column('roster_digest',sa.String(64),nullable=False),
        sa.Column('updated_by',sa.String(100),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False),
        sa.UniqueConstraint('event_id','nation_code','discipline','gender',name='uq_arrival_forecast_area'),
        sa.CheckConstraint('expected_total IS NULL OR expected_total >= 0',name='arrival_forecast_total'),
        sa.CheckConstraint("gender IN ('M','W')",name='arrival_forecast_gender'),
        sa.CheckConstraint('(check_in_date IS NULL AND check_out_date IS NULL) OR (check_in_date IS NOT NULL AND check_out_date IS NOT NULL AND check_in_date < check_out_date)',name='arrival_forecast_dates'))
    op.create_index('ix_athlete_arrival_forecast_event_id','athlete_arrival_forecast',['event_id'])


def downgrade():
    op.drop_table('athlete_arrival_forecast')
