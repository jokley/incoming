"""PR8 schema adds no grants and changes no existing evidence or policy."""
import pytest
import sqlalchemy as sa
from alembic import command
from test_event_ownership import legacy, reviewed
from event_ownership import inventory

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.explicit_event_access]


def test_grant_migration_is_additive_and_has_no_implicit_users(legacy):
    engine,cfg,target,*_=legacy
    reviewed(legacy);command.upgrade(cfg,'20261023_01')
    with engine.connect() as conn:before=inventory(conn)
    command.upgrade(cfg,'head')
    with engine.connect() as conn:
        assert inventory(conn)['tables']==before['tables']
        assert conn.exec_driver_sql('SELECT count(*) FROM event_access').scalar()==0
        assert set(sa.inspect(conn).get_pk_constraint('event_access')['constrained_columns'])=={'username','event_id'}
    with engine.begin() as conn:
        conn.execute(sa.text('INSERT INTO event_access (username,event_id) VALUES (:u,:e)'),{'u':'explicit-user','e':target})
        assert conn.exec_driver_sql('SELECT can_write FROM event_access').scalar() is False
