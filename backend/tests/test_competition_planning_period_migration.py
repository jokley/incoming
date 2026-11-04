"""Real additive migration preserves existing stock and scoped references."""
import pytest
import sqlalchemy as sa
from alembic import command
from test_event_ownership import legacy,reviewed
from event_ownership import inventory
pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


def test_period_link_migration_is_additive_and_guards_used_references(legacy):
    engine,cfg,target,other,*_=legacy
    reviewed(legacy);command.upgrade(cfg,'20261026_01')
    with engine.connect() as connection:before=inventory(connection)
    command.upgrade(cfg,'20261028_01')
    with engine.connect() as connection:
        after=inventory(connection)
        for name,table in before['tables'].items():
            actual=after['tables'][name]
            rows=[{k:v for k,v in row.items() if k!='accommodation_event_id'} for row in actual['rows']] if name=='event_competition' else actual['rows']
            assert rows==table['rows'],name
            assert actual['ids']==table['ids'] and actual['count']==table['count']
        assert connection.scalar(sa.text('SELECT count(*) FROM event_competition WHERE accommodation_event_id IS NOT NULL'))==0
        mapping=connection.scalar(sa.text('SELECT id FROM event_competition WHERE event_id=:owner LIMIT 1'),{'owner':target})
        period=connection.scalar(sa.text('SELECT id FROM event WHERE championship_event_id=:owner LIMIT 1'),{'owner':target})
    assert mapping is not None and period is not None
    with engine.begin() as connection:
        connection.execute(sa.text('UPDATE event_competition SET accommodation_event_id=:period WHERE id=:mapping'),{'period':period,'mapping':mapping})
    with pytest.raises(RuntimeError,match='refusing destructive downgrade'):
        command.downgrade(cfg,'20261026_01')
    with engine.connect() as connection:
        assert connection.scalar(sa.text('SELECT version_num FROM alembic_version'))=='20261028_01'
    with engine.begin() as connection:
        connection.execute(sa.text('UPDATE event_competition SET accommodation_event_id=NULL'))
    command.downgrade(cfg,'20261026_01')
    with engine.connect() as connection:
        assert 'accommodation_event_id' not in {c['name'] for c in sa.inspect(connection).get_columns('event_competition')}
