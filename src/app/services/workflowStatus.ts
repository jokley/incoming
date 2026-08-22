import type { Athlete } from '../types';

export type WorkCategory = 'new' | 'open' | 'review' | 'conflict' | 'current';

const API_WORK_CATEGORY: Record<NonNullable<Athlete['workflowStatus']>, WorkCategory> = {
  NEW_PERSON: 'new',
  OPEN_ASSIGNMENT: 'open',
  REVIEW_ASSIGNMENT: 'review',
  CONFLICT: 'conflict',
  CURRENT: 'current',
};

/**
 * Shared business status used by dashboard, athletes and assignments.
 *
 * The API workflow status is authoritative. Import-presence and change-tracking
 * flags describe how a person reached their current state; they are not data
 * integrity errors and must therefore never promote a person to `conflict`.
 * The fallback keeps mock/legacy API records usable while applying the same
 * workflow precedence as the backend.
 */
export function athleteWorkCategory(athlete: Athlete): WorkCategory {
  if (athlete.workflowStatus) return API_WORK_CATEGORY[athlete.workflowStatus];
  if (athlete.hasPendingRoomlistReview && athlete.assignment?.hasAssignment) return 'review';
  if (!athlete.assignment?.hasAssignment && athlete.importChangeTypes?.includes('NEW_ATHLETE')) return 'new';
  if (!athlete.assignment?.hasAssignment) return 'open';
  return 'current';
}

export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  new: 'Neu',
  open: 'Offen',
  review: 'Disposition prüfen',
  conflict: 'Stammdaten prüfen',
  current: 'Aktuell',
};
