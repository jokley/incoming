"""introduce championship events and event competition mappings

Revision ID: 20260924_02
Revises: 20260924_01
"""
from alembic import op
import sqlalchemy as sa

revision = '20260924_02'
down_revision = '20260924_01'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('championship_event',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(160), nullable=False),
        sa.Column('year', sa.Integer()),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('fis_event_id', sa.String(50)),
        sa.Column('sector_code', sa.String(50)),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('name', name='uq_championship_event_name'))
    op.create_table('event_competition',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('event_id', sa.Integer(), sa.ForeignKey('championship_event.id', ondelete='CASCADE'), nullable=False),
        sa.Column('competition_id', sa.Integer(), sa.ForeignKey('competition.id', ondelete='CASCADE'), nullable=False),
        sa.Column('fis_codex', sa.String(30), nullable=False),
        sa.Column('import_code', sa.String(50), nullable=False),
        sa.Column('official_name', sa.String(120), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint('event_id', 'competition_id', name='uq_event_competition_competition'),
        sa.UniqueConstraint('event_id', 'import_code', name='uq_event_competition_import_code'))
    op.create_index('ix_event_competition_event_id', 'event_competition', ['event_id'])
    op.create_index('ix_event_competition_competition_id', 'event_competition', ['competition_id'])
    event_id = op.get_bind().execute(sa.text("""
        INSERT INTO championship_event (name, year, active)
        VALUES ('WSC Montafon 2027', 2027, true) RETURNING id
    """)).scalar_one()
    op.get_bind().execute(sa.text("""
        INSERT INTO event_competition
            (event_id, competition_id, fis_codex, import_code, official_name, active)
        SELECT :event_id, id, code, import_code, name, active FROM competition
    """), {'event_id': event_id})


def downgrade():
    op.drop_index('ix_event_competition_competition_id', table_name='event_competition')
    op.drop_index('ix_event_competition_event_id', table_name='event_competition')
    op.drop_table('event_competition')
    op.drop_table('championship_event')
