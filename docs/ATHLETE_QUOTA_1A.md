# Athlete quota 1A

`competitions.top_level_discipline(code)` resolves an exact four-digit catalogue
code: 6xxx is Snowboard; 8xxx is Freestyle. Both catalogue definitions and ORM
Competition objects expose the derived `top_level_discipline` property. Import
columns remain opaque: the selected active EventCompetition mapping resolves
each column to a Competition before deriving its top-level discipline.

Detailed `sport`, `quota_discipline`, exact memberships, and competition identity
are unchanged. This derived concept requires no database migration or backfill.

## Counting and response

`quota_service.evaluate_athlete_quota_usage(people)` evaluates only athletes,
using canonical `topLevelDisciplines` memberships and stable `personId` (or the
parser's `matchKey`). Each nation/discipline row counts a set of distinct person
identities, so multiple individual/team competitions do not duplicate a person.
Someone participating in both disciplines counts once in each.

Import preview responses add an informational `athleteQuotaChecks` array:

- `nationCode`, `topLevelDiscipline`
- `athleteQuotaUsed`, `athleteQuotaLimit` (36), `athleteQuotaExceeded` (used > 36)
- `athleteGenderUsed` and `athleteGenderExceeded`, each with M/F keys
- `athleteGenderLimit` (20; exceeded means used > 20)
- `athleteGenderUnknown` (distinct people with missing/unrecognized/conflicting gender)
- `athleteQuotaStatus`: EXCEEDED if either base limit is exceeded, otherwise
  INCOMPLETE for unresolved gender, otherwise WITHIN_BASE_LIMITS
- `worldChampionExceptionSupported: false`

Individual Gender is normalized (including W to F). Competition/team gender and
For_gender do not substitute for a missing individual gender in this calculation.
Unknown gender still contributes to the overall 36-person total. Status describes
base-limit usage, not verified FIS admission eligibility.

Article 8.2 eligibility is unsupported: administrative WORLD_CHAMPION and OTHER
single-room exemptions do not change athlete usage. No champion status is inferred.

The field is present in typed cached previews and serialized review responses,
and is recalculated independently when review overrides are staged. Older stored
previews without the field remain compatible with the optional frontend type.

## Scope boundary

There is no new route or quota UI. Athlete checks do not create warnings,
approval tasks, or confirmation blocks. A future UI can display these explicit
fields without reinterpreting existing Officials/single-room fields; workflow
enforcement and article 8.2 eligibility require separate business decisions.

Officials allowance/grouping/usage, single-room entitlement/usage, exemptions,
APPROVED_EXTRA decision groups and preservation, nation snapshot scope,
operational booking preservation, and transaction/cache lifecycle remain unchanged.
