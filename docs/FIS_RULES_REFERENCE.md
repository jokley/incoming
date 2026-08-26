# FIS Rules reference

## Page structure

The **FIS Rules** tab sits next to **Disposition** and **Quoten** in the assignment workspace. It contains, in reading order:

1. two compact rule cards for the Official Quota and Single Room Quota;
2. a reference table for one to eight entered athletes;
3. a live calculator with one input and the two operational results.

The page is deliberately a reference tool rather than an analytics view. It has no charts, trends, filters, or administrative actions.

## Existing components and patterns

- `WorkspaceFrame` and the existing assignment tabs retain the surrounding workspace and navigation.
- `ContentCard`, `SectionHeader`, and `StatusChip` provide the established card, typography, and status-label patterns.
- The table, numeric input, borders, surfaces, focus state, spacing, and typography use the existing `--ops-*` design tokens.
- Both the reference rows and calculator call the calculation helpers in `services/fisRules.ts`; formulas are not repeated inside the UI.

## UX decisions

- Each formula is visible without interaction and marked **FIS Rule**, making its authority unambiguous during a call.
- The reference table optimizes the common one-to-eight-athlete lookup and keeps all three values on one row.
- The calculator is placed beside the rules on wide screens, updates immediately, and presents only the two values required to answer a nation's question.
- Semantic table markup, a labelled numeric input, keyboard focus styling, and live result announcements support accessible use.

## Operational benefit

An Accommodation Manager can first locate a delegation's entered-athlete count in the table, then explain the two-step calculation from the rule cards. Unusual athlete counts can be entered in the calculator without opening an external rulebook or spreadsheet. This keeps the explanation and its result in the same workspace as the current quotas and supports answering quota questions within 30 seconds.

## Possible small follow-up

If operations teams frequently move from a quota group to this reference, the selected group's entered-athlete count could later prefill the calculator. This should remain an optional shortcut and must not turn the page into another quota analysis view.
