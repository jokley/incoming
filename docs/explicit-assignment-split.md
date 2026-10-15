# Explicit assignment splitting

The operator opens an assigned period, chooses **Zuweisung teilen**, selects the
people and an interior date, reviews the backend preview, and confirms. Destination
selection stays in disposition. No active-assignment mode or persisted open slot
exists. Edit, split and person removal retain separate meanings.

## API and transaction

- `GET /api/assignments/bookings/{id}/split-preview?athleteIds=1,2&splitDate=2027-03-14`
  returns `booking`, selected `athleteIds`, `splitDate`, `previewToken`,
  `retainedSegments`, and `people` with canonical projected coverage and
  `affectedOpenIntervals`. Negative booking IDs identify preview-only continuation
  rows; they are never stored. The response is not cached and makes no writes or
  audit event.
- `POST /api/assignments/bookings/{id}/split` takes those selection/date/token
  fields. It uses the same split plan, returns the actual booking and affected
  person coverage, and commits once. Errors roll back all changes.

The fingerprint binds source booking identity, selected people, date, affected
person stays/bookings/metadata, competing physical-room bookings, room type and
inventory. Confirmation reacquires the existing transaction advisory lock and
rejects changed or deleted source data with HTTP 409. This is a state comparison,
not a new authorization mechanism; normal assignment permissions still apply.
Preview and confirmation reject conflicted person or room data and endpoint dates.
No historical data is repaired automatically.

For all occupants, the source booking simply ends at the split date. For a subset,
all original occupants remain in the shared prefix; only unselected occupants get
a continuation in the same room. Dates remain half-open. Flags, room identity,
owner/source metadata, original timestamps and occupant roles are preserved;
approvals and roommate preferences are untouched. Audit records the authenticated
operator, selected people and split date. Other bookings are unchanged.

## Physical capacity

The split never increases room use at any instant. Booking-write capacity
validation coalesces non-overlapping uses of the same named physical room; anonymous
bookings remain separate and overlapping duplicates are still counted
conservatively. This is a scoped correction to row counting, not a nightly capacity
rewrite. Partial shared splits require a known room number. Existing room overlap
and person coverage checks remain in force.

Assignments room totals already count occupied physical slots. Its bed summaries
now count distinct occupants per slot, so a continuation does not duplicate an
occupant. They remain whole-timeline summaries, not availability for a particular
date. Server validation decides actual availability. Other overview/capacity
consumers remain outside this change.

## Dated queue items

`dispositionItems()` copies each person's backend `openIntervals` into visible
items, without interval subtraction. Matching gaps can be paired using an existing
shared booking ending at that gap, then existing requested-pair context. The shared
prefix persists after splitting both, so pair disposition survives refresh without
creating a permanent preference. Different periods remain individual; no
intersection is inferred. Each person/period appears only once.

The card and its person/pair handles are draggable. With a hotel open, clearly
labelled actions assign directly to that hotel. They do not activate another mode.
The actual drag payload is transient and carries the item's IDs and exact dates.
Validation accepts explicit person IDs and dates, independent of legacy unit IDs.
Shared ADD remains atomic. Detail open periods link to **In Disposition anzeigen**,
which only navigates, highlights and scrolls to the corresponding work item.
Successful splitting refreshes canonical state, highlights the affected gap and
shows a concrete success message. Consecutive open gaps are shown as the merged
interval returned by backend coverage.

Repeated splits use the same operation with no split-count limit. The Athlete
list needs no redesign: its existing coverage-based status, hotel/segment summary
and detail tooltip refresh through canonical person reads and the existing
operations state-change event.

No schema/model, EXTERNAL, NO_ROOM, LOC window, import, World Champion, quota formula,
Dashboard, Analytics or export migration is included. Before EXTERNAL support,
hotel classification and local inventory consumption still require an explicit
design. Split creation itself remains independent of destination hotel type.
