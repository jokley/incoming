# Domain glossary

This page defines the terms used by the accommodation and FIS-import code. It is
intentionally short: the purpose is to prevent similarly named concepts from
being treated as interchangeable.

| Term | Meaning | Important distinction |
| --- | --- | --- |
| **Person / Athlete** | One `Athlete` database row. Despite the model name, it can represent an athlete, coach, official, or other delegation member. | Accommodation, approval, and exemption state is person-centric. A person is not duplicated merely because they enter several competitions. |
| **Person identity / `matchKey`** | Import-time identity chosen from FIS code, competitor/staff ID, or normalized name and nation. | A preview key is not a database primary key. Room lists may need weaker name-based matching, so collisions require review. |
| **Competition** | Stable global sporting competition, with display and quota metadata. | It is not the same as an event-specific external FIS code. |
| **Championship event** | The selected championship context (`Event`) for an import. | It supplies the valid event-specific competition mappings. It is distinct from the accommodation-planning model `AccommodationEvent`. |
| **Event competition mapping** | `EventCompetition`, which maps an external FIS import code/codex to a stable `Competition` for one championship event. | Import codes may vary by event; athlete membership remains attached to the stable competition. |
| **Competition membership** | The many-to-many relationship between a person and all competitions entered in the current snapshot. | Multiple memberships do not create multiple accommodation persons. |
| **Quota discipline** | `Competition.quota_discipline`, the grouping label used by quota calculations. | Several competitions can share one quota discipline; a person counts once in that group. |
| **Quota group** | Nation + quota discipline + normalized gender. | A multi-competition athlete can participate in several distinct groups, but only once in each group. Officials intentionally retain their single-discipline grouping semantics. |
| **Gender normalization** | Values beginning with `M` map to `M`; values beginning with `F` or `W` map to `F`. | Backend and frontend must use the same grouping rule. |
| **Room request / imported room state** | A room type, roommate, and stay requested by the incoming FIS room list. | It describes requested/imported state, not the hotel room currently assigned by operations. |
| **Operational room booking** | `RoomBooking` plus `RoomBookingOccupant`, representing the live hotel-room disposition. | Retained bookings are not replaced merely because a new import snapshot is confirmed. |
| **Physical room type** | The `RoomType` attached to a `RoomBooking`, including its physical capacity. | It does not decide whether the booking consumes a single-room quota. |
| **`counts_as_single`** | Operational classification on a `RoomBooking`: whether the current booking consumes single-room quota. | It is independent of physical capacity, occupant count, and person approval status. |
| **`single_room_status`** | Person-level business state: `NONE`, `IN_QUOTA`, `PENDING_APPROVAL`, or `APPROVED_EXTRA`. | It records entitlement/decision state, not current room use. An approved person creates an active surcharge only when their booking also counts as single. |
| **`APPROVED_EXTRA`** | A durable approval for a single-room request beyond normal quota. | It must not be inferred from room type and must not silently spread to another quota discipline. |
| **Single-room quota exemption** | Person-level `single_room_quota_exempt_reason`: `WORLD_CHAMPION`, `OTHER`, or null. | An exempt requested single remains visible but does not consume normal quota and is not an extra-room approval candidate. |
| **Import preview** | Validated, calculated review state derived from uploaded files and the current database. | It is not yet live master data. Its typed confirmation payload currently lives in a process-local token store. |
| **Staged override** | An administrative exemption command recorded on the current preview version. | It changes derived review state immediately but changes the live `Athlete` only on confirmation. |
| **Import approval** | `ImportApproval`, a durable business decision for a quota issue and import version. | Completed decisions are evidence: revisions create a new current record rather than rewriting the old decision. |
| **Import session / version** | A nation-scoped workflow and its immutable uploaded/reviewed versions. | Session/version JSON is durable review and audit state; it is not currently a replacement for the typed confirmation cache. |
| **Full snapshot** | Confirmation semantics in which the imported nations' current people and memberships are authoritative. | This is not an upsert-only import: absent people in an imported nation are removed with dependent operational references. Other nations are outside that snapshot. |
| **Preserved approval** | An `APPROVED_EXTRA` carried into the next snapshot for the same continuously present person, requested single, nation, and matching quota group. | Historical approval alone is insufficient. Removal, a non-single intervening snapshot, exemption, or group change breaks continuity. |
| **Disposition analysis** | Preview projection of operational work caused by the incoming snapshot. | It is derived review information, not a persisted room mutation. |
