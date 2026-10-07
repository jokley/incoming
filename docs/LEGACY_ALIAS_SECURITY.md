# Legacy alias security remediation

## Inventory and usage review

The 117-path / 162-method-path manifest remains unchanged. It contains 24
non-API compatibility paths (12 patterns, each with and without a trailing
slash), accounting for 42 explicit method/path pairs. `/health` and Flask's
static-file route are independent endpoints, not aliases.

| Alias pattern (both slash forms) | Methods | Classification |
| --- | --- | --- |
| `/room-types` | GET, POST | Read-only GET; mutating POST |
| `/room-types/<int:room_type_id>` | PUT, DELETE | Mutating |
| `/hotels` | GET, POST | Read-only GET; mutating POST |
| `/hotels/<int:hotel_id>` | GET, PUT, DELETE | Read-only GET; mutating PUT/DELETE |
| `/hotels/<int:hotel_id>/inventory` | POST | Mutating |
| `/hotels/<int:hotel_id>/inventory/<int:inventory_id>` | PUT, DELETE | Mutating |
| `/athletes` | GET, POST | Read-only GET; mutating POST |
| `/room-assignments` | GET, POST | Read-only GET; mutating POST |
| `/room-assignments/<int:assignment_id>` | PUT, DELETE | Mutating |
| `/room-bookings/grouped` | GET | Read-only |
| `/fis/official-quotas` | GET | Read-only |
| `/import/excel` | POST | Obsolete; returns 410 without mutation |

Read-only aliases expose protected application data and are safe to retain only
with the same read permission as the canonical route. All aliases remain
compatibility paths: no external requirement was independently verified, but
absence of consumers was not established either. None is removed.

Repository evidence inspected before editing:

- `src/app/services/api.ts` appends resource paths to `API_BASE_URL`, which
  defaults to `/api`. Environment examples and Compose include `/api`; the local
  development launcher requires it. Strings such as `'/hotels'` in this client
  therefore request `/api/hotels`, not the legacy backend alias.
- `src/app/routes.tsx` and navigation components use `/hotels`, `/athletes`, and
  `/room-types` as SPA pages. These are not backend API calls.
- `test_api_route_safety.py` and `fixtures/api_routes.json` cover every alias.
  `test_api_characterization.py` calls hotel, person, quota, and retired-import
  aliases; `test_assignment_planning_projection.py` calls grouped-booking
  aliases. These are deliberate compatibility checks.
- No direct non-API calls were found in the inspected repository scripts.
  Deployment examples use `/api/room-types`.
- Repository Nginx routes `/api/` to the backend and `/` to the frontend; Vite
  proxies `/api`. Compose exposes backend port 5000 internally rather than
  publishing it. Actual deployed proxy settings, access logs, and external
  scripts were not available for verification. This configuration evidence is
  not proof that a backend alias cannot be reached.

## Original defect and minimal fix

Previously the authentication hook and successful-mutation audit hook both
required `request.path.startswith('/api/')`. All aliases bypassed both hooks.
Permission selection, pre-delete snapshots, and audit entity classification
also depended on the canonical path.

`_canonical_api_path()` now resolves a non-API request only if Flask has matched
a registered rule and that same endpoint/method has a corresponding `/api`
rule. Existing canonical paths are returned unchanged. The shared hooks use
this request-local canonical path for permission checks, snapshots, audit
classification, and audit eligibility. There is no redirect, internal second
request, new handler, or duplicated authentication policy.

The audit record retains the original request path, so legacy usage remains
observable. The actor, request ID, action, entity references, business activity,
and delete snapshot follow the canonical behavior. Canonical responses, auth
configuration, role permissions, route registrations, and business handlers
remain unchanged. Public health checks, static files, unknown non-API 404s, and
automatic OPTIONS behavior are unaffected.

Authenticated legacy callers need the same trusted proxy identity and
permissions as canonical callers. Unauthenticated legacy reads and writes now
return 401; identities without the required permission return 403. The obsolete
Excel endpoint returns 410 only after the same import permission check as its
canonical counterpart. Failed requests produce no successful-mutation audit.

## Regression coverage

- Every alias and canonical route rejects anonymous access (including HEAD
  for reads) and authenticated identities with no permissions.
- Viewer writes are denied; individual capability tests verify alias/canonical
  dispatch parity, including `assignments.write` and `imports.write`.
- A real PostgreSQL sequence exercises all 13 mutating method/pattern
  combinations via canonical and legacy URLs, with both slash forms. It compares
  HTTP status/body and audit content, checks exactly one audit per mutation,
  and verifies the original URL, editor identity, and request ID.
- Delete audits retain person/hotel/room-type context. Unauthorized attempts
  create no audit records; persisted final state matches the canonical flow.
- Existing read-alias, import, planning, quota, person, and route-manifest tests
  continue to run. The retired import's 410 response is not audited as success.

## Separate follow-up: token confirmation versus session approval

This finding was outside the alias fix and has since been addressed by the
[direct confirmation approval follow-up](DIRECT_CONFIRMATION_APPROVAL.md).
The paragraph below records its state at the time of the alias investigation.

`/api/import/fis/confirm` can consume a valid preview token without an approved
session; `/api/import/sessions/<id>/import` requires explicit session approval.
This remains unchanged and is outside this security fix. A separate decision
should establish the intended direct-confirm contract, inventory its consumers,
and add migration/authorization tests before changing it. The existing
characterization test intentionally continues to record the current behavior.

## Verification

Run `scripts/test_backend.py fast`, `unittest`, `postgres`, and `backup` with
the backend virtual environment. The PostgreSQL runner first validates the
dedicated test target and runs migration checks. No restored development data
is used by these tests.

Results on 2026-10-06:

| Check | Result |
| --- | --- |
| Fast baseline | 75 passed; 951 subtests passed |
| Legacy unittest discovery | 54 run, OK; 9 expected PostgreSQL-module skips |
| PostgreSQL migrations | 2 passed; 6 subtests passed |
| PostgreSQL integration | 50 passed; 37 subtests passed; no skips |
| Backup suite | 15 passed |
| Python syntax (excluding installed venv packages) | Passed |
| Diff whitespace check | Passed |

Existing SQLAlchemy legacy API warnings and the backup-download test resource
warning remain visible; no warnings were suppressed.
