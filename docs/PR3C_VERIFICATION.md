# PR 3C — quota correctness verification

Both PR 3B quota defects are corrected. All four original failing **quota
assertions** now pass. The overall suite is not green: one original test now
reaches a later stale response-shape assertion, and offline Alembic SQL generation
still fails. Neither unrelated failure was changed, skipped or weakened.

## Reproduction before application edits

The existing PR 2/3A/3B changes and PR 1 state-ownership documentation were
preserved. The reports supply the audit context; a separately numbered original
audit roadmap is not present in this checkout. The existing isolated portable
PostgreSQL 17.11 cluster was restarted on loopback port 55432 using only the
incoming_test database and credentials. All four tests failed before editing:

| Exact test (under backend/tests/) | Expected | Actual | Root cause |
| --- | --- | --- | --- |
| `test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types` | approvedExtraSingleRooms = 1 | 0 | Live approval/implementation aggregates used female/male keys, while quota-service rows used F/M |
| `test_single_room_status.py::SingleRoomStatusTest::test_import_review_stages_exemption_and_recalculates_current_preview` | quotaExemptSingleRooms = 1 | 0 | Existing/requested preview merge failed to merge exemption counts |
| `test_single_room_status.py::SingleRoomStatusTest::test_quota_exempt_request_is_not_a_surcharge_candidate` | quotaExemptSingleRooms = 1 | 0 | Same preview merge |
| `test_single_room_status.py::SingleRoomStatusTest::test_recalculation_accepts_serialized_preview_dates` | quotaExemptSingleRooms = 1 | 0 | Same preview merge after serialized-date recalculation |

The code path is `GET /api/fis/official-quotas` to
`app.py::_build_official_quota_usage_rows` for the first failure, and
`excel_import.py::build_quota_warnings` (directly or through preview
recalculation) for the remaining three. Root causes and planned scope were
reported before editing application code.

## Changes

- `backend/app.py`: `_build_official_quota_usage_rows` now uses the existing
  quota-service `normalize_gender` for approved/implemented count keys, stored
  approval-detail keys and the gender query filter. This aligns aggregation and
  lookup with the canonical quota rows. The separate booking/presentation
  `_normalize_gender` helper is unchanged.
- `backend/quota_service.py`: the same canonical normalization helper also
  recognizes Herr/Herren and Dame/Damen, aliases already accepted by the app.
  Existing M/male/man/men, F/female and W/woman/women handling remains intact.
  No second quota normalization rule was introduced.
- `backend/excel_import.py`: `build_quota_warnings` merges
  `quotaExemptSingleRooms` by maximum, just like existing assigned-official and
  ordinary-single usage counts. Existing and requested sources are overlapping
  views, so adding their counts would double count. Both views use the same
  authoritative roster for athletes, official quota and single-room allowance;
  these values and the existing derived-warning formulas are unchanged.
- `backend/tests/test_import_operational_impacts.py`: added one focused live
  totals test with 14 gender subcases, checking counts, decisions, filters,
  normalized output keys and derived remaining-room totals.
- `backend/tests/test_import_athlete_single_room_quota.py`: added 8 parameterized
  cases for WORLD_CHAMPION/OTHER, requested-only/existing-only/both sources,
  and an exempt athlete in two competitions sharing one quota discipline.
- `docs/PR3C_VERIFICATION.md`: this report.

These are the complete PR 3C file changes; other modified files in the working
tree belong to earlier PR work. Original regression assertions were untouched.
No migration, route structure, frontend, lint or architecture changes were made.

The new tests were executed before the application fix: all 14 gender subcases
failed, as did four preview cases where exemptions existed only in requested
usage. Existing-only/both cases supplied passing controls for preserving the
current source and avoiding addition. All new cases pass after the fix.

## Preserved behavior

Person/competition deduplication and quota-discipline selection remain in the
existing quota-service functions. Tests retain coverage for one person spanning
distinct groups and multiple competitions sharing one group. Exemptions remain
person-level and outside ordinary quota usage. A physical Double room with
counts_as_single set consumes quota independently of its physical type.
APPROVED_EXTRA remains an approval/entitlement, not an exemption.

