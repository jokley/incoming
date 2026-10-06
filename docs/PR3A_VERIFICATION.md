# PR 3A verification

All 88 initial type errors are repaired. Typecheck, 15 frontend tests and the
production build pass. Lint remains at 67 errors and 16 warnings; every remaining
finding and deferral reason appears below. No backend files or lint rules changed.

## Investigation and scope

The issue grouping and planned files were reported before application edits.
Context: PR 1's domain/import/state-ownership documentation, the PR 2 baseline,
PR2_VERIFICATION.md, ARCHITECTURE.md, and current backend implementations. A
separately numbered original audit roadmap was not found in this checkout.

Initial checks: 88 type errors, 132 lint errors and 18 warnings, 12 passing tests.
The 46 additional lint errors relative to PR 2 came from installed Werkzeug
debugger JavaScript under backend/venv. A narrow venv/.venv directory exclusion
corrects that tooling scope. All application source remains checked.

The existing changes in package.json, pnpm-lock.yaml, docs/DEVELOPMENT.md and
docs/PR2_VERIFICATION.md belong to PR 2 and were preserved without further edits.

## Root causes, backend authority and runtime impact

Frontend paths below are relative to src/app/. Backend paths are repository-relative.

| Classification | Backend evidence / contract | Frontend correction and affected consumers | Runtime impact |
| --- | --- | --- | --- |
| TYPE DUPLICATION / DRIFT | backend/excel_import.py:1748 and :1945 emit persisted DATE_CHANGED/NEW_ATHLETE; preview disposition construction at :1486 onward emits NEW_PERSON/STAY_CHANGED. Athlete.to_dict serializes persisted importChangeTypes. | types.ts keeps ImportChangeType for persisted changes and adds PreviewImportChangeType for ImportChange. components/DataImport.tsx uses preview types; assignment/AssignmentInfo.tsx continues using persisted types unchanged. | Type-only. The two concepts are not combined into a permissive union. |
| TYPE DUPLICATION / DRIFT | backend/models.py:468 constrains single_room_status; :523 defaults it to NONE; :586 serializes it. backend/app.py:3049 validates WORLD_CHAMPION, OTHER or null. | Shared SingleRoomStatus and SingleRoomQuotaExemptReason in types.ts; reused by quotaEvaluation.ts, api.ts, importSessions.ts, Assignments, Athletes, DataImport, OperationsDecisionDialog and SingleRoomStatusBadge. Badge re-exports its existing public type name. | Type-only. Preview entitlement values and differing decision-ID representations remain distinct. |
| TYPE DUPLICATION / DRIFT | Athlete.to_dict emits arrivalDate/departureDate once each. | Remove identical repeated properties from types.ts. | None. |
| MISSING SYMBOL | backend/app.py:1173 and :1322 provide review flags, change details and athlete IDs for occupants. Existing AssignmentChangeSubject describes the acknowledgement consumer. | Assignments.tsx reuses AssignmentChangeSubject. Athletes.tsx imports Alert and removes the unused nonexistent surcharge import. | Acknowledgement behavior preserved; error UI can render. |
| STALE FIELD / CONTRACT ERROR | backend/app.py:2917 assignment summary supplies bookingId, hotelId and roomTypeName, but no roomTypeId. | Athletes.tsx removes the unsupported roomTypeId read. The response type is not widened. | Review links keep booking/hotel/person navigation. |
| PERMISSION MODEL | backend/auth.py ROLE_PERMISSIONS grants editors data.write and admins wildcard; auth/permissions.ts already maps this to canCreate/canEdit/canDelete. | Events.tsx calls usePermissions and distinguishes create/edit submission guards. | Removes missing-variable crashes; no invented or weakened permissions. |
| CONTRACT ERROR | backend/app.py:2744 requires personDemand and defaults singleRoomPercentage to 50; update_event accepts both. AccommodationEvent.to_dict emits both. | Events.tsx includes both values in form state, exposes numeric inputs, preserves values on edit and resets to model defaults 0/50. API request type remains required. | Legacy event creation sends valid data; existing planning values survive edits. Uses existing control styling. |
| STALE FIELD | backend/app.py:2624 accepts only hotel master data; :2683 inventory requires roomTypeId, dates and roomCount; :3342 provides per-room-type capacity and totals. | Hotels.tsx creates master data only, removes two inputs whose values were ignored, and displays HotelCapacityOverview values instead of nonexistent Hotel fields. | Corrects the objectively broken legacy form/cards. No undated inventory creation, quota inference, route removal or component replacement. Zero inventory displays zero capacity. |
| CONTRACT ERROR | backend/app.py:2080 and :2189 write EXCEPTION_APPROVED/CANCELLED. | ImportQueue.tsx completes the existing status map with success/neutral tones. | Existing workflow unchanged; labels receive defined tones. |
| NULLABILITY / TYPE DUPLICATION / DRIFT | Hotel.to_dict and AccommodationEvent.to_dict provide child collections; mock creation already initializes arrays. | api.ts uses satisfies Hotel/Event to preserve known-present collection inference. | None. No optional-field proliferation or any added. |
| CONTRACT ERROR | backend/models.py:523 and :586 define default single_room_status NONE, independent of room type or occupancy. | mockData.ts supplies NONE for all 22 mock people; api.ts mock creation does likewise. | Mocks match the persisted default without manufacturing entitlement. |
| STALE FIELD | HotelContactRow supplies occupiedBeds/freeBeds; the accumulator supplies occupied/free. | Lists.tsx calls summarizeHotelContactRows in lists/listEngine.ts. | Summary totals become numbers instead of NaN. |
| TYPE DUPLICATION / DRIFT | ListRow and CapacityDay are the existing authoritative frontend projection types. | Lists.tsx retains tuple literal keys; RoomAnalytics.tsx validates metric configuration with satisfies. | None. |
| REACT LIFECYCLE / HOOK | Assignment expansion already renders missing entries as true and writes explicit values on user toggles. | Remove the redundant default-writing effect in Assignments.tsx. | Same expansion/toggle policy without an extra render; no restructuring. |
| REACT LIFECYCLE / HOOK | Tooltip Row was recreated on every render. | Move this one leaf renderer to module scope in RoomAnalytics.tsx. | Stable component identity, unchanged content/markup. No large component decomposition. |
| REACT LIFECYCLE / HOOK | Dashboard calculation reads assignment content, not just count. | Dashboard.tsx depends on assignments. | Refreshes calculations after booking changes at a stable count. |
| REACT LIFECYCLE / HOOK | Chart keys should remain stable for equivalent series arrays. | EnterpriseChart.tsx derives memoized keys from a JSON-serialized key list. | Preserves key-change triggers, fixes dependency mismatch and delimiter collisions. Preference reset policy remains deferred. |
| MECHANICAL / STYLE | Unused declarations, const suggestions and conditional-expression statements. | No mass cleanup. | Deferred as requested. |
| UNKNOWN, resolved as tooling scope | ESLint traversed backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js. | eslint.config.js excludes Python virtual environments. | No application rule suppression. |

