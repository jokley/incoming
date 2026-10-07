# Limited Athlete/Person route extraction

Only four handlers moved from `backend/app.py` to the `athletes` blueprint in
`backend/routes/athletes.py`:

| Handler | Methods | Paths |
| --- | --- | --- |
| `get_athletes` | GET | `/api/athletes`, `/api/athletes/`, `/athletes`, `/athletes/` |
| `get_athlete` | GET | `/api/athletes/<int:athlete_id>`, same path with trailing slash |
| `create_athlete` | POST | `/api/athletes`, `/api/athletes/`, `/athletes`, `/athletes/` |
| `acknowledge_athlete_roomlist_change` | POST | `/api/athletes/<int:athlete_id>/acknowledge-roomlist-change`, same path with trailing slash |

The blueprint imports Flask, datetime and the existing models directly. There
are no imports from `app.py`, no shared-helper extraction and no new utility or
service modules. Identity aggregation, booking projections and import-related
response fields move unchanged with the list handler. Model serializers remain
in `models.py`.

`update_athlete`, `_update_athlete_operations`, `_build_official_quota_usage_rows`
and `_normalize_gender` remain unchanged in `app.py`, as do all quota/import/update
logic and global authentication, permission and audit hooks. Hotels and Events
are untouched. Blueprint endpoint names gain the `athletes.` prefix; URL paths
and HTTP methods do not change.

## Files and size

- `backend/app.py`: removes four handlers and adds blueprint import/registration.
- `backend/routes/athletes.py`: the extracted routes.
- `backend/tests/test_athlete_routes.py`: focused acknowledgement characterization.
- `scripts/test_backend.py`: registers the new PostgreSQL test module.
- `docs/ATHLETE_ROUTE_EXTRACTION.md`: boundary and validation record.

`app.py`: **3,201 -> 3,030 lines**; 173 lines removed, two added, net reduction 171.
Existing characterization, identity, planning, status and route-safety tests
were not edited.

## Behavior characterized before extraction

The new tests passed against the original handlers: **3 tests and 10 subtests**.
They cover both slash variants, successful editor/admin acknowledgement, full
response parity, persisted timestamp and summary, repeated acknowledgement,
missing change, missing person, authentication, permissions and audit behavior.

Existing behavior deliberately retained:

- Missing `roomlist_changed_at` returns 400 with
  `{"error": "No roomlist change to acknowledge"}`; it does not audit.
- Missing person returns 404 and does not audit.
- An already-acknowledged change can be acknowledged again. This overwrites the
  acknowledgement timestamp, copies the current summary and creates another
  audit entry; it is not a no-op.
- The response is the person serializer plus `hasPendingRoomlistReview: false`.
  No booking or pending-review check is required by the acknowledgement handler.
- The POST is audited as action `create`, activity `Athlet angelegt`, with a
  `personId` reference. The original request path, including its slash, is kept.
- Unauthenticated requests return 401; authenticated viewers and unknown roles
  return 403. Rejected requests leave acknowledgement and audit state unchanged.
- Existing SQLAlchemy legacy API warnings remain.

## Structural verification

The live Flask manifest before and after matches the unchanged reviewed fixture:
**117 paths / 162 method-path pairs**, excluding implicit HEAD/OPTIONS and Flask
static according to the existing convention.

AST comparison confirms exactly the four authorized functions moved, unchanged
after normalizing only the route decorator receiver from `athletes` to `app`.
Every remaining function in `app.py` is AST-identical to the saved original.

## Validation

The post-extraction focused selection includes the new acknowledgement tests,
person identity, planning projection, single-room status, route safety, unchanged
API characterization, hotel routes and event routes: **59 passed, 995 subtests
passed**. This includes the three new tests previously run against the original
handlers.

| Check | Result |
| --- | --- |
| Fast tests | 75 passed; 951 subtests passed |
| Migration tests | 2 passed; 6 subtests passed |
| PostgreSQL runner migration phase | 2 passed; 6 subtests passed |
| PostgreSQL integration | 67 passed; 72 subtests passed; no skips |
| Backup tests | 15 passed |
| Legacy unittest discovery | 57 run, OK; 12 expected PostgreSQL-module skips |
| Compile checks: backend, backup, scripts, excluding venv | Passed |
| `git diff --check` | Passed |

The existing virtual-environment Python required execution outside the sandbox.
Tests use the runner's guarded local PostgreSQL environment. Logs and snapshots
are retained in ignored `.local-test/athletes-*.log` and `.local-test/athlete-*`.

No Athlete/Person API or business behavior was intentionally changed.
