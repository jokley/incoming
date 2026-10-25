import type { ImportChangePlan } from '../types';

export function canConfirmReview(plan: ImportChangePlan | null | undefined, destructive: boolean, stale = false): boolean {
  return Boolean(plan && !stale && (!plan.requiresDestructiveConfirmation || destructive));
}

export function importReviewRequest(plan: ImportChangePlan | null | undefined, destructive: boolean, stale = false) {
  if (!canConfirmReview(plan, destructive, stale)) throw new Error('Aktuellen Änderungsplan ausdrücklich bestätigen.');
  return { planDigest: plan!.digest, snapshotScope: 'FULL_NATION' as const, confirmDestructiveChanges: destructive };
}
