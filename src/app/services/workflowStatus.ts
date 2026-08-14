import type { Athlete } from '../types';

export type WorkCategory = 'new' | 'open' | 'review' | 'conflict' | 'current';

/** Shared business status used by dashboard, athletes and assignments. */
export function athleteWorkCategory(athlete: Athlete): WorkCategory {
  if (athlete.missingFromLatestAthletesImport || athlete.missingFromLatestRoomlistImport) return 'conflict';
  if (athlete.hasPendingRoomlistReview && athlete.assignment?.hasAssignment) return 'review';
  if (!athlete.assignment?.hasAssignment && athlete.importChangeTypes?.includes('NEW_ATHLETE')) return 'new';
  if (!athlete.assignment?.hasAssignment) return 'open';
  return 'current';
}

export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  new: 'Neu importiert',
  open: 'Zuweisung offen',
  review: 'Disposition prüfen',
  conflict: 'Stammdaten prüfen',
  current: 'Aktuell',
};
