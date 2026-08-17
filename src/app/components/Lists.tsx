import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Boxes, Building2, Download, FileSpreadsheet, NotebookPen, Search, Users } from 'lucide-react';
import { api } from '../services/api';
import type { Athlete, Hotel, RoomBooking } from '../types';
import { ContentCard, EmptyState, ErrorState, LoadingState, OpsButton, PageHeader, SplitPageLayout, StatusChip, Toolbar } from '../design-system';
import { createListRows, filterListRows, groupListRows, type ListFilters, type ListKind, type ListRow } from '../lists/listEngine';
import { exportExcel } from '../lists/listExports';
import { assignmentWorkspaceHref } from '../services/auditActivity';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const initialFilters: ListFilters = { search: '', selection: '', discipline: '', assignedOnly: true };
const formatDate = (date: string) => date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }) : '—';
const roomCode = (value: string) => value.toUpperCase().match(/(?:^|\s|\/)(EZ|DZ|APP)(?=\s|\/|:|$)/)?.[1] || value;
const columns = ['Zimmer', 'Art', 'Name', 'Nation', 'Disziplin / Event', 'Funktion', 'Anreise', 'Abreise', 'First Meal', 'Last Meal', 'Special Meal', 'Late Checkout', 'Mehrpreis', 'Zimmerpartner', 'Bemerkung'];

type Group = ReturnType<typeof groupListRows>[number];
function GroupSummary({ group, kind }: { group: Group; kind: ListKind }) {
  const rows = group.rows;
  if (kind === 'nations') {
    const disciplines = [...new Set(rows.map(row => row.discipline).filter(value => value !== '—'))];
    const roles = [...new Set(rows.map(row => row.role).filter(value => value !== '—'))];
    return <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--ops-text-muted)]"><span>{disciplines.slice(0, 3).join(' · ')}</span>{roles.length > 0 && <span>{roles.slice(0, 2).join(' · ')}</span>}</div>;
  }
  const roomRows = new Map<string, ListRow>();
  rows.forEach(row => row.assigned && roomRows.set(`${row.hotel}/${row.room}`, row));
  const counts = { EZ: 0, DZ: 0, APP: 0 };
  roomRows.forEach(row => { const code = roomCode(row.roomType); if (code in counts) counts[code as keyof typeof counts] += 1; });
  const dates = rows.flatMap(row => [row.arrival, row.departure]).filter(Boolean).sort();
  return <div className="flex flex-wrap items-center gap-x-2.5 text-[10px] text-[var(--ops-text-muted)]"><span>{roomRows.size} Zimmer</span>{Object.entries(counts).map(([code, count]) => count > 0 && <span key={code}>{count} {code}</span>)}{dates.length > 0 && <span>{formatDate(dates[0])}–{formatDate(dates.at(-1)!)}</span>}</div>;
}

