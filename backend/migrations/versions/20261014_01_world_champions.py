"""Event-scoped title references and manual exemption provenance."""
from alembic import op
import sqlalchemy as sa
import json
from pathlib import Path

revision = '20261014_01'
down_revision = '20261012_01'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('athlete', sa.Column('single_room_exemption_source', sa.String(30)))
    # Existing administrative World Champion statuses must survive recognition.
    op.execute("UPDATE athlete SET single_room_exemption_source = 'MANUAL_SET' WHERE single_room_quota_exempt_reason = 'WORLD_CHAMPION'")
    op.create_table('world_champion',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('event_id', sa.Integer, sa.ForeignKey('championship_event.id'), nullable=False),
        sa.Column('fis_code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('nation', sa.String(10), nullable=False),
        sa.Column('gender', sa.String(10), nullable=False),
        sa.Column('discipline', sa.String(100), nullable=False),
        sa.Column('event_group', sa.String(100), nullable=False),
        sa.Column('championship', sa.String(160), nullable=False),
        sa.Column('championship_year', sa.Integer, nullable=False),
        sa.Column('title_type', sa.String(20), nullable=False),
        sa.Column('entitlement_enabled', sa.Boolean, nullable=False),
        sa.Column('source', sa.Text, nullable=False),
        sa.Column('active', sa.Boolean, nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.Column('updated_at', sa.DateTime, nullable=False),
        sa.CheckConstraint("title_type IN ('INDIVIDUAL', 'TEAM')", name='world_champion_title_type'),
        sa.CheckConstraint("title_type != 'TEAM' OR entitlement_enabled = false", name='world_champion_team_disabled'),
        sa.UniqueConstraint('event_id', 'fis_code', 'championship', 'championship_year', 'discipline', 'title_type', name='uq_world_champion_title'))
    op.create_index('ix_world_champion_event_id', 'world_champion', ['event_id'])
    op.create_index('ix_world_champion_fis_code', 'world_champion', ['fis_code'])
    # Frozen, verified title evidence. Explicit target identity; no import fallback.
    records = json.loads((Path(__file__).parents[2] / 'reference_data/engadin_2025_world_champions.json').read_text())
    def literal(value):
        return "'" + str(value).replace("'", "''") + "'"
    for record in records:
        fields = [('fis_code', 'fisCode'), ('name', 'name'), ('nation', 'nation'),
                  ('gender', 'gender'), ('discipline', 'discipline'), ('event_group', 'eventGroup'),
                  ('championship', 'championship'), ('championship_year', 'championshipYear'),
                  ('title_type', 'titleType'), ('source', 'source')]
        columns = ', '.join(field for field, _ in fields)
        values = ', '.join(literal(record[key]) for _, key in fields)
        enabled = 'true' if record['titleType'] == 'INDIVIDUAL' else 'false'
        op.execute(f"INSERT INTO world_champion (event_id, {columns}, entitlement_enabled, active, created_at, updated_at) "
            f"SELECT e.id, {values}, {enabled}, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP "
            "FROM championship_event e WHERE e.name = 'WSC Montafon 2027' "
            f"AND NOT EXISTS (SELECT 1 FROM world_champion w WHERE w.event_id = e.id AND w.fis_code = {literal(record['fisCode'])} "
            f"AND w.championship = 'Engadin' AND w.championship_year = 2025 AND w.discipline = {literal(record['discipline'])} "
            f"AND w.title_type = {literal(record['titleType'])})")


def downgrade():
    op.drop_table('world_champion')
    op.drop_column('athlete', 'single_room_exemption_source')
