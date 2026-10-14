import type { ImportSession } from '../data/importSessions.ts';
/** Open dialogs display the latest canonical preview, including after crown mutations. */
export function currentPreviewDetail<T extends { title: string; rows?: unknown[][] }>(
  detail: T | null, rows: { people: NonNullable<T['rows']>; rooms: NonNullable<T['rows']>; quota: NonNullable<T['rows']> },
): T | null {
  if (!detail) return null;
  const current = detail.title === 'Personen der Importvorschau' ? rows.people
    : detail.title === 'Zimmer der Importvorschau' ? rows.rooms
      : detail.title === 'Quota & EZ' ? rows.quota : undefined;
  return current ? { ...detail, rows: current } : detail;
}

export function canApproveSingleRoomSelection(selected: string[], maximum: number): boolean {
  return selected.length > 0 && selected.length <= maximum && new Set(selected).size === selected.length;
}

/** Every mutation uses the response's canonical preview for all open views. */
export function canonicalSessionState(session: ImportSession) {
  return { selected: session, preview: session.preview ?? null };
}
