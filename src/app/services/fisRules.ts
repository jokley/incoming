export type ComplianceStatus = 'ok' | 'over' | 'missing';

export interface OfficialQuotaUsage {
  nationCode: string;
  discipline: string;
  gender: string;
  athletesEntered: number;
  officialQuota: number;
  singleRoomsAllowed: number;
  assignedOfficials: number;
  singleRoomsUsed: number;
  approvedExtraSingleRooms: number;
  requiredSingleRooms: number;
  implementedSingleRooms: number;
  remainingSingleRooms: number;
  openApprovals: number;
  approvedExceptions: number;
  quotaStatus: 'FULFILLED' | 'DECISION_REQUIRED' | 'EXCEPTION_APPROVED';
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
