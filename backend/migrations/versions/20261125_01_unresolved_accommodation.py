"""Allow unresolved operative accommodation without changing source values."""
from alembic import op

revision = '20261125_01'
down_revision = '20261124_01'
branch_labels = None
depends_on = None


def _replace_constraint(values):
    name = op.f('ck_athlete_accommodation_requirement')
    with op.batch_alter_table('athlete') as batch:
        batch.drop_constraint(name, type_='check')
        batch.create_check_constraint(name, f'accommodation_requirement IN ({values})')


def upgrade():
    _replace_constraint("'REQUIRED', 'NO_ROOM', 'NO_DISPO', 'UNRESOLVED'")


def downgrade():
    # The old constraint rejects outstanding decisions instead of changing them.
    _replace_constraint("'REQUIRED', 'NO_ROOM', 'NO_DISPO'")
