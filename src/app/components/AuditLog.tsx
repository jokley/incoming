import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { describeAuditEvent, type AuditActivityContext } from '../services/auditActivity';
import type { AuditEvent } from '../types';

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [context, setContext] = useState<AuditActivityContext>({});
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.getAuditEvents(),
      api.getAthletes().catch(() => []), api.getHotels().catch(() => []), api.getRoomTypes().catch(() => []),
      api.getEvents().catch(() => []), api.getImportSessions().catch(() => []),
    ]).then(([audit, athletes, hotels, roomTypes, eventItems, importSessions]) => {
      setEvents(audit.items);
      setContext({ athletes, hotels, roomTypes, events: eventItems, importSessions });
    }).catch(() => setError('Aktivitätsprotokoll konnte nicht geladen werden.'));
  }, []);

  const activities = useMemo(() => events.map(event => ({ event, description: describeAuditEvent(event, context) })), [events, context]);

  return (
    <section>
      <h2 className="mb-2 text-2xl font-bold text-gray-900">Aktivitätsprotokoll</h2>
      <p className="mb-6 text-sm text-gray-600">Fachliche Änderungen und Entscheidungen im Überblick.</p>
      {error && <p className="mb-4 rounded bg-red-50 p-3 text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50"><tr>
            <th className="p-3">Zeitpunkt</th><th className="p-3">Benutzer</th><th className="p-3">Kategorie</th>
            <th className="p-3">Aktivität</th><th className="p-3">Betroffene Entität</th>
          </tr></thead>
          <tbody>{activities.map(({ event, description }) => (
            <tr key={event.id} className="border-b align-top last:border-0">
              <td className="p-3 whitespace-nowrap">{new Date(event.createdAt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Vienna' })}</td>
              <td className="p-3"><span className="font-medium">{event.displayName || event.username}</span>{event.displayName && <div className="text-xs text-gray-500">{event.username}</div>}</td>
              <td className="p-3">{description.category}</td>
              <td className="p-3"><span className="font-medium text-gray-900">{description.activity}</span>{description.details.map(detail => <div key={detail} className="mt-1 text-xs text-gray-500">{detail}</div>)}</td>
              <td className="p-3 font-medium text-gray-900">{description.entity}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
