# Operations Design System

This package introduces the UI foundation for the FIS Freestyle World Championships 2027 room-dispatch application. It is intentionally additive: existing pages keep their current imports and behavior until they are migrated in later, smaller steps.

## Current architecture findings

- The app is a Vite/React single-page application using route-level feature components under `src/app/components`.
- `Assignments.tsx` already contains the target operations-center visual language: dark surfaces, dense grids, compact controls, and subtle blue/amber/emerald operational states.
- CRUD-oriented pages currently share `src/app/components/PageLayout.tsx`, which uses a lighter admin-template style and should be treated as compatibility UI for now.
- The project contains many low-level shadcn/Radix-style primitives under `src/app/components/ui`, while Material UI is also installed. This creates parallel component languages unless a design-system layer owns tokens and composition.
- Theme values were split across Tailwind utilities, shadcn CSS variables, and page-local hex values. The new `--ops-*` tokens centralize the future dispatch UI language without rewriting existing screens.

## Migration plan

1. Keep existing screens stable and add new components only through `src/app/design-system`.
2. Use `theme/tokens.ts` and `theme/muiTheme.ts` as the canonical token source for Material UI and custom React components.
3. Prefer composed building blocks (`ContentCard`, `DataPanel`, `Toolbar`, chips, panels) over page-local card and toolbar variants.
4. Migrate pages incrementally, starting with non-critical read-only pages, then analytics/import/audit, and finally the assignment workflow.
5. Retire compatibility components in `src/app/components/PageLayout.tsx` only after every consumer has moved to the design-system exports.