Import sessions, approvals, quota types and permissions were inspected. Distinct
preview/live quota shapes were not collapsed. Existing approval/session/permission
representations were reused rather than redesigned. No backend change was needed.

## Validation

| Exact command | Final result |
| --- | --- |
| pnpm typecheck | PASS — zero diagnostics |
| pnpm lint | FAIL — 67 errors, 16 warnings intentionally deferred below |
| pnpm test | PASS — 15 tests, zero failures/skips |
| pnpm build | PASS |
| pnpm lint --format json --output-file "$env:TEMP\incoming-pr3a-lint-after.json" | Same remaining findings, recorded by file/line/rule |
| git diff --check | PASS |

Typecheck/lint/test also ran before edits; typecheck ran during implementation.
Final validation ran after source and test edits. Environment: Windows, Node
24.15.0, pnpm 10.33.2. Logs: $env:TEMP/incoming-pr3a-*.log. No browser interaction
suite was run; lifecycle changes are not claimed as end-to-end verified.
Backend validation was not repeated because backend code is unchanged; PR 2's
backend findings remain outside PR 3A.

Added lists/hotelTotals.test.ts: two tests covering empty/filtered totals and a
real inventory/occupant projection without legacy hotel fields. Updated
services/auditActivity.test.ts: one test for supported booking deep-link fields,
including nullable booking/hotel IDs. All 12 existing tests are preserved.
Three runtime imports in listEngine.ts use explicit .ts extensions to let the
native Node runner test the projection without changing resolution settings.

## Exact PR 3A files changed

- eslint.config.js
- docs/PR3A_VERIFICATION.md (new)
- src/app/types.ts
- src/app/components/Assignments.tsx
- src/app/components/Athletes.tsx
- src/app/components/Dashboard.tsx
- src/app/components/DataImport.tsx
- src/app/components/Events.tsx
- src/app/components/Hotels.tsx
- src/app/components/ImportQueue.tsx
- src/app/components/Lists.tsx
- src/app/components/OperationsDecisionDialog.tsx (shared exemption type only)
- src/app/components/RoomAnalytics.tsx
- src/app/components/SingleRoomStatusBadge.tsx
- src/app/components/charts/EnterpriseChart.tsx
- src/app/data/importSessions.ts
- src/app/data/mockData.ts
- src/app/lists/listEngine.ts
- src/app/lists/hotelTotals.test.ts (new)
- src/app/services/api.ts
- src/app/services/auditActivity.test.ts
- src/app/services/quotaEvaluation.ts

