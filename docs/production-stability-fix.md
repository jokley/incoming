# P1 production stability fix

Base: main `3634336` (merged PR335). No schema/model/migration changes. No production database access, deployment, backup, restore or reset performed.

## Causes and changes

### Global database metadata

`app._required_permission()` previously treated all database administration as `admin.reset`. `authenticate_api_request()` additionally required explicit access to every Event and a pinned maintenance deployment for every database route, including status/list GETs. The configured Superadmin intentionally does not inherit reset privileges.

An exact method/path allowlist now separates GET/HEAD `/api/admin/database/status` and `/api/admin/database/backups`. The verified, configured Superadmin can read these two global metadata endpoints without operational Event selection, explicit Event grants, or `OPERATIONAL_EVENT_ID`. No username is hardcoded; the existing `SUPERADMIN_USERNAME` configuration (production: jokley) remains authoritative. All other callers retain existing checks.

Downloads remain global data exports even though they use GET. Download/create/upload/restore retain the existing functional permission, request Event, explicit all-Event grants (including inactive Events, no Superadmin bypass), and maintenance pin checks. Reset is unchanged. No extra dangerous capability is granted.

Status returns separate `capabilities` hints, calculated using those existing checks. The client disables create/upload/download/restore when hints are absent/false. Hints are not authorization; every actual endpoint still validates. Database failure makes hints fail closed.

The client requests only the two metadata GETs through an event-independent transport lease; all downloads and writes remain event-bound. Status/list load independently with separate errors. A failed list no longer pretends to be an empty list; HTTP403 is distinguished from service failure. The screen labels database reachability separately from successful backup evidence. A last failed backup is not displayed as a successful one. Raw backup error text, internal database names and connection details are excluded from last-backup metadata.

| Actor/context | Metadata | Download | Create/upload/restore | Reset |
|---|---|---|---|---|
| Verified configured Superadmin, no reset role/grants/pin | Yes | Denied | Denied | Denied |
| Ordinary viewer/editor/ungranted user | Denied | Denied | Denied | Denied |
| Existing maintenance administrator | Existing strict checks | Reset permission + authorized request Event + explicit all-Event READ + pin | Reset permission + authorized request Event + explicit all-Event WRITE + pin | Existing independent reset checks unchanged |

No backup-service authentication bypass, port exposure, automatic backup or restore is introduced. HTTP health still means process reachability, not verified backup/restore capability. The actual production backup-service state needs the previously supplied read-only operator diagnosis and a separately authorized isolated restore drill.

### Approval projection

`Athlete.to_dict()` derives approved disciplines and contexts separately. Both previously repeated the entire multi-person approval check. For every approved person, this reloaded the nation roster and scanned it once per selected identity. The same work recurred in planning, booking and live quota responses.

`backend/approval_projection.py` supplies a request-local read context:

- current rule/Event applicability once per decision and owner;
- immutable decision evidence and selected keys reused;
- roster fetched once per Event/nation with Competition memberships;
- identity index built once, preserving ambiguous matches;
- active athlete allowance contexts derived once per exact roster;
- entire selected cohort validated once per decision/exact roster;
- both DTO projections derived from the same validated result.

Canonical checks remain in `quota_history.py`; the read context is an optional acceleration input. Explicit caller-provided rosters are kept separate from persisted rosters. Event/nation/gender, exact Competition identities, historical evidence, selected person keys and active rule revision are still required. A single invalid selected member still invalidates the whole cohort. Single-person Athlete approvals retain the previous singleton-roster semantics.

Only GET/HEAD projection wrappers use this context; write/reimport/preservation calls continue through the uncached canonical path. Context resets at each API request, including tests holding an outer Flask app context. No global/cross-request cache, stored person updates or stored approval updates.

Booking reads also eager-load Hotel, RoomType, occupants, Athlete and Competition relationships using the existing event-filtered query helper. Live Officials quota eagerly loads memberships. Event ownership criteria remain applied to relationship loaders.

## Measurements

Local PostgreSQL17, two Championships, 45 Hotels, 109 inventories, seven planning Events, four bookings, 300 people in the measured Event/nation, one EZ decision selecting 20 people. Two fresh HTTP dispatches per case; minimum warm time. Cursor query count includes authorization. These are reproducible local comparisons, not production percentiles.

