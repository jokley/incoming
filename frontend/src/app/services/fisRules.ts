import type { AccommodationCoverage, AccommodationRequirement, SingleRoomQuotaExemptReason } from '../types';

export interface UnallocatedSingleRoom {
  personId: string;
  name: string;
  nationCode: string;
  status: 'PENDING';
  context: null;
  reason: string;
}
export interface PersonDispositionStatus {
  personId: string; eventId: string; name: string; nationCode: string;
  personalGender: string; personType: 'ATHLETE' | 'OFFICIAL'; function: string | null;
  accommodationRequirement: AccommodationRequirement;
  sportFamilies: string[]; quotaDisciplines: string[]; quotaContexts: string[][];
  matchesContextFilters: boolean;
  accommodation: AccommodationCoverage;
  roomPreference: {
    reportedValue: string | null; reportedKind: 'SINGLE' | 'DOUBLE' | 'UNKNOWN';
    status: 'MATCH' | 'MISMATCH' | 'UNKNOWN' | 'UNASSIGNED' | 'NOT_APPLICABLE'; hasMismatch: boolean;
    segments: Array<AccommodationCoverage['segments'][number] & {
      capacity: number | null; occupantCount: number;
      physicalUsage: 'SINGLE_ROOM' | 'SHARED_DOUBLE' | 'SOLE_DOUBLE' | 'UNKNOWN';
      comparison: 'MATCH' | 'MISMATCH' | 'UNKNOWN';
    }>;
  };
  singleRoom: {
    hasSingleUse: boolean; status: 'NO_SINGLE_USE' | 'COVERED' | 'APPROVED_EXTRA' | 'EXEMPT' | 'PENDING' | 'UNKNOWN';
    context: string[] | null; eligibleContexts: string[][]; bookingIds: string[];
    storedApprovalId: string | null; approvalApplicable: boolean; applicableApprovalId: string | null;
    approvedContexts: string[][]; exemptionReason: SingleRoomQuotaExemptReason; reason: string | null;
  };
}
export type PersonDispositionSummary = Record<'peopleTotal' | 'accommodationPeopleRequired' | 'fullyAssigned' |
  'unassigned' | 'partiallyAssigned' | 'accommodationConflicts' | 'roomPreferenceMismatches' |
  'pendingSingleRoomPeople' | 'contextlessPendingSingleRoomPeople', number>;

export interface OfficialQuotaOverview {
  rows: OfficialQuotaUsage[];
  unallocatedSingleRooms: UnallocatedSingleRoom[];
  /** Present only when includePeople=true; absence is not an evaluated green state. */
  personStatuses?: PersonDispositionStatus[];
  personSummary?: PersonDispositionSummary;
  personFilters?: {nationCode:string|null;discipline:string|null;gender:string|null;sportFamily:string|null;
    personType:string|null;personalGender:string|null;contextlessPendingIncluded:boolean};
}

export type ComplianceStatus = 'ok' | 'over' | 'missing';

export interface OfficialQuotaUsage {
  functionGroups?: Array<{function:string|null;count:number;people:Array<{personId:string;name:string;isAssigned:boolean;accommodationRequirement?:'REQUIRED'|'NO_ROOM';accommodationRateCategory:'STANDARD'|'SPECIAL';accommodationRateSource:'DEFAULT'|'MANUAL'}>}>;
  accommodationPeopleRequired?: number;
  accommodationPeopleFullyAssigned?: number;
  accommodationPeoplePartiallyAssigned?: number;
  accommodationPeopleOpen?: number;
  noRoomPeople?: number;
  specialRateCount?: number;
  nationCode: string;
  discipline: string;
  gender: string;
  athletesEntered: number;
  officialQuota: number;
  registeredOfficials?: number;
  singleRoomOfficialBasis?: number;
  singleRoomsAllowed: number;
  assignedOfficials: number;
  singleRoomsUsed: number;
  singleRoomAllocations?: Array<{ personId?: string | number | null; status: string; context: string[] | null }>;
  singleRoomsCovered?: number;
  singleRoomsPending?: number;
  quotaExemptSingleRooms?: number;
  approvedExtraSingleRooms: number;
  requiredSingleRooms: number;
  implementedSingleRooms: number;
  remainingSingleRooms: number;
  openApprovals: number;
  approvedExceptions: number;
  quotaStatus: 'FULFILLED' | 'DECISION_REQUIRED' | 'EXCEPTION_APPROVED';
  peopleTotal: number;
  peopleAssigned: number;
}

/**
 * Client-side representation of the FIS quota rules used by the live
 * reference calculator. Keeping the calculation here prevents the reference
 * table and calculator UI from drifting apart.
 */
export function computeOfficialQuota(athletesEntered: number): number {
  if (athletesEntered <= 0) return 0;
  return athletesEntered + 2;
}

export function computeSingleRoomEntitlement(officials: number): number {
  if (officials <= 0) return 0;
  if (officials <= 3) return 1;
  if (officials <= 6) return 2;
  return 3;
}

export function getComplianceStatus(assigned: number, quota: number): ComplianceStatus {
  if (assigned === quota) return 'ok';
  if (assigned > quota) return 'over';
  return 'missing';
}
