# Import performance investigation

Benchmark baseline: `8760d6f`. Measurements use the same real AUS JSON fixture converted into two real XLSX files, read by the real workbook parser. Every repetition creates a disposable in-memory SQLite database with the real Competition catalogue; reimport uses 58 existing people, four retained bookings and a manual SPECIAL rate. Three repetitions per version, run sequentially without concurrent test load. cProfile is enabled: these are local profiled wall times, not production latency or PostgreSQL benchmarks. No GER fixture exists in the checked-in real_entries directory.

## End-to-end measurements

All SQL statements (SELECT and DML) are counted using SQLAlchemy cursor events. Session list contains one current import session. Times and counts below are medians.

| Phase | Before ms | After ms | Time reduction | SQL before | SQL after |
|---|---:|---:|---:|---:|---:|
| First import, persistence service | 619.38 | 278.31 | 55.1% | 875 | 291 |
| Workbook preview | 733.98 | 277.86 | 62.1% | 593 | 34 |
| Session detail GET | 794.70 | 111.48 | 86.0% | 834 | 39 |
| Session list GET | 702.16 | 105.28 | 85.0% | 834 | 39 |
| Session import POST | 1835.12 | 250.69 | 86.3% | 1879 | 118 |
| Detail GET after import | 817.14 | 104.17 | 87.3% | 834 | 39 |

First-import SQL statements fall from 875 to 291. Explicit flushes needed for new IDs remain. Reimport SQL falls by 93.7%; preview SQL by 94.3%; session-detail SQL by 95.3%. Small baseline session-list/post-import count variation (834–836) comes from ORM identity-map lifetime/lazy loading.

## Major phase timings

Timings below are cumulative inclusive profiler durations: nested rows overlap and must not be summed. The post-confirmation frontend GET is measured separately from the POST.

| Calculation | Measured flow | Before ms | After ms |
|---|---|---:|---:|
| Workbook parsing / two reads | preview | 55.66 | 56.05 |
| Entries parsing | preview | 73.12 | 78.05 |
| Room List parsing | preview | 26.00 | 26.92 |
| Identity-map construction | confirmation | 1062.83 | 1.71 |
| Person matching | confirmation | 1.53 | 1.12 |
| Requirement resolution / guard | confirmation | 32.11 | 2.89 |
| Rate resolution | confirmation | 12.70 | 0.39 |
| Exemption / single-room recognition | confirmation | 27.64 | 17.19 |
| Approval preservation | confirmation | 162.06 | 9.38 |
| DB-resolved competition evidence | confirmation | 204.19 | 6.43 |
| Booking / partner context lookup | confirmation | 231.76 | 1.49 |
| Quota-context reconstruction | confirmation | 165.59 | 90.18 |
| Quota formula evaluation | confirmation | 11.07 | 10.20 |
| Disposition comparison | confirmation | 790.91 | 15.99 |
| Person field updates | confirmation | 6.41 | 5.45 |
| Session flush incl. no-op autoflush calls | confirmation | 72.68 | 12.67 |
| Session commit | confirmation | 3.00 | 2.40 |
| Final JSON response | session_detail | 1.96 | 1.94 |
| Session/model serialization | session_detail | 9.59 | 10.75 |

`person_accommodation_coverage()` is never called in these import preview/session/confirmation flows (0 calls before and after). There is no coverage interval-calculation hotspot to optimize here. Preview requirement and rate resolvers still run once per person per validation pass. Quota reconstruction still runs once per preview calculation, twice during the complete import POST: preflight plus the authoritative recalculation under the accommodation lock. It was not rebuilt after each person.

## Memberships, bookings, audit and transactions

The SQL durations below measure cursor execution only, not ORM materialization, network latency or the full phase. Counts classify statements mentioning the corresponding table. Membership SELECTs can load multiple rows; counts are statements, not membership rows.

| SQL group during session import POST | Before statements | After statements | Before cursor ms | After cursor ms |
|---|---:|---:|---:|---:|
| AthleteCompetition handling | 295 | 7 | 41.44 | 1.05 |
| Booking / occupant lookups | 327 | 35 | 6.92 | 1.03 |
| Audit / session history | 4 | 4 | 0.10 | 0.09 |

Actual dirty flush events during reimport drop from 86 to 5. Session commits remain 2: the pre-existing snapshot persistence boundary and the route-owned lifecycle/history boundary. There were no per-person commits. Commit cost was small and did not justify changing these boundaries. New-person ID flushes and explicit rate-override row-lock refreshes remain. In a snapshot with a repeated identity, pending earlier changes are flushed before `populate_existing()` can refresh it.

