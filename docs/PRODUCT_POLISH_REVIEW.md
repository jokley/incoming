# Product polish review – public beta

**Review date:** 26 August 2026

**Product lens:** time-critical event operations, not executive reporting

**Scope:** all routed workspaces, shared navigation, dialogs, tables, cards, forms,
timelines, printing, responsiveness, and light/dark themes.

## Executive assessment

The application is structurally ready for beta. Its strongest pattern is the dense
master/detail workspace: operators can keep context visible while reviewing or
editing a record. The design system also provides a sound semantic foundation for
both themes. The remaining risk is **drift**, not a missing visual language: loading,
empty, table, and action patterns are sometimes implemented locally and therefore
behave differently between otherwise similar pages.

No workflow, feature, route, permission, calculation, or business rule should be
changed during this polish sprint. Recommendations below deliberately evolve the
existing system.

## Priority 1 — quick wins (less than one hour each)

1. **Use exact, consistent navigation labels.** Correct spelling and keep route,
   page title, and navigation terminology identical. The visible `Dashbord` typo
   was corrected to `Dashboard` in this review.
2. **Standardise icon-only actions.** Require a visible tooltip, an accessible name,
   a 40 × 40 px minimum target, and the shared focus ring for edit, delete, theme,
   close, pagination, and overflow controls. This is especially valuable on dense
   master/detail pages and in dialogs.
3. **Differentiate the three empty conditions.** Use concise copy for “no records”,
   “no search results”, and “nothing selected”. Only show a CTA when it resolves the
   state; a selection placeholder must not look like an error.
4. **Align button hierarchy.** One filled primary action per page section or dialog;
   use secondary styling for supporting actions and quiet styling for cancel/close.
   Destructive actions remain visually distinct but should not dominate before the
   confirmation step.
5. **Keep operational filters visible.** Preserve active filters when scrolling and
   show the result count next to search/filter controls. Add a clearly named reset
   action only when at least one filter is active.
6. **Tighten microcopy and truncation.** Avoid mixed nouns and verbs for equivalent
   actions, keep German labels consistent, and provide a tooltip or native title for
   truncated hotel, event, athlete, and role names.
7. **Unify loading feedback.** Replace remaining local loading text (notably audit
   history) with the shared skeleton pattern; keep `aria-busy` and non-visual status
   announcements.

## Priority 2 — medium improvements (a few hours each)

1. **Create one enterprise table recipe.** Consolidate sticky headers, row height,
   numeric alignment, sort affordances, hover/selected states, horizontal overflow,
   totals, and empty/loading rows. Apply it first to Assignments, Athletes, Hotels,
   Events, Room Types, Import, and Administration. Do not alter columns or actions.
2. **Create explicit shared state variants.** Extend the common state component with
   `empty`, `no-results`, `no-selection`, `loading`, and `error` variants. This removes
   ad-hoc messages without changing recovery paths.
3. **Normalise form rhythm.** Use a consistent label → control → helper/error spacing,
   persistent labels, required/optional wording, and a predictable footer action
   order in all CRUD and contingency forms. Preserve entered values on validation
   errors and move focus to the first invalid field.
4. **Make master/detail resizing resilient.** Verify sensible minimum widths and
   independent scrolling at laptop widths, retain the selected row after refresh,
   and avoid wrapping primary identifiers. Collapse only at the design system's
   existing responsive breakpoint.
5. **Complete theme parity.** Audit focus, disabled, selected, warning, and chart
   contrast in both themes. Replace direct blue/gray utility colours in active
   components with semantic tokens so meaning and contrast remain stable.
6. **Harden print layouts.** Hide navigation and non-print actions, repeat table
   headers, avoid splitting assignment/room groups across pages, include print date
   and active filter context, and verify monochrome readability. Printed status must
   never rely on colour alone.
7. **Consolidate the inactive legacy surfaces.** Confirm that `Hotels.tsx`,
   `Events.tsx`, `RoomOccupancy.tsx`, and the local `PageLayout.tsx` have no supported
   deep links. Then archive or remove them so future polish is applied only to routed
   workspaces.

## Priority 3 — optional nice-to-have ideas

- Add keyboard-shortcut hints to existing high-frequency actions only after usage
  research; do not introduce new commands during beta polish.
- Add lightweight density preference only if live-event observation shows that the
  current compact density is insufficient. Keep the existing density as default.
- Introduce page-specific skeleton shapes for the timeline and analytics after the
  shared state migration; this is perceptual polish rather than operational need.
- Gradually converge on one icon library when touching components for other reasons.
  A standalone migration has low operator value.

## Components to keep exactly as they are

- **Dashboard information architecture:** operational KPIs, open tasks, and direct
  links are prioritised appropriately; secondary audit/import data loads progressively.
- **Assignments master/detail model:** simultaneous list and detail context supports
  rapid decisions and should not be converted into a wizard or card grid.
