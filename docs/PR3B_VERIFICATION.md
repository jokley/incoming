# PR 3B verification — 2026-10-04

The backend/PostgreSQL validation baseline is implemented and exercised. It is
**not a green backend suite**: one existing offline migration defect and four
integration failures from two quota defects remain visible. No application
behavior, production configuration or migration history was changed.

## Environment and scope

Windows PowerShell, existing backend virtual environment: Python 3.11.9,
pytest 9.1.1, SQLAlchemy 2.1.3, Alembic 1.16.5, psycopg 3.2.9. Portable PostgreSQL
17.11 was used because Docker is unavailable locally. This validates the
PostgreSQL major version used by production; it does not validate the Compose
container runtime or the recommended Python 3.12+ environment.

The working tree already contained PR 2 and PR 3A changes. They were preserved,
including `pnpm-lock.yaml`; frontend checks were not repeated in this backend PR.
At resumption, `git status` and `git diff` were inspected before changes. The
saved guards, Compose file, environment template and migration test were retained.

## Commands and results

All commands below run at repository root. `py` in this table abbreviates the
exact executable `backend/venv/Scripts/python.exe`, not the Windows `py` launcher.

| Command | Result |
| --- | --- |
| `git status` and `git diff` | PASS — inspected saved work before editing |
| `py -m pip check` | PASS — no broken requirements |
| `py -m pip install -r backend/requirements-test.txt -r backup/requirements.txt` | PASS — dependencies already satisfied |
| `py scripts/test_backend.py fast` | FAIL — existing issue: 56 passed, 1 failed, 14 safety subtests passed, 2 legacy API warnings |
| `py scripts/test_backend.py unittest` | FAIL — existing issue: 42 tests, 1 failure, 7 PostgreSQL skips (34 passed); pytest functions are not collected by unittest |
| `py scripts/test_backend.py backup` | PASS — 10 tests; backup/database subprocesses are mocked |
| `py -m compileall -q -x '[/\\]venv[/\\]' backend backup scripts` | PASS — excludes installed virtual-environment packages |
| Portable `initdb`, `pg_ctl start`, `createdb`, identity query (below) | PASS — PostgreSQL 17.11, incoming_test database/user, loopback port 55432 |
| `py scripts/test_backend.py migrate` | PASS — 1 test, 2 empty-schema migration subtests |
| Guarded `dropdb` then `createdb` (below) | PASS — database destroyed and recreated |
| `py scripts/test_backend.py postgres` after recreation | Migration phase PASS — 2 more empty-schema passes; integration initially 30 passed, 10 failed |
| `py scripts/test_backend.py postgres` after fixture corrections | Migration phase PASS — 1 test, 2 subtests; integration FAIL — real application defects: 36 passed, 4 failed, 37 legacy API warnings, no skips |
| Portable `pg_ctl -m fast -w stop` | PASS — server stopped cleanly |
| `git diff --check` | PASS |
| `git check-ignore .env.test .local-test/pgdata/PG_VERSION` | PASS — generated environment and cluster data ignored |
| `git diff --name-only -- backend/migrations backend/app.py backend/excel_import.py backend/models.py backend/quota_service.py docker-compose.yml` | PASS — no changes |
| `docker compose -f compose.test.yaml up -d --wait postgres-test` | NOT RUN — Docker unavailable; portable PostgreSQL used instead |

The first sandboxed Python attempts could not launch the Microsoft Store Python
base interpreter. The same commands ran successfully with approved access to the
existing installation. This was an environment restriction, not a test failure.
The earlier run's archive-extraction approval failed because its automatic review
hit a usage limit; no extraction occurred in that attempt. This resumed run was
approved. Full `Expand-Archive` was subsequently stopped while unpacking unused
pgAdmin files, and server-only extraction completed as documented below.

## Migration evidence

The independent migration test resets `public`, verifies that it has no tables,
and invokes `python -m alembic -c alembic.ini upgrade head` from `backend/` twice.
Both passes reached **20261001_01**, with 31 active competitions, 31 active event
mappings, expected tables and exemption column, and PostgreSQL check-constraint
rejection SQLSTATE `23514` for an invalid single-room status.

The database was also dropped and recreated with PostgreSQL utilities before
repeating the migration phase and integration suite. No ORM `create_all`, stamp,
seed script, edited migration or pre-existing schema substitutes for migration
validation. ORM integration tests run in a separate process afterward.

## Corrections and failure ownership

