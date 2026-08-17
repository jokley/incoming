import { useEffect, useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from '../services/api';
import { describeAuditEvent, type AuditActivityContext } from '../services/auditActivity';
import type { AuditEvent } from '../types';
import { ActivityTimeline, type ActivityItem } from './activity';
import { loadAllAuditEvents } from './activity/activityData';
import { ContentCard, EmptyState, InfoPanel, PageHeader, SplitPageLayout, StatusChip, Toolbar } from '../design-system';

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
  return <SplitPageLayout><PageHeader eyebrow="Systemweiter Verlauf" title="Aktivitäten" subtitle="Alle fachlichen Änderungen und Entscheidungen verständlich im Überblick." meta={<StatusChip tone="neutral">{activities.length} Einträge</StatusChip>}/>
    {error && <InfoPanel tone="error" title="Fehler">{error}</InfoPanel>}
    <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row">
      <ContentCard surface="raised" className="flex flex-col overflow-hidden xl:w-[22rem] xl:shrink-0"><div className="border-b border-[var(--ops-divider)] p-4"><h2 className="text-sm font-extrabold">Navigation & Filter</h2><Toolbar className="mt-3"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Aktivitäten durchsuchen" placeholder="Person, Hotel oder Benutzer" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></Toolbar></div><nav className="space-y-2 p-3" aria-label="Aktivitätskategorien">{filters.map(value => <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition ${filter === value ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)] text-[var(--ops-tone-primary-text)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)] text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)]'}`}><span>{value}</span>{filter === value && <History size={15}/>}</button>)}</nav></ContentCard>
      <ContentCard surface="raised" className="overflow-hidden xl:min-h-0 xl:flex-1"><div className="border-b border-[var(--ops-divider)] p-5"><h2 className="text-xl font-extrabold">{filter === 'Alle' ? 'Alle Aktivitäten' : filter}</h2><p className="mt-1 text-sm text-[var(--ops-text-muted)]">Chronologisch, neueste Einträge zuerst</p></div><div className="p-5 xl:h-[calc(100%-5rem)] xl:overflow-y-auto">{loading ? <div className="py-16 text-center text-sm text-[var(--ops-text-muted)]">Aktivitäten werden geladen …</div> : activities.length ? <ActivityTimeline items={activities} onOpen={item => item.description.href && openActivity(item)}/> : <EmptyState title="Keine Aktivitäten" description="Keine Aktivitäten entsprechen den gewählten Filtern."/>}</div></ContentCard>
    </div>
  </SplitPageLayout>;
}
