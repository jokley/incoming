# Split stays: Step 2

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

The existing detail dialog includes each selected person's overall stay, status,
all segments and all backend-derived open intervals. Each open interval has its
own Neue Zuweisung action, prefilling From/To from that interval. Dates can be
shortened or shifted within it; no frontend interval-subtraction algorithm exists.
Each existing segment has edit/remove actions. A compact dialog chooses hotel,
room or explicit shared-booking join, and dates. Conflicts block add/edit in the UI;
removal remains available to resolve them. Nothing auto-fills remaining gaps.

Mutation responses update the displayed coverage immediately, then the canonical
planning/person state is refetched. Selection follows the person, even if editing
or removing changes the selected booking ID. Partial/conflict units stay in the
Assignments open queue. Local progress/labels use coverage; backend/global counts
are not changed.

Full-stay drag/drop and quick assign remain for completely unassigned people with
one open interval matching the unit's full stay. Partial, conflicted or ambiguous
stays use explicit person actions; drag controls are disabled and handlers are
guarded. Drag-to-join uses the new endpoint for one person with identical dates;
it cannot resize a roommate's stay. Paired normal full-stay assignment remains.

## Deferred consumers and limits

Dashboard, quota disposition cards, Analytics, person-list legacy statuses,
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
