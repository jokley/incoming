# Quota Architecture

## Two grouping levels

`Competition.quota_discipline` is the configurable FIS Event Group used by
operational Officials and single-room workflows. It is resolved from exact
Competition membership, never from sport, descriptive names, `Industryname`,
filenames, import-code fragments or numeric prefixes. No additional persistent
`event_group` or Officials-specific gender model is needed.

The 2027 catalogue contains these 31 exact competitions:

| Configured FIS Event Group | Competition codes and event/gender |
| --- | --- |
| Freeski Park & Pipe | 8171 HP M; 8172 HP W; 8178 BA M; 8181 BA W; 8196 SS M; 8197 SS W |
| Freestyle | 8179 MO M; 8183 MO W; 8186 DM M; 8187 DM W; 8188 DMT A; 8193 AE M; 8194 AE W; 8195 AET A |
| Ski Cross | 8180 SX M; 8184 SX W; 8185 SXT A |
| Snowboard Park & Pipe | 6174 HP M; 6175 HP W; 6182 BA M; 6183 BA W; 6188 SS M; 6190 SS W |
| Snowboard Alpine | 6170 PGS M; 6172 PGS W; 6177 PSL M; 6178 PSL W; 6180 PRT A |
| Snowboard Cross | 6191 SBX M; 6192 SBX W; 6193 BXT A |

Operational algorithms accept arbitrary configured groups. The catalogue and
forward reconciliation supply these six values; algorithms do not recognize or
hardcode their names. Changing a Competition to `TestGroup` changes its operational
consumers without an algorithm change.

## Athlete admission: 36/20

Only the athlete base quota derives a higher-level discipline. The explicit,
central `ATHLETE_DISCIPLINE_BY_EVENT_GROUP` mapping in `backend/competitions.py`
converts Freeski Park & Pipe, Freestyle and Ski Cross to **Freestyle**, and
Snowboard Park & Pipe, Snowboard Alpine and Snowboard Cross to **Snowboard**.
The previous broad Snowboard value remains supported for compatibility input.
Custom groups without an explicit athlete-discipline mapping do not receive an
invented 36/20 rule.

Each top-level discipline allows 36 distinct athletes per nation and 20 per
individual gender. An athlete in several child Event Groups counts once in that
top-level discipline. A person in both top-level disciplines counts once in each.
Identity is a persisted person ID or stable import match key.

`athleteQuotaChecks` keeps its existing informational API and M/F count labels;
its female API label F represents personal W gender. It does not create a
36/20 approval or confirmation gate. Article 8.2 athlete-admission exceptions
remain unsupported. Administrative WORLD_CHAMPION single-room exemptions do
not establish eligibility for that admission exception.

## Operational allowance contexts and gender

```text
Exact Athlete Competition membership
→ Competition.quota_discipline (FIS Event Group)
→ Nation + Event Group + Athlete.gender (M/W)
→ distinct entered athletes
→ Officials allowance
→ single-room allocation
```

Quota gender comes exclusively from personal `Athlete.gender`. Operational keys
use M/W. Existing F/female and male textual spellings normalize to W/M at the
boundary; arbitrary values are not accepted by prefix matching. Missing, invalid
or conflicting athlete gender generates a validation/review error. `forGender`
and `Competition.gender` are never quota-gender evidence.

`Competition.gender = A` describes a mixed-team competition. PRT, DMT, AET, SXT
and BXT stay in their configured Event Group. No A operational bucket exists.
A person with individual and team entries in the same group/gender counts once.

Officials have no quota gender. Exact Official Competition membership determines
their Event Groups. They are relevant once to **each active athlete M/W context**
in the same nation and mapped group; their personal gender, `forGender` and
Competition gender have no effect. Officials support usage is visible once in each
applicable context; these eligibility views are not distinct physical room totals.
A booked single-room person consumes at most one eligible entitlement slot. Without an athlete context, an Official's allowance is
unresolved and the preview explicitly requests review; it cannot invent a gender
bucket or generate an allowance. Invalid live athlete data returns a structured
409 review response rather than incomplete operational quota totals.

Distinct-person resolution is shared by Officials usage, disposition, single-room
usage, exemptions, preview, confirmation and the live read model. Frontend booking
and planning projections match Officials to the authoritative allowance contexts
returned by the backend, independently of the Official's gender.

## Physical single-room allocation

Keep entitlement context (`nation + Event Group + athlete M/W gender`) separate
from physical usage (`one distinct booked person`). The central
`allocate_single_rooms` function uses sorted augmenting-path bipartite matching
against each context's available slots. It finds maximum coverage while respecting
eligibility; unused capacity in an ineligible context cannot cover a person.
Ordering by eligibility count and stable person evidence makes allocation
independent of input row/context order. Repeated memberships and bookings do not
multiply physical usage.

