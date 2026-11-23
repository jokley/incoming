import { requiresAccommodation } from './accommodationRequirement.ts';
export type AccommodationSurchargeReason = 'SPECIAL_RATE' | 'APPROVED_EXTRA_SINGLE';
type SurchargePerson = {
  accommodationRequirement?: string | null;
  accommodationRateCategory?: string | null;
};

/** Overview projection only: tariff and active single-room approval stay separate. */
export function accommodationSurcharge(person?: SurchargePerson | null, activeApprovedExtraSingle = false) {
  const surchargeReasons: AccommodationSurchargeReason[] = [];
  if (person?.accommodationRateCategory === 'SPECIAL') surchargeReasons.push('SPECIAL_RATE');
  if (activeApprovedExtraSingle) surchargeReasons.push('APPROVED_EXTRA_SINGLE');
  return { applicable: requiresAccommodation(person), hasAccommodationSurcharge: requiresAccommodation(person) && surchargeReasons.length > 0, surchargeReasons };
}
