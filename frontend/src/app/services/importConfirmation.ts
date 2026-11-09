import type { ImportSession } from '../data/importSessions.ts';
import type { FisImportConfirmResult } from '../types.ts';

export function apiResponseError(body: unknown, fallback: string): Error {
  if (body && typeof body === 'object') {
    const fields = body as Record<string,unknown>;
    const message = typeof fields.message === 'string' ? fields.message
      : typeof fields.error === 'string' ? fields.error : fallback;
    // Preserve structured validation fields for existing callers.
    return Object.assign(new Error(message), fields);
  }
  return new Error(typeof body === 'string' && body.trim() ? body : fallback);
}

export function requireSuccessfulApiResponse(response: Pick<Response,'ok'|'statusText'> & { status?: number }, body: unknown): void {
  if (!response.ok && response.status === 413) throw new Error('Die Datei überschreitet die Uploadgrenze des Servers oder eines vorgeschalteten Proxys (HTTP 413).');
  if (!response.ok) throw apiResponseError(body, `API Error: ${response.statusText}`);
}

export function requireImportConfirmation(body: unknown): FisImportConfirmResult {
  if (!body || typeof body !== 'object') throw new Error('Ungültige Importantwort: Erfolgsdaten fehlen.');
  const result = body as Partial<FisImportConfirmResult>;
  if (result.success !== true) throw apiResponseError(body, 'Import fehlgeschlagen: Erfolgsbestätigung fehlt.');
  if (!result.summary || !['peopleCreated','peopleUpdated','fisRoomsImported'].every(key => {
    const value = (result.summary as unknown as Record<string,unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  })) throw new Error('Ungültige Importantwort: Erfolgsdaten fehlen.');
  return result as FisImportConfirmResult;
}

export function importConfirmationMessage(body: unknown): string {
  const result = requireImportConfirmation(body);
  return `Import erfolgreich: ${result.summary.peopleCreated} neu, ${result.summary.peopleUpdated} aktualisiert, ${result.summary.peopleRemoved ?? 0} entfernt. ${result.summary.dispositionsChanged ?? 0} Dispositionen geändert.`;
}

/** Independent canonical reads after a successful confirmation; one call each. */
export async function reloadImportSession<T>(
  sessionId: string,
  source: { getImportSession: (id: string) => Promise<T>; getImportSessions: () => Promise<T[]> },
): Promise<[T, T[]]> {
  return Promise.all([source.getImportSession(sessionId), source.getImportSessions()]);
}


/** Read before retrying; a lost HTTP response is not proof that the write failed. */
export async function archiveImportSessionChecked(
  session: Pick<ImportSession,'id'|'currentVersionId'>,
  source: {
    getImportSession: (id: string) => Promise<ImportSession>;
    archiveImportSession: (id: string, versionId: string|null) => Promise<ImportSession>;
  },
): Promise<ImportSession> {
  const read = async () => {
    const current = await source.getImportSession(session.id);
    if (!current || current.id !== session.id) throw new Error('Ungültige Sessionantwort.');
    return current;
  };
  let current: ImportSession;
  try { current = await read(); }
  catch { throw new Error('Serverstatus konnte nicht geprüft werden. Bitte Verbindung prüfen und erneut versuchen. Es wurde kein weiterer Abschlussaufruf gesendet.'); }
  if (current.status === 'ARCHIVED') return current;
  if (current.currentVersionId !== session.currentVersionId) throw new Error('Es gibt eine neuere Importversion. Bitte die Warteschlange aktualisieren und den Abschluss erneut bestätigen.');
  try {
    const archived = await source.archiveImportSession(session.id, session.currentVersionId);
    if (archived?.id !== session.id || archived.status !== 'ARCHIVED') throw new Error('Abschluss wurde nicht bestätigt.');
    return archived;
  } catch (error) {
    try { current = await read(); }
    catch { throw new Error('Abschlussstatus derzeit unklar. Bitte Verbindung prüfen und erneut versuchen; vor einem weiteren Abschluss wird der Serverstatus erneut geprüft.'); }
    if (current.status === 'ARCHIVED') return current;
    throw error;
  }
}
