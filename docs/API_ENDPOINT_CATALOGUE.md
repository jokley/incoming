# Canonical API endpoint catalogue

## Status and conventions

This catalogue documents the current HTTP surface; it does not approve any
route for removal.

- A path beginning with `/api/` is the **canonical application endpoint**.
- A path without `/api/`, an alternate resource name, or a duplicate
  slash/no-slash registration is a **compatibility alias**.
- **Compatibility aliases are not approved for removal.** Static frontend usage
  is not evidence that external scripts, bookmarks, or integrations do not use
  an alias. Removal requires access-log review, an owner decision, and regression
  tests.
- Slash variants shown as `[/]` register both forms and have identical behavior.
- Unless noted, `/api/*` routes pass through proxy-header authentication.
  Permission selection is currently path/method based:
  - reads: `data.read`;
  - normal mutations: `data.write`;
  - `/api/import/*` mutations: `imports.write`;
  - `/api/assignments/*` and `/api/room-assignments*` mutations:
    `assignments.write`;
  - audit reads: `audit.read`;
  - `/api/admin/*`: administrator permission.
- Registered non-`/api` aliases use their matching canonical path in the shared
  authentication, permission, and mutation-audit hooks. Audit records retain
  the original URL. See [legacy alias security](LEGACY_ALIAS_SECURITY.md) for
  the inventory, usage evidence, and regression coverage. Aliases remain
  registered; automatic OPTIONS requests retain canonical unauthenticated behavior.

## Health and identity

| Method | Canonical path | Purpose | Current frontend / audience | Compatibility aliases |
| --- | --- | --- | --- | --- |
| GET | `/health` | Application and PostgreSQL liveness | Docker/orchestration; intentionally outside `/api` | None |
| GET | `/api/auth/me` | Current authenticated proxy identity and permissions | Frontend authentication provider | None |
| GET | `/api/audit-events` | Paginated business audit activity | Audit page | None |
| GET | `/api/debug/routes` | Runtime Flask route map | Internal/debug; no current frontend caller proven | None; removal not approved |

## Administration, fixtures, simulation, and backup

| Method | Canonical path | Purpose | Current frontend / audience | Compatibility aliases |
| --- | --- | --- | --- | --- |
| POST | `/api/admin/test-data/reset` | Delete selected dynamic test data | Administration test-data page | None |
| GET | `/api/admin/scenarios` | List deterministic import scenarios | Administration | None |
| POST | `/api/admin/scenarios/<number>/generate` | Download one generated scenario | Administration | None |
| POST | `/api/admin/scenarios/complete/generate` | Download complete scenario suite | Administration | None |
| POST | `/api/admin/simulation` | Create deterministic simulation-owned people/bookings | Administration tests | None |
| DELETE | `/api/admin/simulation` | Delete only simulation-owned data | Administration tests | None |
| GET | `/api/admin/database/status` | PostgreSQL, Alembic, and backup status | Database administration | None |
| GET | `/api/admin/database/backups` | List server backups | Database administration | None |
| GET | `/api/admin/database/backups/<category>/<filename>` | Download a validated backup file | Database administration | None |
| POST | `/api/admin/database/backup` | Ask backup service to create a backup | Database administration | None |
| POST | `/api/admin/database/import` | Stage and validate an uploaded backup | Database administration | None |
| POST | `/api/admin/database/restore` | Ask backup service to restore selected backup/token | Database administration; destructive operation | None |

## FIS import sessions and approvals

