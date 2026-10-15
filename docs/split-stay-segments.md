# Split stays: Step 2

The operator workflow described below is superseded by
[explicit assignment splitting](explicit-assignment-split.md). The existing segment
APIs and coverage foundation remain; activation controls have been removed.

## Explicit person-segment API

- `POST /api/assignments/persons/<personId>/segments`: ADD; never searches for an
  occupant-set booking to replace and never detaches another reservation.
- `PUT /api/assignments/persons/<personId>/segments/<bookingId>`: EDIT/MOVE only
  this person's selected segment.
- `DELETE` at that same resource: REMOVE only this person's membership, deleting
  the booking if empty. Other bookings and occupants remain intact.

POST/PUT use `hotelId`, `roomTypeId`, `roomNumber`, `checkInDate`, `checkOutDate`.
POST optionally accepts `joinBookingId` to attach to an existing shared booking.
Joining requires identical dates, room capacity, no existing membership and no
person overlap. It never changes the target booking's dates or single-room flag.

Successful responses include `success`, `personId`, `booking` (null on removal),
and the complete current Step-1 `accommodationCoverage`. Invalid writes return
HTTP 400 with `error`, `reasonCode` and a user-readable `message`.

## Validation and sharing

Intervals remain half-open. New/edited segments must fit within valid person
arrival/departure. The Step-1 service checks the remaining booking population for
conflicts; the shared booking validator rejects person overlaps. A room-number
check additionally rejects reservations overlapping the same hotel/type/room.
Inventory semantics and the existing conservative capacity count are unchanged.

For a solo booking, edit updates that booking. For a shared booking, edit creates
a separate RoomBooking for this person and removes only their old membership.
The original booking's dates, occupants and flags remain unchanged. Choosing a
still-occupied original room for overlapping changed dates is rejected; select
another free room. No per-occupant dates are introduced.

Default `countsAsSingle` initialization reuses the existing APPROVED_EXTRA rule.
Edit copies the selected booking's existing flag; join preserves the target flag.
No entitlement, approval or quota formula is modified. Existing person-level
booking aggregation continues to prevent repeated segment consumption.

## Transactions

Every new operation validates, flushes, calculates its response and commits once.
Any exception rolls back the entire operation. Validation errors also roll back.
Helpers used by segment operations use `commit=False` and do not detach unrelated
bookings. The legacy detachment helper now flushes instead of committing, and its
controlled callers roll back on failure before the final booking save commits.

PostgreSQL transaction-scoped advisory lock 701027001 serializes assignment
mutations. The authentication hook obtains it after permission checks and before
audit snapshots; explicit segment routes also obtain it for direct use/testing.
This deliberately coarse lock covers new and legacy assignment endpoints and
protects check-then-write person/room/capacity validation. SQLite tests run without
that PostgreSQL lock. Concurrency tests exercise real PostgreSQL requests.

Controlled legacy POST retains its original full-stay replacement semantics, but
rejects multi-booking people with SEGMENT_OPERATION_REQUIRED before any detachment.
Legacy controlled PUT no longer detaches occupants from unrelated bookings. The
new UI never sends partial stays to legacy replacement POST. Legacy room-level
removal remains explicit removal of all occupants of that room reservation; its
button label now distinguishes it from the person-segment Remove action.

## Assignments workflow

The queue displays compact assigned segments and every backend-derived open
interval. Rest zuweisen (one remaining gap) or Zuweisen (several gaps) selects an
active target. The detail dialog's Neue Zuweisung does the same and closes the
dialog. No booking is written during selection. The active target banner shows
people and dates, can be dragged into the usual room area, and can be cancelled.
Normal hotel/room actions use that exact interval. Multiple gaps always require an
explicit choice. The existing compact edit dialog remains for known segments;
hotel options include the already available contingent date range.

Full-stay drag/drop still defaults to the complete stay. Both normal and split
adds now use POST /api/assignments/segments, never the legacy replacement route.
This endpoint accepts athleteIds (one person or two partners), the existing
hotel/room/date fields and optional joinBookingId. The interval must still be an
exact openInterval for every selected person. It validates and saves all people
under the existing transaction lock, commits once and returns booking plus
people: [{personId, accommodationCoverage}]. A failure for either person rolls
back all changes. Shared joins require identical booking dates and capacity;
no roommate's dates or flag is changed. The approved-extra default for a new
shared booking is initialized from all selected people, matching the legacy rule.
Audit references include both selected people and the resulting booking.

Beide zusammen zuweisen is enabled only for identical backend-projected gaps.
For several common gaps, explicit date-specific pair actions are shown; no
intersection is calculated. Different gaps retain independent person actions.
The old full-stay pair action now uses this same safe ADD flow. Shared edit/remove
retain the Step-2 person separation rules above.

The existing validation GET accepts optional checkInDate/checkOutDate to reuse
backend room checks for the selected period. Frontend validation caches include
the selected dates; target changes invalidate older requests. Room drop feedback
uses those backend checks. Occupancy summary counters remain whole-timeline
summaries, not nightly availability. Mutation success refetches canonical planning
state; segment edit/remove also apply returned coverage before refresh.

Assignments partial/conflict units remain open work. The Athlete list now uses
coverageStatus for accommodation labels and its assigned/open header counts. It
keeps one person row, deduplicates hotel names for display and shows N Segmente
with a full date/hotel/type/room tooltip for multiple segments. Existing single
booking fields remain for backwards compatibility. No frontend subtraction or
persisted slots are introduced.

## Deferred consumers and limits

Dashboard, quota disposition cards, Analytics,
print/export and hotel/contingent summaries retain legacy first/any-booking or
whole-timeline aggregate semantics. In particular, hotel summary occupancy is not
a new nightly capacity calculation. The Step-1 consumer inventory remains relevant.
Actual server validation, not those summaries, decides whether a segment fits.

The advisory lock is intentionally coarse and is not a cross-application database
exclusion constraint. Imports and administrative resets retain their existing
behavior. Large-scale locking optimization and date-aware overview migration are
separate work. Before EXTERNAL support, add an explicit hotel classification and
separate coverage from local inventory validation/consumption; do not fabricate
inventory or use NO_ROOM as an external-accommodation substitute.

No EXTERNAL, NO_ROOM, new StaySegment model, persisted open slots, schema migration,
import/matching/World Champion changes or quota-formula changes are included.
