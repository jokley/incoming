import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AuditEvent } from '../types';

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAuditEvents().then((result) => setEvents(result.items)).catch(() => setError('Audit-Log konnte nicht geladen werden.'));
  }, []);

  return (
    <section>
      <h2 className="mb-6 text-2xl font-bold text-gray-900">Audit-Log</h2>
      {error && <p className="mb-4 rounded bg-red-50 p-3 text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50"><tr>
            <th className="p-3">Zeitpunkt (UTC)</th><th className="p-3">Benutzer</th>
            <th className="p-3">Aktion</th><th className="p-3">Bereich</th><th className="p-3">Pfad</th>
          </tr></thead>
          <tbody>{events.map((event) => (
            <tr key={event.id} className="border-b last:border-0">
              <td className="p-3 whitespace-nowrap">{new Date(event.createdAt).toLocaleString('de-AT', { timeZone: 'UTC' })}</td>
              <td className="p-3">{event.displayName || event.username}<div className="text-xs text-gray-500">{event.username}</div></td>
              <td className="p-3">{event.action}</td><td className="p-3">{event.entityType}</td>
              <td className="p-3 font-mono text-xs">{event.path}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