- **Quota and FIS Rules tabs:** placing explanation beside the operative quota view
  supports decisions without leaving the workflow. Keep the tab relationship and
  rule content hierarchy.
- **Athletes, Hotels, Events, and Room Types management structure:** dense selection,
  detail context, and direct actions are appropriate for an operations tool.
- **EnterpriseDialog and CrudDialog structure:** fixed header/footer, bounded content
  area, focus handling, busy state, and unsaved-change protection are strong defaults.
- **Semantic theme tokens:** shared meaning across dark and light themes is the right
  foundation; improve token adoption rather than replacing the palette.
- **Timeline chronology:** a chronological scan is the correct mental model for
  operational history; preserve its order and event grouping.

## Remove completely

Remove only elements that are provably redundant; do not remove operational data.

1. **Inactive legacy page implementations**, after confirming no supported deep
   links or planned reactivation. Duplicate implementations create visual drift and
   maintenance ambiguity.
2. **Duplicated headings inside adjacent cards** when the page/section heading already
   names the same scope and no accessibility relationship depends on the duplicate.
3. **Decorative separators and borders** inside already bounded cards or panels when
   spacing alone communicates grouping.
4. **Disabled actions with no explanation.** Either hide actions the user can never
   perform because of role permissions, or retain them with a concise reason when the
   action may become available through selection/state.

## Cross-application inconsistencies

| Area | Current inconsistency | Target convention |
| --- | --- | --- |
| Navigation | Labels and active components can drift | One route-derived label and one shared active/focus treatment |
| Page headers | Action placement and supporting text vary | Title/context left; one primary action and utilities right |
| Tables | Sticky headers, padding, sorting, totals, and states are locally styled | One dense enterprise table recipe |
| Status chips | Similar meanings can be expressed by local colour choices | Semantic tone + concise text; never colour alone |
| Buttons | Filled, outlined, and icon controls do not always reflect importance | Primary, secondary, quiet, destructive hierarchy |
| Forms | Helper/error spacing and required-field language vary | Shared field stack and validation behaviour |
| Empty/loading states | Generic text, skeletons, and selection placeholders coexist | Named common state variants |
| Icons | Lucide and MUI coexist with varying apparent size | 16 px inline, 20 px standalone, consistent stroke/target |
| Radius | Tokens and direct utility radii are mixed | Token radius by component family |
| Themes | Semantic tokens coexist with direct palette utilities | Tokens for every interactive and stateful colour |
| Responsive layout | Horizontal navigation and dense workspaces rely on local overflow | Explicit scroll ownership and tested minimum widths |
| Print | Screen controls and colour semantics may leak into output | Dedicated print rules and text-redundant status |

## Page-by-page review

| Surface | Keep | Highest-value polish |
| --- | --- | --- |
| Dashboard | KPI/task hierarchy and progressive loading | Ensure every KPI links or clearly reads as non-interactive; align card heights only within rows |
| Assignments | Dense master/detail workspace | Standardise table states, numeric alignment, and selected-row persistence |
| Quota | Decision context next to assignments | Align threshold/progress semantics and expose exact values without relying on bar colour |
| FIS Rules | In-context reference tab | Preserve readable line length and make section anchors/focus states consistent |
| Athletes | Fast list-to-detail navigation | Standardise truncation, filters, selection placeholder, and action hierarchy |
| Hotels | Operational filters and management detail | Keep filters visible; reduce nested borders; align capacity numbers |
| Events | Management structure | Clarify date/time hierarchy and use one date format throughout |
| Room Types | Compact reference data workflow | Use shared CRUD form spacing and table actions |
| Import | Decision dialogs and conflict handling | Make step/loading/error state persistent and put destructive replacement behind explicit confirmation |
| Analytics | Existing operational metrics | Improve chart contrast, units, legends, and empty datasets in both themes and print |
| Lists | Compact exported operational views | Show active scope/filter context and verify repeated print headers |
| Administration | Separation from daily operations | Standardise destructive hierarchy, permission explanations, and long-running progress |
| Dialogs | Enterprise/CRUD shell | Audit action order, first-invalid focus, and long-content scrolling |
| Timeline / Audit | Chronological scan | Replace local loading text, strengthen date grouping, and retain accessible event labels |

## Beta acceptance checks

- Complete each core workflow using keyboard only at 1280 × 720 and 1440 × 900.
- Verify browser zoom at 200% without hidden actions or two-dimensional page scrolling.
- Verify all loading, empty, error, read-only, and permission-denied states.
- Check selected, hover, focus, disabled, warning, and destructive states in both themes.
- Print Assignments, Lists, and Analytics to A4 portrait/landscape and monochrome PDF.
- Confirm all status, chart, and quota meaning remains understandable without colour.

## Change boundary

This review intentionally recommends no new features and no workflow or business-logic
changes. The only implementation included is the visible dashboard-label spelling
correction; the remaining items form a prioritised, bounded polish backlog.
