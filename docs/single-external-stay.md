# One EXTERNAL stay per person

New EXTERNAL creation is limited to one RoomBooking relationship per person.
`ensure_external_create_allowed` is used by the preview/convenience action and
by the shared booking validator, covering direct ADD, joins and conversion of
STANDARD bookings through correction APIs. Existing accommodation transaction
locking serializes the check and save; PostgreSQL regressions verify that two
concurrent non-overlapping creates cannot both succeed. The domain error is
`EXTERNAL_ALREADY_EXISTS` with the affected person's name. A preview that became
invalid before confirmation is rejected atomically with 409 and the same reason.

Editing a person's own existing EXTERNAL relationship is allowed. Historical
multiple relationships do not become unusable or get normalized by an edit.
Changing the external destination or shortening the dates affects only the
selected relationship; extending into another booking is rejected with a clear
instruction to adapt/remove that booking first. There is no STANDARD repartition
in the edit path. CREATE remains the explicit convenience action that can insert
the first EXTERNAL stay into STANDARD accommodation using the existing atomic
partitioning service.

Removal deletes only the selected relationship, recalculates coverage and exposes
the resulting normal open interval. It never restores/extends a former STANDARD
booking. Editing/removing one occupant of a shared external booking preserves the
other occupant's accommodation and keeps one external relationship per person.

EXTERNAL segments no longer expose Aufenthalt teilen in either segment or queue
menus. The backend split service rejects external sources as well, so direct
split calls cannot bypass this rule. STANDARD split/edit/remove are unchanged.

## UI eligibility

The existing compact Externen Aufenthalt shortcut is disabled with an explanation
when all represented people already have EXTERNAL accommodation. In a mixed pair,
Beide and the ineligible person are disabled; the eligible partner is selected by
default. The reason is shown next to disabled choices. External hotel selection
still contains only EXTERNAL destinations. Eligibility comes from current backend
coverage and does not modify or merge any segments. The backend remains the final
authority after concurrent changes.

## Historical records

No migration or operational-data rewrite is included. Multiple existing EXTERNAL
segments remain visible and explicitly editable/removable; new creation is
blocked. No production database was queried. The isolated browser fixture
intentionally contained two adjacent EXTERNAL records for Middle GAPS (04–06 and
06–08 March 2027); both remained visible and unchanged until explicit user actions.
Automated fixtures additionally cover historical duplicate relationships.

## Validation

Focused backend regressions cover direct-call enforcement, mixed-pair atomicity,
location edits, shortening, conflicting extension rollback, removal without
restoration, individual shared edits, blocked external split and preserved history.
PostgreSQL tests cover concurrent disjoint creates and a pair preview invalidated
by one member's new external stay. Browser checks cover zero/one/two eligible
pair members, explanations, both menu types, exact queue refresh, untouched
roommates, historical duplicates and narrow layout.

No new schema/model, automatic merging, NO_ROOM, LOC window, quota formula,
import changes or Dashboard/Analytics redesign is included.

Executed validation: 397 fast backend tests and 1,028 subtests passed; 38 focused
single/external/replacement tests passed; 14 PostgreSQL transaction tests passed.
Frontend: 94 tests, typecheck, production build and git diff --check passed.
Isolated Chromium checks passed for all requested eligibility/menu/edit/remove
states, exact queue gaps, untouched STANDARD/partner accommodation, deliberately
seeded historical duplicates and a narrow mixed-pair dialog without overflow or
JavaScript exceptions.
