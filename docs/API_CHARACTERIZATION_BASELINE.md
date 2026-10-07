# Backend API characterization and route safety

This report records the initial pre-remediation inspection. The subsequent
[legacy alias security fix](LEGACY_ALIAS_SECURITY.md) closes the alias auth/audit
bypass described below and updates those test expectations. The route manifest
remains unchanged. The separate
[direct-confirm approval fix](DIRECT_CONFIRMATION_APPROVAL.md) subsequently
replaced the bypass characterization with shared session-eligibility tests.

This baseline precedes extraction of routes from `backend/app.py`. It changes
tests and documentation only, plus test-runner registration. Production routes,
responses, business rules, and compatibility aliases remain unchanged.

## Inspected surface

The [endpoint catalogue](API_ENDPOINT_CATALOGUE.md) describes canonical routes
and compatibility aliases. The reviewed [route manifest](../backend/tests/fixtures/api_routes.json)
records all 117 registered application paths and 162 explicit method/path pairs,
including the database administration blueprint and `/health`. Flask's static
route and implicit HEAD/OPTIONS methods are excluded from the manifest; HEAD
authentication and OPTIONS availability are tested separately.

One observed Flask routing exception is preserved explicitly: OPTIONS on
`/api/import/fis/mock-files/<path:filename>` returns a 308 redirect to the slash
form, which then returns 200 without authentication.

Canonical `/api/` families include identity, audit, debug, room types, hotels and
inventory, accommodation events, championship events and competition mappings,
athletes, assignments and planning, quotas, imports and approvals, analytics,
and administration (scenarios, simulation, reset, database/backup operations).

Non-API aliases have both slash and no-slash registrations:

| Alias | Methods | Current effect |
| --- | --- | --- |
| `/room-types` | GET, POST | Read/create |
| `/room-types/<int:room_type_id>` | PUT, DELETE | Update/delete |
| `/hotels` | GET, POST | Read/create |
| `/hotels/<int:hotel_id>` | GET, PUT, DELETE | Read/update/delete |
| `/hotels/<int:hotel_id>/inventory` | POST | Create |
| `/hotels/<int:hotel_id>/inventory/<int:inventory_id>` | PUT, DELETE | Update/delete |
| `/athletes` | GET, POST | Read/create |
| `/room-assignments` | GET, POST | Read/create booking |
| `/room-assignments/<int:assignment_id>` | PUT, DELETE | Update/delete booking |
| `/room-bookings/grouped` | GET | Grouped booking read |
| `/fis/official-quotas` | GET | Quota read |
| `/import/excel` | POST | Retired entry point; 410, no import |

The alternate API names `/api/official-quotas` and
`/api/room-assignments/grouped` also remain registered, with slash variants.
`/health` is an independent operational endpoint, not a compatibility alias.

## Authentication and security observations

The global authentication hook only handles paths starting with `/api/` and
skips OPTIONS. Proxy-secret validation precedes permission checks. A configured
development identity is an explicit authentication fallback.

| Canonical request | Permission |
| --- | --- |
| `/api/auth/me` | Authenticated identity only |
| `/api/audit-events` | `audit.read` |
| `/api/admin/*`, including reads | `admin.reset` |
| Other GET/HEAD | `data.read` |
| `/api/import/*` mutations, including approval decisions | `imports.write` |
| `/api/assignments/*`, `/api/room-assignments*` mutations | `assignments.write` |
| Other mutations | `data.write` |

Viewers can read ordinary data, editors can mutate data/imports/assignments and
read audit records, and administrators have all permissions. Consequently,
single-room approval decisions are available to editors, not just admins.
The debug route map is also an ordinary authenticated data read.

