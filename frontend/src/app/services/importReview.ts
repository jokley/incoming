import type { ImportChangePlan } from '../types';

export function canConfirmReview(plan: ImportChangePlan | null | undefined, scope: boolean, destructive: boolean, stale = false): boolean {
  return Boolean(plan && scope && !stale && (!plan.requiresDestructiveConfirmation || destructive));
}

export function importReviewRequest(plan: ImportChangePlan | null | undefined, scope: boolean, destructive: boolean, stale = false) {
  if (!canConfirmReview(plan, scope, destructive, stale)) throw new Error('Aktuellen Änderungsplan und Snapshot-Scope ausdrücklich bestätigen.');
  return { planDigest: plan!.digest, snapshotScope: 'FULL_NATION' as const, confirmDestructiveChanges: destructive };
}
