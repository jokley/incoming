"""Add verified apartment layout and optional bedroom-scoped bookings."""
import sqlalchemy as sa
from alembic import op

revision = '20261124_01'
down_revision = '20261122_01'
branch_labels = None
depends_on = None

# Confirmed catalogue entries only. Do not derive layouts from arbitrary names.
LAYOUTS = (
    ('APP: 1 DZ + DU', 2, 1, 1),
    ('APP: 2 DZ + DU', 2, 2, 1),
    ('APP: 2 DZ + 2 DU', 4, 2, 2),
    ('APP: 3 DZ + DU', 2, 3, 1),
    ('APP: 3 DZ + 2 DU', 4, 3, 2),
    ('APP: 3 DZ + 3 DU', 6, 3, 3),
)


def upgrade():
    import json
    op.add_column('room_type', sa.Column('apartment_layout', sa.JSON()))
    op.add_column('room_booking', sa.Column('bedroom_index', sa.Integer()))
    op.add_column('room_booking', sa.Column('apartment_exception', sa.JSON()))
    table = sa.table('room_type', sa.column('name', sa.String),
                     sa.column('max_persons', sa.Integer), sa.column('apartment_layout', sa.JSON))
    if not op.get_context().as_sql:
        for name, maximum, bedrooms, showers in LAYOUTS:
            op.execute(table.update().where(table.c.name == name, table.c.max_persons == maximum)
                       .values(apartment_layout={'bedrooms': [2] * bedrooms, 'showers': showers}))
    else:
        for name, maximum, bedrooms, showers in LAYOUTS:
            payload = json.dumps({'bedrooms': [2] * bedrooms, 'showers': showers})
            op.execute(sa.text(f"""UPDATE room_type SET apartment_layout = '{payload}'
                               WHERE name = '{name}' AND max_persons = {maximum}"""))


def downgrade():
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM room_booking WHERE bedroom_index IS NOT NULL)
               THEN RAISE EXCEPTION 'Bedroom bookings exist; refusing to discard assignment data'; END IF; END $$""")
    op.drop_column('room_booking', 'apartment_exception')
    op.drop_column('room_booking', 'bedroom_index')
    op.drop_column('room_type', 'apartment_layout')
