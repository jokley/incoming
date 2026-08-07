export type ImportSessionStatus = 'UPLOAD' | 'PREVIEW' | 'PRÜFUNG' | 'RÜCKSPRACHE NATION' | 'IMPORT BEREIT' | 'IMPORTIERT' | 'ERSETZT' | 'ABGEBROCHEN' | 'FEHLER';

export interface ImportSession { id: string; nation: string; discipline: string; uploadedAt: string; uploadedBy: string; status: ImportSessionStatus; warnings: number; errors: number; version: number; }

// Frontend-only staging data. This is intentionally not connected to the productive import API.
export const mockImportSessions: ImportSession[] = [
  { id: 'IS-2027-0042', nation: 'AUT', discipline: 'Ski Cross', uploadedAt: '07.08.2026 · 09:42', uploadedBy: 'S. Huber', status: 'RÜCKSPRACHE NATION', warnings: 3, errors: 0, version: 2 },
  { id: 'IS-2027-0041', nation: 'GER', discipline: 'Freeski', uploadedAt: '07.08.2026 · 08:17', uploadedBy: 'M. Keller', status: 'IMPORTIERT', warnings: 0, errors: 0, version: 1 },
  { id: 'IS-2027-0040', nation: 'CAN', discipline: 'Snowboard', uploadedAt: '06.08.2026 · 16:08', uploadedBy: 'A. Martin', status: 'IMPORT BEREIT', warnings: 1, errors: 0, version: 3 },
  { id: 'IS-2027-0039', nation: 'USA', discipline: 'Moguls', uploadedAt: '06.08.2026 · 14:31', uploadedBy: 'J. Wilson', status: 'ERSETZT', warnings: 0, errors: 0, version: 1 },
  { id: 'IS-2027-0038', nation: 'SUI', discipline: 'Aerials', uploadedAt: '06.08.2026 · 11:54', uploadedBy: 'L. Meier', status: 'PREVIEW', warnings: 2, errors: 0, version: 1 },
  { id: 'IS-2027-0037', nation: 'FRA', discipline: 'Freeski', uploadedAt: '05.08.2026 · 17:22', uploadedBy: 'C. Dubois', status: 'FEHLER', warnings: 1, errors: 4, version: 1 },
];