Audit/history is not the bottleneck: the benchmark has no exemption changes, so `audit_status` has 0 calls. The existing IMPORTED lifecycle history is still inserted. Event/audit rows for actual changes are accumulated by the existing ORM and flushed with the controlled mutation points; no audit event is skipped or reinterpreted.

## Exact causes and implemented changes

- `GET sessions → _current_session_payload → _current_session_preview → recalculate → build_disposition_analysis` rebuilt the entire Athlete index inside its person loop. `_assignment_context` additionally queried duplicate FIS identities and lazily loaded memberships, legacy assignments and booking context for each person. A phase-local `ImportReadContext` bulk-loads these relationships and exact live Competition rows. The same read-only context is shared across session-list projections, not across requests. Session versions, approvals and history are also eager-loaded for the list.
- `preview_approval_person` issued the same Competition-ID lookup for every person on each approval/preservation pass. Optional bulk Competition data now uses the identical canonical mapper and exact IDs; no static catalogue inference or quota formula changed.
- Rate and requirement preview helpers each rebuilt the person map; requirement preview additionally queried booking existence per NO_ROOM person. They now accept the same phase-local read data. The write-time NO_ROOM booking check remains an actual database guard.
- Confirmation rebuilt the full database Athlete index and flushed after every person. It now updates/rebuilds the in-memory index only for changed/new identities, preserving collision precedence, and defers ordinary existing-person writes under `no_autoflush` to a controlled flush. New IDs and explicit rate-override refreshes keep their required flushes.
- Frontend confirmation previously awaited detail GET before starting list GET. Both canonical reads now start together. No call is removed merely because its URL looks similar: list and detail have separate consumers. Initial session opening already made one list read and one detail read; there was no redundant import request to remove.

## Correctness and browser verification

All 18 business payload projections and three persisted-person snapshots match the unmodified baseline exactly (volatile tokens/timestamps excluded). Existing tests retain MANUAL precedence, stale override rejection, SPECIAL and NO_ROOM preservation, booking guards, approval behavior, quota values, coverage, metadata and shared-booking safety. The accommodation transaction lock, expire/reload under the lock, independent row-lock/base checks and current-event/membership validation remain. No request-external cache is introduced.

Chromium against an isolated SQLite fixture and the actual rendered import screen verified: one list GET and one selected-detail GET on opening; one import POST then one list GET and one detail GET, with both GET requests initiated before either completed; successful canonical refresh; 58 people retained, 24 NO_ROOM and one manual SPECIAL unchanged; no JavaScript or API errors. Global application activity loading remains unchanged.

Validation: 138 focused backend tests passed; full fast backend run: 436 passed plus 1,028 subtests, with three existing failures independently reproduced against the unchanged baseline. They are the outdated API route-manifest assertion and two DB-less import tests lacking an application context (`test_import_extraction_characterization` preview and `test_wsc_membership_validation` invalid token). No new failure remains. Frontend: 117 passed; TypeScript and production build passed. Structural tests bound queries/flushes and check fresh state between requests plus concurrent frontend refetch initiation; no wall-clock CI assertions.

## Reproduce / limits

Run `backend/venv/bin/python scripts/benchmark_import_performance.py --label current` from the repository root. It creates only in-memory SQLite data and scratch XLSX/JSON/cProfile files in `work/performance/`. `IMPORT_BENCHMARK_BACKEND` can select an isolated baseline backend module tree; it is not a database selector. Native PostgreSQL query/lock latency and production network latency were not benchmarked. Remaining reference lookups (e.g. WorldChampion) were small in this fixture and were not changed blindly. Import session lists still recompute each current preview to retain live validation semantics; large historical response payloads are not paginated or redesigned.

No UI/response shape, `no data available` behavior, business/import precedence, quota formula, NO_ROOM semantics, coverage calculation, schema or production data changed.

## Changed files

- `backend/accommodation_rates.py`
- `backend/accommodation_requirements.py`
- `backend/app.py`
- `backend/excel_import.py`
- `backend/imports/identity.py`
- `backend/imports/read_context.py`
- `backend/quota_history.py`
- `backend/tests/test_import_performance.py`
- `frontend/src/app/components/DataImport.tsx`
- `frontend/src/app/services/importConfirmation.ts`
- `frontend/src/app/services/importConfirmation.test.ts`
- `scripts/benchmark_import_performance.py`
- `docs/import-performance.md`
