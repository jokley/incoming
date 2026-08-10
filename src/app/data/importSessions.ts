import type { FisImportPreview } from '../types';

export const IMPORT_SESSION_STATUS = {
  DRAFT: 'Entwurf', TECHNICALLY_REVIEWED: 'Technisch geprüft', PROFESSIONALLY_REVIEWED: 'Fachlich geprüft',
  WAITING_FOR_NATION: 'Warten auf Nation', NEW_LIST_RECEIVED: 'Neue Meldeliste erhalten', RECHECK_REQUIRED: 'Erneut prüfen',
  EXCEPTION_APPROVED: 'Ausnahme genehmigt',
  APPROVED: 'Freigegeben', IMPORTED: 'Importiert',
  PREVIEW_CREATED: 'Technisch geprüft', READY_FOR_IMPORT: 'Fachlich geprüft',
  NATION_CLARIFICATION: 'Warten auf Nation',
  REPLACED: 'Ersetzt', ARCHIVED: 'Archiviert', ERROR: 'Fehler',
} as const;

export type ImportSessionStatus = keyof typeof IMPORT_SESSION_STATUS;
export type ApprovalType = 'NATION_APPROVED'|'ORGANIZER_APPROVED';
export type ApprovalMethod = 'EMAIL'|'PHONE';
export interface ImportApproval { id: string; sessionId: string; nation: string; type: string; description: string; decision: 'PENDING'|'APPROVED'|'NEW_LIST_ANNOUNCED'; comment?: string; user: string; timestamp: string; approvalType?: ApprovalType|null; approvalMethod?: ApprovalMethod|null; approvalBy?: string|null; approvalDate?: string|null; contactSubject?: string|null; deadlineAt?: string|null; approvedPersonKeys?: string[]; quotaDetails?: { gender?: string; excessCount?: number; importedSingleRooms?: number; singleRoomsAllowed?: number; importedOfficials?: number; officialQuota?: number; singleRoomCandidates?: Array<{personKey:string;name:string;function?:string}> }; }
export interface ImportSession {
  id: string; nation: string; discipline?: string; uploadedAt: string; uploadedBy: string;
  status: ImportSessionStatus; warnings: number; errors: number; version: number;
  currentVersionId?: string | null;
  currentVersion: {id:string;version:number;uploadedBy:string;uploadedAt:string;errors:number;warnings:number;entriesFile?:string|null;roomFile?:string|null} | null;
  approvedAt?: string | null; approvals: ImportApproval[]; preview?: FisImportPreview | null;
  versions: Array<{id:string;version:number;uploadedBy:string;uploadedAt:string;errors:number;warnings:number}>;
  history: Array<{id:string;type:string;title:string;description?:string;user:string;timestamp:string}>;
}

export const completedImportStatuses = new Set<ImportSessionStatus>(['IMPORTED', 'REPLACED', 'ARCHIVED']);
