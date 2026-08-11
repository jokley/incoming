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

export function getComplianceStatus(assigned: number, quota: number): ComplianceStatus {
  if (assigned === quota) return 'ok';
  if (assigned > quota) return 'over';
  return 'missing';
}
