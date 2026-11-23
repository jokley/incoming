"""Allow NO_DISPO in the existing person accommodation requirement fields."""
from alembic import op

revision = '20261122_01'
down_revision = '20261118_03'
branch_labels = None
depends_on = None


def _replace_constraints(values):
    requirement = op.f('ck_athlete_accommodation_requirement')
    imported = op.f('ck_athlete_accommodation_requirement_import_value')
    with op.batch_alter_table('athlete') as batch:
        batch.drop_constraint(requirement, type_='check')
        batch.drop_constraint(imported, type_='check')
        batch.create_check_constraint(requirement, f'accommodation_requirement IN ({values})')
        batch.create_check_constraint(imported,
            f'accommodation_requirement_import_value IS NULL OR accommodation_requirement_import_value IN ({values})')


def upgrade():
    _replace_constraints("'REQUIRED', 'NO_ROOM', 'NO_DISPO'")


def downgrade():
    _replace_constraints("'REQUIRED', 'NO_ROOM'")
