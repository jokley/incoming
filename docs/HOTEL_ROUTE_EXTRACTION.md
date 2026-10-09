# Hotel route extraction

## Scope

Ten hotel handlers moved mechanically from `backend/app.py` into the
`hotels` Blueprint in `backend/routes/hotels.py`:

| Canonical route | Methods | Compatibility routes |
| --- | --- | --- |
| `/api/hotels` | GET, POST | `/hotels`; both slash forms |
| `/api/hotels/<int:hotel_id>` | GET, PUT, DELETE | `/hotels/<int:hotel_id>`; both slash forms |
| `/api/hotels/<int:hotel_id>/inventory` | POST | Matching non-API alias; both slash forms |
| `/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>` | PUT, DELETE | Matching non-API alias; both slash forms |
| `/api/hotels/capacity-overview` | GET | None |
| `/api/hotels/<int:hotel_id>/reservations` | GET | None |

`app.py` imports and registers the Blueprint during existing initialization,
after database initialization. No service/repository layer or app factory was
introduced. The Blueprint imports Flask, SQLAlchemy, datetime, and existing
models; it does not import `app.py`.

The model serializers remain in `models.py`. Global authentication, permission
checks, canonical-alias resolution, audit snapshots and mutation auditing remain
in `app.py`, as do shared planning helpers, import/seed operations, and every
non-hotel domain. Reads retain `data.read`; mutations retain `data.write`.

Flask's internal endpoint names gain the standard `hotels.` prefix. Repository
inspection found no consumers of the old endpoint names. Canonical paths and
their aliases still resolve to the same endpoint, preserving the global alias
security hooks. No URLs, methods or handler bodies changed.

## Mechanical comparison

- `app.py`: 3,628 lines before, 3,343 after; net reduction 285 lines.
- Removed 287 hotel route lines; added one import and one registration line.
- Python AST comparison verified all 10 moved handler bodies unchanged and
  every remaining function in `app.py` unchanged.
- Live route maps before/after and the characterization manifest match exactly:
  117 paths and 162 explicit method/path pairs (excluding implicit HEAD/OPTIONS).
- File hashes confirm the existing API characterization, route-safety and
  planning tests and route manifest were not edited for this extraction.

Two focused tests were added in `test_hotel_routes.py`, registered in the
existing PostgreSQL runner. They were also run against the saved pre-extraction
app: both passed. Existing suites continue to cover hotel CRUD responses,
permissions, aliases and mutation audit parity.

## Existing behavior preserved during extraction (fixed in follow-up below)

Capacity overview reads `RoomBookingOccupant`/`RoomBooking`. Reservations reads
legacy `RoomAssignment`. This difference remains unchanged.

The new pre-extraction reservation check exposed an existing query defect:
`RoomAssignment.query.join(Athlete)` cannot choose between the `athlete_id` and
`shared_with_athlete_id` foreign keys. SQLAlchemy raises
`AmbiguousForeignKeysError` before serialization, producing an HTML HTTP 500
when exception propagation is disabled. This was reproduced against the saved
original app. At extraction time, the new test explicitly recorded that failure;
it was not skipped or marked xfail. The follow-up below repairs only the join
and retains the legacy reservations data source.

## Files for this extraction

- `backend/app.py`: removed hotel routes; imported/registered Blueprint.
- `backend/routes/__init__.py`: route package.
- `backend/routes/hotels.py`: unchanged handlers with Blueprint decorators.
- `backend/tests/test_hotel_routes.py`: two focused read-route tests.
- `scripts/test_backend.py`: registered the new PostgreSQL test module.
- This report.

Earlier uncommitted characterization and security changes remain in the working
tree; they are not additional hotel-refactor changes.

## Validation results (2026-10-07)

| Check | Result |
| --- | --- |
| New hotel tests against pre-extraction app | 2 passed |
| `scripts/test_backend.py fast` | 75 passed; 951 subtests passed |
| PostgreSQL migration checks | 2 passed; 6 subtests passed |
| PostgreSQL integration suite | 56 passed; 49 subtests passed; no skips |
| Backup tests | 15 passed |
| Legacy unittest discovery | 55 run, OK; 10 expected PostgreSQL-module skips |
| Python compile checks (excluding installed venv packages) | Passed |
| `git diff --check` | Passed |
| Before/after route manifest | Identical: 117 paths / 162 method-path pairs |

Existing SQLAlchemy legacy API warnings and the backup-download test resource
warning remain visible. No existing test was rewritten or skipped to accommodate
the extraction.

## Reservations query follow-up (2026-10-07)

`GET /api/hotels/<int:hotel_id>/reservations` failed while executing
`RoomAssignment.query.join(Athlete).join(RoomType).filter(RoomAssignment.hotel_id == hotel_id)`.
The implicit athlete join was ambiguous because both `athlete_id` and
`shared_with_athlete_id` reference `athlete.id`. This is an ORM query-shape defect,
not a PostgreSQL-specific error or a missing model relationship.

The sole production change replaces `.join(Athlete)` with
`.join(RoomAssignment.athlete)`, using the existing relationship's explicit
`athlete_id` foreign key. URL, method, filters, JSON row schema, check-in ordering,
permissions, audit hooks and legacy/canonical routing remain unchanged. The
endpoint still reads legacy `RoomAssignment`, not current `RoomBooking` rows.
Empty matches (including an unknown hotel) now reach the existing `jsonify([])`
response; previously the query error prevented even empty results from returning.

The failure-recording test was replaced with successful response assertions.
PostgreSQL regression coverage checks the full row schema, exclusion of current
bookings, shared-room guest identity and filtering, empty/filter-miss results,
check-in ordering with null dates, unauthenticated/unauthorized rejection and
viewer/editor/admin access. Before the production fix these tests reproduced
`AmbiguousForeignKeysError`; after it they pass.

| Follow-up check | Result |
| --- | --- |
| Focused hotel tests on PostgreSQL | 6 passed; 13 subtests passed |
| Fast tests | 75 passed; 951 subtests passed |
| PostgreSQL migration checks | 2 passed; 6 subtests passed |
| PostgreSQL integration suite | 60 passed; 62 subtests passed; no skips |
| Backup tests | 15 passed |
| Legacy unittest discovery | 55 run, OK; 10 expected PostgreSQL-module skips |
| Python compile checks for backend, backup and scripts (excluding venv) | Passed |
| `git diff --check` | Passed |
| Live route manifest vs. characterization and pre-extraction baselines | Identical: 117 paths / 162 method-path pairs |
| AST comparison of all ten hotel handler bodies vs. pre-extraction source | Only the intended athlete join changed |

Only `backend/routes/hotels.py`, `backend/tests/test_hotel_routes.py` and this
document were edited for the follow-up. Existing unrelated working-tree changes
were retained. Existing SQLAlchemy legacy API warnings remain.

No unrelated hotel or API behavior was intentionally changed.
