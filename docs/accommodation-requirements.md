# Person accommodation requirement

`Athlete.accommodation_requirement` is REQUIRED or NO_ROOM, with provenance
DEFAULT, IMPORT or MANUAL. Defaults are REQUIRED/DEFAULT. A nullable
`accommodation_requirement_import_value` retains the last explicit source decision
independently of a manual override, so releasing a manual override can resume the
source decision even when the Entries room text was blank and Room List flags
provided the evidence. It is never an operator-editable field.

Exact normalized `No room` means NO_ROOM; recognized room requests mean REQUIRED.
Blank, `no data available` and unknown values are review data, never implicit
NO_ROOM. Missing evidence preserves an earlier decision. Conflicting explicit
Entries/Room List values block confirmation unless explicitly reviewed through a
manual override. Raw Function is unrelated.

Manual changes use the existing person PATCH API. Send `accommodationRequirement`
as REQUIRED/NO_ROOM to establish a manual decision, or null to release it. Import
review uses the session's `/accommodation-requirements/<person-key>` PATCH path,
with the same payload. Review changes remain staged until import confirmation.
An override records the live base state and stale changes block confirmation.

All requirement transitions, import confirmations and booking writes share the
existing PostgreSQL transaction-scoped accommodation advisory lock. NO_ROOM cannot
be set while any booking membership remains. Standard/external/pair writes reject
NO_ROOM. Explicit removals remain available; no booking is deleted implicitly.

Coverage returns NO_ROOM with empty demand arrays when no booking exists.
Historical contradictions return CONFLICT/NO_ROOM_HAS_BOOKINGS, retain real booking
segments and generate no assignable gaps. Real physical occupancy remains counted.

Roster `peopleTotal`, entered athletes, Officials membership and formulas retain
their meaning. Quota DTOs add accommodationPeopleRequired,
accommodationPeopleFullyAssigned, accommodationPeoplePartiallyAssigned,
accommodationPeopleOpen and noRoomPeople. Accommodation progress uses full coverage
and the required-person denominator; zero demand reads Kein Unterkunftsbedarf.

NO_ROOM does not clear SPECIAL or historical EZ approvals. It creates no new EZ
request; pending-demand surfaces exclude it. Overview Mehrpreis is not applicable
(—), while tariff metadata remains available.

## Legacy review

Migration 20261016_02 only adds defaulted fields. It never converts existing people
or changes bookings. In the configured backend environment, review candidates:

```sh
backend/venv/bin/python scripts/reconcile_accommodation_requirements.py
```

Apply only explicitly reviewed eligible IDs (exact legacy No room, DEFAULT source,
no booking), with a named audit actor:

```sh
backend/venv/bin/python scripts/reconcile_accommodation_requirements.py --apply-person-id 123 --username operator
```

All selected IDs are rechecked under the same lock; one ineligible ID aborts the
operation. Booked candidates remain review conflicts. Blank/unknown values are
never converted. Apply the schema migration before application deployment.

## Changed files

- `backend/accommodation_coverage.py`
- `backend/accommodation_rates.py`
- `backend/accommodation_requirements.py`
- `backend/accommodation_split.py`
- `backend/app.py`
- `backend/excel_import.py`
- `backend/external_accommodation.py`
- `backend/migrations/versions/20261016_02_accommodation_requirements.py`
- `backend/models.py`
- `backend/routes/accommodation_segments.py`
- `backend/routes/athletes.py`
- `backend/tests/test_accommodation_requirements.py`
- `backend/tests/test_requirement_transactions.py`
- `docs/accommodation-requirements.md`
- `frontend/src/app/components/AccommodationRequirementField.tsx`
- `frontend/src/app/components/Assignments.tsx`
- `frontend/src/app/components/Athletes.tsx`
- `frontend/src/app/components/Dashboard.tsx`
- `frontend/src/app/components/DataImport.tsx`
- `frontend/src/app/components/Lists.tsx`
- `frontend/src/app/components/assignment/PersonAccommodationPanel.tsx`
- `frontend/src/app/components/assignment/QuotaPersonGroups.tsx`
- `frontend/src/app/lists/listEngine.ts`
- `frontend/src/app/lists/listExports.ts`
- `frontend/src/app/services/accommodationRequirement.test.ts`
- `frontend/src/app/services/accommodationRequirement.ts`
- `frontend/src/app/services/accommodationSurcharge.test.ts`
- `frontend/src/app/services/accommodationSurcharge.ts`
- `frontend/src/app/services/api.ts`
- `frontend/src/app/services/dispositionItems.ts`
- `frontend/src/app/services/externalStayEligibility.ts`
- `frontend/src/app/services/fisRules.ts`
- `frontend/src/app/services/personAccommodation.ts`
- `frontend/src/app/services/planningCalculations.ts`
- `frontend/src/app/services/segmentWorkflow.ts`
- `frontend/src/app/services/workflowStatus.ts`
- `frontend/src/app/types.ts`
- `scripts/reconcile_accommodation_requirements.py`
- `scripts/test_backend.py`
