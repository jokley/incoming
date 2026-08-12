import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from '../services/api';
import { describeAuditEvent, type AuditActivityContext } from '../services/auditActivity';
import type { AuditEvent } from '../types';
import { ActivityTimeline, type ActivityItem } from './activity';
import { loadAllAuditEvents } from './activity/activityData';

const filters = ['Alle', 'Import', 'Disposition', 'Hotels', 'Stammdaten', 'Entscheidungen'] as const;

export function AuditLog() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [context, setContext] = useState<AuditActivityContext>({});
  const [filter, setFilter] = useState<(typeof filters)[number]>('Alle');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadAllAuditEvents(), api.getAthletes().catch(() => []), api.getHotels().catch(() => []), api.getRoomTypes().catch(() => []), api.getEvents().catch(() => []), api.getImportSessions().catch(() => [])])
      .then(([audit, athletes, hotels, roomTypes, eventItems, importSessions]) => { setEvents(audit); setContext({ athletes, hotels, roomTypes, events: eventItems, importSessions }); })
      .catch(() => setError('Aktivitäten konnten nicht geladen werden.')).finally(() => setLoading(false));
  }, []);

  const activities = useMemo(() => events.map(event => ({ event, description: describeAuditEvent(event, context) })).filter(item => {
    if (filter !== 'Alle' && item.description.category !== filter) return false;
    const searchText = [item.description.activity, item.description.entity, ...item.description.details, item.event.username, item.event.displayName].join(' ').toLocaleLowerCase('de');
    return searchText.includes(query.trim().toLocaleLowerCase('de'));
  }), [events, context, filter, query]);

  const openActivity = (item: ActivityItem) => { if (item.description.href) navigate(item.description.href); };
  return <section className="mx-auto max-w-5xl text-[var(--ops-text)]">
    <div className="mb-6"><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--ops-primary)]">Systemweiter Verlauf</p><h2 className="mt-1 text-3xl font-extrabold">Aktivitäten</h2><p className="mt-2 text-sm text-[var(--ops-text-muted)]">Alle fachlichen Änderungen und Entscheidungen verständlich im Überblick.</p></div>
    <div className="mb-6 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4 shadow-sm">
      <label className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ops-text-muted)]" size={18}/><span className="sr-only">Aktivitäten durchsuchen</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Person, Hotel, Nation, Zimmer oder Benutzer suchen …" className="h-11 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] pl-10 pr-3 text-sm outline-none focus:border-[var(--ops-primary)] focus:ring-2 focus:ring-[var(--ops-primary)]/20"/></label>
      <div className="mt-3 flex flex-wrap items-center gap-2"><SlidersHorizontal size={16} className="mr-1 text-[var(--ops-text-muted)]"/>{filters.map(value => <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${filter === value ? 'border-[var(--ops-primary)] bg-[var(--ops-primary)] text-white' : 'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] text-[var(--ops-text-subtle)] hover:border-[var(--ops-primary)]'}`}>{value}</button>)}</div>
    </div>
    {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {loading ? <div className="py-16 text-center text-sm text-[var(--ops-text-muted)]">Aktivitäten werden geladen …</div> : <ActivityTimeline items={activities} emptyMessage="Keine Aktivitäten entsprechen den gewählten Filtern." onOpen={item => item.description.href && openActivity(item)}/>}
  </section>;
}
