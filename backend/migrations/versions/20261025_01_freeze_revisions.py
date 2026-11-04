"""Add immutable rule history and title recognition links; preserve all existing rows."""
from alembic import op
import sqlalchemy as sa
import json
import hashlib
revision='20261025_01'
down_revision='20261024_02'
branch_labels=None
depends_on=None


def upgrade():
    op.create_table('event_quota_revision',
        sa.Column('event_id',sa.Integer(),sa.ForeignKey('championship_event.id'),primary_key=True),
        sa.Column('revision',sa.Integer(),primary_key=True),
        sa.Column('config_json',sa.Text(),nullable=False),
        sa.Column('is_world_championship',sa.Boolean(),nullable=False),
        sa.Column('digest',sa.String(64),nullable=False),
        sa.Column('activated_at',sa.DateTime(),nullable=False),
        sa.Column('activated_by',sa.String(100)),sa.Column('reason',sa.Text(),nullable=False))
    op.create_table('world_champion_recognition',
        sa.Column('event_id',sa.Integer(),sa.ForeignKey('championship_event.id'),primary_key=True),
        sa.Column('title_id',sa.Integer(),sa.ForeignKey('world_champion.id'),primary_key=True),
        sa.Column('active',sa.Boolean(),nullable=False),
        sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('created_by',sa.String(100)))
    conn=op.get_bind()
    for row in conn.execute(sa.text('SELECT * FROM championship_event WHERE quota_rules_fixed_at IS NOT NULL')).mappings():
        config=json.loads(row['quota_rules_json'])
        value={'config':config,'isWorldChampionship':row['is_world_championship']}
        digest=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()
        conn.execute(sa.text('INSERT INTO event_quota_revision VALUES (:e,:r,:c,:w,:d,:t,:u,:reason)'),
            dict(e=row['id'],r=row['quota_rules_revision'],c=row['quota_rules_json'],w=row['is_world_championship'],d=digest,t=row['quota_rules_fixed_at'],u=row['quota_rules_fixed_by'],reason='Bestandsrevision; unverändert übernommen'))
    # Legacy event_id remains origin/provenance. Link exactly its old applicability.
    conn.execute(sa.text('INSERT INTO world_champion_recognition (event_id,title_id,active,created_at,created_by) SELECT event_id,id,active,created_at,NULL FROM world_champion'))


def downgrade():
    conn=op.get_bind()
    if conn.execute(sa.text('SELECT count(*) FROM event_quota_revision')).scalar() or conn.execute(sa.text('SELECT count(*) FROM world_champion_recognition')).scalar():
        raise RuntimeError('Keep additive history and recognitions during code rollback; reviewed recovery required.')
    op.drop_table('world_champion_recognition');op.drop_table('event_quota_revision')
