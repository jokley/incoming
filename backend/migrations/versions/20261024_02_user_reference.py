"""Optional known-user directory; no grants, role or operational data backfill."""
from alembic import op
import sqlalchemy as sa

revision = '20261024_02'
down_revision = '20261024_01'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('user_reference',
        sa.Column('username', sa.String(100), primary_key=True),
        sa.Column('display_name', sa.String(200)),
        sa.Column('groups_json', sa.Text()),
        sa.Column('last_seen_at', sa.DateTime()))


def downgrade():
    # Keep references rather than silently discarding administration history.
    if op.get_bind().execute(sa.text('SELECT count(*) FROM user_reference')).scalar():
        raise RuntimeError('Known user references exist; keep the additive schema during code rollback.')
    op.drop_table('user_reference')
