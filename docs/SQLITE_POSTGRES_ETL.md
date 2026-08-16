# SQLite → PostgreSQL ETL and cutover runbook

## Safety contract

The command is a manually invoked, one-shot process and is not part of Flask's
lifecycle. Alembic remains the only schema authority. The importer reflects
that schema and transfers data only. SQLite is opened with `mode=ro` and
`PRAGMA query_only=ON`; always give the tool a filesystem snapshot, never the
live application database.

The normal run replaces the contents of every source table in one PostgreSQL
transaction. It deletes in reverse dependency order and imports in
foreign-key dependency order. Nullable foreign keys in cycles are restored in
a second pass. Consequently rerunning the same snapshot produces the same
database contents. Target-only tables (notably `alembic_version`) are retained.

## Preparation and dry run

1. Stop SQLite writes or use the storage platform's atomic snapshot facility.
2. Copy the database and record its SHA-256 checksum and byte size:
   `cp --reflink=auto /source/live.db /secure/staging/incoming.db` and
   `sha256sum /secure/staging/incoming.db`.
3. Back up PostgreSQL before every real run:
   `pg_dump --format=custom --file=before-etl.dump "$DATABASE_URL"`.
4. Ensure credentials are secret-managed and the ETL principal can migrate the
   schema and modify application tables.
5. Bring the staging target to Alembic head once before dry-run. Dry-run itself
   deliberately performs no Alembic operation because that could write:

```bash
cd backend
python -m etl.sqlite_to_postgres \
  --source /secure/staging/incoming.db --target "$DATABASE_URL" \
  --dry-run --report ../migration-reports/dry-run.json
```

Dry-run opens both databases, runs SQLite integrity and FK checks, compares
table coverage, derives the FK order, reads every source row, checks cyclic FK
feasibility, and records current target counts. It performs no target DML.

The Compose equivalent mounts the deliberately selected snapshot read-only:

```bash
docker compose --profile etl run --rm \
  -v /secure/staging/incoming.db:/snapshot/source.db:ro etl \
  --source /snapshot/source.db --target "$DATABASE_URL" \
  --dry-run --report /reports/dry-run.json
```

## Controlled import

After peer review of the checksum, backup and dry-run report, execute without
`--dry-run`. The command first runs `alembic upgrade head`, then starts the data
transaction. Any copy or validation error rolls back all target data changes.
It never changes the source.

```bash
python -m etl.sqlite_to_postgres \
  --source /secure/staging/incoming.db --target "$DATABASE_URL" \
  --report ../migration-reports/import.json
```

Structured logs contain `event=etl_started`, `event=etl_completed` or
`event=etl_failed`; passwords are not logged. The JSON report is written on
success and failure and contains timing, import/source/target counts per table,
warnings, errors, skipped rows, dependency order and validation results.

## Validation and acceptance

The source must pass SQLite `integrity_check` and `foreign_key_check`. Before
commit the target must have identical per-table counts, no NULL in required
columns, no orphaned reflected foreign keys, and no unvalidated PostgreSQL
CHECK/FK constraints. Inserts themselves exercise active CHECK, type, unique
and FK constraints. Archive the report, logs, both checksums and operator
approval together. Application smoke testing is a separate, manual cutover
gate; do not switch traffic merely because ETL succeeds.

## Cutover

1. Announce the maintenance window and freeze writes to SQLite.
2. Create and checksum a final SQLite snapshot; confirm it differs only as
   expected from the rehearsal snapshot.
3. Take and verify a PostgreSQL `pg_dump`; run dry-run and obtain two-person
   approval of its report.
4. Run the real import and review every validation field and warning.
5. Run read-only business smoke queries and application acceptance tests.
6. Manually change runtime configuration to PostgreSQL, restart, and monitor
   errors, latency, row growth and audit events. Keep SQLite frozen and intact.

## Rollback

An in-process failure needs no operator DML: the transaction is rolled back.
Alembic's preceding schema upgrade is intentionally separate and may remain;
data rollback is complete. If acceptance fails after commit, stop PostgreSQL
writes, point the application back to the still-frozen SQLite reference, then
restore the target to a new database from `before-etl.dump` (`pg_restore
--clean --if-exists`). Never reverse-sync PostgreSQL into the reference file.
Record the incident and reconcile any writes admitted after cutover before a
new attempt.

## Remaining risks

Production rehearsal is still required for volume, locking, disk space,
encoding, sequence behavior and maintenance-window duration. The replacement
strategy intentionally removes pre-existing application-table rows, so the
backup and explicit approval gates are mandatory. A successful tool run means
the data is technically ready for acceptance; final cutover readiness requires
a representative rehearsal, verified restore, business sign-off and an
approved operations window.