Suggested commit: `fix: align frontend contracts and type safety`

Suggested PR title: `Repair frontend API contracts and TypeScript correctness`

The request requires reporting lifecycle decisions before changing their behavior.
Reset/loading/URL synchronization and skeleton randomness were reported and left
unchanged. Lint is not green; this PR does not claim to finish those repairs.
Remaining counts: 46 unused declarations, 5 const suggestions, 7 expression
statements, 8 effect-state errors, 1 purity error and 16 dependency warnings.

## Every remaining lint finding

| File:line:column | Severity | Rule | Classification | Reason deferred |
| --- | --- | --- | --- | --- |
| src/app/components/AdministrationEvents.tsx:31:39 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Selection fallback and same-ID refresh versus dirty form preservation need a decision. |
| src/app/components/AdministrationEvents.tsx:32:26 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Selection fallback and same-ID refresh versus dirty form preservation need a decision. |
| src/app/components/AdministrationEvents.tsx:32:45 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Selection fallback and same-ID refresh versus dirty form preservation need a decision. |
| src/app/components/AdministrationEvents.tsx:100:57 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Selection fallback and same-ID refresh versus dirty form preservation need a decision. |
| src/app/components/AdministrationEvents.tsx:106:155 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Selection fallback and same-ID refresh versus dirty form preservation need a decision. |
| src/app/components/Assignments.tsx:27:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:109:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:179:6 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Operational refresh/selection dependencies need a focused lifecycle repair, preserving request sequencing. |
| src/app/components/Assignments.tsx:183:6 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Operational refresh/selection dependencies need a focused lifecycle repair, preserving request sequencing. |
| src/app/components/Assignments.tsx:287:9 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:1746:3 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:1985:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:2130:9 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:2130:19 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:2281:50 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:2728:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Assignments.tsx:2740:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Athletes.tsx:307:6 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide how URL changes interact with the open person editor before changing reload/selection behavior. |
| src/app/components/Dashboard.tsx:43:7 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/DataImport.tsx:47:699 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide whether URL changes reload staging and clear selected files. |
| src/app/components/DataImport.tsx:178:31 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/DatabaseBackups.tsx:18:139 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:1:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:1:22 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:1:34 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:1:47 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:42:14 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:64:14 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:91:14 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:114:14 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:132:14 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Events.tsx:287:25 | error | @typescript-eslint/no-unused-expressions | MECHANICAL / STYLE | Equivalent conditional-statement cleanup is outside scope; preserve branch and permission semantics. |
| src/app/components/Events.tsx:296:25 | error | @typescript-eslint/no-unused-expressions | MECHANICAL / STYLE | Equivalent conditional-statement cleanup is outside scope; preserve branch and permission semantics. |
| src/app/components/EventsManagement.tsx:38:52 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide form reset and selection preservation during refresh. |
| src/app/components/EventsManagement.tsx:66:37 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide form reset and selection preservation during refresh. |
| src/app/components/EventsManagement.tsx:85:139 | error | @typescript-eslint/no-unused-expressions | MECHANICAL / STYLE | Equivalent conditional-statement cleanup is outside scope; preserve branch and permission semantics. |
| src/app/components/Hotels.tsx:1:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Hotels.tsx:1:22 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Hotels.tsx:1:34 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/Hotels.tsx:1:47 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/HotelsManagement.tsx:28:555 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide dirty-form reset and filtered-selection fallback during reload. |
| src/app/components/HotelsManagement.tsx:36:710 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide dirty-form reset and filtered-selection fallback during reload. |
| src/app/components/HotelsManagement.tsx:41:106 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide dirty-form reset and filtered-selection fallback during reload. |
| src/app/components/HotelsManagement.tsx:56:138 | error | @typescript-eslint/no-unused-expressions | MECHANICAL / STYLE | Equivalent conditional-statement cleanup is outside scope; preserve branch and permission semantics. |
| src/app/components/HotelsManagement.tsx:57:344 | error | @typescript-eslint/no-unused-expressions | MECHANICAL / STYLE | Equivalent conditional-statement cleanup is outside scope; preserve branch and permission semantics. |
| src/app/components/ImportDecisionDialog.tsx:20:5 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Request identity/cancellation and loading-state reset need a focused dialog lifecycle repair. |
| src/app/components/OperationsDecisionDialog.tsx:75:21 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Decide when task updates reset unsaved approval selections. |
| src/app/components/RoomAnalytics.tsx:9:53 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:9:72 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:10:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:14:6 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:24:7 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:25:7 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:26:7 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:50:10 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:82:7 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:83:7 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:84:7 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:137:89 | error | @typescript-eslint/no-unused-expressions | MECHANICAL / STYLE | Equivalent conditional-statement cleanup is outside scope; preserve branch and permission semantics. |
| src/app/components/RoomAnalytics.tsx:186:84 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Decide URL-versus-local source ownership and update timestamp semantics. |
| src/app/components/RoomAnalytics.tsx:195:9 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomAnalytics.tsx:295:126 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide URL-versus-local source ownership and update timestamp semantics. |
| src/app/components/RoomOccupancy.tsx:14:36 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Filter-driven request sequencing and loading state need a focused lifecycle repair. |
| src/app/components/RoomTypesManagement.tsx:16:6 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/components/RoomTypesManagement.tsx:28:52 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide form reset and selection preservation during refresh. |
| src/app/components/RoomTypesManagement.tsx:44:37 | warning | react-hooks/exhaustive-deps | REACT LIFECYCLE / HOOK | Decide form reset and selection preservation during refresh. |
| src/app/components/RoomTypesManagement.tsx:63:151 | error | @typescript-eslint/no-unused-expressions | MECHANICAL / STYLE | Equivalent conditional-statement cleanup is outside scope; preserve branch and permission semantics. |
| src/app/components/activity/ActivityHistoryDialog.tsx:20:5 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Entity/request changes and stale-response cancellation need a focused lifecycle repair. |
| src/app/components/activity/ActivityInfoBlock.tsx:14:5 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Decide metadata/loading fallback during entity changes. |
| src/app/components/charts/EnterpriseChart.tsx:59:7 | error | react-hooks/set-state-in-effect | REACT LIFECYCLE / HOOK | Decide whether changed series restore stored preferences, retain selection or show all. |
| src/app/components/ui/sidebar.tsx:611:26 | error | react-hooks/purity | REACT LIFECYCLE / HOOK | Choose stable random or deterministic skeleton widths before altering presentation. |
| src/app/lists/listEngine.ts:136:100 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:10:3 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:32:3 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:51:5 | error | prefer-const | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:52:5 | error | prefer-const | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:56:5 | error | prefer-const | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:60:5 | error | prefer-const | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:61:5 | error | prefer-const | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:946:30 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:976:66 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/api.ts:982:26 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |
| src/app/services/quotaEvaluation.ts:131:74 | error | @typescript-eslint/no-unused-vars | MECHANICAL / STYLE | Mechanical unused-code/const cleanup excluded; preserve initializer side effects and compatibility code. |

