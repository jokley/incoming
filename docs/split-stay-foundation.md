# Split-stay foundation (Step 1)

## Booking date contract

RoomBooking accommodation nights are `[checkInDate, checkOutDate)`. A new booking
requires check-in strictly before check-out. Checkout and another check-in on the
same date are adjacent, not overlapping. Existing stored dates are not rewritten.

Changed booking checks in `backend/app.py`:

- `_dates_overlap` delegates to the central strict half-open overlap helper.
- `_validate_booking_payload` rejects malformed, zero-length and reversed dates.
- The same validator rejects overlaps with another booking containing a requested
  person, across hotels; the booking being moved/edited is excluded.
- Its existing room-capacity query uses strict interval-intersection predicates.
  Capacity limits and the existing whole-window reservation-count method remain.

Inventory semantics are unchanged: available_from <= booking check-in and
available_until >= booking checkout. Inventory aggregation, analytics date filters,
Event dates and general-purpose report ranges are not converted in this step.

## Authoritative coverage

`backend/accommodation_coverage.py::person_accommodation_coverage` is read-only.
It consumes person arrival/departure and all their RoomBookings. It deduplicates
booking IDs, sorts by check-in, checkout and numeric booking ID, detects conflicts,
merges adjacent coverage and derives all gaps. No maximum segment count is assumed.

An invalid/missing overall person stay is CONFLICT with no calculable open range.
Missing booking dates, non-positive booking ranges and out-of-stay bookings remain
in segments and are conflicts. They contribute no coverage and are never clipped.
Otherwise valid overlapping bookings contribute to diagnostic union coverage but
always result in CONFLICT; full union coverage never hides overlaps.

Conflict codes:

- PERSON_STAY_MISSING_DATES / PERSON_STAY_INVALID_RANGE
- BOOKING_MISSING_DATES / BOOKING_INVALID_RANGE
- BOOKING_OUTSIDE_PERSON_STAY
- BOOKING_OVERLAP (contains the two booking IDs)

## Additive API contract

GET /api/athletes, GET /api/athletes/<id> and each planning-view unit occupant add
`accommodationCoverage`:

```json
{
  "overallInterval": {"checkInDate": "2027-03-14", "checkOutDate": "2027-03-27"},
  "segments": [{
    "bookingId": "1", "hotelId": "2", "hotelName": "Hotel",
    "roomTypeId": "3", "roomTypeName": "Double", "roomNumber": "101",
    "checkInDate": "2027-03-14", "checkOutDate": "2027-03-20",
    "countsAsSingle": false, "conflictCodes": []
  }],
  "coveredIntervals": [{"checkInDate": "2027-03-14", "checkOutDate": "2027-03-20"}],
  "openIntervals": [{"checkInDate": "2027-03-20", "checkOutDate": "2027-03-27"}],
  "conflicts": [],
  "coverageStatus": "PARTIALLY_ASSIGNED"
}
```

Statuses are UNASSIGNED, PARTIALLY_ASSIGNED, FULLY_ASSIGNED and CONFLICT.
Conflicts take precedence. All booking segments are exposed, including invalid
ones with nullable dates. Conflict objects are `{code, bookingIds}`; overall stay
conflicts have an empty bookingIds list. Existing flags and singular assignment
fields are retained unchanged. The person list uses its existing canonical person
stay and collects bookings across existing sourceRecordIds without multiplying
the person. Detail GET and planning occupants describe the requested stored person.

## Consumers intentionally still using booking presence

- `routes/athletes.py`: assignment.hasAssignment, first booking summary,
  hasPendingRoomlistReview and workflowStatus.
- `app.py::_build_room_booking_units`: first booking, occupant isAssigned,
  hasAnyAssigned and unit isFullyAssigned (all occupants have some booking).
- `app.py::_build_assignment_planning_view`: assigned/unassigned unit lists.
- `app.py::_build_official_quota_usage_rows` and
  `quota_service.py::disposition_by_quota_group`: assigned membership sets.
- `Assignments.tsx`: queue filters, assignment controls and singular booking IDs.
- `Athletes.tsx` and `services/workflowStatus.ts`: person status/filter/navigation.
- `Dashboard.tsx`: assigned people, peopleWithoutRoom and assignment coverage.
- `lists/listEngine.ts`: per-person last-booking map and assignedOnly; its
  `listExports.ts` print/export consumers inherit that projection.
- `planningCalculations.ts`, `RoomAnalytics.tsx`, hotel/contingent projections:
  active bookings or aggregate booking totals, not whole-person coverage.

These consumers must adopt coverage explicitly in later steps. Existing single-room
flags, quota allocation, approval applicability, imports and identity are untouched.

## Remaining mutation and atomicity limitations (Step 2)

The following describes the Step-1 baseline. Implemented Step-2 operations,
atomicity fixes and Assignments behavior are documented in
[split-stay-segments.md](split-stay-segments.md).

The controlled assignment POST still reuses an exact occupant-set booking and
detaches other memberships; PUT still performs its existing detachment. They are
not new-segment commands. The legacy POST already could create multiple bookings;
its shared validator now rejects real person overlaps. No new route or UI enables
the future split workflow.

`_detach_athletes_from_existing_bookings` still commits before the later save.
This pre-existing risk is not expanded by the read-only projection or validation
changes. Step 2 must make detach/save atomic, add explicit segment-vs-move intent,
and serialize concurrent person/room overlap checks before enabling split writes.
Current validation is not a database-level concurrency exclusion constraint.

There is no EXTERNAL, NO_ROOM, schema migration or booking-date backfill here.