function DataRows({ rows, kind, navigate }: { rows: ListRow[]; kind: ListKind; navigate: ReturnType<typeof useNavigate> }) {
  let room = '';
  let roomBand = -1;
  return <>{rows.map(row => {
    const startsRoom = row.room !== room;
    if (startsRoom) { room = row.room; roomBand += 1; }
    const background = roomBand % 2 === 0 ? 'bg-[var(--ops-surface)]' : 'bg-[var(--ops-surface-elevated)]/45';
    return <tr key={row.id} className={`${background} ${startsRoom && roomBand > 0 ? 'border-t border-[var(--ops-border)]' : ''} text-[11px] leading-4 hover:bg-[var(--ops-surface-raised)]`}>
      <td className="px-2 py-1"><button className="font-medium text-[var(--ops-text-muted)] hover:text-[var(--ops-primary)] hover:underline" onClick={() => navigate(assignmentWorkspaceHref({ bookingId: row.bookingId, hotelId: row.hotelId, personId: row.id }))}>{row.room}</button></td>
      <td className="px-2 py-1 text-[10px] font-semibold text-[var(--ops-text-subtle)]">{roomCode(row.roomType)}</td>
      <td className="whitespace-nowrap px-2 py-1"><button className="text-xs font-bold text-[var(--ops-text)] hover:text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/athletes?athleteId=${row.id}`)}>{row.name}</button></td>
      <td className="px-2 py-1 font-bold text-[var(--ops-text)]">{row.nation}</td>
      <td className="px-2 py-1">{row.discipline}</td>
      <td className="px-2 py-1 font-semibold text-[var(--ops-text)]">{row.role}</td>
      <td className="px-2 py-1 tabular-nums text-[var(--ops-text-muted)]">{formatDate(row.arrival)}</td>
      <td className="px-2 py-1 tabular-nums text-[var(--ops-text-muted)]">{formatDate(row.departure)}</td>
      {[row.firstMeal, row.lastMeal, row.specialMeal, row.lateCheckout, row.surcharge, row.roommate].map((value, index) => <td key={index} className="px-2 py-1 text-[var(--ops-text-muted)]">{value}</td>)}
      <td className="px-2 py-0.5 text-center">{row.remark !== '—' && <Tooltip><TooltipTrigger asChild><button type="button" aria-label={`Bemerkung zu ${row.name}`} className="inline-flex rounded p-0.5 text-[var(--ops-text-muted)] hover:text-[var(--ops-primary)]"><NotebookPen size={12}/></button></TooltipTrigger><TooltipContent side="top" sideOffset={5} className="max-w-80 whitespace-pre-wrap break-words bg-[var(--ops-text)] text-left text-xs leading-relaxed text-[var(--ops-surface)]">{row.remark}</TooltipContent></Tooltip>}</td>
      {kind === 'nations' && <td className="px-2 py-1"><button className="font-semibold text-[var(--ops-text)] hover:text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/hotels?hotelId=${row.hotelId}`)}>{row.hotel}</button></td>}
    </tr>;
  })}</>;
}

export function Lists() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<ListKind>('hotels');
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<{ athletes: Athlete[]; bookings: RoomBooking[]; hotels: Hotel[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { Promise.all([api.getAthletes(), api.getRoomAssignments(), api.getHotels()]).then(([athletes, bookings, hotels]) => setData({ athletes, bookings, hotels })).catch(() => setError(true)); }, []);

  const allRows = useMemo(() => data ? createListRows(data.athletes, data.bookings, data.hotels) : [], [data]);
  const rows = useMemo(() => filterListRows(allRows, kind, filters), [allRows, kind, filters]);
  const groups = useMemo(() => groupListRows(rows, kind), [rows, kind]);
  const displayedRows = useMemo(() => groups.flatMap(group => group.rows), [groups]);
  const selections = useMemo(() => [...new Set(allRows.map(row => kind === 'hotels' ? row.hotel : kind === 'nations' ? row.nation : row.contingent).filter(value => value !== '—'))].sort((a, b) => a.localeCompare(b, 'de')), [allRows, kind]);
  const disciplines = useMemo(() => [...new Set(allRows.map(row => row.discipline).filter(value => value !== '—'))].sort((a, b) => a.localeCompare(b, 'de')), [allRows]);
  const rooms = new Set(rows.filter(row => row.assigned).map(row => `${row.hotel}/${row.room}`)).size;
  const update = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) => setFilters(current => ({ ...current, [key]: value }));
  const switchKind = (next: ListKind) => { setKind(next); setFilters(current => ({ ...current, selection: '' })); };

  return <SplitPageLayout density="compact">
    <PageHeader className="px-4 py-2 [&_h1]:text-lg [&_p]:text-[11px]" eyebrow="Informationszentrum" title="Listen" subtitle="Live-Daten filtern und in die operative Ansicht wechseln." meta={<StatusChip tone="neutral">Nur-Lese-Ansicht</StatusChip>} />
    {error && <ErrorState title="Listen konnten nicht geladen werden" description="Bitte laden Sie die Seite erneut." />}
    {!data && !error ? <LoadingState label="Live-Listen werden geladen…" /> : data && <>
      <div className="flex items-center gap-5 border-y border-[var(--ops-divider)] px-1 py-1.5 text-[11px] text-[var(--ops-text-muted)]" aria-label="Listenstatistik">
        <span><b className="font-bold text-[var(--ops-text)]">{rows.length}</b> Personen</span>
        <span><b className="font-bold text-[var(--ops-text)]">{rooms}</b> belegte Zimmer</span>
        <span><b className="font-bold text-[var(--ops-text)]">{groups.length}</b> {kind === 'hotels' ? 'Hotels' : kind === 'nations' ? 'Nationen' : 'Kontingente'}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <ContentCard className="h-fit overflow-hidden"><div className="border-b border-[var(--ops-divider)] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--ops-text-subtle)]">Gruppierung</div><nav className="space-y-0.5 p-1.5" aria-label="Listen">{([{ id: 'hotels', label: 'Hotels', icon: Building2 }, { id: 'nations', label: 'Nationen', icon: Users }, { id: 'contingents', label: 'Kontingente', icon: Boxes }] as const).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => switchKind(id)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${kind === id ? 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]' : 'text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]'}`}><span className="flex items-center gap-2"><Icon size={15}/>{label}</span></button>)}</nav></ContentCard>
        <div className="min-w-0 space-y-3">
          <ContentCard className="p-2.5"><Toolbar className="border-0 bg-transparent p-0 shadow-none"><label className="flex min-w-[15rem] flex-1 items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 py-1.5"><Search size={15}/><input aria-label="Liste durchsuchen" className="w-full bg-transparent text-xs outline-none" placeholder="Name, Zimmer, Disziplin suchen" value={filters.search} onChange={event => update('search', event.target.value)}/></label><select aria-label={kind === 'hotels' ? 'Hotel filtern' : kind === 'nations' ? 'Nation filtern' : 'Kontingent filtern'} className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 py-1.5 text-xs" value={filters.selection} onChange={event => update('selection', event.target.value)}><option value="">Alle {kind === 'hotels' ? 'Hotels' : kind === 'nations' ? 'Nationen' : 'Kontingente'}</option>{selections.map(selection => <option key={selection}>{selection}</option>)}</select><select aria-label="Disziplin filtern" className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 py-1.5 text-xs" value={filters.discipline} onChange={event => update('discipline', event.target.value)}><option value="">Alle Disziplinen</option>{disciplines.map(value => <option key={value}>{value}</option>)}</select><label className="flex items-center gap-1.5 px-1 text-[11px] font-semibold"><input type="checkbox" checked={filters.assignedOnly} onChange={event => update('assignedOnly', event.target.checked)}/>Nur disponierte</label></Toolbar></ContentCard>
          <ContentCard className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ops-divider)] px-3 py-1.5"><div><h2 className="text-xs font-extrabold">{kind === 'hotels' ? 'Hotel-Liste' : kind === 'nations' ? 'Nationen-Liste' : 'Kontingent-Liste'}</h2><p className="text-[10px] text-[var(--ops-text-muted)]">{rows.length} Personen · aktuell gefilterte Live-Ansicht</p></div><OpsButton className="px-2.5 py-1 text-[10px]" onClick={() => exportExcel(displayedRows, kind)} disabled={!rows.length}><FileSpreadsheet className="mr-1.5 inline" size={13}/>Excel</OpsButton></div>
            {!groups.length ? <div className="p-5"><EmptyState title="Keine Einträge" description="Passen Sie die Filter an."/></div> : <div className="max-h-[68vh] overflow-auto">
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
                          {kind === 'hotels' && hotelId ? <button className="text-xs font-extrabold text-[var(--ops-text)] hover:text-[var(--ops-primary)] hover:underline" onClick={() => navigate(`/hotels?hotelId=${hotelId}`)}>{group.label} <span className="ml-1 font-medium text-[var(--ops-text-muted)]">{group.count} Personen</span></button> : <b className="text-xs">{group.label} <span className="ml-1 font-medium text-[var(--ops-text-muted)]">{group.count} Personen</span></b>}
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
  </SplitPageLayout>;
}
