# State ownership and lifecycle

The same person appears in imported master data, review projections, approvals,
and live room disposition. This matrix identifies which state is authoritative
and prevents one representation from being used to reconstruct another.

| State | Authoritative storage | Primary writer | Lifecycle / replacement rule | Must not be inferred from |
| --- | --- | --- | --- | --- |
| Person (`Athlete`) | `athlete` row | Confirmed FIS import; selected operational edit endpoints | Imported fields are updated by each confirmed nation snapshot. A person absent from an imported nation snapshot is removed. | Competition row count or room occupant count |
| Person identity | `fis_code`, then other stable IDs; normalized names are matching fallback | Import matching | Stable identifiers should retain the oldest productive identity when legacy duplicates exist; duplicate cleanup follows confirmation. | Database primary key embedded in preview `matchKey` |
| Operator note | `Athlete.internal_note` | Operational athlete edit | Survives imports; it is operator-owned. | FIS `additional_items` |
| Imported note/items | `Athlete.additional_items` and other FIS fields | Confirmed FIS import | Replaced from incoming snapshot. | `internal_note` |
| Competition memberships | `athlete_competition` relation | Confirmed FIS import | Replaced with every active competition code selected for the person in the current event mapping. | Legacy `Athlete.discipline` string |
| Quota grouping | `Competition.quota_discipline` plus nation and normalized gender | Competition catalogue/migrations; evaluated by quota service | Several competitions may share a group; a person counts once per distinct group. | Competition display name alone |
| Legacy discipline projection | `Athlete.discipline` | Import compatibility write | Readable fallback for older clients; not authoritative when memberships exist. | — |
| Imported room request | Preview `rooms`; import-owned fields on `Athlete`; historical `FisRoomAssignment` where used | File parser / confirmed import | Describes request, partner, and stay in the current snapshot. It may trigger operational review. | Current `RoomBooking` |
| Physical room assignment | `RoomBooking` + `RoomBookingOccupant` + `RoomType` | Assignment APIs / operators | Retained across imports for retained people; removed when its last occupant is removed. | Imported requested room type |
| `RoomBooking.counts_as_single` | `room_booking.counts_as_single` | Assignment APIs; initialized deliberately for a new booking | Authoritative operational quota-consumption flag. Independent of room capacity and occupant count. | Physical room type, `single_room_status`, or “one occupant” |
| `Athlete.single_room_status` | `athlete.single_room_status` | Confirmed import and active approval revision logic | `NONE`, `IN_QUOTA`, `PENDING_APPROVAL`, or `APPROVED_EXTRA`. Tracks person entitlement/decision, not use. | Booking room type or `counts_as_single` |
| Legacy entitlement | `Athlete.single_room_entitlement` | Compatibility writes during import/approval | Non-authoritative compatibility field retained for old consumers. | Used as the sole current decision source |
| `single_room_quota_exempt_reason` | `athlete.single_room_quota_exempt_reason` | Confirmed staged override; direct administrative person edit | `WORLD_CHAMPION`, `OTHER`, or null. Persisted exemptions survive later imports unless explicitly changed. | `APPROVED_EXTRA` or physical room type |
| Staged exemption | `ImportSessionVersion.preview_json.singleRoomQuotaExemptOverrides` and matching typed cached preview | Import review endpoint | Review-only until confirmation. Every quota-derived preview section must be recalculated. | Live `Athlete` before confirmation |
| `ImportApproval` | `import_approval` row | Approval endpoint / preview task creation | Pending tasks are derived and rebuildable. Completed decisions are immutable; revisions create a new current row and history. | Current athlete status alone when reconstructing history |
| Approval-to-person link | `Athlete.single_room_decision_id` | Confirmation / active decision application | Points to the decision currently supporting `APPROVED_EXTRA`; cleared when no longer applicable or superseded by exemption. | Historical approval rows without continuity checks |
| Import session | `ImportSession` | Import workflow routes | Nation-scoped workflow state; selects a current immutable version and current approvals. | Technical `ImportRun` status |
| Import version review state | `ImportSessionVersion.preview_json` | Preview creation and staged review commands | Durable serialized review/audit projection. | A durable typed confirmation payload |
| Typed confirmation preview | Process-local `PREVIEW_STORE` | Preview creation; staged override synchronization | Expires, is consumed on success, and does not survive restart or cross-worker transfer. | `preview_json` without an explicit decode/reconstruction contract |
| Import history | `ImportSessionEvent` | Workflow and approval routes; confirmation | Append-oriented business history. Decision revisions must retain old evidence. | Mutable current labels alone |
| Technical import run | `ImportRun` | `confirm_fis_import` | Records technical start/finish of applying a preview. | Business approval or workflow history |
| Disposition analysis | Derived preview JSON | Preview/recalculation functions | Rebuilt when staged overrides change derived quota state. | Live mutation having already occurred |

## Rules for future changes

1. Never derive `counts_as_single` from physical room type, occupant count, or a
   person's approval status.
2. Never interpret `APPROVED_EXTRA` alone as an active additional cost; current
   operational use also requires a booking that counts as single.
3. Never mutate a completed approval to revise historical evidence.
4. Never make an import overwrite `internal_note` with imported remarks.
5. Never change snapshot deletion scope without an explicit product decision and
   full import/assignment regression coverage.
6. Never treat serialized preview JSON and the typed confirmation cache as
   interchangeable until that boundary is designed and tested.
