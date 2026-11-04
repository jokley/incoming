# Calm accommodation actions

Assigned accommodation rows now show only their period, destination and a compact
three-dot action. The menu contains Bearbeiten, Aufenthalt teilen and Zuweisung
entfernen, preserving the existing conflict/permission restrictions. Split uses
the existing split dialog and service, with operator-facing wording Aufenthalt
teilen. Edit remains an expert correction dialog; its full hotel list is retained
but capped to viewport-friendly menu height. Open periods still navigate to the
normal disposition queue.

A single Externen Aufenthalt shortcut sits below the selected people's history,
including fully assigned STANDARD stays. Queue cards use the same wording and
put rare split actions in overflow. Their footer actions share one compact row;
normal person/pair assignment controls are unchanged.

The focused EXTERNAL dialog offers only EXTERNAL hotels, person selection for
pairs and dates bounded by the stay/selected open period. For a larger shared
room it permits individual selection instead of offering an unsupported group ADD.
The server previews the complete resulting timeline and canonical remaining gaps.
The form uses explicit column spacing and capped dropdown height to avoid the
overlap and long dropdowns in the reference screenshots.

## Atomic replacement of STANDARD accommodation

This request also adds a business action that the previous open-period-only UI
could not express: setting an external period within an existing STANDARD stay.
There is no new endpoint, schema, model or persisted split state.

The existing preview and ADD requests accept `replaceStandard: true` for the
history shortcut. The existing open-period queue shortcut retains its strict
open-interval behavior. In replacement mode the server validates the selected
period against each person's stay and partitions overlapping STANDARD bookings.
Overlapping EXTERNAL bookings require explicit editing; they are never silently
overwritten.

`partition_booking` is extracted from the existing split service and reused by
both explicit splitting and the EXTERNAL orchestration. It preserves flags,
room identity, source metadata and occupant roles. For a middle external period,
STANDARD pieces before and after remain. Only selected occupants are removed from
the replaced period; unselected roommates retain continuous accommodation through
adjacent rows in the same physical room. Unknown room identity requires review
when individual or middle partitioning could otherwise duplicate room consumption.

Preview uses transient retained pieces plus the EXTERNAL booking with the central
coverage calculator. Confirmation revalidates the same plan/token under the
existing transaction lock, releases selected STANDARD relationships and reuses
the existing ADD/join operation with no intermediate commit. Any save failure
rolls back partitions, relationships and the new booking. Changed data rejects
confirmation with 409. The audit snapshot includes replaced source bookings;
existing authenticated mutation auditing remains responsible for attribution.

Normal STANDARD disposition, Athlete presentation, coverage formulas, local
capacity rules and quota formulas are unchanged. No NO_ROOM or LOC window is added.

## Verification

- Prefix, suffix, middle and full replacement for both or either roommate;
  real room consumption remains one and unrelated accommodation stays intact.
- Solo replacement, stale confirmation, failure after partition rollback,
  immutable source metadata/flags and unknown-room safety.
- PostgreSQL authenticated transaction tests cover replacement, rollback and stale
  confirmation in addition to the existing segment suite.
- Frontend checks cover closed menus instead of permanent action clusters, one
  external shortcut and complete server-projected preview timelines.
- Isolated Chromium covers solo/pair/individual automatic replacement, all expert
  menu entries, edit/split/remove, external-only choices, normal STANDARD gap
  assignment, one Athlete row and narrow dialog/queue layout without JS errors.

Remaining UX boundaries: an overlapping existing EXTERNAL stay must be corrected
through Bearbeiten; historical conflicts or missing physical-room identity need
review. STANDARD hotel selection remains the visual disposition workflow. The
all-hotel correction dropdown is intentionally still available inside Bearbeiten.
