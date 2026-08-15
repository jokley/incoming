import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, Download, FileSpreadsheet, List, NotebookPen, Search, Users } from 'lucide-react';
import { api } from '../services/api';
import type { Athlete, RoomBooking } from '../types';
import { ContentCard, EmptyState, ErrorState, LoadingState, OpsButton, PageHeader, PageLayout, StatusChip, Toolbar } from '../design-system';
import { createListRows, filterListRows, groupListRows, type ListFilters, type ListKind, type ListRow } from '../lists/listEngine';
import { exportExcel } from '../lists/listExports';
import { assignmentWorkspaceHref } from '../services/auditActivity';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const initialFilters: ListFilters = { search: '', selection: '', discipline: '', assignedOnly: true };
const formatDate = (date: string) => date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }) : '—';
const roomCode = (value: string) => value.toUpperCase().match(/(?:^|\s|\/)(EZ|DZ|APP)(?=\s|\/|:|$)/)?.[1] || value;
const roomTone = (value: string) => ({ EZ: 'border-emerald-300 bg-emerald-50 text-emerald-700', DZ: 'border-blue-300 bg-blue-50 text-blue-700', APP: 'border-violet-300 bg-violet-50 text-violet-700' }[roomCode(value)] || 'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] text-[var(--ops-text-muted)]');
const columns = ['Zimmer', 'Art', 'Name', 'Nation', 'Disziplin / Event', 'Funktion', 'Anreise', 'Abreise', 'First Meal', 'Last Meal', 'Special Meal', 'Late Checkout', 'Mehrpreis', 'Zimmerpartner', 'Bemerkung'];

type Group = ReturnType<typeof groupListRows>[number];
function GroupSummary({ group, kind }: { group: Group; kind: ListKind }) {
  const rows = group.rows;
  if (kind === 'nations') {
    const disciplines = [...new Set(rows.map(row => row.discipline).filter(value => value !== '—'))];
    const roles = [...new Set(rows.map(row => row.role).filter(value => value !== '—'))];
    return <div className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--ops-text-muted)]"><span>{rows.length} Personen</span>{disciplines.slice(0, 3).map(value => <StatusChip key={value}>{value}</StatusChip>)}{roles.slice(0, 2).map(value => <StatusChip key={value}>{value}</StatusChip>)}</div>;
  }
  const roomRows = new Map<string, ListRow>();
  rows.forEach(row => row.assigned && roomRows.set(`${row.hotel}/${row.room}`, row));
  const counts = { EZ: 0, DZ: 0, APP: 0 };
  roomRows.forEach(row => { const code = roomCode(row.roomType); if (code in counts) counts[code as keyof typeof counts] += 1; });
  const dates = rows.flatMap(row => [row.arrival, row.departure]).filter(Boolean).sort();
  return <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--ops-text-muted)]"><span>{rows.length} Personen</span><span>{roomRows.size} Zimmer</span>{Object.entries(counts).map(([code, count]) => <span key={code}>{count} {code}</span>)}{dates.length > 0 && <span>{formatDate(dates[0])}–{formatDate(dates.at(-1)!)}</span>}</div>;
}

