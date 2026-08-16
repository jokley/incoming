"""Deterministic, transactional SQLite to PostgreSQL data copy.

The source is opened with SQLite's read-only URI.  Destination tables are
reflected from the Alembic-managed schema; this module never creates schema.
"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import time

from sqlalchemy import Integer, MetaData, and_, create_engine, delete, event, func, select, text, update
from sqlalchemy.engine import Connection, Engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from logging_config import configure_logging  # noqa: E402

LOG = logging.getLogger("etl.sqlite_to_postgres")


def _legacy_athlete_status(_source: Connection):
    """Build the released athlete-status backfill as an in-memory transform."""
    def derive(row: dict) -> str:
        entitlement = row.get("single_room_entitlement")
        return entitlement if entitlement in {"IN_QUOTA", "APPROVED_EXTRA"} else "NONE"
    return derive


def _legacy_event_person_demand(source: Connection):
    """Build the released room-capacity backfill without writing to SQLite."""
    totals = dict(source.exec_driver_sql("""
        SELECT d.event_id, SUM(d.room_count * rt.max_persons)
        FROM event_room_demand d JOIN room_type rt ON rt.id = d.room_type_id
        GROUP BY d.event_id
    """).all())
    return lambda row: totals.get(row["id"], 0)


def _legacy_event_single_room_percentage(_source: Connection):
    """Return the default used when Release 1 gained event planning columns."""
    return lambda _row: 50


# Compatibility transforms are deliberately explicit rather than inferred from
# target defaults.  They mirror released SQLite backfills while keeping the
# input snapshot immutable and making the resulting PostgreSQL rows repeatable.
LEGACY_DERIVED_COLUMNS = {
    "athlete": {"single_room_status": _legacy_athlete_status},
    "event": {
        "person_demand": _legacy_event_person_demand,
        "single_room_percentage": _legacy_event_single_room_percentage,
    },
}


@dataclass
class TableResult:
    source_rows: int = 0
    imported_rows: int = 0
    target_rows: int = 0
    skipped_rows: int = 0
    validation: str = "pending"


@dataclass
class MigrationReport:
    started_at: str
    dry_run: bool
    source: str
    target: str
    status: str = "running"
    duration_seconds: float = 0.0
    table_order: list[str] = field(default_factory=list)
    tables: dict[str, TableResult] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    validation: dict = field(default_factory=dict)

    def json(self) -> str:
        return json.dumps(asdict(self), indent=2, sort_keys=True, default=str) + "\n"


def readonly_sqlite_engine(path: Path) -> Engine:
    resolved = path.expanduser().resolve(strict=True)
    engine = create_engine("sqlite://", creator=lambda: __import__("sqlite3").connect(
        f"file:{resolved}?mode=ro", uri=True
    ))
    @event.listens_for(engine, "connect")
    def _query_only(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA query_only=ON")
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
    return engine


def dependency_order(metadata: MetaData, names: set[str]) -> tuple[list[str], set[tuple[str, str]]]:
    """Topologically order tables and identify FK columns participating in cycles."""
    dependencies = {name: set() for name in names}
    columns_by_edge: dict[tuple[str, str], set[str]] = defaultdict(set)
    for name in names:
        for fk in metadata.tables[name].foreign_keys:
            parent = fk.column.table.name
            if parent in names and parent != name:
                dependencies[name].add(parent)
                columns_by_edge[(name, parent)].add(fk.parent.name)
    remaining = {name: set(value) for name, value in dependencies.items()}
    queue = deque(sorted(name for name, deps in remaining.items() if not deps))
    result = []
    while queue:
        name = queue.popleft()
        result.append(name)
        for child in sorted(remaining):
            if name in remaining[child]:
                remaining[child].remove(name)
                if not remaining[child] and child not in result and child not in queue:
                    queue.append(child)
    cyclic_tables = set(names) - set(result)
    def reaches(start: str, sought: str, seen=None) -> bool:
        seen = (seen or set()) | {start}
        return sought in dependencies[start] or any(
            parent not in seen and reaches(parent, sought, seen)
            for parent in dependencies[start]
        )
    # Cyclic references are loaded as NULL and restored in a second pass.
    cyclic_columns = {(table, col) for (table, parent), cols in columns_by_edge.items()
                      if table in cyclic_tables and parent in cyclic_tables and reaches(parent, table)
                      for col in cols}
    return result + sorted(cyclic_tables), cyclic_columns


class Migrator:
    def __init__(self, source: Engine, target: Engine, report: MigrationReport):
        self.source, self.target, self.report = source, target, report

    def analyze(self):
        with self.source.connect() as source, self.target.connect() as target:
            integrity = source.exec_driver_sql("PRAGMA integrity_check").scalars().all()
            fk_issues = source.exec_driver_sql("PRAGMA foreign_key_check").all()
            if integrity != ["ok"] or fk_issues:
                raise RuntimeError(f"SQLite integrity failed: integrity={integrity}, foreign_keys={fk_issues}")
            sm, tm = MetaData(), MetaData()
            sm.reflect(bind=source)
            tm.reflect(bind=target)
            source_names = set(sm.tables) - {"alembic_version", "sqlite_sequence"}
            target_names = set(tm.tables) - {"alembic_version"}
            missing = sorted(source_names - target_names)
            if missing:
                raise RuntimeError(f"target schema is missing source tables: {missing}")
            names = source_names
            order, cyclic = dependency_order(tm, names)
            for table, column in cyclic:
                if not tm.tables[table].c[column].nullable:
                    raise RuntimeError(f"non-nullable cyclic FK cannot be staged: {table}.{column}")
            self.report.table_order = order
            self.report.validation.update(table_count={"source": len(source_names), "target": len(target_names),
                                                        "migrated": len(names)}, source_integrity="ok")
            if target_names - source_names:
                self.report.warnings.append(f"target-only tables are not modified: {sorted(target_names-source_names)}")
            rows = {}
            for name in order:
                source_columns = set(sm.tables[name].c.keys())
                target_columns = set(tm.tables[name].c.keys())
                if source_columns - target_columns:
                    raise RuntimeError(f"target {name} is missing columns: {sorted(source_columns-target_columns)}")
                derivation_factories = LEGACY_DERIVED_COLUMNS.get(name, {})
                derived_columns = set(derivation_factories) - source_columns
                required = [column.name for column in tm.tables[name].columns
                            if column.name not in source_columns and not column.nullable
                            and column.default is None and column.server_default is None
                            and column.name not in derived_columns]
                if required:
                    raise RuntimeError(f"source {name} cannot populate required target columns: {required}")
                data = [dict(row._mapping) for row in source.execute(select(sm.tables[name])).all()]
                for column in sorted(derived_columns):
                    derive = derivation_factories[column](source)
                    for row in data:
                        row[column] = derive(row)
                if derived_columns:
                    message = f"source {name} legacy columns derived in memory: {sorted(derived_columns)}"
                    if message not in self.report.warnings:
                        self.report.warnings.append(message)
                null_violations = [column.name for column in tm.tables[name].columns
                                   if not column.nullable and column.name in source_columns | derived_columns
                                   and any(row[column.name] is None for row in data)]
                if null_violations:
                    raise RuntimeError(f"source {name} has NULL in required columns: {null_violations}")
                rows[name] = data
                self.report.tables[name] = TableResult(source_rows=len(data))
            self.report.validation.update(source_foreign_keys="passed", source_nullability="passed",
                                          source_check_constraints="passed")
            return tm, rows, cyclic

    def run(self, dry_run: bool):
        metadata, rows, cyclic = self.analyze()
        if dry_run:
            with self.target.connect() as connection:
                for name in self.report.table_order:
                    self.report.tables[name].target_rows = connection.execute(
                        select(text("count(*)")).select_from(metadata.tables[name])).scalar_one()
                    self.report.tables[name].validation = "analyzed"
            return
        with self.target.begin() as connection:
            connection.execute(text("SET CONSTRAINTS ALL DEFERRED"))
            # Break nullable cycles in pre-existing target data before DELETE.
            for name in self.report.table_order:
                values = {column: None for table, column in cyclic if table == name}
                if values:
                    connection.execute(update(metadata.tables[name]).values(**values))
            for name in reversed(self.report.table_order):
                connection.execute(delete(metadata.tables[name]))
            deferred = []
            for name in self.report.table_order:
                table = metadata.tables[name]
                payload = []
                for original in rows[name]:
                    item = dict(original)
                    changes = {column: item[column] for tbl, column in cyclic if tbl == name and item.get(column) is not None}
                    for column in changes:
                        item[column] = None
                    payload.append(item)
                    if changes:
                        deferred.append((table, {c.name: original[c.name] for c in table.primary_key.columns}, changes))
                if payload:
                    connection.execute(table.insert(), payload)
                self.report.tables[name].imported_rows = len(payload)
            for table, identity, values in deferred:
                predicate = [table.c[key] == value for key, value in identity.items()]
                connection.execute(update(table).where(*predicate).values(**values))
            self._validate(connection, metadata, rows)
            self._reset_sequences(connection, metadata)

    def _reset_sequences(self, connection: Connection, metadata: MetaData):
        """Move serial/identity sequences beyond explicitly imported keys."""
        for name in self.report.table_order:
            table = metadata.tables[name]
            for column in table.primary_key.columns:
                if not isinstance(column.type, Integer):
                    continue
                sequence = connection.execute(
                    text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
                    {"table_name": name, "column_name": column.name},
                ).scalar_one_or_none()
                if sequence:
                    maximum = connection.execute(select(func.max(column))).scalar_one()
                    connection.execute(text("SELECT setval(CAST(:sequence AS regclass), :value, :called)"),
                                       {"sequence": sequence, "value": maximum or 1,
                                        "called": maximum is not None})

    def _validate(self, connection: Connection, metadata: MetaData, rows: dict):
        fk_failures, null_failures = [], []
        for name in self.report.table_order:
            table = metadata.tables[name]
            result = self.report.tables[name]
            result.target_rows = connection.execute(select(text("count(*)")).select_from(table)).scalar_one()
            if result.target_rows != len(rows[name]):
                raise RuntimeError(f"row-count mismatch for {name}: {len(rows[name])} != {result.target_rows}")
            for column in table.columns:
                if not column.nullable and not column.primary_key:
                    count = connection.execute(select(text("count(*)")).select_from(table).where(column.is_(None))).scalar_one()
                    if count:
                        null_failures.append(f"{name}.{column.name}:{count}")
            for constraint in table.foreign_key_constraints:
                conditions = [local == element.column for local, element in zip(constraint.columns, constraint.elements)]
                present = [column.is_not(None) for column in constraint.columns]
                query = select(text("count(*)")).select_from(table.outerjoin(constraint.referred_table, and_(*conditions))).where(
                    *present, next(iter(constraint.referred_table.primary_key.columns)).is_(None))
                count = connection.execute(query).scalar_one()
                if count:
                    fk_failures.append(f"{constraint.name or name}:{count}")
            result.validation = "passed"
        if fk_failures or null_failures:
            raise RuntimeError(f"validation failed: foreign_keys={fk_failures}, nulls={null_failures}")
        # Inserts exercise PostgreSQL CHECK constraints; also reject unvalidated constraints.
        unvalidated = connection.execute(text("SELECT count(*) FROM pg_constraint WHERE contype IN ('c','f') AND NOT convalidated")).scalar_one()
        if unvalidated:
            raise RuntimeError(f"PostgreSQL has {unvalidated} unvalidated CHECK/FK constraints")
        self.report.validation.update(row_counts="passed", foreign_keys="passed", nullability="passed",
                                      check_constraints="passed", reference_integrity="passed")


def upgrade_schema(target_url: str):
    env = os.environ.copy()
    env.update(DATABASE_BACKEND="postgresql", DATABASE_URL=target_url)
    subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
                   cwd=Path(__file__).resolve().parents[1], env=env, check=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="immutable SQLite snapshot")
    parser.add_argument("--target", default=os.environ.get("DATABASE_URL"), help="PostgreSQL SQLAlchemy URL")
    parser.add_argument("--report", type=Path, default=Path("migration-report.json"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not args.target or not args.target.startswith(("postgresql://", "postgresql+psycopg://")):
        parser.error("--target (or DATABASE_URL) must be a PostgreSQL URL")
    target_url = args.target.replace("postgresql://", "postgresql+psycopg://", 1)
    configure_logging(os.environ.get("LOG_LEVEL", "INFO"))
    report = MigrationReport(datetime.now(timezone.utc).isoformat(), args.dry_run, str(args.source),
                             target_url.split("@")[-1])
    started = time.monotonic()
    try:
        LOG.info("event=etl_started dry_run=%s source=%s", args.dry_run, args.source)
        if not args.dry_run:
            upgrade_schema(target_url)
        else:
            report.warnings.append("dry-run does not run Alembic because it may not write; target must already be at head")
        Migrator(readonly_sqlite_engine(args.source), create_engine(target_url), report).run(args.dry_run)
        report.status = "dry-run-passed" if args.dry_run else "succeeded"
        LOG.info("event=etl_completed status=%s", report.status)
        return_code = 0
    except Exception as exc:
        LOG.exception("event=etl_failed")
        report.status = "failed"
        report.errors.append(str(exc))
        return_code = 1
    finally:
        report.duration_seconds = round(time.monotonic() - started, 3)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(report.json(), encoding="utf-8")
        LOG.info("event=etl_report_written path=%s", args.report)
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
