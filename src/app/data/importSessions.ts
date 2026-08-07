import type { FisImportPreview } from '../types';

export const IMPORT_SESSION_STATUS = {
  DRAFT: 'Draft', PREVIEW_CREATED: 'Preview erstellt', READY_FOR_IMPORT: 'Import bereit',
  NATION_CLARIFICATION: 'Rücksprache Nation', APPROVED: 'Freigegeben', IMPORTED: 'Importiert',
  REPLACED: 'Ersetzt', ARCHIVED: 'Archiviert', ERROR: 'Fehler',
} as const;

export type ImportSessionStatus = keyof typeof IMPORT_SESSION_STATUS;
export interface ImportApproval { id: string; sessionId: string; nation: string; type: string; description: string; decision: 'PENDING'|'APPROVED'|'REJECTED'; comment?: string; user: string; timestamp: string; }
export interface ImportSession {
  id: string; nation: string; discipline?: string; uploadedAt: string; uploadedBy: string;
  status: ImportSessionStatus; warnings: number; errors: number; version: number;
  approvedAt?: string | null; approvals: ImportApproval[]; preview?: FisImportPreview | null;
}

export const completedImportStatuses = new Set<ImportSessionStatus>(['IMPORTED', 'REPLACED', 'ARCHIVED']);
