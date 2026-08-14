import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, Download, FileSpreadsheet, List, Search, Users } from 'lucide-react';
import { api } from '../services/api';
import type { Athlete, RoomBooking } from '../types';
import { ContentCard, EmptyState, ErrorState, LoadingState, OpsButton, PageHeader, PageLayout, StatusChip, Toolbar } from '../design-system';
import { createListRows, filterListRows, groupListRows, type ListFilters, type ListKind, type ListRow } from '../lists/listEngine';
import { exportExcel } from '../lists/listExports';
import { assignmentWorkspaceHref } from '../services/auditActivity';

const initialFilters: ListFilters = { search: '', selection: '', discipline: '', assignedOnly: true, activeOnly: true };
const formatDate = (date: string) => date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }) : '—';
const roomCode = (value: string) => value.toUpperCase().match(/(?:^|\s|\/)(EZ|DZ|APP)(?=\s|\/|:|$)/)?.[1] || value;
const roomTone = (value: string) => ({ EZ: 'border-emerald-300 bg-emerald-50 text-emerald-700', DZ: 'border-blue-300 bg-blue-50 text-blue-700', APP: 'border-violet-300 bg-violet-50 text-violet-700' }[roomCode(value)] || 'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] text-[var(--ops-text-muted)]');
const columns = ['Zimmer', 'Art', 'Name', 'Nation', 'Disziplin / Event', 'Funktion', 'Anreise', 'Abreise', 'First Meal', 'Last Meal', 'Special Meal', 'Late Checkout', 'Mehrpreis', 'Zimmerpartner'];

type Group = ReturnType<typeof groupListRows>[number];
type Child = Group['children'][number];
function GroupSummary({ group, kind }: { group: Group; kind: ListKind }) {
  const rows = group.children.flatMap(child => child.rows);
  if (kind === 'nations') {
    const disciplines = [...new Set(rows.map(row => row.discipline).filter(value => value !== '—'))];
    const roles = [...new Set(rows.map(row => row.role).filter(value => value !== '—'))];
    return <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--ops-text-muted)]"><span>{rows.length} Personen</span>{disciplines.slice(0, 3).map(value => <StatusChip key={value}>{value}</StatusChip>)}{roles.slice(0, 2).map(value => <StatusChip key={value}>{value}</StatusChip>)}</div>;
  }
  const roomRows = new Map<string, ListRow>();
  rows.forEach(row => row.assigned && roomRows.set(`${row.hotel}/${row.room}`, row));
  const counts = { EZ: 0, DZ: 0, APP: 0 };
  roomRows.forEach(row => { const code = roomCode(row.roomType); if (code in counts) counts[code as keyof typeof counts] += 1; });
  const dates = rows.flatMap(row => [row.arrival, row.departure]).filter(Boolean).sort();
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ops-text-muted)]"><span>{rows.length} Personen</span><span>{roomRows.size} Zimmer</span>{Object.entries(counts).map(([code, count]) => <span key={code}>{count} {code}</span>)}{dates.length > 0 && <span>{formatDate(dates[0])}–{formatDate(dates.at(-1)!)}</span>}</div>;
}