## Initial typecheck inventory

All 88 diagnostics, captured before edits; nested overload explanation lines omitted.

```text
src/app/components/Assignments.tsx(621,68): error TS2304: Cannot find name 'ChangeOccupant'.
src/app/components/Assignments.tsx(2374,51): error TS2304: Cannot find name 'ChangeOccupant'.
src/app/components/Athletes.tsx(26,34): error TS2724: '"../services/quotaEvaluation"' has no exported member named 'showStandaloneSingleRoomSurcharge'. Did you mean 'hasSingleRoomSurcharge'?
src/app/components/Athletes.tsx(243,20): error TS2552: Cannot find name 'Alert'. Did you mean 'alert'?
src/app/components/Athletes.tsx(243,78): error TS2552: Cannot find name 'Alert'. Did you mean 'alert'?
src/app/components/Athletes.tsx(398,307): error TS2339: Property 'roomTypeId' does not exist on type '{ hasAssignment: boolean; hotelName?: string; hotelId?: string; roomNumber?: string; roomTypeName?: string; checkInDate?: string; checkOutDate?: string; bookingId?: string; countsAsSingle?: boolean; }'.
src/app/components/DataImport.tsx(100,54): error TS2367: This comparison appears to be unintentional because the types 'ImportChangeType' and '"NEW_PERSON"' have no overlap.
src/app/components/DataImport.tsx(101,30): error TS2367: This comparison appears to be unintentional because the types 'ImportChangeType' and '"STAY_CHANGED"' have no overlap.
src/app/components/DataImport.tsx(103,30): error TS2367: This comparison appears to be unintentional because the types 'ImportChangeType' and '"ROOM_CREATED"' have no overlap.
src/app/components/DataImport.tsx(104,30): error TS2367: This comparison appears to be unintentional because the types 'ImportChangeType' and '"ROOM_REMOVED"' have no overlap.
src/app/components/DataImport.tsx(130,109): error TS2367: This comparison appears to be unintentional because the types 'ImportChangeType' and '"ROOM_REMOVED"' have no overlap.
src/app/components/DataImport.tsx(269,66): error TS2769: No overload matches this call.
src/app/components/DataImport.tsx(274,3): error TS2353: Object literal may only specify known properties, and 'NEW_PERSON' does not exist in type 'Record<ImportChangeType, string>'.
src/app/components/Events.tsx(49,10): error TS2552: Cannot find name 'permissions'. Did you mean 'usePermissions'?
src/app/components/Events.tsx(56,31): error TS2345: Argument of type '{ discipline: string; startDate: string; endDate: string; }' is not assignable to parameter of type '{ discipline: string; startDate: string; endDate: string; personDemand: number; singleRoomPercentage: number; }'.
src/app/components/Events.tsx(79,10): error TS2552: Cannot find name 'permissions'. Did you mean 'usePermissions'?
src/app/components/Events.tsx(94,10): error TS2552: Cannot find name 'permissions'. Did you mean 'usePermissions'?
src/app/components/Events.tsx(117,10): error TS2552: Cannot find name 'permissions'. Did you mean 'usePermissions'?
src/app/components/Events.tsx(158,28): error TS2552: Cannot find name 'permissions'. Did you mean 'usePermissions'?
src/app/components/Events.tsx(159,24): error TS2552: Cannot find name 'permissions'. Did you mean 'usePermissions'?
src/app/components/Events.tsx(159,55): error TS2304: Cannot find name 'permissions'.
src/app/components/Events.tsx(270,25): error TS2304: Cannot find name 'permissions'.
src/app/components/Events.tsx(279,25): error TS2304: Cannot find name 'permissions'.
src/app/components/Events.tsx(393,42): error TS2304: Cannot find name 'permissions'.
src/app/components/Hotels.tsx(18,5): error TS2353: Object literal may only specify known properties, and 'singleRooms' does not exist in type 'Partial<Hotel> | (() => Partial<Hotel>)'.
src/app/components/Hotels.tsx(42,36): error TS2339: Property 'singleRooms' does not exist on type 'Partial<Hotel>'.
src/app/components/Hotels.tsx(42,60): error TS2339: Property 'doubleRooms' does not exist on type 'Partial<Hotel>'.
src/app/components/Hotels.tsx(48,11): error TS2353: Object literal may only specify known properties, and 'singleRooms' does not exist in type '{ name: string; location?: string; region?: string; contactPerson?: string; email?: string; phone?: string; comment?: string; }'.
src/app/components/Hotels.tsx(48,33): error TS2339: Property 'singleRooms' does not exist on type 'Partial<Hotel>'.
src/app/components/Hotels.tsx(49,33): error TS2339: Property 'doubleRooms' does not exist on type 'Partial<Hotel>'.
src/app/components/Hotels.tsx(52,59): error TS2353: Object literal may only specify known properties, and 'singleRooms' does not exist in type 'SetStateAction<Partial<Hotel>>'.
src/app/components/Hotels.tsx(115,31): error TS2339: Property 'singleRooms' does not exist on type 'Partial<Hotel>'.
src/app/components/Hotels.tsx(116,59): error TS2353: Object literal may only specify known properties, and 'singleRooms' does not exist in type 'SetStateAction<Partial<Hotel>>'.
src/app/components/Hotels.tsx(122,31): error TS2339: Property 'doubleRooms' does not exist on type 'Partial<Hotel>'.
src/app/components/Hotels.tsx(123,59): error TS2353: Object literal may only specify known properties, and 'doubleRooms' does not exist in type 'SetStateAction<Partial<Hotel>>'.
src/app/components/Hotels.tsx(137,41): error TS2353: Object literal may only specify known properties, and 'capacity' does not exist in type 'SetStateAction<Partial<Hotel>>'.
src/app/components/Hotels.tsx(149,43): error TS2339: Property 'assignedCount' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(149,65): error TS2339: Property 'capacity' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(166,77): error TS2339: Property 'singleRooms' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(167,67): error TS2339: Property 'assignedSingle' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(171,77): error TS2339: Property 'doubleRooms' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(172,69): error TS2339: Property 'assignedDouble' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(172,94): error TS2339: Property 'doubleRooms' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(177,73): error TS2304: Cannot find name 'capacity'.
src/app/components/Hotels.tsx(181,73): error TS2304: Cannot find name 'occupied'.
src/app/components/Hotels.tsx(186,24): error TS2304: Cannot find name 'capacity'.
src/app/components/Hotels.tsx(186,35): error TS2304: Cannot find name 'occupied'.
src/app/components/Hotels.tsx(208,26): error TS2339: Property 'roomCategories' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(208,50): error TS2339: Property 'roomCategories' does not exist on type 'Hotel'.
src/app/components/Hotels.tsx(212,32): error TS2339: Property 'roomCategories' does not exist on type 'Hotel'.
src/app/components/ImportQueue.tsx(8,7): error TS2739: Type '{ DRAFT: "neutral"; TECHNICALLY_REVIEWED: "primary"; PROFESSIONALLY_REVIEWED: "info"; WAITING_FOR_NATION: "warning"; NEW_LIST_RECEIVED: "primary"; RECHECK_REQUIRED: "warning"; PREVIEW_CREATED: "primary"; ... 6 more ...; ERROR: "error"; }' is missing the following properties from type 'Record<"EXCEPTION_APPROVED" | "APPROVED" | "DRAFT" | "TECHNICALLY_REVIEWED" | "PROFESSIONALLY_REVIEWED" | "WAITING_FOR_NATION" | "NEW_LIST_RECEIVED" | "RECHECK_REQUIRED" | "IMPORTED" | ... 6 more ... | "CANCELLED", "error" | ... 4 more ... | "neutral">': EXCEPTION_APPROVED, CANCELLED
src/app/components/Lists.tsx(18,7): error TS2322: Type '{ key: string; label: string; }[]' is not assignable to type '{ key: "name" | "id" | "role" | "discipline" | "nation" | "hotelId" | "bookingId" | "hotel" | "roomType" | "arrival" | "departure" | "assigned" | "contingent" | "surcharge" | "room" | ... 12 more ... | "singleRoomPending"; label: string; }[]'.
src/app/components/Lists.tsx(81,54): error TS2551: Property 'occupiedBeds' does not exist on type '{ occupied: number; free: number; }'. Did you mean 'occupied'?
src/app/components/Lists.tsx(81,93): error TS2339: Property 'freeBeds' does not exist on type '{ occupied: number; free: number; }'.
src/app/components/RoomAnalytics.tsx(194,25): error TS2345: Argument of type 'string' is not assignable to parameter of type 'keyof CapacityDay'.
src/app/components/RoomAnalytics.tsx(200,127): error TS2345: Argument of type 'string' is not assignable to parameter of type 'keyof CapacityDay'.
src/app/components/RoomAnalytics.tsx(202,47): error TS2322: Type '{ label: string; supply: string; demand: string; assigned: string; free: string; plan: string; reserve: string; group: "beds"; } | { label: string; supply: string; demand: string; assigned: string; free: string; plan: string; reserve: string; group: "rooms"; }' is not assignable to type 'CapacityMetricConfig'.
src/app/data/mockData.ts(635,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; stance: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(647,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; stance: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(659,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; stance: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(671,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; stance: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(683,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(694,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; stance: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(706,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; stance: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(718,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; discipline: string; arrivalDate: string; departureDate: string; stance: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(732,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(742,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(752,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(762,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(772,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(782,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(792,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(802,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(812,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(822,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(832,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(842,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(852,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/data/mockData.ts(862,3): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; gender: string; arrivalDate: string; departureDate: string; }' but required in type 'Athlete'.
src/app/services/api.ts(286,23): error TS2345: Argument of type 'Hotel' is not assignable to parameter of type '{ roomInventories: HotelRoomInventory[]; id: string; name: string; location?: string; region?: string; contactPerson?: string; email?: string; phone?: string; comment?: string; }'.
src/app/services/api.ts(419,23): error TS2345: Argument of type 'Event' is not assignable to parameter of type '{ roomDemands: EventRoomDemand[]; id: string; discipline: string; startDate: string; endDate: string; personDemand: number; singleRoomPercentage: number; }'.
src/app/services/api.ts(531,13): error TS2741: Property 'single_room_status' is missing in type '{ id: string; lastname: string; firstname: string; nationCode: string; function: string; }' but required in type 'Athlete'.
src/app/types.ts(124,3): error TS2300: Duplicate identifier 'arrivalDate'.
src/app/types.ts(131,3): error TS2300: Duplicate identifier 'departureDate'.
src/app/types.ts(140,3): error TS2300: Duplicate identifier 'arrivalDate'.
src/app/types.ts(141,3): error TS2300: Duplicate identifier 'departureDate'.
src/app/types.ts(184,13): error TS2300: Duplicate identifier 'ImportChangeType'.
src/app/types.ts(486,13): error TS2300: Duplicate identifier 'ImportChangeType'.
```

