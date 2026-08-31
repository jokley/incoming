# Dashboard variants for live evaluation

The temporary segmented control on the dashboard exposes three real views over the same APIs and business data. The selected variant is reflected in the `dashboard` query parameter so that an evaluation session can link directly to a view.

## A — Capacity control

**Strengths:** Makes the planning/live/capacity relationship the dominant decision surface. Event demand, remaining hotel reserves, critical hotels, and unresolved decisions lead directly to their working context.

**Weaknesses:** Daily movements and import activity are deliberately secondary. It is less useful as the team's first screen during a high-change live operating day.

## B — Operations today

**Strengths:** Starts with today's arrivals, departures, room changes, and imports; then prioritizes the decision queue. Capacity remains visible as a guardrail rather than dominating the workday.

**Weaknesses:** The reduced event-demand detail makes medium-term capacity deterioration less obvious than in variant A.

## C — Executive overview

**Strengths:** Highest information density and fastest scanning. It combines planning versus live, hotel risks, recent changes, and the open decision queue with direct continuation links.

**Weaknesses:** Compact metrics need more domain familiarity and provide less explanatory context. It is best for experienced users and status reviews, not detailed planning.

## Recommended final direction

Use **B — Operations today** as the default architecture because it most directly answers what the Incoming Team must know or do now. Retain the planning-versus-live comparison and compact hotel risk list from A. Use C as the basis for an optional condensed mode or management review, rather than making it the team's default workspace.

Before removing the selector, validate task completion time, wrong-navigation rate, and whether users can identify the first required action without prompting. The evaluation should select a hierarchy, not introduce new calculations or APIs.