| Classification | Affected tests / correction |
| --- | --- |
| STALE TEST EXPECTATION | `test_alembic_config.py`: replace obsolete fixed head 20260818_02 with singleton repository head verification; retain that revision in ancestry |
| TEST FIXTURE ISSUE | `test_database_admin.py`: capture upload bytes inside mocked urlopen before Flask closes the stream; keep byte and request assertions |
| TEST FIXTURE ISSUE | `test_event_competition_mapping.py`: supply the three existing-athlete map keys expected by the parser |
| TEST FIXTURE ISSUE | `test_scenario_generator.py`: provide isolated in-memory SQLite Flask/ORM context; dispose engine |
| TEST FIXTURE ISSUE | `test_sqlite_to_postgres_etl.py`: dispose source and target engines before temporary-directory cleanup on Windows; all read-only/checksum/data assertions retained |
| TEST FIXTURE ISSUE | `test_assignment_planning_projection.py`: give the existing booking valid stay dates so countsAsSingle update reaches the behavior under test |
| TEST FIXTURE ISSUE | `test_import_operational_impacts.py`: preserve existing Double room requirements and the unchanged incoming partner pair, isolating stay changes from unintended room-type/partner changes |
| TEST FIXTURE ISSUE | `test_single_room_status.py`: timestamp cached previews and clear the preview store between tests; preserve all business assertions |
| ENVIRONMENT / CONFIGURATION | Six PostgreSQL modules: validate actual test engine/environment before destructive ORM setup, provide local dev authentication; health fixture no longer overwrites an already configured URL |
| POSTGRESQL-SPECIFIC | New migration/constraint checks run against real PostgreSQL 17; integration is mandatory in postgres mode and does not silently skip a missing service |

Before these changes, the earlier pytest baseline was 10 failed, 44 passed,
9 skipped; unittest had 38 tests, 2 failures, 7 errors, 6 skips. The final fast
baseline includes three new safety tests. Newly exercised PostgreSQL failures
are documented below separately from those historical counts.

### Remaining failures — assertions intentionally unchanged

1. **REAL APPLICATION DEFECT — offline migration generation.**
   `test_alembic_config.py::AlembicConfigurationTest::test_offline_sql_uses_postgresql_configuration`.
   `20260924_02_event_competition_mapping.py` calls `.scalar_one()` on an offline
   `execute()` result, which is `None`. The next catalogue migration also depends
   on query results. `alembic upgrade head --sql` still fails. This is independent
   of the successful online PostgreSQL chain; no migration rewrite or skip added.
2. **REAL APPLICATION DEFECT — inconsistent live quota gender keys.**
   `test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types`.
   `app.py::_build_official_quota_usage_rows` aggregates approved/implemented
   counts using `_normalize_gender` (`female`/`male`), then looks them up against
   quota-service row keys (`F`/`M`). The approved-extra count is 0 instead of 1.
   Fixing the application aggregation belongs in a follow-up correctness PR.
3. **REAL APPLICATION DEFECT — preview exemption counts lost during merge.**
   In `excel_import.py::build_quota_warnings`, the combined row is initialized
   from projected existing usage; requested usage updates ordinary counts but
   does not carry over `quotaExemptSingleRooms`. A newly requested exempt single
   room is reported as 0 instead of 1. Three tests in
   `test_single_room_status.py::SingleRoomStatusTest` remain failing:
   - `test_quota_exempt_request_is_not_a_surcharge_candidate`
   - `test_import_review_stages_exemption_and_recalculates_current_preview`
   - `test_recalculation_accepts_serialized_preview_dates`

These are behavior-sensitive findings. No assertions were weakened, marked
xfail or skipped to conceal them. Legacy SQLAlchemy Query.get warnings remain.
The baseline does not claim concurrency/locking, production-data upgrade,
restore-to-PostgreSQL or deployment coverage. Backup tests use mocks.

## Portable PostgreSQL workflow used

