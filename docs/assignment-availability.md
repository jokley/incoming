# Assignment availability and synchronized hotel suitability

The read-only `POST /api/assignments/availability` accepts dated queue needs
(`key`, `athleteIds`, `checkInDate`, `checkOutDate`) and the filtered population's
IDs. It returns target validation for each need and individual action, plus hotel
fit and an independent `alreadyUsed` flag. The server checks exact canonical open
intervals; NO_ROOM is excluded from demand. No placement is saved or returned.

Inventory validation is shared with booking writes via `inventory_guard`.
Its existing whole-interval inventory contract and half-open booking boundaries
remain unchanged. Named-room conflicts, room compatibility, capacity, existing
occupants and single-use blocking are checked before enabling targets. Joining an
existing single-use room is rejected on the server as well; assembling a new
atomic pair retains its existing approved-extra default behavior.

Physical occupant counts are unchanged. Operational availability treats
`countsAsSingle` as blocking the room's remaining capacity. Whole-timeline hotel
summaries conservatively count such rooms as unavailable; selected-period
eligibility always comes from the backend.

`FIT_ALL` requires a complete constructive feasibility witness across all open
needs, including repeated intervals per person. This is a deterministic,
constrained-first capacity simulation, not an allocation/optimization solver.
`FIT_PARTIAL` and its displayed `mind.` count are conservative lower bounds,
not a proof of the maximum possible occupancy. Alternative placements can
sometimes accommodate more. `NO_FIT` means no need passed the initial target
checks. An empty demand is labelled "Kein offener Unterkunftsbedarf".

The frontend debounces context changes by 180 ms, sends one aggregate request,
ignores obsolete responses and reuses results for pair/individual buttons and
subsequent dragging. SQL is outside hotel/person loops. The endpoint loads people, bookings and
inventory in bulk and reuses the existing virtual-room and central coverage
helpers without building quota/approval projections (four SQL queries for both
3 and 23 people in the regression fixture). Direct projection tests
verify two constant bulk reads when a planning snapshot is supplied. Inventory guard
results are cached per hotel/type/interval/provisional occupancy in the request.

"Bereits genutzt" uses the matching population including fully assigned people;
open demand uses only their current open intervals. Person filters apply to
individual occupants and remain presentation-only. The existing discipline filter
uses configured quota-discipline memberships; no Slopestyle/FIS-role remapping
was introduced.

No schema, quota formulas, pricing, NO_ROOM, EXTERNAL or import behavior changed.
