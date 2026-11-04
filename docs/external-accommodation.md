# External accommodation and Aufenthalt teilen

## Model and migration

`Hotel.accommodation_type` is STANDARD or EXTERNAL; migration `20261015_01`
adds the non-null column with server default STANDARD and a check constraint.
Existing hotels and bookings retain their IDs, dates, flags and occupants.
`RoomBooking.room_type_id` becomes nullable. STANDARD writes still require a
real room type, local inventory, capacity and room number. EXTERNAL writes may
omit the room type and number; no room type or inventory is fabricated.
Downgrade refuses external hotels/bookings that would lose their meaning.

Hotel create/edit exposes Standard/Extern and list/detail show Extern badges.
Changing a hotel's classification is blocked if it has bookings or inventory;
this avoids silently reclassifying historical reservations or local capacity.
External inventory creation is rejected. Classification edits share the booking
transaction lock.

## Preview and confirmation

GET `/api/assignments/segments/preview` accepts athleteIds (comma-separated),
hotelId, checkInDate, checkOutDate, openCheckInDate and openCheckOutDate.
It is the only new endpoint and is read-only, authenticated and non-cacheable.
A backend preview is needed to show actual gaps before saving without duplicating
coverage subtraction in the browser.

The plan returns previewToken, hotelId/name, athleteIds, selected dates,
openInterval and people (personId, name, accommodationCoverage).
`external_accommodation.external_plan` verifies one/two distinct people, an
EXTERNAL hotel, valid dates and containment within the same current canonical
open interval. It passes a transient booking projection to the existing
`person_accommodation_coverage`; no slots or demands are stored. Preview holds
the existing transaction lock and releases it by rolling back its read transaction.

POST `/api/assignments/segments` consumes the plan. It recomputes and verifies
its fingerprint under the booking lock, then reuses the existing atomic ADD and
join operations. The fingerprint covers hotel identity/name/type, selected IDs,
dates, frozen open interval, person stay/status/update state and all their current
bookings/occupants. Changed coverage or evidence returns 409. Any later failure
rolls back the entire pair operation. POST previews are not used, so preview reads
do not create mutation audit events. Confirmation uses existing authenticated audit.

## UI

An actionable queue interval exposes Aufenthalt teilen for editing users. The
small dialog defaults to both people for a pair, lists EXTERNAL hotels only, and
bounds Von/Bis by the visible queue interval. It renders backend preview gaps,
including two gaps for a middle stay. Confirm uses the existing ADD endpoint and
refreshes canonical state, then reveals remaining queue work. No active target
or destination selection mode is introduced into normal STANDARD disposition.

EXTERNAL bookings remain in the planning response's hotel `externalBookings`
array with no local slots. Their real shared occupants provide pair context for
compatible identical remaining dates after refresh; roommate preferences are not
changed. Different gaps remain individual items. Existing Zuweisung teilen uses
the same split service for EXTERNAL bookings, including safe individual partitioning
without requiring a nonexistent local physical-room number. Edit/remove remain
person-specific and atomic.

Coverage segments include accommodationType; Athlete/detail labels show Extern
without fake room metadata. One row per person and existing segment summaries
remain. The list/export adapter accepts nullable room types; no broad export
redesign is included.

## Local capacity and quota

EXTERNAL bookings create no local inventory and no local room-grid slots.
Backend hotel capacity and availability queries exclude external inventory/use.
Shared frontend local capacity/risk calculations, hotel occupancy stats and
contingent projections exclude external use. Dashboard only gains the necessary
local room-count exclusion; no page or formula redesign is included.

Quota formulas, countsAsSingle, single_room_status and APPROVED_EXTRA are unchanged.
The existing approved-extra default is preserved in preview and confirmation.
The planning-to-quota adapter includes external bookings as evidence using the
existing converter; distinct-person quota allocation still prevents multiple
segments from multiplying consumption. Local bed capacity excludes external
bookings independently of these quota flags.

## Validation and follow-up boundaries

Regression coverage includes STANDARD defaults, no-inventory external writes,
solo/pair/individual and middle stays, stale previews, rollback, out-of-range dates,
edit/remove, external shared splits, STANDARD completion, approved-extra flags,
paired remainder derivation, local-capacity exclusion and nullable-room labels.
PostgreSQL tests verify authenticated audit, stale state and migration preservation
on existing bookings; the migration chain also runs online and as rendered SQL.

Browser checks use an isolated in-memory SQLite fixture and real frontend build.
They cover external hotel create/read, solo middle stay, pair/individual stay,
canonical queue refresh, normal STANDARD pair assignment, Athlete/detail labels,
existing shared split dialog and narrow desktop.

No EXTERNAL inventory is inferred or imported automatically. Reporting dedicated
external person/nights totals is deferred. Dashboard/Analytics demand estimates
retain their existing planning conventions; only actual local occupancy excludes
external stays. NO_ROOM still needs its own explicit semantics before implementation.
There is no LOC window, StaySegment model or persisted open slot.

## Changed files

- `backend/accommodation_coverage.py`
- `backend/accommodation_split.py`
- `backend/app.py`
- `backend/external_accommodation.py`
- `backend/migrations/versions/20261015_01_external_accommodation.py`
- `backend/models.py`
- `backend/routes/accommodation_segments.py`
- `backend/routes/analytics.py`
- `backend/routes/hotels.py`
- `backend/tests/fixtures/api_routes.json`
- `backend/tests/test_api_characterization.py`
- `backend/tests/test_booking_read_routes.py`
- `backend/tests/test_external_accommodation.py`
- `backend/tests/test_postgres_migrations.py`
- `backend/tests/test_segment_transactions.py`
- `docs/external-accommodation.md`
- `frontend/src/app/components/Assignments.tsx`
- `frontend/src/app/components/Dashboard.tsx`
- `frontend/src/app/components/HotelsManagement.tsx`
- `frontend/src/app/components/assignment/DispositionQueueCard.tsx`
- `frontend/src/app/components/assignment/ExternalStayDialog.tsx`
- `frontend/src/app/components/assignment/PersonAccommodationPanel.tsx`
- `frontend/src/app/components/assignment/SplitAssignmentDialog.tsx`
- `frontend/src/app/lists/listEngine.ts`
- `frontend/src/app/services/api.ts`
- `frontend/src/app/services/dispositionItems.test.ts`
- `frontend/src/app/services/dispositionItems.ts`
- `frontend/src/app/services/personAccommodation.ts`
- `frontend/src/app/services/planningCalculations.test.ts`
- `frontend/src/app/services/planningCalculations.ts`
- `frontend/src/app/services/quotaEvaluation.test.ts`
- `frontend/src/app/services/quotaEvaluation.ts`
- `frontend/src/app/services/segmentPresentation.test.ts`
- `frontend/src/app/types.ts`

## Executed validation

- Full fast backend: 371 tests and 1,028 subtests passed; final focused external,
  segment and split regressions: 55 passed (including two additional input/stale
  regressions added after the full run).
- PostgreSQL compatibility run: 126 tests and 157 subtests passed, plus migration
  tests; final migration/transaction run: 14 passed and 6 subtests passed.
- Frontend: 86 passed; typecheck, production build and git diff --check passed.
- Isolated Chromium: hotel type create/read, solo middle interval, both occupants,
  individual occupant, paired remainder, STANDARD completion, Athlete/detail
  labels and existing split dialog passed without JavaScript exceptions.
- Real pointer drag/drop passed for the leading gap after a middle EXTERNAL stay:
  displayed 04–08 dates were submitted and the external booking remained intact.