The archive was already downloaded in the previous run from the
[EDB PostgreSQL binaries distribution](https://www.enterprisedb.com/download-postgresql-binaries):

```powershell
curl.exe -L --fail --silent --show-error 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616' -o "$env:TEMP\incoming-pr3b-postgresql17.zip"
```

`Expand-Archive -LiteralPath "$env:TEMP\incoming-pr3b-postgresql17.zip"
-DestinationPath "$env:TEMP\incoming-pr3b-postgresql17"` was started, then its
verified extraction process was stopped while unpacking pgAdmin. The following
server-only extraction finished in seconds. It also works directly on a fresh
archive; no system installer/service is required. Existing complete server files
are preserved and paths outside the target directory are rejected.

```powershell
@'
from pathlib import Path
from zipfile import ZipFile
import os
root = Path(os.environ['TEMP']) / 'incoming-pr3b-postgresql17'
with ZipFile(Path(os.environ['TEMP']) / 'incoming-pr3b-postgresql17.zip') as archive:
    for entry in archive.infolist():
        if not entry.filename.startswith(('pgsql/bin/', 'pgsql/lib/', 'pgsql/share/')):
            continue
        target = (root / entry.filename).resolve()
        if not target.is_relative_to(root.resolve()):
            raise ValueError('Archive path outside extraction directory')
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif target.exists():
            if target.stat().st_size != entry.file_size:
                raise ValueError(f'Incomplete server file: {target.name}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))
print('PostgreSQL server bin/lib/share extraction complete')
'@ | backend/venv/Scripts/python.exe -
```

Initialize once from repository root (refuses to overwrite an existing cluster):

```powershell
$pgBin = "$env:TEMP\incoming-pr3b-postgresql17\pgsql\bin"
$testRoot = Join-Path (Get-Location) '.local-test'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
if (Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue) { throw 'Test port already in use' }
if (Test-Path "$testRoot\pgdata") { throw 'Test cluster exists; refusing to initialize over it' }
Get-ChildItem Env:PG* | Remove-Item
Set-Content -LiteralPath "$testRoot\pg-password.txt" -Value 'incoming_test' -Encoding Ascii
& "$pgBin\initdb.exe" -D "$testRoot\pgdata" -U incoming_test --pwfile="$testRoot\pg-password.txt" --auth=scram-sha-256 --encoding=UTF8 --locale=C
if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
& "$pgBin\pg_ctl.exe" -D "$testRoot\pgdata" -l "$testRoot\postgres.log" -o '-h 127.0.0.1 -p 55432' -w start
if ($LASTEXITCODE -ne 0) { throw 'pg_ctl failed' }
$env:PGPASSWORD='incoming_test'
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 55432 -U incoming_test incoming_test
if ($LASTEXITCODE -ne 0) { throw 'createdb failed' }
& "$pgBin\psql.exe" -h 127.0.0.1 -p 55432 -U incoming_test -d incoming_test -c 'SELECT version(), current_database(), current_user;'
backend/venv/Scripts/python.exe scripts/test_backend.py migrate
```

Database recreation and full PostgreSQL validation, also executed:

```powershell
$pgBin = "$env:TEMP\incoming-pr3b-postgresql17\pgsql\bin"
Get-ChildItem Env:PG* | Remove-Item
$env:PGPASSWORD='incoming_test'
$target = & "$pgBin\psql.exe" -h 127.0.0.1 -p 55432 -U incoming_test -d incoming_test -Atc 'SELECT current_database(), current_user;'
if ($target -ne 'incoming_test|incoming_test') { throw 'Unexpected test database identity' }
& "$pgBin\dropdb.exe" -h 127.0.0.1 -p 55432 -U incoming_test incoming_test
if ($LASTEXITCODE -ne 0) { throw 'dropdb failed' }
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 55432 -U incoming_test incoming_test
if ($LASTEXITCODE -ne 0) { throw 'createdb failed' }
backend/venv/Scripts/python.exe scripts/test_backend.py postgres
```

The actual integration invocations redirected output to
`.local-test/postgres-tests.log`, displayed its tail, and propagated `$LASTEXITCODE`.
The final log is retained locally (ignored). The unittest log is in
`$env:TEMP\incoming-pr3b-unittest-after.log`.

Stop the server (executed). To resume later, use the same pg_ctl start command;
do not run initdb again. For a disposable database reset use the guarded dropdb/
createdb block above. Binaries are in TEMP, cluster data/logs under `.local-test`.

```powershell
$pgBin = "$env:TEMP\incoming-pr3b-postgresql17\pgsql\bin"
& "$pgBin\pg_ctl.exe" -D "$((Get-Location).Path)\.local-test\pgdata" -m fast -w stop
```

## PR 3B files changed

New:

- `.env.test.example`
- `compose.test.yaml`
- `backend/requirements-test.txt`
- `backend/test_support.py`
- `backend/tests/test_test_database_safety.py`
- `backend/tests/test_postgres_migrations.py`
- `scripts/test_backend.py`
- `docs/PR3B_VERIFICATION.md`

Modified:

- `.gitignore`
- `docs/DEVELOPMENT.md` (preserves earlier frontend documentation)
- `backend/tests/test_alembic_config.py`
- `backend/tests/test_assignment_planning_projection.py`
- `backend/tests/test_database_admin.py`
- `backend/tests/test_event_competition_mapping.py`
- `backend/tests/test_health.py`
- `backend/tests/test_import_event_id_api.py`
- `backend/tests/test_import_operational_impacts.py`
- `backend/tests/test_import_session_versioning.py`
- `backend/tests/test_person_identity.py`
- `backend/tests/test_scenario_generator.py`
- `backend/tests/test_single_room_status.py`
- `backend/tests/test_sqlite_to_postgres_etl.py`

Ignored local artifacts: generated `.env.test`, `.local-test/` cluster/password
file/logs, Python bytecode. Portable binaries/archive remain in TEMP. All these
credentials are deliberately non-sensitive test defaults.

PR 3B's requested baseline work is complete with the failures above explicitly
retained. Recommended next PR: narrowly repair quota aggregation and preview
exemption reporting using these existing failing tests. Address offline migration
generation separately with an explicit policy for immutable migration history.

No production database credentials or production database connection were used in this PR.