Each physical person receives one COVERED, PENDING, EXEMPT or APPROVED_EXTRA result,
and at most one routing context. COVERED consumes one normal slot. Exempt people
consume none. An approved extra requires validated person-specific current context
evidence and consumes no normal slot, leaving it available for other people.
History and approval-continuity boundaries remain immutable.

Preview combines distinct requested and retained booked single people without
summing overlapping source/context rows. Confirmation uses the same matcher after
resolving new and preserved decisions. Live usage runs over the full nation roster
before applying Event Group/gender display filters. Persisted `counts_as_single`
flags stay unchanged; any flagged booking makes its person one physical single.

The API returns per-person `singleRoomAllocations`, including the selected context
and coverage status. Frontend filtered views use those authoritative allocations;
they must not independently re-match a partial set of contexts. Unfiltered client
calculations use the same sorted maximum-matching semantics, covered by shared
cross-language tests. Single-room control lists show only physically routed people
and distinguish covered, pending, exempt and approved-extra people.

Overall capacity counts distinct flagged booked persons directly, including exempt
and unmapped people. It does not require quota membership. `getQuotaSummary` sums
disjoint allocation rows and excludes exempt/unresolved physical people; it must
not be used as the overall physical capacity total.

## Formulas and accommodation state

The existing formulas remain unchanged: Officials allowance is entered athletes
plus two (zero with no entered athletes), and allocated single rooms are one for
1–3 Officials, two for 4–6, and three for 7 or more.

Art. 9.1.3 provides the Officials allowance used by Art. 13.3 single-room allocation.
Evaluating these formulas separately for six Event Groups and athlete gender can
change totals compared with the previous broad grouping.

Keep these independent concepts separate:

- `RoomBooking.room_type_id`: physical room type.
- `RoomBooking.counts_as_single`: operational single-room usage.
- `Athlete.single_room_status`: import/approval state.

Single-room exemptions remain person-level state and do not consume normal
single-room quota. APPROVED_EXTRA remains an approved surcharge state, with
applicability resolved for current quota contexts. Existing preservation,
continuity, room-booking and exemption rules remain in force.

## Immutable historical approvals

Never rewrite decision JSON, selected-person evidence, revision or audit history.
The applicability resolver intersects immutable exact Competition IDs/import codes
with the selected person's current exact Competition membership.

Frozen compatibility mappings support detailed legacy groups and version 1 broad
Snowboard/Freestyle decisions during the approved 1C transition. The six-group
transition requires exact known catalogue identity and the configured approved
target group. A broad approval cannot spread into child groups through its label
or the top-level athlete mapping. Missing/ambiguous exact evidence is unresolved.
A subsequent arbitrary configuration remap requires new review.

New decisions use `quotaMembershipVersion = 2`, distinguishing the current
Freestyle Event Group from the historical broad Freestyle label. Current decisions
require both exact identity evidence and the reviewed configured group to match.
Reviewed M/W context must also remain applicable; an Official's personal gender
cannot establish or broaden approval coverage.

Several old decisions collapsing into one current group count the approved person
once while retaining their separate historical decision records.

## Saved previews and database reconciliation

Saved broad group strings are derived data. Refresh them through current exact
EventCompetition mappings or, for eventless previews, reliable persisted
Competition IDs. Without reliable evidence, membership remains unresolved.
Confirmation recalculates and revalidates gender errors before persisting people.

Forward migration `20261012_01` freezes all 31 exact `(import_code, code)` mappings
and invokes the shared idempotent reconciliation. It changes only
`Competition.quota_discipline`; unknown/custom rows, IDs, metadata, relationships,
bookings, approvals and history remain untouched. Historical migrations remain
unchanged. Downgrade does not overwrite later administrative configuration edits.

The saved `topLevelDisciplines` preview field remains a compatibility alias of
operational `quotaDisciplines`; it must not be used for the 36/20 calculation.
The `top_level_discipline` Competition property/lookup derives the athlete level.

## Sources / Business Basis

- Rules for the Organisation of FIS World Championships, Edition April 2024,
  Art. 8.7.1/8.7.2 (36/20 athlete admission), Art. 9.1.3 (Officials), and Art. 13.3
  (single rooms).
- Rules for the FIS Snowboard / Freestyle / Freeski / Ski Cross World Cups,
  Edition 2025/26, Event Group structure.
- Direct FIS clarification received by the project connecting Art. 9.1.3 to
  single-room allocation and naming the six Event Groups.
- Final project business decision: personal athlete M/W quota gender; Officials
  are evaluated against athlete-derived contexts; mixed-team A is descriptive.