## Initial lint inventory

All 150 findings, captured before edits: 86 application errors, 18 warnings, and 46 installed Werkzeug dependency errors.

```text
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:2:8 error 'EVALEX_TRUSTED' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:6:7 error 'CONSOLE_MODE' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:6:23 error 'EVALEX' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:10:18 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:11:7 error 'EVALEX' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:14:31 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:15:5 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:18:30 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:19:17 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:33:26 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:34:19 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:35:20 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:41:22 error 'URLSearchParams' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:42:19 error 'SECRET' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:47:3 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:54:7 error 'fetch' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:60:13 error 'EVALEX_TRUSTED' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:61:21 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:63:13 error 'alert' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:73:11 error 'alert' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:74:11 error 'console' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:83:8 error 'EVALEX_TRUSTED' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:84:5 error 'fetch' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:85:23 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:87:5 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:161:9 error 'EVALEX' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:201:7 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:202:7 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:205:5 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:210:23 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:217:18 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:224:16 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:230:19 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:240:15 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:247:27 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:255:18 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:267:5 error 'fetch' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:272:21 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:279:29 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:306:9 error 'console' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:320:7 error 'requestAnimationFrame' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:333:7 error 'requestAnimationFrame' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:339:7 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:339:45 error 'document' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:340:5 error 'setTimeout' is not defined no-undef
backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js:342:5 error 'document' is not defined no-undef
src/app/components/AdministrationEvents.tsx:31:39 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/AdministrationEvents.tsx:32:26 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/AdministrationEvents.tsx:32:45 warning React Hook useEffect has a missing dependency: 'loadSelected'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/AdministrationEvents.tsx:100:57 warning React Hook useEffect has a missing dependency: 'event'. Either include it or remove the dependency array. If 'setDraft' needs the current value of 'event', you can also switch to useReducer instead of useState and read 'event' in the reducer react-hooks/exhaustive-deps
src/app/components/AdministrationEvents.tsx:106:155 warning React Hook useEffect has a missing dependency: 'mapping'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/Assignments.tsx:26:10 error 'AssignmentStatusChip' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:108:10 error 'athletes' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:178:6 warning React Hook useEffect has a missing dependency: 'loadInitialData'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/Assignments.tsx:182:6 warning React Hook useEffect has a missing dependency: 'loadQuotaUsage'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/Assignments.tsx:286:9 error 'slotById' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:1745:3 error 'additionalCostPersonIds' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:1793:5 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/Assignments.tsx:1992:10 error 'AthletesPanel' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:2137:9 error 'allUnits' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:2137:19 error 'assignedUnits' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:2288:50 error 'assignedUnits' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:2735:10 error 'StatusTag' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Assignments.tsx:2747:10 error 'QuotaMetric' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Athletes.tsx:26:34 error 'showStandaloneSingleRoomSurcharge' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Athletes.tsx:243:20 error 'Alert' is not defined react/jsx-no-undef
src/app/components/Athletes.tsx:305:6 warning React Hook useEffect has a missing dependency: 'requestedAthleteId'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/Dashboard.tsx:43:7 error 'dayKey' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/Dashboard.tsx:244:6 warning React Hook useMemo has a missing dependency: 'assignments'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/DataImport.tsx:46:699 warning React Hook useEffect has a missing dependency: 'searchParams'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/DataImport.tsx:177:31 error 'preview' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/DatabaseBackups.tsx:18:139 error 'local' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:1:10 error 'PageLayout' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:1:22 error 'PageHeader' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:1:34 error 'ContentCard' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:1:47 error 'PermissionButton' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:3:10 error 'usePermissions' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:41:14 error 'err' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:63:14 error 'err' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:88:14 error 'err' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:111:14 error 'err' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:129:14 error 'err' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Events.tsx:270:25 error Expected an assignment or function call and instead saw an expression @typescript-eslint/no-unused-expressions
src/app/components/Events.tsx:279:25 error Expected an assignment or function call and instead saw an expression @typescript-eslint/no-unused-expressions
src/app/components/EventsManagement.tsx:38:52 warning React Hook useEffect has a missing dependency: 'initial'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/EventsManagement.tsx:66:37 warning React Hook useEffect has a missing dependency: 'load'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/EventsManagement.tsx:85:139 error Expected an assignment or function call and instead saw an expression @typescript-eslint/no-unused-expressions
src/app/components/Hotels.tsx:1:10 error 'PageLayout' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Hotels.tsx:1:22 error 'PageHeader' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Hotels.tsx:1:34 error 'ContentCard' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/Hotels.tsx:1:47 error 'PermissionButton' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/HotelsManagement.tsx:28:555 warning React Hook useEffect has a missing dependency: 'initial'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/HotelsManagement.tsx:36:710 warning React Hook useEffect has a missing dependency: 'load'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/HotelsManagement.tsx:41:106 warning React Hook useEffect has missing dependencies: 'filtered' and 'selectedId'. Either include them or remove the dependency array react-hooks/exhaustive-deps
src/app/components/HotelsManagement.tsx:56:138 error Expected an assignment or function call and instead saw an expression @typescript-eslint/no-unused-expressions
src/app/components/HotelsManagement.tsx:57:344 error Expected an assignment or function call and instead saw an expression @typescript-eslint/no-unused-expressions
src/app/components/ImportDecisionDialog.tsx:20:5 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/OperationsDecisionDialog.tsx:74:21 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/RoomAnalytics.tsx:9:53 error 'calculateRoomPlan' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:9:72 error 'eventRoomPlan' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:10:10 error 'calculateQuotaUsage' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:14:6 error 'Tone' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:24:7 error 'inventoryBeds' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:25:7 error 'isAssigned' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:26:7 error 'eventForAthlete' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:50:10 error 'ActionCell' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:68:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:69:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:69:93 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:70:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:70:74 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:71:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:72:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:73:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:74:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:78:6 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:78:47 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:78:116 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:78:175 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:78:283 error Error: Cannot create components during render
src/app/components/RoomAnalytics.tsx:81:7 error 'tableClass' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:82:7 error 'rowClass' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:83:7 error 'headClass' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:136:89 error Expected an assignment or function call and instead saw an expression @typescript-eslint/no-unused-expressions
src/app/components/RoomAnalytics.tsx:185:84 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/RoomAnalytics.tsx:194:9 error 'reserve' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/components/RoomAnalytics.tsx:294:126 warning React Hook useMemo has an unnecessary dependency: 'data'. Either exclude it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/RoomOccupancy.tsx:14:36 warning React Hook useEffect has a missing dependency: 'loadData'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/RoomTypesManagement.tsx:16:6 error 'Usage' is defined but never used @typescript-eslint/no-unused-vars
src/app/components/RoomTypesManagement.tsx:28:52 warning React Hook useEffect has a missing dependency: 'initial'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/RoomTypesManagement.tsx:44:37 warning React Hook useEffect has a missing dependency: 'load'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/RoomTypesManagement.tsx:63:151 error Expected an assignment or function call and instead saw an expression @typescript-eslint/no-unused-expressions
src/app/components/activity/ActivityHistoryDialog.tsx:20:5 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/activity/ActivityInfoBlock.tsx:14:5 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/charts/EnterpriseChart.tsx:34:27 error Compilation Skipped: Existing memoization could not be preserved
src/app/components/charts/EnterpriseChart.tsx:34:63 warning React Hook useMemo has a missing dependency: 'series'. Either include it or remove the dependency array react-hooks/exhaustive-deps
src/app/components/charts/EnterpriseChart.tsx:59:7 error Error: Calling setState synchronously within an effect can trigger cascading renders
src/app/components/ui/sidebar.tsx:611:26 error Error: Cannot call impure function during render
src/app/lists/listEngine.ts:129:100 error '_quotaUsage' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/services/api.ts:9:3 error 'RoomBookingUnit' is defined but never used @typescript-eslint/no-unused-vars
src/app/services/api.ts:31:3 error 'mockRoomAvailability' is defined but never used @typescript-eslint/no-unused-vars
src/app/services/api.ts:50:5 error 'mockRoomTypes' is never reassigned. Use 'const' instead prefer-const
src/app/services/api.ts:51:5 error 'mockHotels' is never reassigned. Use 'const' instead prefer-const
src/app/services/api.ts:55:5 error 'mockEvents' is never reassigned. Use 'const' instead prefer-const
src/app/services/api.ts:59:5 error 'mockAthletes' is never reassigned. Use 'const' instead prefer-const
src/app/services/api.ts:60:5 error 'mockRoomBookings' is never reassigned. Use 'const' instead prefer-const
src/app/services/api.ts:944:30 error 'availability' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/services/api.ts:974:66 error 'roomType' is assigned a value but never used @typescript-eslint/no-unused-vars
src/app/services/api.ts:980:26 error 'athleteId' is defined but never used @typescript-eslint/no-unused-vars
src/app/services/quotaEvaluation.ts:130:74 error '_allowedSingleRooms' is defined but never used @typescript-eslint/no-unused-vars
```