| Method | Canonical path | Purpose | Current frontend / audience | Compatibility aliases |
| --- | --- | --- | --- | --- |
| POST | `/api/import/fis/preview[/]` | Parse files, create preview, session/version, and review tasks | Import page | Trailing slash only |
| POST | `/api/import/fis/confirm[/]` | Confirm the current token of an approved session via the session import operation | Wrapper exists; current session workflow should be preferred | Trailing slash only; removal not approved |
| GET | `/api/import/sessions` | List nation-scoped import sessions | Import page/queue | None |
| GET | `/api/import/sessions/<session_id>` | Read session, versions, approvals, history, and preview | Import page | None |
| PATCH | `/api/import/sessions/<session_id>/single-room-exemptions/<person_key>` | Stage exemption and recalculate preview | Import review | None |
| GET | `/api/import/approvals/<approval_id>` | Read canonical decision detail | Decision dialog | None |
| PATCH | `/api/import/sessions/<session_id>/approvals/<approval_id>` | Decide or revise approval | Decision dialog | None |
| POST | `/api/import/sessions/<session_id>/approve` | Explicitly approve reviewed session | Import workflow | None |
| POST | `/api/import/sessions/<session_id>/import` | Confirm/apply approved current version | Import workflow | None |
| POST | `/api/import/sessions/<session_id>/archive` | Archive a completed/error session | No current frontend caller proven | None; removal not approved |
| POST | `/api/import/sessions/<session_id>/cancel` | Cancel workflow and clear transient review state | Import workflow | None |
| POST | `/api/import/sessions/<session_id>/history` | Add contact/note history and optional waiting state | Import workflow | None |
| GET | `/api/import/fis/mock-files[/]` | List generated mock FIS file pairs | Development/admin import UI | Trailing slash only |
| GET | `/api/import/fis/mock-files/<filename>[/]` | Download one generated mock file | URLs may be consumed indirectly | Trailing slash only |
| GET | `/api/import/fis/mock-files/download-all[/]` | Download all mock files as ZIP | Development/admin; caller unproven | Trailing slash only |
| POST | `/api/import/excel[/]` | Older generic Excel import entry point | No current frontend caller proven | `/import/excel[/]`; **not approved for removal** |

## Room types and hotels

| Method | Canonical path | Purpose | Compatibility aliases |
| --- | --- | --- | --- |
| GET | `/api/room-types[/]` | List room types | `/room-types[/]`; not approved for removal |
| POST | `/api/room-types[/]` | Create room type | `/room-types[/]`; not approved for removal |
| PUT | `/api/room-types/<room_type_id>[/]` | Update room type | `/room-types/<room_type_id>[/]`; not approved for removal |
| DELETE | `/api/room-types/<room_type_id>[/]` | Delete room type | `/room-types/<room_type_id>[/]`; not approved for removal |
| GET | `/api/hotels[/]` | List hotels and inventory | `/hotels[/]`; not approved for removal |
| GET | `/api/hotels/<hotel_id>[/]` | Read hotel | `/hotels/<hotel_id>[/]`; not approved for removal |
| POST | `/api/hotels[/]` | Create hotel | `/hotels[/]`; not approved for removal |
| PUT | `/api/hotels/<hotel_id>[/]` | Update hotel | `/hotels/<hotel_id>[/]`; not approved for removal |
| DELETE | `/api/hotels/<hotel_id>[/]` | Delete hotel | `/hotels/<hotel_id>[/]`; not approved for removal |
| POST | `/api/hotels/<hotel_id>/inventory[/]` | Add room inventory | `/hotels/<hotel_id>/inventory[/]`; not approved for removal |
| PUT | `/api/hotels/<hotel_id>/inventory/<inventory_id>[/]` | Update inventory | Non-`/api` equivalent; not approved for removal |
| DELETE | `/api/hotels/<hotel_id>/inventory/<inventory_id>[/]` | Delete inventory | Non-`/api` equivalent; not approved for removal |
| GET | `/api/hotels/capacity-overview` | Capacity projection for selected period/filter | None |
| GET | `/api/hotels/<hotel_id>/reservations` | Reservation rows for one hotel | None |

## Accommodation events and championship mappings

Two event concepts coexist. `/api/events` manages accommodation-planning events;
`/api/championship-events` and `/api/admin/events` manage championship contexts
and their FIS competition mappings.

