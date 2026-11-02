import type { SingleRoomQuotaExemptReason } from '../types';
import type { FisImportPreview } from '../types';

export const IMPORT_SESSION_STATUS = {
  DRAFT: 'Entwurf', TECHNICALLY_REVIEWED: 'Technisch geprüft', PROFESSIONALLY_REVIEWED: 'Fachlich geprüft',
  WAITING_FOR_NATION: 'Warten auf Nation', NEW_LIST_RECEIVED: 'Neue Meldeliste erhalten', RECHECK_REQUIRED: 'Erneut prüfen',
  EXCEPTION_APPROVED: 'Ausnahme genehmigt',
  APPROVED: 'Freigegeben', IMPORTED: 'Importiert',
  PREVIEW_CREATED: 'Technisch geprüft', READY_FOR_IMPORT: 'Fachlich geprüft',
  NATION_CLARIFICATION: 'Warten auf Nation',
  REPLACED: 'Ersetzt', ARCHIVED: 'Archiviert', ERROR: 'Fehler',
  CANCELLED: 'Abgebrochen',
} as const;

export type ImportSessionStatus = keyof typeof IMPORT_SESSION_STATUS;
export type ApprovalType = 'NATION_APPROVED'|'ORGANIZER_APPROVED';
export type ApprovalMethod = 'EMAIL'|'PHONE';
export interface ImportApproval { id: string; sessionId: string; nation: string; type: string; description: string; decision: 'PENDING'|'APPROVED'|'NEW_LIST_ANNOUNCED'; comment?: string; user: string; timestamp: string; approvalType?: ApprovalType|null; approvalMethod?: ApprovalMethod|null; approvalBy?: string|null; approvalDate?: string|null; contactSubject?: string|null; costCoverage?: string|null; deadlineAt?: string|null; approvedPersonKeys?: string[]; quotaDetails?: { decisionKind?: 'SINGLE_ROOM'|'ATHLETE_QUOTA'; family?:string; tariffEffect?:'NONE'|'SPECIAL_SELECTED'; approvedExtent?:import('../types').QuotaExtent; uncoveredExtent?:import('../types').QuotaExtent; required?:import('../types').QuotaExtent; candidates?:Array<{personKey:string;name?:string;gender?:string}>; ezRequested?: number; ezEntitlement?: number; ezExcess?: number; officialsBasis?: number; officialsReported?: number; athletesEntered?: number; singleRoomsRequested?: number; discipline?: string; gender?: string; excessCount?: number; importedSingleRooms?: number; singleRoomsAllowed?: number; quotaExemptSingleRooms?: number; importedOfficials?: number; officialQuota?: number; singleRoomCandidates?: Array<{personKey:string;name:string;function?:string;singleRoomQuotaExemptReason?:SingleRoomQuotaExemptReason}>; singleRoomReviewPeople?: Array<{personKey:string;name:string;function?:string;singleRoomQuotaExemptReason?:SingleRoomQuotaExemptReason}> }; }
export interface ImportDecision extends ImportApproval { discipline?: string|null; gender?: string|null; importVersion?: number|null; importSession:{id:string;nation:string}; people:Array<{id:string;name:string;nation:string;singleRoomStatus:string}>; }
export interface NationClarificationSubject {
  key:string;digest:string;label:string;personKeys:string[];people:string[];
  facts?:{stay?:{arrivalDate?:string;departureDate?:string;allowedStart?:string;allowedEnd?:string;outsideNights?:number}};
}
export interface NationClarification {
 id:string;versionId:string;subject:NationClarificationSubject;required:boolean;state:'OPEN'|'RESOLVED'|'CORRECTED';changed:boolean;
 comment:string;contactMethod?:string;contactDate?:string;user:string;createdAt:string;result?:string;resolutionComment?:string;
 replies:Array<{comment:string;user:string;timestamp:string}>;
}
export interface ImportSession {
  submissions?:Array<{family:string;versionId:string;version:number;people:number;athletes:number;status:ImportSessionStatus;errors:number}>;
  submissionTotal?:{people:number|null;athletes?:number;retainedPeople?:number;conflict?:string};
  nationClarifications?:{subjects:NationClarificationSubject[];items:NationClarification[]};

  importControl?:import('../types').ImportControl;
  id: string; nation: string; discipline?: string; uploadedAt: string; uploadedBy: string;
  status: ImportSessionStatus; warnings: number; errors: number; version: number;
  currentVersionId?: string | null;
  currentVersion: {id:string;version:number;uploadedBy:string;uploadedAt:string;errors:number;warnings:number;entriesFile?:string|null;roomFile?:string|null} | null;
  approvedAt?: string | null; approvals: ImportApproval[]; preview?: FisImportPreview | null;
  versions: Array<{id:string;version:number;uploadedBy:string;uploadedAt:string;errors:number;warnings:number}>;
  history: Array<{id:string;versionId?:string|null;type:string;title:string;description?:string;user:string;timestamp:string;decisionId?:string|null}>;
}

export const completedImportStatuses = new Set<ImportSessionStatus>(['IMPORTED', 'REPLACED', 'ARCHIVED', 'CANCELLED']);

export const hasOpenSubmissions = (session:{submissions?:ReadonlyArray<{status:string}>}) => Boolean(session.submissions?.some(s=>s.status!=='IMPORTED'));