The frontend quota DTO and API wrapper were inspected. Response field names and
types are unchanged; backend quota rows continue to expose canonical M/F keys.
No frontend changes are needed for these corrected backend totals.

## Validation results

| Command/check | Result |
| --- | --- |
| Four original PostgreSQL tests, before edits | FAIL — 4 verified quota failures |
| Four original PostgreSQL tests, after edits | 3 passed, 1 failed on a later unrelated response-shape assertion; all four original quota assertions pass |
| Focused run: original four, new live regression, entire test_import_athlete_single_room_quota.py | 18 passed, 1 unrelated failure, 14 gender subtests passed |
| `backend/venv/Scripts/python.exe scripts/test_backend.py postgres` | Migration PASS: 1 test / 2 empty-schema passes to 20261001_01; integration 40 passed, 1 unrelated failure, 14 gender subtests passed; 39 legacy API warnings |
| `backend/venv/Scripts/python.exe scripts/test_backend.py fast` | 64 passed, 1 existing offline Alembic failure; 14 safety subtests passed, 2 legacy API warnings |
| `backend/venv/Scripts/python.exe scripts/test_backend.py unittest` | 42 tests: 34 passed, 1 existing offline Alembic failure, 7 PostgreSQL skips |
| `backend/venv/Scripts/python.exe -m compileall -q -x '[/\\]venv[/\\]' backend backup scripts` | PASS |
| `git -c core.safecrlf=false diff --check` | PASS |
| `git diff --name-only -- backend/migrations` | PASS — no migration changes |

Exact focused command, run from repository root before and after the fix:

```powershell
@'
from scripts.test_backend import environment, run
raise SystemExit(run('-m', 'pytest', '-q',
 'tests/test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types',
 'tests/test_single_room_status.py::SingleRoomStatusTest::test_import_review_stages_exemption_and_recalculates_current_preview',
 'tests/test_single_room_status.py::SingleRoomStatusTest::test_quota_exempt_request_is_not_a_surcharge_candidate',
 'tests/test_single_room_status.py::SingleRoomStatusTest::test_recalculation_accepts_serialized_preview_dates', env=environment(True)))
'@ | backend/venv/Scripts/python.exe -
```

The expanded focused run adds these two selections to the same invocation:

```text
tests/test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_totals_use_canonical_gender_for_counts_decisions_and_filters
tests/test_import_athlete_single_room_quota.py
```

Before application edits these two selections were also run on their own.
All invocations use the PR 3B environment builder and existing destructive-test
guards. Python required approved access to its existing Microsoft Store base
installation. Logs are retained under ignored `.local-test/pr3c-*.log`.

Startup and clean shutdown used the existing PR 3B portable cluster:

```powershell
$pgBin = "$env:TEMP\incoming-pr3b-postgresql17\pgsql\bin"
& "$pgBin\pg_ctl.exe" -D "$((Get-Location).Path)\.local-test\pgdata" -l "$((Get-Location).Path)\.local-test\postgres.log" -o '-h 127.0.0.1 -p 55432' -w start
# Run validation above.
& "$pgBin\pg_ctl.exe" -D "$((Get-Location).Path)\.local-test\pgdata" -m fast -w stop
```

## Remaining unrelated failures

1. `test_live_quota_uses_import_entitlements_not_assigned_room_types` now passes
   the original approved-extra assertion and reaches its full-dictionary check.
   Its expected dictionary lacks the already-existing `peopleTotal: 5` and
   `peopleAssigned: 4` DTO fields. The quota values match. This stale assertion
   was previously unreachable because the earlier quota assertion failed. It is
   retained under the instruction not to fix unrelated test failures. Assertions
   after this dictionary check, including its query-count check, are not reached;
   this PR makes no new performance claim.
2. `test_offline_sql_uses_postgresql_configuration` still fails in migration
   `20260924_02` because offline execute returns None before `.scalar_one()`.
   No migration changes, xfails or skips were introduced. Online PostgreSQL
   migrations continue to pass independently.

No production database connection or production credentials were used.

Only the two verified quota correctness defects were changed in this PR.
