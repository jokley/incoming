import { useEffect, useMemo, useState } from 'react';
import { Building2, Download, FileSpreadsheet, FileText, List, Search, Users } from 'lucide-react';
import { api } from '../services/api';
import type { Athlete, RoomBooking } from '../types';
import { ContentCard, EmptyState, ErrorState, LoadingState, OpsButton, PageHeader, PageLayout, StatusChip, Toolbar } from '../design-system';
import { createListRows, filterListRows, groupListRows, type ListFilters, type ListKind } from '../lists/listEngine';
import { exportExcel, exportPdf } from '../lists/listExports';

const initialFilters: ListFilters = { search: '', selection: '', assignedOnly: true, activeOnly: true, from: '', until: '' };
const formatDate = (date: string) => date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }) : '—';

export function Lists() {
  const [kind, setKind] = useState<ListKind>('hotels');
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<{ athletes: Athlete[]; bookings: RoomBooking[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { Promise.all([api.getAthletes(), api.getRoomAssignments()]).then(([athletes, bookings]) => setData({ athletes, bookings })).catch(() => setError(true)); }, []);

  const allRows = useMemo(() => data ? createListRows(data.athletes, data.bookings) : [], [data]);
  const rows = useMemo(() => filterListRows(allRows, kind, filters), [allRows, kind, filters]);
  const groups = useMemo(() => groupListRows(rows, kind), [rows, kind]);
  const selections = useMemo(() => [...new Set(allRows.map((row) => kind === 'hotels' ? row.hotel : row.nation).filter((value) => value !== '—'))].sort((a, b) => a.localeCompare(b, 'de')), [allRows, kind]);
  const rooms = new Set(rows.filter((row) => row.assigned).map((row) => `${row.hotel}/${row.room}`)).size;
  const update = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const switchKind = (next: ListKind) => { setKind(next); setFilters((current) => ({ ...current, selection: '' })); };

  return <PageLayout>
    <PageHeader eyebrow="Informationszentrum" title="Listen" subtitle="Aktuelle Daten zentral ansehen, filtern und in derselben Ansicht weitergeben." meta={<><StatusChip tone="success">Live-Daten</StatusChip><StatusChip tone="neutral">Nur-Lese-Ansicht</StatusChip></>} />
    {error && <ErrorState title="Listen konnten nicht geladen werden" description="Bitte laden Sie die Seite erneut." />}
    {!data && !error ? <LoadingState label="Live-Listen werden geladen…" /> : data && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <ContentCard className="p-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--ops-tone-primary-surface)] p-2 text-[var(--ops-primary)]"><Users size={20}/></span><div><div className="text-2xl font-extrabold">{rows.length}</div><div className="text-xs font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Personen</div></div></div></ContentCard>
        <ContentCard className="p-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--ops-tone-info-surface)] p-2 text-[var(--ops-tone-info-text)]"><Building2 size={20}/></span><div><div className="text-2xl font-extrabold">{rooms}</div><div className="text-xs font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Belegte Zimmer</div></div></div></ContentCard>
        <ContentCard className="p-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--ops-tone-success-surface)] p-2 text-[var(--ops-tone-success-text)]"><List size={20}/></span><div><div className="text-2xl font-extrabold">{groups.length}</div><div className="text-xs font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">{kind === 'hotels' ? 'Hotels' : 'Nationen'}</div></div></div></ContentCard>
      </div>
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <ContentCard className="h-fit overflow-hidden">
          <div className="border-b border-[var(--ops-divider)] px-4 py-3 text-xs font-extrabold uppercase tracking-[.14em] text-[var(--ops-text-subtle)]">Listenauswahl</div>
          <nav className="space-y-1 p-2" aria-label="Listen">
            {([{ id: 'hotels', label: 'Hotels', icon: Building2 }, { id: 'nations', label: 'Nationen', icon: Users }] as const).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => switchKind(id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-bold transition ${kind === id ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}><span className="flex items-center gap-2"><Icon size={17}/>{label}</span><span className="text-xs">{id === 'hotels' ? new Set(allRows.filter(r => r.assigned).map(r => r.hotel)).size : new Set(allRows.map(r => r.nation)).size}</span></button>)}
          </nav>
          <div className="border-t border-[var(--ops-divider)] p-4 text-xs leading-relaxed text-[var(--ops-text-muted)]">Weitere Gruppierungen werden auf Basis derselben Listen-Engine ergänzt.</div>
        </ContentCard>
        <div className="min-w-0 space-y-4">
          <ContentCard className="p-3">
            <Toolbar className="border-0 bg-transparent p-0 shadow-none">
              <label className="flex min-w-[15rem] flex-1 items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2"><Search size={16}/><input aria-label="Liste durchsuchen" className="w-full bg-transparent text-sm outline-none" placeholder="Name, Zimmer, Disziplin suchen" value={filters.search} onChange={(event) => update('search', event.target.value)}/></label>
              <select aria-label={kind === 'hotels' ? 'Hotel filtern' : 'Nation filtern'} className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 text-sm" value={filters.selection} onChange={(event) => update('selection', event.target.value)}><option value="">Alle {kind === 'hotels' ? 'Hotels' : 'Nationen'}</option>{selections.map((selection) => <option key={selection}>{selection}</option>)}</select>
              <label className="flex items-center gap-1.5 text-xs text-[var(--ops-text-muted)]">Von <input type="date" className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2 py-1.5" value={filters.from} onChange={(event) => update('from', event.target.value)}/></label>
              <label className="flex items-center gap-1.5 text-xs text-[var(--ops-text-muted)]">Bis <input type="date" className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2 py-1.5" value={filters.until} onChange={(event) => update('until', event.target.value)}/></label>
              <label className="flex items-center gap-2 px-1 text-xs font-semibold"><input type="checkbox" checked={filters.assignedOnly} onChange={(event) => update('assignedOnly', event.target.checked)}/>Nur disponierte</label>
              <label className="flex items-center gap-2 px-1 text-xs font-semibold"><input type="checkbox" checked={filters.activeOnly} onChange={(event) => update('activeOnly', event.target.checked)}/>Nur aktive</label>
            </Toolbar>
          </ContentCard>
          <ContentCard className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ops-divider)] px-4 py-3"><div><h2 className="font-extrabold">{kind === 'hotels' ? 'Hotel-Liste' : 'Nationen-Liste'}</h2><p className="text-xs text-[var(--ops-text-muted)]">{rows.length} Personen · aktuell gefilterte Live-Ansicht</p></div><div className="flex gap-2"><OpsButton onClick={() => exportPdf(rows, kind)} disabled={!rows.length}><FileText className="mr-1.5 inline" size={16}/>PDF</OpsButton><OpsButton onClick={() => exportExcel(rows, kind)} disabled={!rows.length}><FileSpreadsheet className="mr-1.5 inline" size={16}/>Excel</OpsButton></div></div>
            {!groups.length ? <div className="p-5"><EmptyState title="Keine Einträge" description="Passen Sie die Filter an."/></div> : <div className="max-h-[62vh] overflow-auto">
              {groups.map((group) => <section key={group.label}><div className="sticky top-0 z-20 flex items-center gap-2 border-y border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)] px-4 py-2.5"><Building2 size={16}/><b>{group.label}</b><StatusChip>{group.count} Personen</StatusChip></div>{group.children.map((child) => <div key={child.label}><div className="sticky top-[42px] z-10 bg-[var(--ops-surface-raised)] px-4 py-2 text-xs font-bold text-[var(--ops-text-muted)]">{kind === 'hotels' ? 'Zimmer' : 'Disziplin'} · {child.label}</div><div className="overflow-x-auto"><table className="w-full min-w-[1320px] border-collapse text-left text-xs"><thead><tr className="border-y border-[var(--ops-divider)] text-[10px] uppercase tracking-wider text-[var(--ops-text-subtle)]">{['Zimmer','Art','Name','Nation','Disziplin / Event','Funktion','Anreise','Abreise','First Meal','Last Meal','Special Meal','Late Checkout','Mehrpreis','Zimmerpartner', ...(kind === 'nations' ? ['Hotel'] : [])].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2 font-extrabold">{label}</th>)}</tr></thead><tbody>{child.rows.map((row) => <tr key={row.id} className="border-b border-[var(--ops-divider)] hover:bg-[var(--ops-surface-elevated)]"><td className="px-3 py-2 font-bold">{row.room}</td><td className="px-3 py-2">{row.roomType}</td><td className="whitespace-nowrap px-3 py-2 font-bold">{row.name}</td><td className="px-3 py-2">{row.nation}</td><td className="px-3 py-2">{row.discipline}</td><td className="px-3 py-2">{row.role}</td><td className="px-3 py-2 tabular-nums">{formatDate(row.arrival)}</td><td className="px-3 py-2 tabular-nums">{formatDate(row.departure)}</td><td className="px-3 py-2">{row.firstMeal}</td><td className="px-3 py-2">{row.lastMeal}</td><td className="px-3 py-2">{row.specialMeal}</td><td className="px-3 py-2">{row.lateCheckout}</td><td className="px-3 py-2">{row.surcharge}</td><td className="px-3 py-2">{row.roommate}</td>{kind === 'nations' && <td className="px-3 py-2">{row.hotel}</td>}</tr>)}</tbody></table></div></div>)}</section>)}
            </div>}
          </ContentCard>
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--ops-text-muted)]"><Download size={14}/>PDF und Excel basieren immer auf den sichtbaren Filtern.</div>
        </div>
      </div>
    </>}
  </PageLayout>;
}