| Endpoint | Before ms / SQL | After ms / SQL |
|---|---:|---:|
| Persons | 2,187.97 / 169 | 54.47 / 13 |
| Planning (`includeValidations=false`) | 2,633.25 / 200 | 75.43 / 12 |
| Officials quota | 1,056.62 / 57 | 44.84 / 11 |
| Booking alias | 482.71 / 53 | 22.19 / 10 |

Payload sizes remain 780,824 / 873,744 / 54,601 / 8,958 bytes respectively. Unprofiled time minus measured cursor time for Persons fell from approximately 2,043 ms to 43 ms; this includes ORM/serialization/dispatch overhead, not exclusively projection CPU. The earlier pre-PR8 comparison (same historical validator and cohort) supplies the baseline cProfile; cProfile shows the 300 `Athlete.to_dict` calls falling from about 7.52 s to 0.047 s under instrumentation; total call count from 27.5 million to 185 thousand. Profiled times are slower than uninstrumented HTTP times and must not be combined as the same measurement.

Independent comparison against the original PR335 code on the **same persisted synthetic database** produced identical canonicalized full-JSON SHA256 values:

| Endpoint | SHA256 before = after |
|---|---|
| Persons | `7f9657f034fd0aa1a1e8af326c15c139d76e02ad7dfa5285f391506226a45363` |
| Bookings | `afb3caa84bf9d9404b2f26579bbdce80191db255e7b12e2993e63708296a18e7` |
| Planning | `681151d76f39dc37af888c818af2d72c1843a1692895f3be181cb81b593edbba` |
| Officials quota | `186f59176f27fe3ab1bf564b2e00a9aa3c618a1dd54f97e8af3b31f9b501f580` |

### Browser

Real Chromium, React/Vite and local HTTP backend, same synthetic cohort. Administration, Dashboard, Persons, Disposition, Import list and Analytics opened sequentially. Measurement point is navigation → networkidle + fixed 1.2 s observation, **not TTI or React render time**.

| View | Before | After |
|---|---:|---:|
| Administration | 3.61 s | 2.87 s |
| Dashboard | 5.24 s | 2.73 s |
| Persons | 4.91 s | 2.67 s |
| Disposition | 8.83 s | 2.90 s |
| Import list (small synthetic session) | 2.58 s | 2.60 s |
| Analytics | 5.30 s | 2.71 s |

Disposition's slowest initial API fell from 6,132 ms to 331 ms. Request count was not changed. No browser claim about large real stored import reviews is made.

Additional real-browser checks passed: metadata loads without maintenance pin; dangerous actions disabled; status403 preserves successfully loaded backup rows; list503 preserves database status and does not display an empty-backup assertion; 390px viewport has no horizontal overflow. Service success used an explicit synthetic Alembic-version fixture, not an actual deployment/migration. No action button invoking backup/restore/reset was clicked.

## Automated verification

Final results:

- Final full Backend suite with actual JPN workbook paths configured: **879 passed, 0 skipped; 1,282 subtests passed** (210.06 s). This includes the final short-circuit regression. An earlier full run passed 874 with four JPN cases skipped; all four were subsequently run with actual workbooks and are also included in the final full run.
- Frontend: **174 passed, 0 failed**.
- Backup: **21 passed plus 14 subtests**.
- Typecheck, production build and `git diff --check`: passed. Vite retains existing chunk-size advisory; no build error.
- New 300-person acceptance tests, exact JSON comparisons and existing import query/flush budgets: passed in the full suite.
- PostgreSQL migration-chain tests are included in the full Backend suite, on the guarded local test database only. This patch itself adds no migration.
- The first full invocation from repository root had one relative-fixture-path failure and one obsolete metadata-denial assertion. Correct working directory and the intentional permission expectation update resolve them. The passing final suite has no remaining Backend failures; no test was disabled. Existing SQLAlchemy/datetime deprecation warnings remain.

Tests use the guarded dedicated loopback PostgreSQL test target only; no production connection. Run backend tests from `backend/` because an existing real-import fixture uses a relative `tests/fixtures` path.

