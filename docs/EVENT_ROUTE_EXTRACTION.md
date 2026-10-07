# Event route extraction

## Boundary

The following 12 handlers (10 paths, 14 method/path pairs) moved mechanically
from `backend/app.py` to the `events` blueprint in `backend/routes/events.py`:

| Path | Methods | Handlers |
| --- | --- | --- |
| `/api/events` | GET, POST | `get_events`, `create_event` |
| `/api/events/<int:event_id>` | PUT, DELETE | `update_event`, `delete_event` |
| `/api/events/<int:event_id>/demand` | POST | `add_event_demand` |
| `/api/events/<int:event_id>/demand/<int:demand_id>` | DELETE | `delete_event_demand` |
| `/api/championship-events` | GET | `list_active_championship_events` |
| `/api/admin/events` | GET, POST | `administer_events` |
| `/api/admin/events/<int:event_id>` | GET, PUT | `administer_event` |
| `/api/admin/events/<int:event_id>/competitions` | POST | `add_event_competition` |
| `/api/admin/events/<int:event_id>/competitions/<int:mapping_id>` | PUT | `update_event_competition` |
| `/api/admin/events/<int:event_id>/copy-mappings` | POST | `copy_event_competitions` |

There are no registered compatibility aliases or trailing-slash variants for
these routes. Flask endpoint names gain the blueprint prefix, as in the hotel
extraction; URLs, methods and handler names are preserved.

`AccommodationEvent` and `EventRoomDemand` serve the accommodation endpoints.
`Event` and `EventCompetition` serve championship administration, with
`Competition` remaining the shared catalogue. All model serializers stay in
`models.py`. There are no event-only free helper functions to move.
`normalize_event_id` and `ImportValidationError` remain in `excel_import.py`
and are imported directly by the blueprint. No import workflow code moves.

Shared authentication, permission resolution and mutation audit hooks remain
in `app.py`. Reads require `data.read`, accommodation mutations require
`data.write`, and all `/api/admin/` requests require `admin.reset`.
Successful accommodation mutations produce the same business audit entries;
administrative event/mapping mutations remain excluded from that chronicle.

The competition catalogue route, import handlers including `import_events`,
reference-data seeds, timeline, capacity calculations and their shared model
imports remain in `app.py`. Hotel routes, assignments, quota logic, auth,
audit implementation and migrations are untouched.

## Files and size

- `backend/app.py`: removes the two event route blocks and registers the blueprint.
- `backend/routes/events.py`: contains the unchanged handler bodies and decorators
  with `app.route` replaced by `events.route`.
- `backend/tests/test_event_routes.py`: adds four focused PostgreSQL HTTP tests.
- `scripts/test_backend.py`: includes that module in PostgreSQL integration runs.
- `docs/EVENT_ROUTE_EXTRACTION.md`: records the boundary and verification.

`app.py`: **3,343 -> 3,201 lines**, a net reduction of **142** (144 moved lines,
two added import/registration lines).

## Verification

The new tests passed against the original handlers before extraction together
with existing mapping, characterization and route safety tests: **35 passed,
967 subtests passed**. Existing characterization tests and the reviewed route
fixture were not edited.

After extraction, that selection plus hotel tests passed: **41 passed,
980 subtests passed**. Coverage includes accommodation read/CRUD/clamping,
championship list ordering and active filtering, detail/update schemas,
permissions, absent aliases/slash variants, mapping creation/update/scoping,
copy validation and independent copies, skipping existing competitions,
self-copy, and audit parity (including no audit for rejected commands or
administrative event/mapping mutations).

AST comparison against the saved pre-extraction source confirms all 12 moved
handlers are identical after normalizing only the route decorator receiver.
Every remaining function in `app.py` is AST-identical as well.
The live Flask route manifest before/after and the reviewed fixture are
identical: **117 paths / 162 method-path pairs** (excluding implicit HEAD/OPTIONS
and Flask static, matching the existing manifest convention).

| Complete backend baseline | Result |
| --- | --- |
| Fast tests | 75 passed; 951 subtests passed |
| Migration tests | 2 passed; 6 subtests passed |
| PostgreSQL runner migration phase | 2 passed; 6 subtests passed |
| PostgreSQL integration, including hotel and new event tests | 64 passed; 62 subtests passed; no skips |
| Backup tests | 15 passed |
| Legacy unittest discovery | 56 run, OK; 11 expected PostgreSQL-module skips |
| Compile checks for backend, backup and scripts, excluding venv | Passed |
| `git diff --check` | Passed |

Commands used the existing `backend/venv/Scripts/python.exe` and
`scripts/test_backend.py` modes `fast`, `migrate`, `postgres`, `backup`, and
`unittest`. The focused selection used the same runner's guarded test environment.
The interpreter required execution outside the filesystem sandbox. Logs and
before/after snapshots are retained in the ignored `.local-test/events-*.log`
and `.local-test/event-*` files. PostgreSQL tests ran against the dedicated,
validated local test database.

## Existing behavior intentionally retained

- Accommodation demand POST/DELETE commands return 405 and do not audit.
- Accommodation DELETE retains the audit activity text `Event geändert`.
- Admin event/mapping mutations do not create business audit entries.
- Create and update validation remain asymmetric: creation trims mapping fields
  and checks required values; updates assign supplied fields directly.
- Copying mappings skips existing competition IDs and copies inactive rows too.
- SQLAlchemy legacy `Query.get()` warnings remain.

No Event API or business behavior was intentionally changed.