| Method | Canonical path | Purpose | Compatibility aliases |
| --- | --- | --- | --- |
| GET | `/api/events` | List accommodation events and demand | None |
| POST | `/api/events` | Create accommodation event | None |
| PUT | `/api/events/<event_id>` | Update accommodation event | None |
| DELETE | `/api/events/<event_id>` | Delete accommodation event | None |
| POST | `/api/events/<event_id>/demand` | Add room demand | None |
| DELETE | `/api/events/<event_id>/demand/<demand_id>` | Delete room demand | None |
| GET | `/api/competitions` | List stable competition catalogue | None |
| GET | `/api/championship-events` | List active championship contexts | None |
| GET | `/api/admin/events` | List championship contexts with admin projection | Same path also handles POST |
| POST | `/api/admin/events` | Create championship context | Same path also handles GET |
| GET | `/api/admin/events/<event_id>` | Read context and mappings | Same path also handles PUT |
| PUT | `/api/admin/events/<event_id>` | Update championship context | Same path also handles GET |
| POST | `/api/admin/events/<event_id>/competitions` | Add event-to-competition mapping | None |
| PUT | `/api/admin/events/<event_id>/competitions/<mapping_id>` | Update mapping | None |
| POST | `/api/admin/events/<event_id>/copy-mappings` | Copy mappings from another event | None |

## People

| Method | Canonical path | Purpose | Compatibility aliases |
| --- | --- | --- | --- |
| GET | `/api/athletes[/]` | Aggregated person projection with memberships, review, and assignment state | `/athletes[/]`; not approved for removal |
| GET | `/api/athletes/<athlete_id>[/]` | Read one person | Trailing slash only |
| PUT/PATCH | `/api/athletes/<athlete_id>[/]` | Update operator-managed person state, including exemption | Trailing slash only |
| POST | `/api/athletes[/]` | Create person manually | `/athletes[/]`; not approved for removal |
| POST | `/api/athletes/<athlete_id>/acknowledge-roomlist-change[/]` | Acknowledge operational review marker | Trailing slash only |

## Assignments and quota

`/api/assignments/bookings` is the canonical command family for current
operational bookings. `/api/room-assignments` remains a supported compatibility
surface until consumers and historical data are verified.

| Method | Canonical path | Purpose | Compatibility aliases |
| --- | --- | --- | --- |
| GET | `/api/room-bookings/grouped[/]` | Grouped current booking projection | `/room-bookings/grouped[/]`, `/api/room-assignments/grouped[/]`; not approved for removal |
| GET | `/api/room-assignments[/]` | Current assignment/booking list projection | `/room-assignments[/]`; not approved for removal |
| GET | `/api/fis/official-quotas[/]` | Official and single-room quota usage/status | `/fis/official-quotas[/]`, `/api/official-quotas[/]`; not approved for removal |
| GET | `/api/assignments/planning-view[/]` | Hotel/slot/person planning projection | Trailing slash only |
| GET | `/api/assignments/planning-view/validations/<validation_key>` | Deferred validation details | None |
| POST | `/api/assignments/bookings[/]` | Create operational booking and occupants | Trailing slash only |
| PUT | `/api/assignments/bookings/<booking_id>[/]` | Update occupants or operational single classification | Trailing slash only |
| POST | `/api/assignments/bookings/<booking_id>/unassign[/]` | Remove entire booking unit | Trailing slash only |
| POST | `/api/assignments/bookings/<booking_id>/occupants/<athlete_id>/unassign[/]` | Remove one occupant | Trailing slash only |
| POST | `/api/room-assignments[/]` | Compatibility booking creation | `/room-assignments[/]`; not approved for removal |
| PUT | `/api/room-assignments/<assignment_id>[/]` | Compatibility booking update | `/room-assignments/<assignment_id>[/]`; not approved for removal |
| DELETE | `/api/room-assignments/<assignment_id>[/]` | Compatibility booking deletion | `/room-assignments/<assignment_id>[/]`; not approved for removal |

## Analytics

| Method | Canonical path | Purpose | Compatibility aliases |
| --- | --- | --- | --- |
| GET | `/api/analytics/room-availability` | Availability projection by date/filter | None |
| GET | `/api/analytics/occupancy-timeline` | Occupancy timeline projection | None |

## Change policy

Before removing or changing an endpoint or alias:

1. inspect production access logs and external scripts;
2. identify the product owner for the consumer;
3. add a canonical-path contract test;
4. announce/deprecate the alias if it is externally reachable;
5. verify authentication behavior explicitly;
6. update this catalogue and the frontend API wrapper in the same change.
