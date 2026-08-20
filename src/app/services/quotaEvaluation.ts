import type { OfficialQuotaUsage } from './fisRules';
import type { RoomBooking } from '../types';

/** Persisted `countsAsSingle` is the only operational quota classification. */
export const isEvaluatedAsSingle = (booking?: Pick<RoomBooking, 'countsAsSingle'> | null) =>
  Boolean(booking?.countsAsSingle);

export const quotaUsageKey = (nation?: string | null, discipline?: string | null, gender?: string | null) =>
  `${nation || ''}|${discipline || ''}|${normalizeGender(gender)}`;

export const isAdditionalCostQuota = (row?: Pick<OfficialQuotaUsage, 'singleRoomsUsed' | 'singleRoomsAllowed'> | null) =>
  Boolean(row && row.singleRoomsUsed > row.singleRoomsAllowed);

const normalizeGender = (gender?: string | null) => {
  const value = (gender || '').trim().toUpperCase();
  if (value.startsWith('M')) return 'M';
  if (value.startsWith('F') || value.startsWith('W')) return 'F';
  return value;
};
