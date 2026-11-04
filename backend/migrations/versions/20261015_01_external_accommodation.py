"""Hotel classification and optional room type for external stays."""
from alembic import op
import sqlalchemy as sa
revision = '20261015_01'
down_revision = '20261014_01'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table('hotel') as batch:
        batch.add_column(sa.Column('accommodation_type', sa.String(10), nullable=False, server_default='STANDARD'))
        batch.create_check_constraint('hotel_accommodation_type', "accommodation_type IN ('STANDARD', 'EXTERNAL')")
    with op.batch_alter_table('room_booking') as batch:
        batch.alter_column('room_type_id', existing_type=sa.Integer(), nullable=True)

def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text('SELECT COUNT(*) FROM room_booking WHERE room_type_id IS NULL')).scalar():
        raise RuntimeError('External bookings without room types must be removed or converted before downgrade.')
    if connection.execute(sa.text("SELECT COUNT(*) FROM hotel WHERE accommodation_type = 'EXTERNAL'")).scalar():
        raise RuntimeError('External hotels must be explicitly converted before downgrade.')
    with op.batch_alter_table('room_booking') as batch:
        batch.alter_column('room_type_id', existing_type=sa.Integer(), nullable=False)
    with op.batch_alter_table('hotel') as batch:
        batch.drop_constraint('hotel_accommodation_type', type_='check')
        batch.drop_column('accommodation_type')
