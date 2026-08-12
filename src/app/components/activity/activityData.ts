import { api } from '../../services/api';
import type { AuditEvent } from '../../types';

export async function loadAllAuditEvents(): Promise<AuditEvent[]> {
  const first = await api.getAuditEvents(1);
  if (first.pages <= 1) return first.items;
  const remaining = await Promise.all(Array.from({ length: first.pages - 1 }, (_, index) => api.getAuditEvents(index + 2)));
  return [first, ...remaining].flatMap(page => page.items);
}

export function belongsToEntity(event: AuditEvent, entityType: string, entityId: string) {
  const targetId = String(entityId);
  const referenceKeys: Record<string, string[]> = {
    athletes: ['personId', 'personId2', 'personId3', 'personId4'],
    hotels: ['hotelId'],
    assignments: ['bookingId', 'roomId'],
    events: ['eventId'],
    'room-types': ['roomTypeId'],
    import: ['importSessionId', 'decisionId', 'nationId'],
  };
  if ((referenceKeys[entityType] ?? []).some(key => String(event.entityRefs?.[key] ?? '') === targetId)) return true;
  if (event.entityType === entityType) {
    if (event.entityId != null) return String(event.entityId) === targetId;
    return event.path.split(/[/?]/).includes(targetId);
  }
  // Zuweisungen und Importentscheidungen gehören fachlich ebenfalls zur Historie einer Person.
  if (entityType === 'athletes') {
    const athleteIds = Array.isArray(event.changes?.athleteIds) ? event.changes.athleteIds.map(String) : [];
    return athleteIds.includes(targetId) || (event.entityType === 'assignments' && event.path.split(/[/?]/).includes(targetId));
  }
  return false;
}