function FragmentRows({ child, kind, navigate }: { child: Child; kind: ListKind; navigate: ReturnType<typeof useNavigate> }) {
  const firstRow = child.rows[0];
  return <>
    <tr className="border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] text-[var(--ops-text-muted)]">
      <td colSpan={columns.length + (kind === 'nations' ? 1 : 0)} className="px-4 py-2 font-bold">
        {kind === 'hotels' && firstRow ? <button className="hover:text-[var(--ops-primary)] hover:underline" onClick={() => navigate(assignmentWorkspaceHref({ bookingId: firstRow.bookingId, hotelId: firstRow.hotelId, personId: firstRow.id }))}>Zimmer · {child.label}</button> : <>Disziplin · {child.label}</>}
      </td>
    </tr>
    {child.rows.map(row => <tr key={row.id} className="border-b border-[var(--ops-divider)] hover:bg-[var(--ops-surface-elevated)]">
      <td className="px-3 py-2"><button className="font-bold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(assignmentWorkspaceHref({ bookingId: row.bookingId, hotelId: row.hotelId, personId: row.id }))}>{row.room}</button></td>
      <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 font-extrabold ${roomTone(row.roomType)}`}>{roomCode(row.roomType)}</span></td>
      <td className="whitespace-nowrap px-3 py-2"><button className="font-bold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/athletes?athleteId=${row.id}`)}>{row.name}</button></td>
      <td className="px-3 py-2">{row.nation}</td>
      <td className="px-3 py-2">{row.discipline}</td>
      <td className="px-3 py-2">{row.role}</td>
      <td className="px-3 py-2 tabular-nums">{formatDate(row.arrival)}</td>
      <td className="px-3 py-2 tabular-nums">{formatDate(row.departure)}</td>
      <td className="px-3 py-2">{row.firstMeal}</td>
      <td className="px-3 py-2">{row.lastMeal}</td>
      <td className="px-3 py-2">{row.specialMeal}</td>
      <td className="px-3 py-2">{row.lateCheckout}</td>
      <td className="px-3 py-2">{row.surcharge}</td>
      <td className="px-3 py-2">{row.roommate}</td>
      {kind === 'nations' && <td className="px-3 py-2"><button className="font-bold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/hotels?hotelId=${row.hotelId}`)}>{row.hotel}</button></td>}
    </tr>)}
  </>;
}