```sh
# FLASK_ENV=test, DATABASE_URL and TEST_DATABASE_URL must identify the
# existing guarded localhost:55432 incoming_test target (see test_support.py).
cd backend
python -m pytest tests -q --disable-warnings
python -m pytest tests/test_approval_projection_performance.py tests/test_import_performance.py -q -s
# From repository root:
python -m pytest backup/tests -q
# From frontend:
npm test
npm run typecheck
npm run build
```

New acceptance also preserves the unapproved-decision short circuit even when unused evidence is malformed. The population fixture includes 300 JPN people plus another nation and a second Event reusing FIS IDs. Four real HTTP endpoints compare full JSON against canonical uncached validation and enforce query budgets. Additional cases cover stale quota revisions, changed Competition memberships, foreign nation/Event evidence and selected-cohort invalidation. Read requests are asserted not to issue INSERT/UPDATE/DELETE. Existing import query/flush budgets remain covered by the full suite.

The old Superadmin metadata denial assertions in PR9/freeze tests are changed intentionally. They now assert metadata access and separately assert download protection. No tests disabled or quota expectations weakened.

## Scope and remaining risks

- No model/schema/migration changes; no quota formulas, fees, accommodation, import, approval or preservation semantics changed.
- No production persons, memberships, approvals, revisions, bookings, inventory or planning data changed.
- Historical and current revision applicability remain distinct; historical approvals are not transferred to newly uncovered contexts.
- Booking eager loading is included because the isolated measurement demonstrated avoidable queries. Analytics polling, parallel page calls, payload contracts and the Vite Dockerfile are deliberately unchanged: the P1 bottleneck is removed without a broader refactor. Production static delivery and bounded restore-success polling remain separate follow-ups.
- Read-context data are assumed immutable during a GET/HEAD. Do not reuse the class as a write/import cache or move it into a process-global cache.
- Large multi-nation production datasets and real Gunicorn concurrency still need post-deployment monitoring. Local timing is not an SLA.
- Real JPN workbook cases initially skipped for unset fixture paths are all included in the passing final full run; workbooks are not committed.

## Operator rollout and rollback (not executed)

1. Review PR and verify actual deployed backend/frontend commits, image IDs and current Alembic revision. Confirm Superadmin configuration, trusted proxy identity and required function roles. Do not print secrets.
2. Verify a recent successful backup and separately rehearse restoration into an isolated target. Do not restore production as a smoke test. Resolve any unhealthy backup service independently.
3. Stage this patch against a synthetic/sanitized database matching the deployed schema. This PR adds no migration. **The existing backend entrypoint always runs `alembic upgrade head`: if older PR335 migrations are still pending, stop and obtain a separately reviewed migration rollout rather than applying them incidentally.**
4. Retain previous application image/source revision and environment configuration. Deploy backend and frontend together through the normal authorized operator process; no DB reset or rule reinitialization.
5. Check health and authenticated metadata/list access as configured Superadmin without a pin. Verify ordinary viewer denied, and unpinned/download/restore/reset remain denied. Do not invoke a real restore/reset. Check person/Disposition/Officials responses, active rule revision and A→B→A isolation; inspect aggregate SQL/latencies without logging PII.
6. Observe CPU/RAM, DB connections and endpoint duration under normal traffic. Verify no repeated 403 loops and list/service failures remain separate.
7. Roll back application code/images if necessary. With no schema/data changes in this PR, no downgrade or database restore is needed. Preserve all live operational writes made in the interim. Previously installed migrations remain installed. A rollback returns the old metadata restriction and performance limitation; do not work around them by granting global reset rights.

## Files

Backend: `app.py`, new `approval_projection.py`, `quota_history.py`, `database_admin.py`, `routes/booking_reads.py`.
Tests: new `tests/test_approval_projection_performance.py`, `tests/test_database_admin.py`, `tests/test_user_access_admin.py`, `tests/test_freeze_acceptance.py`.
Frontend: `DatabaseBackups.tsx`, `events/eventRequestScope.ts`, new `events/databaseMetadata.test.ts`, `services/api.ts`.
Documentation: this report. No database files, workbooks, credentials, production Event IDs, build artifacts or dependency changes included.
