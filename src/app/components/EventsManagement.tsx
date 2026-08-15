import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { Stack, TextField } from '@mui/material';
import { CalendarDays, Pencil, Plus, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import type { Event } from '../types';
import { ContentCard, CrudDialog, EmptyState, InfoPanel, OpsButton, PageHeader, SplitPageLayout, SectionHeader, StatusChip } from '../design-system';
import { READ_ONLY_TOOLTIP } from './PageLayout';
import { OperationsTimeline, type TimelineRowData } from './timeline';
import { ActivitySummaryCard } from './activity';
import { eventRoomPlan } from '../services/planningCalculations';

type EventForm = { discipline: string; startDate: string; endDate: string; personDemand: number; singleRoomPercentage: number };
const EMPTY_FORM: EventForm = { discipline: '', startDate: '', endDate: '', personDemand: 0, singleRoomPercentage: 50 };
const WM_START = '2027-03-04';
const WM_END = '2027-03-22';
const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const inclusiveDays = (event: Event) => Math.round((new Date(`${event.endDate}T00:00:00Z`).getTime() - new Date(`${event.startDate}T00:00:00Z`).getTime()) / 86_400_000) + 1;
const eventStatus = (event: Event) => {
  const now = new Date();
  if (new Date(`${event.endDate}T23:59:59Z`) < now) return { label: 'Abgeschlossen', tone: 'success' as const };
  if (new Date(`${event.startDate}T00:00:00Z`) <= now) return { label: 'Aktiv', tone: 'warning' as const };
  return null;
};
const demandStats = (event: Event) => {
  const people = Math.max(0, event.personDemand || 0), plan = eventRoomPlan(event);
  const singlePercentage = Math.max(0, Math.min(100, event.singleRoomPercentage ?? 50));
  return { people, singlePercentage, doublePercentage: 100 - singlePercentage, singleRooms: plan.singleRooms, doubleRooms: plan.doubleRooms, rooms: plan.rooms, beds: plan.beds };
};

function EventDialog({ open, event, onClose, onSave }: { open: boolean; event: Event | null; onClose: () => void; onSave: (value: EventForm) => Promise<void> }) {
  const initial: EventForm = event ? { discipline: event.discipline, startDate: event.startDate, endDate: event.endDate, personDemand: event.personDemand || 0, singleRoomPercentage: event.singleRoomPercentage ?? 50 } : EMPTY_FORM;
  const [form, setForm] = useState<EventForm>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(initial); }, [open, event?.id]);
  const valid = Boolean(form.discipline.trim() && form.startDate && form.endDate && form.endDate >= form.startDate && form.personDemand > 0 && form.singleRoomPercentage >= 0 && form.singleRoomPercentage <= 100);
  return <CrudDialog open={open} title={event ? 'Event bearbeiten' : 'Event hinzufügen'} dirty={JSON.stringify(form) !== JSON.stringify(initial)} saving={saving} saveDisabled={!valid} onClose={onClose} onSave={async () => { setSaving(true); try { await onSave(form); onClose(); } finally { setSaving(false); } }}>
    <Stack spacing={2.25} sx={{ pt: 1 }}>
      <TextField required label="Eventname / Disziplin" value={form.discipline} onChange={e => setForm({ ...form, discipline: e.target.value })} placeholder="z. B. Big Air" />
      <TextField required type="number" label="Personenbedarf" value={form.personDemand || ''} inputProps={{ min: 1, step: 1 }} helperText="Grundlage für den automatisch berechneten Zimmerbedarf" onChange={e => setForm({ ...form, personDemand: Number(e.target.value) })} />
      <TextField required type="number" label="EZ-Anteil (%)" value={form.singleRoomPercentage} inputProps={{ min: 0, max: 100, step: 1 }} helperText={`DZ-Anteil: ${100 - form.singleRoomPercentage} %`} onChange={e => setForm({ ...form, singleRoomPercentage: Number(e.target.value) })} />
      <TextField required type="date" label="Startdatum" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField required type="date" label="Enddatum" value={form.endDate} error={Boolean(form.endDate && form.startDate && form.endDate < form.startDate)} helperText={form.endDate && form.startDate && form.endDate < form.startDate ? 'Das Enddatum muss nach dem Startdatum liegen.' : undefined} onChange={e => setForm({ ...form, endDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
      {event && <ActivitySummaryCard entityType="events" entityId={event.id} />}
    </Stack>
  </CrudDialog>;
}

function PlanningSummary({ event }: { event: Event }) {
  const stats = demandStats(event);
  const items = [['Personenbedarf', `${stats.people} Personen`], ['EZ-Anteil', `${stats.singlePercentage} %`], ['DZ-Anteil', `${stats.doublePercentage} %`], ['Gesamt Zimmer', stats.rooms], ['Gesamt Betten', stats.beds]];
  return <div className="grid grid-cols-2 divide-x divide-y divide-[var(--ops-divider)] overflow-hidden rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] sm:grid-cols-5 sm:divide-y-0">{items.map(([label, value]) => <div key={label} className="px-3 py-2.5"><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">{label}</div><div className="mt-0.5 text-base font-extrabold">{value}</div></div>)}</div>;
}

export function EventsManagement() {
  const location = useLocation(); const requestedEventId = new URLSearchParams(location.search).get('eventId');
  const permissions = usePermissions();
  const [events, setEvents] = useState<Event[]>([]), [selectedId, setSelectedId] = useState<string | null>(null), [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; event: Event | null }>({ open: false, event: null });
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const load = async () => { try { setLoading(true); const data = await api.getEvents(); setEvents(data); setSelectedId(value => requestedEventId && data.some(event => event.id === requestedEventId) ? requestedEventId : value && data.some(event => event.id === value) ? value : data[0]?.id || null); setError(null); } catch { setError('Events konnten nicht geladen werden.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const selected = events.find(event => event.id === selectedId) || null;
  const filtered = useMemo(() => events.filter(event => !search.trim() || event.discipline.toLowerCase().includes(search.trim().toLowerCase())), [events, search]);
  const totalPeople = events.reduce((sum, event) => sum + demandStats(event).people, 0);
  const timelineRows: TimelineRowData[] = events.map(event => {
    const stats = demandStats(event);
    return { id: event.id, title: event.discipline, subtitle: `${inclusiveDays(event)} Tage`, segments: [{ id: `event-${event.id}`, start: event.startDate, end: event.endDate, label: event.discipline, color: event.id === selectedId ? 'var(--ops-primary-emphasis)' : 'var(--ops-info)', tooltipData: { title: event.discipline, description: <><div>Personenbedarf: {stats.people}</div><div>Berechnete Zimmer: {stats.rooms}</div><div>EZ-Anteil: {stats.singlePercentage} %</div><div>DZ-Anteil: {stats.doublePercentage} %</div></> } }] };
  });
  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500">Events werden geladen …</div>;
  return <SplitPageLayout>
    <PageHeader eyebrow="Operations Center" title="Events & Bedarfsplanung" subtitle="Zeitplanung, Überschneidungen und automatisch berechneter Zimmerbedarf." meta={<><StatusChip tone="primary">{events.length} Events</StatusChip><StatusChip tone="info">{totalPeople} Personenbedarf</StatusChip></>} actions={<OpsButton onClick={() => setDialog({ open: true, event: null })} disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined}><Plus className="mr-2 inline h-4 w-4" />Event hinzufügen</OpsButton>} />
    {error && <InfoPanel tone="error" title="Fehler">{error}</InfoPanel>}
    <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
      <ContentCard surface="raised" className="flex flex-col overflow-hidden xl:min-h-0 xl:w-[22rem] xl:shrink-0"><div className="shrink-0 border-b border-[var(--ops-divider)] p-4"><SectionHeader title={`Eventliste (${filtered.length})`} /><label className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2"><Search className="h-4 w-4" /><input aria-label="Events suchen" className="w-full bg-transparent text-sm outline-none" placeholder="Event oder Disziplin suchen" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
        <div className="space-y-2 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">{filtered.map(event => { const stats = demandStats(event); const status = eventStatus(event); return <button key={event.id} onClick={() => setSelectedId(event.id)} className={clsx('w-full rounded-xl border p-3 text-left transition hover:bg-[var(--ops-surface-elevated)]', selectedId === event.id ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}><div className="flex justify-between gap-2"><div><b>{event.discipline}</b><div className="text-xs text-[var(--ops-text-muted)]">{formatDate(event.startDate)} – {formatDate(event.endDate)}</div><div className="text-xs text-[var(--ops-text-muted)]">{inclusiveDays(event)} Tage</div></div>{status && <StatusChip tone={status.tone}>{status.label}</StatusChip>}</div><div className="mt-2 text-xs text-[var(--ops-text-muted)]">{stats.people} Personenbedarf · {stats.rooms} Zimmer berechnet</div></button>; })}{!filtered.length && <EmptyState title="Keine Events gefunden" />}</div>
      </ContentCard>
      <ContentCard surface="raised" className="flex min-h-0 flex-1 flex-col overflow-hidden">{selected ? <><div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ops-divider)] p-4"><div><SectionHeader title="Eventinformationen" /><h2 className="mt-2 text-xl font-extrabold">{selected.discipline}</h2><div className="mt-1 flex items-start gap-2 text-sm text-[var(--ops-text-muted)]"><CalendarDays className="mt-0.5" size={16} /><div><div>{formatDate(selected.startDate)} – {formatDate(selected.endDate)}</div><div>{inclusiveDays(selected)} Tage</div></div></div></div><OpsButton disabled={!permissions.canEdit} onClick={() => setDialog({ open: true, event: selected })}><Pencil className="mr-2 inline h-4 w-4" />Event bearbeiten</OpsButton></div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4"><div className="shrink-0"><SectionHeader title="Bedarfsplanung" subtitle="Belegungsstrategie: automatisch berechneter EZ-/DZ-Bedarf" /><div className="mt-2"><PlanningSummary event={selected} /></div></div><div className="flex min-h-0 flex-1 flex-col"><SectionHeader title="Timeline" subtitle="Eventzeiträume im gesamten WM-Zeitraum · Start und Ende rechts" /><div className="mt-2 min-h-0 flex-1 overflow-y-auto"><OperationsTimeline startDate={WM_START} endDate={WM_END} rows={timelineRows} selectedRowId={selectedId || undefined} onRowClick={row => setSelectedId(row.id)} onSegmentClick={row => { const event = events.find(item => item.id === row.id); if (!event) return; setSelectedId(event.id); if (permissions.canEdit) setDialog({ open: true, event }); }} emptyMessage="Keine Eventzeiträume vorhanden." legend={[{ label: 'Ausgewähltes Event', color: 'var(--ops-primary-emphasis)' }, { label: 'Weitere Eventzeiträume', color: 'var(--ops-info)' }]} /></div></div></div></> : <div className="p-12"><EmptyState title="Kein Event ausgewählt" /></div>}</ContentCard>
    </div>
    <EventDialog open={dialog.open} event={dialog.event} onClose={() => setDialog({ open: false, event: null })} onSave={async value => { dialog.event ? await api.updateEvent(dialog.event.id, value) : await api.createEvent(value); await load(); }} />
  </SplitPageLayout>;
}
