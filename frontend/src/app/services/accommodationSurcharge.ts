import { hasSingleRoomSurcharge } from './quotaEvaluation.ts';

export type AccommodationSurchargeReason = 'SPECIAL_RATE' | 'APPROVED_EXTRA_SINGLE';
type SurchargePerson = Parameters<typeof hasSingleRoomSurcharge>[0] & {
  accommodationRateCategory?: string | null;
};

/** Overview projection only: tariff and active single-room approval stay separate. */
export function accommodationSurcharge(person?: SurchargePerson | null) {
  const surchargeReasons: AccommodationSurchargeReason[] = [];
  if (person?.accommodationRateCategory === 'SPECIAL') surchargeReasons.push('SPECIAL_RATE');
  if (hasSingleRoomSurcharge(person)) surchargeReasons.push('APPROVED_EXTRA_SINGLE');
  return { hasAccommodationSurcharge: surchargeReasons.length > 0, surchargeReasons };
}
