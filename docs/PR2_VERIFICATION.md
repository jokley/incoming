# PR 2 local verification — 2026-10-03

Verified checkout: `0056d65` (includes tooling baseline `b219275`). The working
tree was clean before verification. Windows PowerShell, Node 24.15.0, pnpm
10.33.2, Python 3.11.9. Python is older than the README's recommended 3.12+;
results below describe this actual local environment.

## Minimal tooling corrections

- Match `@types/react` / `@types/react-dom` to the React 18 runtime. React 19
  declarations initially caused 42 `JSX` namespace errors in react-day-picker.
  Keep dependency declaration checking enabled.
- Use double quotes for the test glob: the original single-quoted command
  returned exit code zero with **zero tests** on Windows. Explicitly enable
  TypeScript stripping for the declared Node 22.6 minimum.
- Retain the regenerated `pnpm-lock.yaml`, including the previously unrecorded
  quality-tool dependencies.
- Document pytest as a test prerequisite and the difference between unittest
  and pytest discovery. No application code or lint rules were changed.

The initial sandboxed install failed with EPERM accessing the user directory.
The authorized retry outside the sandbox succeeded. Install warnings about
deprecated ESLint and ignored dependency build scripts did not prevent builds.

## Application typecheck findings

88 diagnostics across 11 files remain after correcting React types. These are
existing application issues, not grounds to weaken TypeScript configuration.
Paths in the following table are relative to `src/app/`.

| Root cause | Affected files | Change sensitivity |
| --- | --- | --- |
| Duplicate identical arrival/departure properties | `types.ts` | Trivial declaration cleanup; preserve the surviving shape. |
| Two incompatible `ImportChangeType` definitions and consumers using different vocabularies | `types.ts`, `components/DataImport.tsx` | Behavior-sensitive API/import contract reconciliation; do not simply union the types to silence errors. |
| Missing `ChangeOccupant` type | `components/Assignments.tsx` | Establish the intended occupant contract before repairing. |
| Missing `Alert` import; unused nonexistent surcharge export | `components/Athletes.tsx` | Small import cleanup. |
| Assignment projection lacks `roomTypeId` | `components/Athletes.tsx` | Behavior-sensitive projection contract. |
| Undefined permissions and missing event demand fields | `components/Events.tsx` | Behavior-sensitive authorization and event creation. |
| Obsolete hotel capacity/room fields and undefined capacity/occupied values | `components/Hotels.tsx` | Behavior-sensitive model drift; establish whether this older view is still supported. |
| Status map omits EXCEPTION_APPROVED and CANCELLED | `components/ImportQueue.tsx` | Explicit presentation decision for workflow states. |
| Widened string keys | `components/Lists.tsx`, `components/RoomAnalytics.tsx` | Usually narrow typing cleanup after confirming keys. |
| Occupancy result uses occupied/free, consumer expects occupiedBeds/freeBeds | `components/Lists.tsx` | Behavior-sensitive displayed values. |
| Required single_room_status missing from fixtures and API mock creation | `data/mockData.ts`, `services/api.ts` | Explicit domain defaults required; do not make the field optional just to pass. |
| Optional roomInventories/roomDemands conflict with inferred required mock arrays | `services/api.ts` | Verify collection normalization and contracts. |

Diagnostic counts by file: Assignments 2, Athletes 4, DataImport 7, Events 11,
Hotels 26, ImportQueue 1, Lists 3, RoomAnalytics 3, mockData 22, api 3, types 6.

## Application lint findings

86 errors and 18 warnings. Paths below are relative to `src/app/`; component
names without another prefix are under `components/` and have `.tsx` extensions.

| Root cause / rule | Count | Affected files | Change sensitivity |
| --- | ---: | --- | --- |
| Unused declarations (`no-unused-vars`) | 48 errors | Assignments, Athletes, Dashboard, DataImport, DatabaseBackups, Events, Hotels, RoomAnalytics, RoomTypesManagement; `lists/listEngine.ts`, `services/api.ts`, `services/quotaEvaluation.ts` | Mostly cleanup. Preserve initializer side effects and hook calls; unused quota/permission-related values need review. |
| `prefer-const` | 5 errors | `services/api.ts` | Trivial cleanup. |
| Undefined JSX component | 1 error | Athletes | Missing Alert import. |
| Conditional expressions used as statements | 7 errors | Events, EventsManagement, HotelsManagement, RoomAnalytics, RoomTypesManagement | Usually equivalent if/else cleanup, preserving permission guards and awaited branch behavior. |
| Synchronous state updates in effects | 9 errors | AdministrationEvents, Assignments, ImportDecisionDialog, OperationsDecisionDialog, RoomAnalytics, `activity/ActivityHistoryDialog.tsx`, `activity/ActivityInfoBlock.tsx`, `charts/EnterpriseChart.tsx` | Behavior-sensitive lifecycle and data-loading changes. |
| Components defined during render | 14 errors | RoomAnalytics | Behavior-sensitive component identity/remount behavior. |
| Manual memoization dependency mismatch | 1 error | `charts/EnterpriseChart.tsx` | Behavior-sensitive chart persistence and recalculation. |
| Impure random call during render | 1 error | `ui/sidebar.tsx` | Rendering behavior; choose stable skeleton widths deliberately. |
| Hook dependency mismatches | 18 warnings | AdministrationEvents, Assignments, Athletes, Dashboard, DataImport, EventsManagement, HotelsManagement, RoomAnalytics, RoomOccupancy, RoomTypesManagement, `charts/EnterpriseChart.tsx` | Behavior-sensitive; adding dependencies blindly can cause repeated loads or reset state. |

