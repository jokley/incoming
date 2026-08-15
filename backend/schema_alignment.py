"""Idempotent SQLite schema alignment before the first Alembic baseline.

The application historically evolved SQLite with additive startup upgrades.
SQLite cannot add foreign keys/check constraints or remove server defaults with
``ALTER COLUMN``, so the few affected tables are rebuilt transactionally from
the canonical SQLAlchemy ``Table`` definitions.  This module is deliberately
SQLite-only and can be removed after all supported installations have adopted
the future Alembic baseline.
"""

from __future__ import annotations

from sqlalchemy import inspect
from sqlalchemy.schema import CreateIndex, CreateTable


_REQUIRED_COLUMNS = {
    'athlete': {
        'single_room_entitlement', 'single_room_status',
        'single_room_decision_id', 'import_change_types_json',
    },
    'event': {'person_demand', 'single_room_percentage'},
}


def _normalise_default(value):
    if value is None:
        return None
    return str(value).strip().strip('()').strip("'").strip('"')


def _requires_rebuild(inspector, table_name: str) -> bool:
    """Return whether legacy DDL still differs from the mapped table."""
    columns = {column['name']: column for column in inspector.get_columns(table_name)}
    if any(_normalise_default(column.get('default')) is not None
           for column in columns.values()):
        # No mapped column currently declares a server_default.
        return True

    if table_name == 'athlete':
        checks = {item.get('name') for item in inspector.get_check_constraints(table_name)}
        foreign_keys = {
            (tuple(item.get('constrained_columns') or ()), item.get('referred_table'),
             tuple(item.get('referred_columns') or ()))
            for item in inspector.get_foreign_keys(table_name)
        }
        return (
            'ck_athlete_single_room_status' not in checks
            or (('single_room_decision_id',), 'import_approval', ('id',)) not in foreign_keys
        )
    return False


def _render_temporary_table(connection, table, temporary_name: str) -> str:
    ddl = str(CreateTable(table).compile(connection)).strip()
    expected = f'CREATE TABLE {table.name}'
    quoted = f'CREATE TABLE "{table.name}"'
    if expected in ddl:
        return ddl.replace(expected, f'CREATE TABLE "{temporary_name}"', 1)
    if quoted in ddl:
        return ddl.replace(quoted, f'CREATE TABLE "{temporary_name}"', 1)
    raise RuntimeError(f'Cannot render temporary DDL for {table.name}')


def _rebuild_table(connection, table) -> None:
    """Recreate one table from metadata while preserving all mapped data."""
    temporary_name = f'_schema_alignment_{table.name}'
    connection.exec_driver_sql(f'DROP TABLE IF EXISTS "{temporary_name}"')
    connection.exec_driver_sql(_render_temporary_table(connection, table, temporary_name))

    columns = ', '.join(f'"{column.name}"' for column in table.columns)
    connection.exec_driver_sql(
        f'INSERT INTO "{temporary_name}" ({columns}) '
        f'SELECT {columns} FROM "{table.name}"'
    )
    connection.exec_driver_sql(f'DROP TABLE "{table.name}"')
    connection.exec_driver_sql(
        f'ALTER TABLE "{temporary_name}" RENAME TO "{table.name}"'
    )
    for index in sorted(table.indexes, key=lambda item: item.name or ''):
        connection.execute(CreateIndex(index))


def align_sqlite_schema(db) -> tuple[str, ...]:
    """Align legacy SQLite DDL with ``db.metadata`` and return rebuilt tables.

    Additive legacy upgrades and their business backfills must run first.  The
    operation is idempotent, preserves rows, validates foreign keys before
    commit, and rolls the complete rebuild back on error.
    """
    if db.engine.dialect.name != 'sqlite':
        return ()

    db.session.remove()
    with db.engine.connect() as connection:
        foreign_keys_enabled = bool(
            connection.exec_driver_sql('PRAGMA foreign_keys').scalar()
        )
        inspector = inspect(connection)
        available_tables = set(inspector.get_table_names())
        missing_tables = set(db.metadata.tables) - available_tables
        if missing_tables:
            raise RuntimeError(
                'SQLite schema alignment requires db.create_all() first; missing: '
                + ', '.join(sorted(missing_tables))
            )
        for table_name, required in _REQUIRED_COLUMNS.items():
            available = {item['name'] for item in inspector.get_columns(table_name)}
            missing = required - available
            if missing:
                raise RuntimeError(
                    f'Legacy backfill must add {table_name} columns first: '
                    + ', '.join(sorted(missing))
                )

        candidates = ('audit_event', 'athlete', 'event', 'room_booking')
        for table_name in candidates:
            available = {item['name'] for item in inspector.get_columns(table_name)}
            mapped = set(db.metadata.tables[table_name].columns.keys())
            if available != mapped:
                missing = sorted(mapped - available)
                unexpected = sorted(available - mapped)
                raise RuntimeError(
                    f'Refusing lossy rebuild of {table_name}; '
                    f'missing={missing!r}, unexpected={unexpected!r}'
                )
        rebuild = tuple(name for name in candidates if _requires_rebuild(inspector, name))
        if not rebuild:
            return ()

        # PRAGMA changes are ignored inside a transaction.  End the implicit
        # inspection transaction before disabling FK enforcement for parent
        # table replacement; foreign_key_check below still validates the result.
        connection.commit()
        connection.exec_driver_sql('PRAGMA foreign_keys = OFF')
        connection.commit()
        try:
            with connection.begin():
                for table_name in rebuild:
                    _rebuild_table(connection, db.metadata.tables[table_name])
                violations = connection.exec_driver_sql('PRAGMA foreign_key_check').fetchall()
                if violations:
                    raise RuntimeError(f'Foreign-key violations after alignment: {violations!r}')
        finally:
            connection.exec_driver_sql(
                f'PRAGMA foreign_keys = {"ON" if foreign_keys_enabled else "OFF"}'
            )
            connection.commit()

    return rebuild
