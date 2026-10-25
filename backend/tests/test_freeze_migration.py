"""Actual PostgreSQL upgrade from deployed PR9, preserving original rows byte-for-byte."""
import json
from datetime import datetime
import sqlalchemy as sa
import pytest
from alembic import command
from test_event_ownership import legacy,reviewed
from event_ownership import inventory
from quota_rules import standard_rules,fingerprint
pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.explicit_event_access]


def test_freeze_upgrade_preserves_stock_and_snapshots_only_existing_applicability(legacy):
 engine,cfg,target,*_=legacy;reviewed(legacy);command.upgrade(cfg,'20261024_02')
 config=standard_rules()
 with engine.begin() as conn:
  conn.execute(sa.text('UPDATE championship_event SET quota_rules_json=:c,quota_rules_fixed_at=:t,quota_rules_fixed_by=:u,quota_rules_revision=1 WHERE id=:e'),dict(c=json.dumps(config),t=datetime(2026,10,23),u='original-admin',e=target))
  conn.execute(sa.text("INSERT INTO world_champion(event_id,fis_code,name,nation,gender,discipline,event_group,championship,championship_year,title_type,entitlement_enabled,source,active,created_at,updated_at) VALUES (:e,'1234567','Preserved Title','JPN','M','Snowboard','Snowboard Cross','Original Source',2025,'INDIVIDUAL',true,'original evidence',true,:t,:t)"),dict(e=target,t=datetime(2026,10,23)))
 with engine.connect() as conn:
  before=inventory(conn);titles=list(conn.exec_driver_sql('SELECT * FROM world_champion ORDER BY id').mappings())
 command.upgrade(cfg,'20261025_01')
 with engine.connect() as conn:
  assert inventory(conn)['tables']==before['tables']
  assert list(conn.exec_driver_sql('SELECT * FROM world_champion ORDER BY id').mappings())==titles
  history=conn.execute(sa.text('SELECT * FROM event_quota_revision WHERE event_id=:e'),dict(e=target)).mappings().one()
  assert history['revision']==1 and history['activated_by']=='original-admin'
  assert history['digest']==fingerprint({'config':config,'isWorldChampionship':False})
  links=list(conn.exec_driver_sql('SELECT * FROM world_champion_recognition').mappings())
  assert {(r['event_id'],r['title_id'],r['active']) for r in links}=={(t['event_id'],t['id'],t['active']) for t in titles}


def test_additive_ddl_failure_is_transactional(legacy,monkeypatch):
 from alembic.operations import Operations
 engine,cfg,*_=legacy;reviewed(legacy);command.upgrade(cfg,'20261024_02')
 original=Operations.create_table
 def interrupted(self,name,*args,**kwargs):
  if name=='world_champion_recognition':raise RuntimeError('Injected recognition DDL failure')
  return original(self,name,*args,**kwargs)
 monkeypatch.setattr(Operations,'create_table',interrupted)
 with pytest.raises(RuntimeError,match='Injected'):command.upgrade(cfg,'20261025_01')
 with engine.connect() as conn:
  assert 'event_quota_revision' not in sa.inspect(conn).get_table_names()
  assert conn.exec_driver_sql('SELECT version_num FROM alembic_version').scalar()=='20261024_02'
