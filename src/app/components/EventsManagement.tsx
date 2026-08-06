import { useEffect, useMemo, useRef, useState } from 'react';
import { Stack, TextField } from '@mui/material';
import { BedDouble, BedSingle, CalendarDays, Pencil, Plus, Search, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import type { Event } from '../types';
import { ContentCard, CrudDialog, EmptyState, InfoPanel, OpsButton, PageHeader, PageLayout, SectionHeader, StatusChip } from '../design-system';
import { READ_ONLY_TOOLTIP } from './PageLayout';
import { OperationsTimeline, type TimelineRowData } from './timeline';

type EventForm = { discipline: string; startDate: string; endDate: string };
type EventStatus = { label: string; tone: 'success' | 'warning' | 'primary' };
const EMPTY_FORM: EventForm = { discipline: '', startDate: '', endDate: '' };
const WM_START = '2027-03-04';
const WM_END = '2027-03-22';
const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const eventStatus = (event: Event): EventStatus => {
  const now = new Date();
  if (new Date(`${event.endDate}T23:59:59Z`) < now) return { label: 'Abgeschlossen', tone: 'success' };
  if (new Date(`${event.startDate}T00:00:00Z`) <= now) return { label: 'Aktiv', tone: 'warning' };
  return { label: 'Geplant', tone: 'primary' };
};
const demandStats = (event: Event) => {
  const demands = event.roomDemands || [];
  const rooms = demands.reduce((sum, demand) => sum + demand.roomCount, 0);
  const beds = demands.reduce((sum, demand) => sum + demand.roomCount * demand.roomType.maxPersons, 0);
  return { rooms, beds, people: beds };
};

function EventDialog({ open, event, onClose, onSave }: { open: boolean; event: Event | null; onClose: () => void; onSave: (value: EventForm) => Promise<void> }) {
  const initial = event ? { discipline: event.discipline, startDate: event.startDate, endDate: event.endDate } : EMPTY_FORM;
  const [form, setForm] = useState<EventForm>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(initial); }, [open, event?.id]);
  const valid = Boolean(form.discipline.trim() && form.startDate && form.endDate && form.endDate >= form.startDate);
  return <CrudDialog open={open} title={event ? 'Event bearbeiten' : 'Neues Event'} dirty={JSON.stringify(form) !== JSON.stringify(initial)} saving={saving} saveDisabled={!valid} onClose={onClose} onSave={async () => { setSaving(true); try { await onSave(form); onClose(); } finally { setSaving(false); } }}>
    <Stack spacing={2.25} sx={{ pt: 1 }}>
      <TextField required label="Eventname / Disziplin" value={form.discipline} onChange={e => setForm({ ...form, discipline: e.target.value })} placeholder="z. B. Big Air" />
      <TextField required type="date" label="Startdatum" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField required type="date" label="Enddatum" value={form.endDate} error={Boolean(form.endDate && form.startDate && form.endDate < form.startDate)} helperText={form.endDate && form.startDate && form.endDate < form.startDate ? 'Das Enddatum muss nach dem Startdatum liegen.' : undefined} onChange={e => setForm({ ...form, endDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
    </Stack>
  </CrudDialog>;
}

function PlanningMetric({ label, value, helper, icon }: { label: string; value: string | number; helper?: string; icon?: React.ReactNode }) {
  return <div className="rounded-[var(--ops-radius-lg)] bg-[var(--ops-surface-raised)] p-4"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">{icon}{label}</div><div className="mt-2 text-2xl font-extrabold text-[var(--ops-text)]">{value}</div>{helper && <div className="mt-1 text-xs text-[var(--ops-text-muted)]">{helper}</div>}</div>;
}

export function EventsManagement() {
  const permissions = usePermissions();
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; event: Event | null }>({ open: false, event: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { try { setLoading(true); const data = await api.getEvents(); setEvents(data); setSelectedId(value => value && data.some(event => event.id === value) ? value : data[0]?.id || null); setError(null); } catch { setError('Events konnten nicht geladen werden.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { detailScrollRef.current?.scrollTo({ top: 0 }); }, [selectedId]);
  const selected = events.find(event => event.id === selectedId) || null;
  const filtered = useMemo(() => events.filter(event => (!statusFilter || eventStatus(event).label === statusFilter) && (!search.trim() || event.discipline.toLowerCase().includes(search.trim().toLowerCase()))), [events, search, statusFilter]);
  const totals = events.reduce((sum, event) => { const stats = demandStats(event); return { rooms: sum.rooms + stats.rooms, people: sum.people + stats.people }; }, { rooms: 0, people: 0 });
  const timelineRows: TimelineRowData[] = events.map(event => ({ id: event.id, title: event.discipline, subtitle: `${formatDate(event.startDate)} – ${formatDate(event.endDate)}`, status: eventStatus(event).label, segments: [{ id: `event-${event.id}`, start: event.startDate, end: event.endDate, label: event.discipline, color: event.id === selectedId ? 'var(--ops-primary-emphasis)' : 'var(--ops-info)', tooltipData: { title: event.discipline, status: eventStatus(event).label, description: 'Eventzeitraum ohne Hotelbelegung' } }] }));

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500">Events werden geladen …</div>;
  return <PageLayout className="[--ops-background:#111d2e] [--ops-surface:#1a2a40] [--ops-surface-raised:#21334c] [--ops-surface-elevated:#2a3e59] [--ops-surface-overlay:#344b67] [--ops-border:#4b6380] [--ops-divider:#405773] [--ops-text-muted:#b7c4d4] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:gap-5 xl:space-y-0">
    <PageHeader eyebrow="Operations Center" title="Events & Bedarfsplanung" subtitle="Planungsgrundlage und berechneter Zimmerbedarf für die WM-Disziplinen." meta={<><StatusChip tone="primary">{events.length} Events</StatusChip><StatusChip tone="info">{totals.people} Personen geplant</StatusChip><StatusChip tone="neutral">{totals.rooms} Zimmer benötigt</StatusChip></>} actions={<OpsButton onClick={() => setDialog({ open: true, event: null })} disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined}><Plus className="mr-2 inline h-4 w-4" />Event hinzufügen</OpsButton>} />
    {error && <InfoPanel tone="error" title="Fehler">{error}</InfoPanel>}
    <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row">
      <ContentCard surface="raised" className="flex flex-col overflow-hidden xl:min-h-0 xl:w-[22rem] xl:shrink-0">
        <div className="shrink-0 border-b border-[var(--ops-divider)] p-4"><SectionHeader title={`Eventliste (${filtered.length})`} /><label className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2"><Search className="h-4 w-4" /><input aria-label="Events suchen" className="w-full bg-transparent text-sm text-[var(--ops-text)] outline-none" placeholder="Event oder Disziplin suchen" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Status filtern" className="mt-3 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Alle Status</option><option>Geplant</option><option>Aktiv</option><option>Abgeschlossen</option></select></div>
        <div className="space-y-2 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">{filtered.map(event => { const stats = demandStats(event); const status = eventStatus(event); return <button key={event.id} onClick={() => setSelectedId(event.id)} className={clsx('w-full rounded-xl border p-3 text-left transition hover:bg-[var(--ops-surface-elevated)]', selectedId === event.id ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}><div className="flex justify-between gap-2"><div className="min-w-0"><b className="block truncate">{event.discipline}</b><div className="mt-1 text-xs text-[var(--ops-text-muted)]">{formatDate(event.startDate)} – {formatDate(event.endDate)}</div></div><StatusChip tone={status.tone}>{status.label}</StatusChip></div><div className="mt-3 flex justify-between text-xs text-[var(--ops-text-muted)]"><span>{stats.people} Personen</span><b>{stats.rooms} Zimmer</b></div></button>; })}{!filtered.length && <EmptyState title="Keine Events gefunden" description="Passen Sie Suche oder Statusfilter an." />}</div>
      </ContentCard>
      <ContentCard surface="raised" className="overflow-hidden xl:min-h-0 xl:flex-1"><div ref={detailScrollRef} className="xl:h-full xl:overflow-y-auto">{selected ? <div>
        <div className="border-b border-[var(--ops-divider)] p-5"><div className="flex items-start justify-between gap-4"><div><SectionHeader title="Eventinformationen" /><h2 className="mt-3 text-2xl font-extrabold">{selected.discipline}</h2><div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--ops-text-muted)]"><CalendarDays size={16} />{formatDate(selected.startDate)} – {formatDate(selected.endDate)}<StatusChip tone={eventStatus(selected).tone}>{eventStatus(selected).label}</StatusChip><StatusChip tone="neutral">Disziplin · {selected.discipline}</StatusChip></div></div><OpsButton disabled={!permissions.canEdit} title={!permissions.canEdit ? READ_ONLY_TOOLTIP : undefined} onClick={() => setDialog({ open: true, event: selected })}><Pencil className="mr-2 inline h-4 w-4" />Event bearbeiten</OpsButton></div></div>
        <div className="space-y-6 p-5"><div><SectionHeader title="Bedarfsplanung" subtitle="Planungsgrundlage für den benötigten Unterkunftsbestand" /><div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">{(() => { const stats = demandStats(selected); return <><PlanningMetric label="Personenbedarf" value={stats.people} helper="Planungswert" icon={<Users size={15} />} /><PlanningMetric label="Belegungsstrategie" value="50 % EZ" helper="Feste Strategie" icon={<BedSingle size={15} />} /><PlanningMetric label="EZ Anteil" value="50 %" helper="Einzelbelegung" /><PlanningMetric label="DZ Anteil" value="50 %" helper="Doppelbelegung" /><PlanningMetric label="Gesamt Zimmer" value={stats.rooms} helper="Berechneter Bedarf" icon={<BedDouble size={15} />} /><PlanningMetric label="Gesamt Betten" value={stats.beds} helper="Berechnete Kapazität" icon={<Users size={15} />} /></>; })()}</div></div>
          <div><SectionHeader title="Zimmerbedarf" subtitle="Berechnete Werte je Zimmertyp – keine Stammdaten" /><div className="mt-3 grid gap-3 lg:grid-cols-2">{(selected.roomDemands || []).map(demand => <ContentCard key={demand.id} interactive className="p-4"><div className="flex items-start justify-between"><div><div className="text-lg font-extrabold">{demand.roomType.name}</div><div className="mt-1 text-xs text-[var(--ops-text-muted)]">bis {demand.roomType.maxPersons} {demand.roomType.maxPersons === 1 ? 'Person' : 'Personen'} pro Zimmer</div></div><StatusChip tone="primary">Berechnet</StatusChip></div><div className="mt-5 text-3xl font-extrabold">{demand.roomCount} <span className="text-base font-semibold text-[var(--ops-text-muted)]">Zimmer</span></div><div className="mt-2 text-xs text-[var(--ops-text-muted)]">{demand.roomCount * demand.roomType.maxPersons} Betten</div></ContentCard>)}{!(selected.roomDemands || []).length && <EmptyState title="Noch kein Zimmerbedarf berechnet" />}</div></div>
          <div><SectionHeader title="Timeline" subtitle="Gesamter WM-Zeitraum · 04.03. bis 22.03.2027 · ausschließlich Eventzeiträume" /><div className="mt-3"><OperationsTimeline startDate={WM_START} endDate={WM_END} rows={timelineRows} selectedRowId={selectedId || undefined} onRowClick={row => setSelectedId(row.id)} emptyMessage="Keine Eventzeiträume vorhanden." legend={[{ label: 'Ausgewähltes Event', color: 'var(--ops-primary-emphasis)' }, { label: 'Weitere Eventzeiträume', color: 'var(--ops-info)' }]} /></div></div>
        </div></div> : <div className="p-12"><EmptyState title="Kein Event ausgewählt" description="Wählen Sie links ein Event aus." /></div>}</div></ContentCard>
    </div>
    <EventDialog open={dialog.open} event={dialog.event} onClose={() => setDialog({ open: false, event: null })} onSave={async value => { dialog.event ? await api.updateEvent(dialog.event.id, value) : await api.createEvent(value); await load(); }} />
  </PageLayout>;
}
