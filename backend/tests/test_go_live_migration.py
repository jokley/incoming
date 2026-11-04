"""The only schema change is a nullable selection; all prior rows survive."""
import pytest
from alembic import command
from alembic.operations import Operations
from test_event_ownership import legacy,reviewed
from sqlalchemy import text,inspect

pytestmark=pytest.mark.explicit_event_ownership


def snapshot(engine):
    with engine.connect() as conn:
        return {name:[dict(row) for row in conn.execute(text(f'SELECT * FROM "{name}"')).mappings()]
            for name in inspect(conn).get_table_names() if name!='alembic_version'}


def test_list_selection_migration_preserves_every_existing_row(legacy):
    engine,cfg,*_=legacy;reviewed(legacy);command.upgrade(cfg,'20261025_01')
    before=snapshot(engine)
    command.upgrade(cfg,'head');after=snapshot(engine)
    assert set(before)==set(after)
    for table,rows in after.items():
        if table=='championship_event':
            assert all(row['world_champion_list_json'] is None for row in rows)
            rows=[{key:value for key,value in row.items() if key!='world_champion_list_json'} for row in rows]
        assert sorted(rows,key=repr)==sorted(before[table],key=repr)
    command.upgrade(cfg,'head');assert snapshot(engine)==after


def test_nullable_selection_ddl_failure_rolls_back(legacy,monkeypatch):
    engine,cfg,*_=legacy;reviewed(legacy);command.upgrade(cfg,'20261025_01')
    original=Operations.add_column
    def interrupted(self,*args,**kwargs):
        original(self,*args,**kwargs)
        raise RuntimeError('Injected list-column failure')
    monkeypatch.setattr(Operations,'add_column',interrupted)
    with pytest.raises(RuntimeError,match='Injected'):command.upgrade(cfg,'head')
    with engine.connect() as conn:
        assert 'world_champion_list_json' not in {c['name'] for c in inspect(conn).get_columns('championship_event')}
        assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one()=='20261025_01'
