"""Remove unused individual arrival decisions, refusing to discard manual data."""
from alembic import op, context
import sqlalchemy as sa
revision='20261118_03'
down_revision='20261118_02'
branch_labels=None
depends_on=None


def upgrade():
    offline=op.get_context().as_sql
    bind=op.get_bind()
    postgres=bind.dialect.name=='postgresql'
    if postgres:
        op.execute('LOCK TABLE athlete IN ACCESS EXCLUSIVE MODE')
        op.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM athlete WHERE arrival_status IS NOT NULL) THEN RAISE EXCEPTION 'Manual arrival statuses exist; export and explicitly resolve before migration'; END IF; END $$")
    elif not offline and bind.scalar(sa.text('SELECT count(*) FROM athlete WHERE arrival_status IS NOT NULL')):
        raise RuntimeError('Manual arrival statuses exist; export and explicitly resolve before migration')
    name='ck_athlete_arrival_status'
    if not offline:
        names=[c['name'] for c in sa.inspect(bind).get_check_constraints('athlete') if c['name'] in {'arrival_status','ck_athlete_arrival_status'}]
        if len(names)!=1:raise RuntimeError('Expected arrival-status CHECK missing or ambiguous; migration stopped')
        name=names[0]
    with op.batch_alter_table('athlete') as batch:
        batch.drop_constraint(op.f(name),type_='check')
        batch.drop_column('arrival_status')


def downgrade():
    with op.batch_alter_table('athlete') as batch:
        batch.add_column(sa.Column('arrival_status',sa.String(20),nullable=True))
        batch.create_check_constraint('arrival_status',"arrival_status IS NULL OR arrival_status IN ('UNDECIDED','EXPECTED','CONFIRMED','NOT_TRAVELLING')")
