"""Explicit event ownership; preflight/plan required for lossless legacy backfill."""
import json
import os
from pathlib import Path
from alembic import context, op
import sqlalchemy as sa
from event_ownership import OWNER_COLUMNS, REQUIRED_OWNERS, assignment_plan, compare, inventory, OwnershipError

revision = '20261022_01'
down_revision = '20261016_02'
branch_labels = None
depends_on = None


def upgrade():
    if context.is_offline_mode():
        raise OwnershipError('Event ownership requires online read-only preflight and an explicit plan; offline SQL is unsafe')
    connection = op.get_bind()
    if connection.dialect.name != 'postgresql':
        raise OwnershipError('Ownership migration requires PostgreSQL transactional DDL')
    # No autocommit/CONCURRENTLY: validation, DDL and backfill share Alembic's transaction.
    connection.execute(sa.text('LOCK TABLE ' + ', '.join('"'+name+'"' for name in (
        'championship_event', *OWNER_COLUMNS, 'room_booking_occupant', 'import_session_version',
        'import_approval', 'athlete_competition', 'event_room_demand', 'room_assignment',
        'fis_room_assignment', 'import_session_event', 'event_competition', 'world_champion',
        'hotel', 'room_type', 'audit_event')) + ' IN SHARE ROW EXCLUSIVE MODE'))
    filename = context.get_x_argument(as_dictionary=True).get('ownership_plan') or os.environ.get('EVENT_OWNERSHIP_PLAN')
    if not filename:
        raise OwnershipError('Supply -x ownership_plan=/reviewed/plan.json or EVENT_OWNERSHIP_PLAN; no default event is assumed')
    config = json.loads(Path(filename).read_text())
    before = inventory(connection)
    plan = assignment_plan(before, config)
    for table, column in OWNER_COLUMNS.items():
        op.add_column(table, sa.Column(column, sa.Integer(), nullable=True))
        op.create_foreign_key(f'fk_{table}_{column}_championship_event', table,
                              'championship_event', [column], ['id'], ondelete='RESTRICT')
        op.create_index(f'ix_{table}_{column}', table, [column])
        target = sa.table(table, sa.column('id', sa.Integer), sa.column(column, sa.Integer))
        for identity, owner in plan[table].items():
            if owner is not None:
                connection.execute(target.update().where(target.c.id == identity).values({column: owner}))
        if table in REQUIRED_OWNERS:
            op.alter_column(table, column, existing_type=sa.Integer(), nullable=False)
    inspector = sa.inspect(connection)
    constraints = [c for c in inspector.get_unique_constraints('import_session') if c['column_names'] == ['nation']]
    indexes = [i for i in inspector.get_indexes('import_session')
               if i['column_names'] == ['nation'] and i['unique'] and not i.get('duplicates_constraint')]
    if len(constraints) + len(indexes) != 1:
        raise OwnershipError('Expected exactly one legacy nation uniqueness definition')
    if constraints:
        op.drop_constraint(op.f(constraints[0]['name']), 'import_session', type_='unique')
    else:
        op.drop_index(op.f(indexes[0]['name']), table_name='import_session')
        op.create_index('ix_import_session_nation', 'import_session', ['nation'])
    op.create_unique_constraint('uq_import_session_event_nation', 'import_session', ['event_id', 'nation'])
    compare(before, inventory(connection))


def downgrade():
    # Returning to global identity/session semantics can silently mix different events.
    raise OwnershipError('No automatic downgrade: restore the reviewed pre-deployment backup instead')