export function Lists() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<ListKind>('hotels');
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<{ athletes: Athlete[]; bookings: RoomBooking[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { Promise.all([api.getAthletes(), api.getRoomAssignments()]).then(([athletes, bookings]) => setData({ athletes, bookings })).catch(() => setError(true)); }, []);

  const allRows = useMemo(() => data ? createListRows(data.athletes, data.bookings) : [], [data]);
  const rows = useMemo(() => filterListRows(allRows, kind, filters), [allRows, kind, filters]);
  const groups = useMemo(() => groupListRows(rows, kind), [rows, kind]);
  const selections = useMemo(() => [...new Set(allRows.map(row => kind === 'hotels' ? row.hotel : row.nation).filter(value => value !== '—'))].sort((a, b) => a.localeCompare(b, 'de')), [allRows, kind]);
  const disciplines = useMemo(() => [...new Set(allRows.map(row => row.discipline).filter(value => value !== '—'))].sort((a, b) => a.localeCompare(b, 'de')), [allRows]);
  const rooms = new Set(rows.filter(row => row.assigned).map(row => `${row.hotel}/${row.room}`)).size;
  const update = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) => setFilters(current => ({ ...current, [key]: value }));
  const switchKind = (next: ListKind) => { setKind(next); setFilters(current => ({ ...current, selection: '' })); };

  return <PageLayout>
    <PageHeader eyebrow="Informationszentrum" title="Listen" subtitle="Aktuelle Live-Daten zentral ansehen, filtern und direkt in die operative Ansicht wechseln." meta={<><StatusChip tone="success">Live-Daten</StatusChip><StatusChip tone="neutral">Nur-Lese-Ansicht</StatusChip></>} />
    {error && <ErrorState title="Listen konnten nicht geladen werden" description="Bitte laden Sie die Seite erneut." />}
    {!data && !error ? <LoadingState label="Live-Listen werden geladen…" /> : data && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <ContentCard className="p-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--ops-tone-primary-surface)] p-2 text-[var(--ops-primary)]"><Users size={20}/></span><div><div className="text-2xl font-extrabold">{rows.length}</div><div className="text-xs font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Personen</div></div></div></ContentCard>
        <ContentCard className="p-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--ops-tone-info-surface)] p-2 text-[var(--ops-tone-info-text)]"><Building2 size={20}/></span><div><div className="text-2xl font-extrabold">{rooms}</div><div className="text-xs font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Belegte Zimmer</div></div></div></ContentCard>
        <ContentCard className="p-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--ops-tone-success-surface)] p-2 text-[var(--ops-tone-success-text)]"><List size={20}/></span><div><div className="text-2xl font-extrabold">{groups.length}</div><div className="text-xs font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">{kind === 'hotels' ? 'Hotels' : 'Nationen'}</div></div></div></ContentCard>
      </div>
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <ContentCard className="h-fit overflow-hidden"><div className="border-b border-[var(--ops-divider)] px-4 py-3 text-xs font-extrabold uppercase tracking-[.14em] text-[var(--ops-text-subtle)]">Gruppierung</div><nav className="space-y-1 p-2" aria-label="Listen">{([{ id: 'hotels', label: 'Hotels', icon: Building2 }, { id: 'nations', label: 'Nationen', icon: Users }] as const).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => switchKind(id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-bold transition ${kind === id ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}><span className="flex items-center gap-2"><Icon size={17}/>{label}</span></button>)}</nav></ContentCard>
        <div className="min-w-0 space-y-4">
          <ContentCard className="p-3"><Toolbar className="border-0 bg-transparent p-0 shadow-none"><label className="flex min-w-[15rem] flex-1 items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2"><Search size={16}/><input aria-label="Liste durchsuchen" className="w-full bg-transparent text-sm outline-none" placeholder="Name, Zimmer, Disziplin suchen" value={filters.search} onChange={event => update('search', event.target.value)}/></label><select aria-label={kind === 'hotels' ? 'Hotel filtern' : 'Nation filtern'} className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 text-sm" value={filters.selection} onChange={event => update('selection', event.target.value)}><option value="">Alle {kind === 'hotels' ? 'Hotels' : 'Nationen'}</option>{selections.map(selection => <option key={selection}>{selection}</option>)}</select><select aria-label="Disziplin filtern" className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 text-sm" value={filters.discipline} onChange={event => update('discipline', event.target.value)}><option value="">Alle Disziplinen</option>{disciplines.map(value => <option key={value}>{value}</option>)}</select><label className="flex items-center gap-2 px-1 text-xs font-semibold"><input type="checkbox" checked={filters.assignedOnly} onChange={event => update('assignedOnly', event.target.checked)}/>Nur disponierte</label><label className="flex items-center gap-2 px-1 text-xs font-semibold"><input type="checkbox" checked={filters.activeOnly} onChange={event => update('activeOnly', event.target.checked)}/>Nur aktive</label></Toolbar></ContentCard>
          <ContentCard className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ops-divider)] px-4 py-3"><div><h2 className="font-extrabold">{kind === 'hotels' ? 'Hotel-Liste' : 'Nationen-Liste'}</h2><p className="text-xs text-[var(--ops-text-muted)]">{rows.length} Personen · aktuell gefilterte Live-Ansicht</p></div><OpsButton onClick={() => exportExcel(rows, kind)} disabled={!rows.length}><FileSpreadsheet className="mr-1.5 inline" size={16}/>Excel</OpsButton></div>
            {!groups.length ? <div className="p-5"><EmptyState title="Keine Einträge" description="Passen Sie die Filter an."/></div> : <div className="max-h-[62vh] overflow-auto">
              <table className="w-full min-w-[1320px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-30 bg-[var(--ops-surface)] shadow-sm">
                  <tr className="border-y border-[var(--ops-divider)] text-[10px] uppercase tracking-wider text-[var(--ops-text-subtle)]">
                    {[...columns, ...(kind === 'nations' ? ['Hotel'] : [])].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-extrabold">{label}</th>)}
                  </tr>
                </thead>
                {groups.map(group => {
                  const hotelId = group.children[0]?.rows[0]?.hotelId;
                  return <tbody key={group.label}>
                    <tr className="border-y border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)]">
                      <td colSpan={columns.length + (kind === 'nations' ? 1 : 0)} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-4">
                          {kind === 'hotels' && hotelId ? <button className="font-extrabold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/hotels?hotelId=${hotelId}`)}>{group.label} ({group.count} Personen)</button> : <b>{group.label} ({group.count} Personen)</b>}
                          <GroupSummary group={group} kind={kind}/>
                        </div>
                      </td>
                    </tr>
                    {group.children.map(child => <FragmentRows key={child.label} child={child} kind={kind} navigate={navigate}/>)}
                  </tbody>;
                })}
              </table>
            </div>}
          </ContentCard><div className="flex items-center gap-2 px-1 text-xs text-[var(--ops-text-muted)]"><Download size={14}/>Excel übernimmt alle sichtbaren Filter und enthält vollständige Klartextwerte.</div>
        </div>
      </div>
    </>}
  </PageLayout>;
}