function DataRows({ rows, kind, navigate }: { rows: ListRow[]; kind: ListKind; navigate: ReturnType<typeof useNavigate> }) {
  let room = '';
  let roomBand = -1;
  return <>{rows.map(row => {
    if (row.room !== room) { room = row.room; roomBand += 1; }
    const background = roomBand % 2 === 0 ? 'bg-[var(--ops-surface)]' : 'bg-[var(--ops-surface-elevated)]/45';
    return <tr key={row.id} className={`${background} border-b border-[var(--ops-divider)] text-[10px] leading-3.5 hover:bg-[var(--ops-tone-primary-surface)]`}>
      <td className="px-2 py-0.5"><button className="font-semibold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(assignmentWorkspaceHref({ bookingId: row.bookingId, hotelId: row.hotelId, personId: row.id }))}>{row.room}</button></td>
      <td className="px-2 py-0.5"><span className={`inline-flex rounded-full border px-1 text-[10px] font-semibold leading-3.5 ${roomTone(row.roomType)}`}>{roomCode(row.roomType)}</span></td>
      <td className="whitespace-nowrap px-2 py-0.5"><button className="font-semibold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/athletes?athleteId=${row.id}`)}>{row.name}</button></td>
      {[row.nation, row.discipline, row.role].map((value, index) => <td key={index} className="px-2 py-0.5">{value}</td>)}
      <td className="px-2 py-0.5 tabular-nums">{formatDate(row.arrival)}</td>
      <td className="px-2 py-0.5 tabular-nums">{formatDate(row.departure)}</td>
      {[row.firstMeal, row.lastMeal, row.specialMeal, row.lateCheckout, row.surcharge, row.roommate].map((value, index) => <td key={index} className="px-2 py-0.5">{value}</td>)}
      <td className="px-2 py-0.5 text-center">{row.remark !== '—' && <Tooltip><TooltipTrigger asChild><button type="button" aria-label={`Bemerkung zu ${row.name}`} className="inline-flex rounded p-0.5 text-[var(--ops-text-muted)] hover:text-[var(--ops-primary)]"><NotebookPen size={12}/></button></TooltipTrigger><TooltipContent side="top" sideOffset={5} className="max-w-80 whitespace-pre-wrap break-words bg-[var(--ops-text)] text-left text-xs leading-relaxed text-[var(--ops-surface)]">{row.remark}</TooltipContent></Tooltip>}</td>
      {kind === 'nations' && <td className="px-2 py-0.5"><button className="font-semibold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/hotels?hotelId=${row.hotelId}`)}>{row.hotel}</button></td>}
    </tr>;
  })}</>;
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
  const displayedRows = useMemo(() => groups.flatMap(group => group.rows), [groups]);
  const selections = useMemo(() => [...new Set(allRows.map(row => kind === 'hotels' ? row.hotel : row.nation).filter(value => value !== '—'))].sort((a, b) => a.localeCompare(b, 'de')), [allRows, kind]);
  const disciplines = useMemo(() => [...new Set(allRows.map(row => row.discipline).filter(value => value !== '—'))].sort((a, b) => a.localeCompare(b, 'de')), [allRows]);
  const rooms = new Set(rows.filter(row => row.assigned).map(row => `${row.hotel}/${row.room}`)).size;
  const update = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) => setFilters(current => ({ ...current, [key]: value }));
  const switchKind = (next: ListKind) => { setKind(next); setFilters(current => ({ ...current, selection: '' })); };

  return <PageLayout density="compact">
    <PageHeader className="px-4 py-3 [&_h1]:text-xl [&_p]:text-xs" eyebrow="Informationszentrum" title="Listen" subtitle="Aktuelle Live-Daten zentral ansehen, filtern und direkt in die operative Ansicht wechseln." meta={<><StatusChip tone="success">Live-Daten</StatusChip><StatusChip tone="neutral">Nur-Lese-Ansicht</StatusChip></>} />
    {error && <ErrorState title="Listen konnten nicht geladen werden" description="Bitte laden Sie die Seite erneut." />}
    {!data && !error ? <LoadingState label="Live-Listen werden geladen…" /> : data && <>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <ContentCard className="p-3"><div className="flex items-center gap-2.5"><span className="rounded-lg bg-[var(--ops-tone-primary-surface)] p-1.5 text-[var(--ops-primary)]"><Users size={18}/></span><div><div className="text-xl font-extrabold leading-none">{rows.length}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Personen</div></div></div></ContentCard>
        <ContentCard className="p-3"><div className="flex items-center gap-2.5"><span className="rounded-lg bg-[var(--ops-tone-info-surface)] p-1.5 text-[var(--ops-tone-info-text)]"><Building2 size={18}/></span><div><div className="text-xl font-extrabold leading-none">{rooms}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Belegte Zimmer</div></div></div></ContentCard>
        <ContentCard className="p-3"><div className="flex items-center gap-2.5"><span className="rounded-lg bg-[var(--ops-tone-success-surface)] p-1.5 text-[var(--ops-tone-success-text)]"><List size={18}/></span><div><div className="text-xl font-extrabold leading-none">{groups.length}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">{kind === 'hotels' ? 'Hotels' : 'Nationen'}</div></div></div></ContentCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <ContentCard className="h-fit overflow-hidden"><div className="border-b border-[var(--ops-divider)] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--ops-text-subtle)]">Gruppierung</div><nav className="space-y-0.5 p-1.5" aria-label="Listen">{([{ id: 'hotels', label: 'Hotels', icon: Building2 }, { id: 'nations', label: 'Nationen', icon: Users }] as const).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => switchKind(id)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${kind === id ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}><span className="flex items-center gap-2"><Icon size={15}/>{label}</span></button>)}</nav></ContentCard>
        <div className="min-w-0 space-y-3">
          <ContentCard className="p-2.5"><Toolbar className="border-0 bg-transparent p-0 shadow-none"><label className="flex min-w-[15rem] flex-1 items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 py-1.5"><Search size={15}/><input aria-label="Liste durchsuchen" className="w-full bg-transparent text-xs outline-none" placeholder="Name, Zimmer, Disziplin suchen" value={filters.search} onChange={event => update('search', event.target.value)}/></label><select aria-label={kind === 'hotels' ? 'Hotel filtern' : 'Nation filtern'} className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 py-1.5 text-xs" value={filters.selection} onChange={event => update('selection', event.target.value)}><option value="">Alle {kind === 'hotels' ? 'Hotels' : 'Nationen'}</option>{selections.map(selection => <option key={selection}>{selection}</option>)}</select><select aria-label="Disziplin filtern" className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 py-1.5 text-xs" value={filters.discipline} onChange={event => update('discipline', event.target.value)}><option value="">Alle Disziplinen</option>{disciplines.map(value => <option key={value}>{value}</option>)}</select><label className="flex items-center gap-1.5 px-1 text-[11px] font-semibold"><input type="checkbox" checked={filters.assignedOnly} onChange={event => update('assignedOnly', event.target.checked)}/>Nur disponierte</label></Toolbar></ContentCard>
          <ContentCard className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ops-divider)] px-3 py-1.5"><div><h2 className="text-xs font-extrabold">{kind === 'hotels' ? 'Hotel-Liste' : 'Nationen-Liste'}</h2><p className="text-[10px] text-[var(--ops-text-muted)]">{rows.length} Personen · aktuell gefilterte Live-Ansicht</p></div><OpsButton className="px-2.5 py-1 text-[10px]" onClick={() => exportExcel(displayedRows, kind)} disabled={!rows.length}><FileSpreadsheet className="mr-1.5 inline" size={13}/>Excel</OpsButton></div>
            {!groups.length ? <div className="p-5"><EmptyState title="Keine Einträge" description="Passen Sie die Filter an."/></div> : <div className="max-h-[62vh] overflow-auto">
              <table className="w-full min-w-[1320px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-30 bg-[var(--ops-surface)] shadow-sm">
                  <tr className="border-y border-[var(--ops-divider)] text-[10px] uppercase tracking-wider text-[var(--ops-text-subtle)]">
                    {[...columns, ...(kind === 'nations' ? ['Hotel'] : [])].map(label => <th key={label} className="whitespace-nowrap px-2 py-1 text-[10px] font-extrabold">{label}</th>)}
                  </tr>
                </thead>
                {groups.map(group => {
                  const hotelId = group.rows[0]?.hotelId;
                  return <tbody key={group.label}>
                    <tr className="border-y border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)]">
                      <td colSpan={columns.length + (kind === 'nations' ? 1 : 0)} className="px-2.5 py-1">
                        <div className="flex items-center justify-between gap-4">
                          {kind === 'hotels' && hotelId ? <button className="text-xs font-extrabold text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/hotels?hotelId=${hotelId}`)}>{group.label} ({group.count} Personen)</button> : <b className="text-xs">{group.label} ({group.count} Personen)</b>}
                          <GroupSummary group={group} kind={kind}/>
                        </div>
                      </td>
                    </tr>
                    <DataRows rows={group.rows} kind={kind} navigate={navigate}/>
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
