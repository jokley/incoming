# PR 3D — backend test baseline cleanup

The requested backend baseline is fully green. Both known failures were
reproduced before editing and corrected without application business-code,
frontend, route, authentication or local-login changes. Earlier PR work in the
shared working tree is preserved; PR 2/3A/3B/3C reports remain historical records.

## Proven failures and classifications

| Test / path | Observed failure | Classification and cause |
| --- | --- | --- |
| `test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types` | Full response dictionary differs by `peopleTotal: 5` and `peopleAssigned: 4` | STALE TEST EXPECTATION. `app.py::_build_official_quota_usage_rows` intentionally projects these fields from `quota_service.disposition_by_quota_group`; `src/app/services/fisRules.ts` declares them and Assignments uses them for disposition KPIs/progress. |
| Same test's later query-count assertion | After correcting the response: measured 4, expected at most 3 | STALE TEST EXPECTATION. Captured statements are four existing bulk queries: people, select-in competition memberships, bookings and current approval state. The old limit predates the membership query. |
| Same test's instrumentation setup | Runner disables performance instrumentation; header assertion requires it | TEST HARNESS DEFECT. Enable measurement only around the test's requests, without changing runtime defaults or auth. |
| `test_alembic_config.py::AlembicConfigurationTest::test_offline_sql_uses_postgresql_configuration` | Exit 1, `AttributeError: 'NoneType' object has no attribute 'scalar_one'` in revision `20260924_02` | OFFLINE MIGRATION COMPATIBILITY DEFECT. Offline execute emits SQL and cannot return the ID from INSERT RETURNING. |
| Independent `alembic upgrade 20260924_02:head --sql` reproduction | Same error at revision `20260924_03` event lookup | OFFLINE MIGRATION COMPATIBILITY DEFECT. Catalogue reconciliation also needs SELECT results, conditional conflict handling, generated IDs and retained-row IDs. |

Both original failing tests and the independent later-revision failure were
recorded before migration edits. No application serialization change was needed.

## Minimal corrections

- Response test: add the two exact expected values while retaining full-dictionary
  equality and every quota assertion. Explicitly enable query instrumentation
  for the requests. Update the documented bulk-query limit to four and strengthen
  coverage by doubling the roster from 5 to 10, checking unchanged query count,
  `peopleTotal: 10` and `peopleAssigned: 4`. No performance implementation changed.
- Revision `20260924_02`: an offline-only data-modifying CTE inserts the event
  and uses its returned ID to populate mappings when the SQL is applied.
- Revision `20260924_03`: an offline-only PostgreSQL DO block performs the same
  ordered catalogue reconciliation at script-application time. Catalogue literals
  are rendered through SQLAlchemy's PostgreSQL dialect. Existing/legacy matching
  priority, collision membership transfer with ON CONFLICT DO NOTHING, conflict
  deletion, ID retention, mapping update/insertion and target-event deactivation
  follow the original online algorithm.
- Both migrations retain their original online statements, identifiers,
  ancestry and downgrade behavior. Nothing was removed, squashed or stamped
  past. Offline branches return only after emitting the required data migration.

## Migration evidence

The existing empty-schema-to-head test still runs twice, checks head
`20261001_01`, catalogue counts, expected tables/column and PostgreSQL constraint
enforcement. The dedicated incoming_test database was also dropped and recreated
before rerunning the full migration/integration command.

A new PostgreSQL parity test executes the actual generated SQL, not just string
assertions. Online and offline results match for:

- The full chain from an empty schema.
- A seeded catalogue with legacy/current identifier collisions, old-name and
  current-code matches, inactive rows, missing mappings and obsolete entries.
- Preserved competition/mapping IDs, catalogue values and active flags.
- Membership transfers including an already-existing destination membership and
  preserved membership timestamps.
- Deactivation of obsolete mappings only for the target event and removal of
  mappings referencing deleted conflicts.

Generated event creation timestamps are omitted from the cross-run comparison
because each execution occurs at a different time. Fixed membership timestamps
are compared. No production dataset was used.

An AST comparison against the original Git versions, excluding only the new
offline branches, confirmed identical online `upgrade()` statements and revision
metadata in both migration files.

## Commands and final results

Commands run from repository root with the existing Windows Python virtual
environment and portable PostgreSQL 17.11. The PR 3B runner supplies the guarded,
isolated test environment; no auth configuration was modified.

| Command / check | Result |
| --- | --- |
| Focused original two tests (command below) | PASS — 2 tests |
| `backend/venv/Scripts/python.exe scripts/test_backend.py fast` | PASS — 65 tests, 14 safety subtests, 2 existing legacy API warnings |
| `backend/venv/Scripts/python.exe scripts/test_backend.py unittest` | PASS — 43 tests: 35 passed, 8 expected PostgreSQL skips; pytest functions run separately in fast mode |
| `backend/venv/Scripts/python.exe scripts/test_backend.py migrate` | PASS — 2 tests, 6 subtests: repeated empty-schema online upgrades plus empty/seeded online/offline parity |
| Guarded dropdb/createdb and `backend/venv/Scripts/python.exe scripts/test_backend.py postgres` | PASS after recreation — migration 2 tests / 6 subtests; integration 41 tests / 14 gender subtests, 39 existing legacy API warnings; no skips |
| `backend/venv/Scripts/python.exe -m compileall -q -x '[/\\]venv[/\\]' backend backup scripts` | PASS |
| Online migration AST / metadata comparison | PASS — original statements and revision identifiers unchanged |
| `git -c core.safecrlf=false diff --check` | PASS |
| Portable PostgreSQL startup / clean shutdown | PASS |

Focused reproduction and final validation:

```powershell
@'
from scripts.test_backend import environment, run
raise SystemExit(run('-m', 'pytest', '-q',
 'tests/test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types',
 'tests/test_alembic_config.py::AlembicConfigurationTest::test_offline_sql_uses_postgresql_configuration', env=environment(True)))
'@ | backend/venv/Scripts/python.exe -
```

The independent offline revision reproduction used the same wrapper with
`run('-m', 'alembic', '-c', 'alembic.ini', 'upgrade', '20260924_02:head', '--sql',
env=environment(False))`.

Database recreation command, after first successful migration validation:

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

Startup/shutdown use the existing PR 3B portable cluster:

```powershell
$pgBin = "$env:TEMP\incoming-pr3b-postgresql17\pgsql\bin"
& "$pgBin\pg_ctl.exe" -D "$((Get-Location).Path)\.local-test\pgdata" -l "$((Get-Location).Path)\.local-test\postgres.log" -o '-h 127.0.0.1 -p 55432' -w start
# Run validation.
& "$pgBin\pg_ctl.exe" -D "$((Get-Location).Path)\.local-test\pgdata" -m fast -w stop
```

Logs are retained under ignored `.local-test/pr3d-*.log`. The PostgreSQL server
was stopped after validation. Python required approved access to its existing
base installation. Docker was not used. Existing deprecation warnings remain;
there are no failing tests in the requested backend validation set.

## Files changed in PR 3D

- `backend/migrations/versions/20260924_02_event_competition_mapping.py`
- `backend/migrations/versions/20260924_03_reconcile_2027_event_catalogue.py`
- `backend/tests/test_import_operational_impacts.py`
- `backend/tests/test_postgres_migrations.py`
- `docs/DEVELOPMENT.md`
- `docs/PR3D_VERIFICATION.md`

The broader working-tree modifications belong to preceding PRs. No production
database credentials or production database connection were used.

No application business behavior was intentionally changed in this PR.