No mass fixes were applied.

## Commands and results

Commands were run from the repository root unless another directory is listed.
Output was captured in `$env:TEMP/incoming-pr2-*.log`; lint's second run also
wrote `$env:TEMP/incoming-pr2-lint.json`. Exit codes were preserved when
redirecting output. The backend and backup commands used the existing virtual
environment by prepending its Scripts directory to PATH in each process:

```powershell
$env:PATH = "C:\Users\reinh\repos\incoming\backend\venv\Scripts;" + $env:PATH
```

| Exact validation/setup command | Directory | Result | Evidence |
| --- | --- | --- | --- |
| `pnpm install` | root | PASS | Initial sandbox attempt failed with EPERM (tooling/environment); retry succeeded, as did install after aligning React types. Lockfile retained. |
| `pnpm typecheck` | root | FAIL — existing application issue | Exit 2; final run has 88 diagnostics. Initial run also had 42 dependency type errors (tooling/configuration issue, corrected). |
| `pnpm lint` | root | FAIL — existing application issue | Exit 1; 86 errors, 18 warnings. |
| `pnpm lint --format json --output-file "$env:TEMP\incoming-pr2-lint.json"` | root | FAIL — existing application issue | Same findings, recorded by rule and file. |
| `pnpm test` | root | PASS | Final run executes and passes 12 tests across all four test files. Initial zero-test exit was FAIL — tooling/configuration issue despite exit 0; corrected. |
| `pnpm build` | root | PASS | Both runs succeeded; final build transformed 3,225 modules. |
| `python -m compileall -q backend backup` | root | PASS | Exit 0. |
| `backend/venv/Scripts/python.exe -m pip install -r backend/requirements.txt -r backup/requirements.txt pytest` | root | PASS | Dependencies installed successfully in the existing ignored virtual environment. |
| `python -m unittest discover -s tests` | backend | FAIL — existing application issue | 38 tests reported, 2 failures, 7 errors, 6 skips. Includes existing test-fixture portability/lifecycle defects detailed below. |
| `python -m unittest discover -s tests` | backup | PASS | 10 tests, no skips. |
| `python -m pytest tests` | backend | FAIL — existing application issue | Additional coverage: 44 passed, 10 failed, 9 skipped, 2 warnings. Includes existing fixture defects. |
| `git diff --check` | root | PASS | No whitespace errors. |

Typecheck, test and build were each run before and after the package correction.
Lint was run normally and then with JSON output. No checks or files were excluded
to obtain a pass. No isolated PostgreSQL test database was configured; skipped
integration tests are unverified, not passing database coverage. Tests were not
pointed at a production database.

## Backend failure groups

Both runners execute successfully; their nonzero results are findings in the
existing application/test suite. Fixture defects below are test harness issues,
not proof of broken production behavior and not failures to install or launch
PR 2's tooling.

| Root cause | Affected files | Classification / next action |
| --- | --- | --- |
| Stale expected Alembic head: 20260818_02 versus actual 20261001_01 | `backend/tests/test_alembic_config.py` | Existing test expectation; update deliberately with migration coverage. |
| Offline migration calls scalar_one on a result unavailable in offline mode | `backend/migrations/versions/20260924_02_event_competition_mapping.py`, `backend/tests/test_alembic_config.py` | Existing application migration issue; behavior-sensitive migration fix. |
| Test reads an upload stream after Flask has closed it | `backend/tests/test_database_admin.py` | Existing fixture lifecycle defect; capture the stream inside the mock call. |
| Scenario preview accesses Athlete.query outside an application context | `backend/tests/test_scenario_generator.py`, `backend/excel_import.py` | Existing fixture/API contract mismatch; provide an isolated context and verify the intended contract. |
| Five ETL tests leave SQLite engine handles open when temporary directories are removed, producing WinError 32 | `backend/tests/test_sqlite_to_postgres_etl.py` | Existing Windows test cleanup defect; explicit engine disposal belongs in a scoped test repair. |
| Pytest-only mapping test supplies an empty athlete map, causing KeyError: by_name_key | `backend/tests/test_event_competition_mapping.py`, `backend/excel_import.py` | Existing fixture/API contract mismatch; verify expected map shape. |

Unittest reports the first two groups as failures and the stream, context, and
five cleanup cases as seven errors. Pytest additionally runs the mapping test.
No business behavior or existing tests were changed to hide these findings.

## Files changed and completion

- `package.json`: React 18 declarations and portable native TypeScript test command.
- `pnpm-lock.yaml`: install-generated dependency resolution, retained as requested.
- `docs/DEVELOPMENT.md`: test runner portability, pytest prerequisite and discovery caveat.
- `docs/PR2_VERIFICATION.md`: this verification record and grouped findings.

Ignored generated artifacts include `node_modules/`, `dist/`, dependencies in
`backend/venv/`, and Python caches. Temporary logs are outside the repository.

PR 2's executable tooling baseline is established with the corrections above.
**PR 2 is not fully green/verified complete:** typecheck, lint, and backend tests
fail, and PostgreSQL integration coverage remains skipped.

Recommended next PR: a scoped correctness/contract repair, starting with duplicate
import types, missing symbols/permissions, and stale UI/API field contracts. Keep
mechanical unused-code cleanup separate from behavior-sensitive fixes. Follow with
backend migration/fixture repairs and isolated PostgreSQL validation before broader
architectural extraction. This recommendation follows the observed findings and
the repository's incremental-refactoring guidance; a separately numbered audit
roadmap was not found in this checkout.
