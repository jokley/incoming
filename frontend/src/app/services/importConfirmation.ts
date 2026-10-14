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

export function requireSuccessfulApiResponse(response: Pick<Response,'ok'|'statusText'>, body: unknown): void {
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
  return `Import erfolgreich: ${result.summary.peopleCreated} neu, ${result.summary.peopleUpdated} aktualisiert. Bestehende Dispositionen wurden nicht verändert.`;
}