**Original security finding (subsequently fixed):** non-API aliases bypassed
authentication and authorization, including handlers that persist mutations.
They also bypassed mutation auditing. The initial tests demonstrated dispatch
for every alias and a real unauthenticated hotel creation without an audit row.
The [scoped security fix](LEGACY_ALIAS_SECURITY.md) now replaces those bypass
expectations with auth/audit parity checks. Deployment reachability was not
verified by this repository inspection.

At initial inspection, direct `/api/import/fis/confirm` consumed a process-local preview token without
requiring an approved import session. The session `/import` command separately
requires explicit approval. A real generated-workbook test freezes this
distinction, preview's lack of live-person/booking writes, and token replay
rejection. This is current behavior, not an endorsement of bypassing review.

## Coverage assessment before additions

| Area | Existing evidence | Missing boundary covered here |
| --- | --- | --- |
| Planning | `test_assignment_planning_projection.py`: full/slim/deferred validation, projections, booking/unassign, single flag | Route/slash registration, planning slash response, populated grouped-booking aliases, and access checks |
| Quotas | Planning and operational-impact tests: assignment propagation, gender/filter normalization, entitlement and single-room usage | Alternate URL equivalence and empty nation filter |
| People | `test_person_identity.py`: FIS identity aggregation; single-room and projection tests: assignment/status fields | Collection aliases, unassigned defaults, detail versus collection distinction |
| Hotels | Used as fixtures in booking tests | Nested inventory HTTP shape, null/string/date conventions, read aliases, partial update, 204 delete, HTML 404 |
| Events | Competition/mapping service and import-event-ID tests | Accommodation event HTTP contract, clamping, retired manual-demand commands |
| Import | Preview event-ID errors, import service/versioning/operational tests | HTTP confirmation errors, no writes on rejection, real preview/confirm/token replay, session approval gate |
| Single-room approvals | Completed-decision revision/auditing and staged-exemption tests | Viewer denial, editor success, invalid decision/metadata/person-selection rejection, read projection |
| Route safety | No complete runtime surface or authorization matrix | Frozen paths/methods, all canonical unauthenticated and unknown-role denials, viewer writes, editor admin denials, individual permission allow/deny checks, OPTIONS and alias dispatch |

## Extraction contract

- Keep the explicit route manifest fixed during extraction. It intentionally
  excludes Python function names, endpoint names, and module locations.
- The alias dispatch test compares actual registered callables, not hard-coded
  endpoint names, so blueprint naming changes remain possible.
- Keep the existing planning, quota, person, import and single-room regression
  tests alongside the new HTTP tests. Repeating their domain assertions in a
  second suite would add maintenance without improving this boundary.
- Do not regenerate the manifest just to make a route regression pass. Review
  intentional API/security changes separately.
- PostgreSQL fixtures use the existing fail-closed `incoming_test` guard. They
  recreate only the dedicated test schema, never restored development data.

## Verification commands

Run with the backend virtual environment's Python from the repository root:

```text
python scripts/test_backend.py fast
python scripts/test_backend.py unittest
python scripts/test_backend.py postgres
python scripts/test_backend.py backup
python -m compileall -q backend backup
```

The PostgreSQL runner includes migration verification before ORM/API tests.
The new integration module is registered in that runner and excluded from the
fast suite. The route-safety suite requires no database connection.

## Recorded results (2026-10-06)

| Check | Result |
| --- | --- |
| Fast pytest baseline | 74 passed; 657 subtests passed |
| Legacy unittest discovery | 53 run, OK; 9 expected PostgreSQL-module skips |
| PostgreSQL migrations | 2 passed; 6 subtests passed |
| PostgreSQL ORM/API integration | 49 passed; 33 subtests passed; no skips |
| Backup unittest suite | 15 passed |
| Python syntax compilation | Passed (virtual-environment packages excluded) |
| `git diff --check` | Passed |

SQLAlchemy legacy `Query.get()` warnings and an existing backup-download test
resource warning remain visible. No production fixes or warning suppression
were introduced. The new modules add 17 tests; two existing planning tests also
gain alias assertions.
