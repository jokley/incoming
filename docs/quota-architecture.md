# Quota Architecture

## Canonical quota grouping

Competition.quota_discipline is the single operational quota grouping source.

Current 2027 configured groups:

- Snowboard
- Freestyle

Current catalogue mapping:

- known mapped 6xxx competitions → Snowboard
- known mapped 8xxx competitions → Freestyle

Quota algorithms consume configured `quota_discipline` values without hardcoding Snowboard or Freestyle.

Future grouping changes must be possible by changing Competition → quota_discipline mapping and reconciling catalogue rows, without rewriting quota algorithms.

## Membership resolution

```text
Exact Competition memberships
→ Competition.quota_discipline
→ distinct quota memberships
→ nation + quota_discipline + normalized gender
→ quota evaluation
```

Multiple competitions in the same quota_discipline count one person once in that quota group.

A person with memberships in multiple quota disciplines belongs once to each.

Missing exact Competition evidence means unresolved/review required. Never guess quota membership.

## Sources that must not define operational quota membership

Do not derive operational quota grouping from:

- Athlete.discipline
- person.discipline
- Industryname
- Competition.name
- Competition.sport
- filenames
- runtime numeric-prefix inference

These may remain descriptive/statistical fields.

## Athlete quota

Current informational athlete limits:

Snowboard:

- max 36 distinct athletes per nation
- max 20 per individual gender

Freestyle:

- max 36 distinct athletes per nation
- max 20 per individual gender

Multiple individual/team Competition memberships do not duplicate a person inside one quota discipline.

FIS article 8.2 reigning World Champion athlete-admission exceptions are currently unsupported.

The administrative single-room WORLD_CHAMPION exemption must not be reused as athlete eligibility evidence.

`athleteQuotaChecks` is informational and does not create approval or confirmation gates.

## Shared quota membership

The same Competition-derived quota membership is used for:

- athletes
- officials
- officials allowance
- officials usage
- single-room entitlement
- single-room usage
- APPROVED_EXTRA
- quota exemptions
- import preview
- confirmation
- live quota read model
- approval decision groups
- approval preservation

Role-specific formulas may differ, but membership derivation must not.

## Historical approvals

Historical approval records are immutable.

Preserve:

- original decision JSON
- selected-person evidence
- revision history
- audit history

Approval applicability is evaluated separately from the historical record.

It requires reliable compatibility between:

- historical selected person
- immutable exact Competition evidence
- current exact Competition membership
- current quota_discipline

An approval must not apply merely because:

- the same person still exists
- a legacy group label equals a current group label

Competition/group remaps can make an old approval non-applicable. The implemented legacy compatibility boundary uses frozen exact catalogue identities and the approved Business Change 1B target mappings; legacy labels alone are insufficient. Versioned canonical evidence also requires the reviewed group to still match.

If applicability cannot be proven, the record is unresolved.

Several historical groups collapsing into one current group must not double-count the same approved person.

## Saved previews

Derived quota membership in saved previews must be refreshed from reliable exact Competition/Event evidence.

Reliable persisted Competition IDs must be preserved.

Eventless previews may resolve current database Competition rows from reliable persisted exact evidence.

Stale saved quota group strings and static catalogue fallbacks must not override current authoritative database mappings.

If reliable exact evidence is missing, leave the quota membership unresolved.

## Single-room concepts

Keep these concepts separate:

- `RoomBooking.room_type_id`: physical room type
- `RoomBooking.counts_as_single`: operational single-room usage
- `Athlete.single_room_status`: approval/import state

They are independent and must not be substituted for one another.

## APPROVED_EXTRA and exemptions

APPROVED_EXTRA represents an approved surcharge state.

Quota exemptions are person-level state.

Existing historical approval/exemption evidence must not be rewritten when quota mappings change.

## Detailed Competition data

Exact Competition identity and detailed fields remain available for:

- display
- statistics
- reporting
- exact event analysis

They do not independently define operational quota grouping.

## Compatibility note

`top_level_discipline` may remain as a compatibility alias from Business Change 1A.

It is not an independent operational grouping source.

Operational quota logic uses Competition.quota_discipline.

## Central design rule

```text
Competition mapping
→ quota_discipline
→ all operational quota logic
```

If a future business decision changes the quota grouping, change the Competition mapping and catalogue reconciliation rather than adding parallel grouping logic.
