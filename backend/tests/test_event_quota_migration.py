"""Real pre-PR7 schema upgrades; never production and never implicit fixation."""
import pytest
import sqlalchemy as sa
from alembic import command
from test_event_ownership import legacy,reviewed
from event_ownership import inventory

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]
FIELDS={'is_world_championship','quota_rules_json','quota_rules_revision','quota_rules_fixed_at','quota_rules_fixed_by'}


def test_additive_policy_migration_preserves_all_stock_and_planning(legacy):
    engine,cfg,*_=legacy
    reviewed(legacy);command.upgrade(cfg,'20261022_01')
    with engine.connect() as connection:before=inventory(connection)
    command.upgrade(cfg,'20261025_01')
    with engine.connect() as connection:
        after=inventory(connection)
        for name,table in before['tables'].items():
            actual=after['tables'][name]
            assert actual['ids']==table['ids'] and actual['count']==table['count']
            rows=actual['rows']
            if name=='championship_event':
                for row in rows:
                    assert row['quota_rules_json'] is None and row['quota_rules_fixed_at'] is None
                    assert row['quota_rules_revision']==0 and row['is_world_championship'] is False
                rows=[{k:v for k,v in row.items() if k not in FIELDS} for row in rows]
            assert rows==table['rows'],name
        assert after['tables']['event']['count']==7
        assert not after['issues']


def test_fixed_rules_prevent_destructive_downgrade(legacy):
    engine,cfg,target,*_=legacy
    reviewed(legacy);command.upgrade(cfg,'20261025_01')
    with engine.begin() as connection:
        before_version = connection.exec_driver_sql('SELECT version_num FROM alembic_version').scalar()
        connection.execute(sa.text('UPDATE championship_event SET quota_rules_fixed_at=:now WHERE id=:id'),{'id':target,'now':__import__('datetime').datetime(2026,10,23)})
    with pytest.raises(RuntimeError,match='reviewed recovery'):command.downgrade(cfg,'20261022_01')
    with engine.connect() as connection:
        assert FIELDS <= {c['name'] for c in sa.inspect(connection).get_columns('championship_event')}
        assert connection.exec_driver_sql('SELECT version_num FROM alembic_version').scalar()==before_version


def test_policy_ddl_failure_rolls_back_all_new_columns(legacy,monkeypatch):
    from alembic.operations import Operations
    engine,cfg,*_=legacy
    reviewed(legacy);command.upgrade(cfg,'20261022_01')
    with engine.connect() as connection:before=inventory(connection)
    original=Operations.add_column;calls=[]
    def interrupted(self,*args,**kwargs):
        calls.append(args)
        if len(calls)==2:raise RuntimeError('Injected policy DDL failure')
        return original(self,*args,**kwargs)
    monkeypatch.setattr(Operations,'add_column',interrupted)
    with pytest.raises(RuntimeError,match='Injected policy DDL'):command.upgrade(cfg,'20261025_01')
    with engine.connect() as connection:
        assert not FIELDS & {c['name'] for c in sa.inspect(connection).get_columns('championship_event')}
        assert inventory(connection)==before
        assert connection.exec_driver_sql('SELECT version_num FROM alembic_version').scalar()=='20261022_01'
