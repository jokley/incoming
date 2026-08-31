import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, Building2, ChartNoAxesCombined, Flag, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../services/api';
import type { Athlete, Event, Hotel, HotelRoomInventory, RoomBooking } from '../types';
import { ContentCard, DataPanel, EmptyState, ErrorState, MetricCard, PageHeader, SplitPageLayout, SplitPaneLayout, SectionHeader, StatusChip } from '../design-system';
import { calculateRoomPlan, eventRoomPlan } from '../services/planningCalculations';
import { calculateQuotaUsage, quotaAssignmentsFromBookings } from '../services/quotaEvaluation';

type ViewKey = 'capacity' | 'hotels' | 'nations';
type AnalyticsData = { hotels: Hotel[]; events: Event[]; athletes: Athlete[]; bookings: RoomBooking[] };
type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary';

const isSingle = (room: { name: string; maxPersons: number }) => room.maxPersons === 1 || /(^|\W)EZ(\W|$)/i.test(room.name);
const dayKey = (value?: string | null) => value?.slice(0, 10) || '';
const formatDay = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const formatFullDay = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const range = (from: string, until: string) => {
  const result: string[] = [];
  for (let date = new Date(`${from}T00:00:00Z`), end = new Date(`${until}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) result.push(date.toISOString().slice(0, 10));
  return result;
};
const inventoryBeds = (items: HotelRoomInventory[] = []) => items.reduce((sum, item) => sum + item.roomCount * item.roomType.maxPersons, 0);
const isAssigned = (athlete: Athlete) => Boolean(athlete.assignment?.hasAssignment || athlete.assignments?.some(item => item.hasAssignment));
const eventForAthlete = (athlete: Athlete, events: Event[]) => events.find(event => athlete.disciplines?.includes(event.discipline) || athlete.discipline === event.discipline);
const athleteOnDay = (athlete: Athlete, date: string) => {
  const stays = athlete.stays?.length ? athlete.stays : [{ arrivalDate: athlete.arrivalDate, departureDate: athlete.departureDate }];
  return stays.some(stay => Boolean(stay.arrivalDate && stay.departureDate && dayKey(stay.arrivalDate) <= date && dayKey(stay.departureDate) > date));
};
const bookingOnDay = (booking: RoomBooking, date: string) => {
  const from = dayKey(booking.checkInDate);
  const until = dayKey(booking.checkOutDate);
  // Legacy bookings without dates still consume a room; dated stays use hotel-night semantics.
  return (!from || from <= date) && (!until || until > date);
};

const NAV: Array<{ key: ViewKey; label: string; question: string; icon: typeof Building2 }> = [
  { key: 'capacity', label: 'Bedarf & Kontingente', question: 'Wann reicht das Kontingent nicht?', icon: ChartNoAxesCombined },
  { key: 'hotels', label: 'Hotelrisiken', question: 'Welche Hotels werden wann kritisch?', icon: Building2 },
  { key: 'nations', label: 'Nationen & Bedarf', question: 'Wer verursacht welchen Bedarf?', icon: Flag },
];

function ClickMetric({ onClick, ...props }: Parameters<typeof MetricCard>[0] & { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-w-0 text-left transition-transform hover:-translate-y-0.5 focus-visible:rounded-xl focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]"><MetricCard {...props} /></button>;
}

function Kpis({ children }: { children: ReactNode }) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>; }
function ViewShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-4"><SectionHeader title={title} subtitle={subtitle}/>{children}</div>;
}
function ChartHeading({ title, subtitle, description }: { title: string; subtitle: string; description: string }) {
  return <div><span className="block text-sm font-extrabold normal-case tracking-normal text-[var(--ops-text)]">{title}</span><span className="mt-0.5 block text-xs font-medium normal-case tracking-normal text-[var(--ops-text-muted)]">{subtitle}</span><span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-[var(--ops-text-subtle)]">{description}</span></div>;
}
function ActionCell() { return <ArrowRight size={16} className="text-[var(--ops-primary)]" />; }
function NationTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { nation: string; count: number; ez: number; dz: number; share: number; bedNights: number; averageStay: number } }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const values = [['Personen', row.count], ['Zimmer', row.ez + row.dz], ['EZ', row.ez], ['DZ', row.dz], ['Anteil', `${row.share.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`], ['Bettennächte', row.bedNights], ['Aufenthalt Ø', `${row.averageStay.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Nächte`]];
  return <div className="rounded-lg border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] p-3 text-xs shadow-xl"><b className="mb-2 block border-b border-[var(--ops-divider)] pb-2 text-sm">Nation {row.nation}</b>{values.map(([label, value]) => <div key={label} className="flex min-w-52 justify-between gap-6 py-0.5"><span className="text-[var(--ops-text-muted)]">{label}</span><strong className="font-mono">{value}</strong></div>)}</div>;
}
type CapacityDay = {
  date: string; label: string; roomSupply: number; assignedRooms: number; freeRooms: number; plannedRooms: number; demandRooms: number;
  bedSupply: number; assignedBeds: number; freeBeds: number; plannedBeds: number; demandBeds: number;
  ezSupply: number; assignedEz: number; freeEz: number; plannedEz: number; demandEz: number;
  dzSupply: number; assignedDz: number; freeDz: number; plannedDz: number; demandDz: number;
  eventRoomReserve: number; eventBedReserve: number; eventEzReserve: number; eventDzReserve: number;
  liveRoomReserve: number; liveBedReserve: number; liveEzReserve: number; liveDzReserve: number;
};

type DemandSource = 'event' | 'live';

function CapacityTooltip({ active, payload, metric, source }: { active?: boolean; payload?: Array<{ payload: CapacityDay }>; metric: 'beds' | 'rooms'; source: DemandSource }) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;
  const config = {
    rooms: ['roomSupply', 'assignedRooms', 'freeRooms', source === 'event' ? 'plannedRooms' : 'demandRooms', source === 'event' ? 'eventRoomReserve' : 'liveRoomReserve'],
    beds: ['bedSupply', 'assignedBeds', 'freeBeds', source === 'event' ? 'plannedBeds' : 'demandBeds', source === 'event' ? 'eventBedReserve' : 'liveBedReserve'],
  }[metric] as Array<keyof CapacityDay>;
  const [supply, assigned, free, demand, reserve] = config.map(key => Number(day[key]));
  const Row = ({ label, value, color }: { label: string; value: number | string; color?: string }) => <div className="flex min-w-48 items-center justify-between gap-6 py-0.5"><span className="flex items-center gap-2 text-[var(--ops-text-muted)]">{color && <i className="h-2 w-2 rounded-sm" style={{ background: color }}/>} {label}</span><strong className="font-mono">{value}</strong></div>;
  if (metric === 'rooms') return <div className="pointer-events-auto rounded-lg border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] p-3 text-xs shadow-xl">
    <div className="mb-1.5 border-b border-[var(--ops-divider)] pb-1.5 text-sm font-extrabold">{day.label}</div>
    <Row label="Kontingent" value={day.roomSupply} />
    <Row label="EZ disponiert" value={day.assignedEz} color="var(--ops-primary-emphasis)"/><Row label="DZ disponiert" value={day.assignedDz} color="var(--ops-primary)"/>
    <Row label="EZ frei" value={day.freeEz} color="var(--ops-success)"/><Row label="DZ frei" value={day.freeDz} color="var(--ops-tone-success-text)"/>
    <Row label={`EZ-Bedarf (${source === 'event' ? 'Event' : 'Live'})`} value={source === 'event' ? day.plannedEz : day.demandEz} color="var(--ops-warning)"/>
    <Row label={`DZ-Bedarf (${source === 'event' ? 'Event' : 'Live'})`} value={source === 'event' ? day.plannedDz : day.demandDz}/>
    <Row label={`Gesamtbedarf (${source === 'event' ? 'Event' : 'Live'})`} value={source === 'event' ? day.plannedRooms : day.demandRooms} color="var(--ops-error)"/>
    <Row label="Reserve gesamt" value={`${reserve > 0 ? '+' : ''}${reserve}`} color={reserve < 0 ? 'var(--ops-error)' : 'var(--ops-success)'}/>
  </div>;
  return <div className="pointer-events-auto rounded-lg border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] p-3 text-xs shadow-xl">
    <div className="mb-1.5 border-b border-[var(--ops-divider)] pb-1.5 text-sm font-extrabold">{day.label}</div>
    <Row label="Kontingent" value={supply} /><Row label="Disponiert" value={assigned} color="var(--ops-primary)"/><Row label="Frei" value={free} color="var(--ops-success)"/><Row label={`Bedarf (${source === 'event' ? 'Event' : 'Live'})`} value={demand} color="var(--ops-warning)"/><Row label="Reserve" value={`${reserve > 0 ? '+' : ''}${reserve}`} color={reserve < 0 ? 'var(--ops-error)' : 'var(--ops-success)'}/>
  </div>;
}
const tableClass = 'w-full min-w-[42rem] text-sm';
const rowClass = 'cursor-pointer border-t border-[var(--ops-divider)] hover:bg-[var(--ops-surface-elevated)]';
const headClass = 'text-left text-[11px] uppercase tracking-wider text-[var(--ops-text-subtle)]';

type CapacityMetricConfig = {
  supply: keyof CapacityDay; demand: keyof CapacityDay; assigned: keyof CapacityDay;
  free: keyof CapacityDay; plan: keyof CapacityDay; reserve: keyof CapacityDay;
};

function CapacityChartTable({ timeline, config, metric, source, onDayClick }: {
  timeline: CapacityDay[]; config: CapacityMetricConfig;
  metric: 'beds' | 'rooms'; source: DemandSource; onDayClick: (day: CapacityDay) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnWidth = 76;
  const labelWidth = 112;
  // The chart and its value grid deliberately share this single band scale.
  // Every consumer below uses these positions; the table has no second layout.
  const xScale = (index: number) => labelWidth + index * columnWidth;
  const barCenters = timeline.map((_, index) => xScale(index) + columnWidth / 2);
  const contentWidth = xScale(timeline.length);
  const rows = metric === 'rooms' ? [
    { label: 'Kontingent', key: 'roomSupply' as keyof CapacityDay },
    { label: 'EZ disponiert', key: 'assignedEz' as keyof CapacityDay },
    { label: 'DZ disponiert', key: 'assignedDz' as keyof CapacityDay },
    { label: 'EZ frei', key: 'freeEz' as keyof CapacityDay },
    { label: 'DZ frei', key: 'freeDz' as keyof CapacityDay },
    { label: `EZ-Bedarf (${source === 'event' ? 'Event' : 'Live'})`, key: (source === 'event' ? 'plannedEz' : 'demandEz') as keyof CapacityDay },
    { label: `DZ-Bedarf (${source === 'event' ? 'Event' : 'Live'})`, key: (source === 'event' ? 'plannedDz' : 'demandDz') as keyof CapacityDay },
    { label: 'Reserve gesamt', key: config.reserve },
  ] : [
    { label: 'Kontingent', key: config.supply },
    { label: 'Disponiert', key: config.assigned },
    { label: 'Frei', key: config.free },
    { label: `Bedarf (${source === 'event' ? 'Event' : 'Live'})`, key: source === 'event' ? config.plan : config.demand },
    { label: 'Reserve', key: config.reserve },
  ];
  const legend = metric === 'rooms' ? [
    { key: 'supply', label: 'Kontingent', meaning: 'Gesamte verfügbare Kapazität', color: 'var(--ops-text-muted)', line: true },
    { key: 'assignedEz', label: 'EZ disponiert', meaning: 'Fest zugewiesene Einzelzimmer', color: 'var(--ops-primary-emphasis)', line: false },
    { key: 'assignedDz', label: 'DZ disponiert', meaning: 'Fest zugewiesene Doppelzimmer', color: 'var(--ops-primary)', line: false },
    { key: 'freeEz', label: 'EZ frei', meaning: 'Noch verfügbare Einzelzimmer', color: 'var(--ops-success)', line: false },
    { key: 'freeDz', label: 'DZ frei', meaning: 'Noch verfügbare Doppelzimmer', color: 'var(--ops-tone-success-text)', line: false },
    { key: 'demandEz', label: 'EZ-Bedarf', meaning: 'Benötigte Einzelzimmer', color: 'var(--ops-warning)', line: true },
    { key: 'demandTotal', label: 'Gesamtbedarf', meaning: 'Benötigte Zimmer insgesamt', color: 'var(--ops-error)', line: true },
  ] : [
    { key: 'supply', label: 'Kontingent', meaning: 'Gesamte verfügbare Kapazität', color: 'var(--ops-text-muted)', line: false },
    { key: 'assigned', label: 'Disponiert', meaning: 'Bereits belegte Kapazität', color: 'var(--ops-primary)', line: false },
    { key: 'free', label: 'Frei', meaning: 'Noch verfügbare Kapazität', color: 'var(--ops-success)', line: false },
    { key: 'demand', label: 'Bedarf', meaning: 'Aktuell benötigte Kapazität', color: 'var(--ops-error)', line: true },
  ];
  const opacity = (key: string, normal = 1) => hoveredSeries && hoveredSeries !== key ? .2 : normal;
  const toggle = (key: string) => setHidden(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const isolate = (key: string) => { if (clickTimer.current) clearTimeout(clickTimer.current); setHidden(new Set(legend.filter(item => item.key !== key).map(item => item.key))); };
  return <div className="min-w-0 overflow-hidden" aria-label="Kontingentverlauf mit Tageswerten">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--ops-divider)] px-3 py-2" aria-label="Diagrammlegende">{legend.map(item => <button type="button" key={item.key} aria-pressed={!hidden.has(item.key)} onMouseEnter={() => setHoveredSeries(item.key)} onMouseLeave={() => setHoveredSeries(null)} onFocus={() => setHoveredSeries(item.key)} onBlur={() => setHoveredSeries(null)} onClick={() => { if (clickTimer.current) clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => toggle(item.key), 220); }} onDoubleClick={() => isolate(item.key)} className={clsx('flex items-start gap-2 text-left text-xs transition-opacity focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]', hidden.has(item.key) && 'opacity-35 line-through')}><span className={clsx('mt-1 shrink-0', item.line ? 'h-[3px] w-5 rounded-full' : 'h-3 w-3 rounded-sm')} style={{ background: item.color }}/><span><b className="block">{item.label}</b><small className="block text-[10px] font-normal text-[var(--ops-text-muted)]">{item.meaning}</small></span></button>)}</div>
    <div className="max-w-full overflow-x-auto" onMouseLeave={() => setActiveIndex(null)}>
      <div className="relative" style={{ width: contentWidth }}>
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={timeline} barCategoryGap="24%" margin={{ top: 20, right: 0, bottom: 0, left: labelWidth - 50 }} onMouseMove={state => setActiveIndex(typeof state.activeTooltipIndex === 'number' ? state.activeTooltipIndex : null)} onClick={state => { if (typeof state.activeTooltipIndex === 'number') onDayClick(timeline[state.activeTooltipIndex]); }}>
            <CartesianGrid stroke="var(--ops-divider)" vertical={false}/><XAxis dataKey="label" hide/><YAxis stroke="var(--ops-text-muted)" width={50} label={{ value: metric === 'rooms' ? 'Zimmer' : 'Betten', angle: -90, position: 'insideLeft', fill: 'var(--ops-text-muted)', fontSize: 11 }}/>
            {metric === 'rooms' ? <>
              {!hidden.has('assignedEz') && <Bar dataKey="assignedEz" name="EZ disponiert" stackId="capacity" fill="var(--ops-primary-emphasis)" opacity={opacity('assignedEz')}/>}
              {!hidden.has('assignedDz') && <Bar dataKey="assignedDz" name="DZ disponiert" stackId="capacity" fill="var(--ops-primary)" opacity={opacity('assignedDz')}/>}
              {!hidden.has('freeEz') && <Bar dataKey="freeEz" name="EZ frei" stackId="capacity" fill="var(--ops-success)" opacity={opacity('freeEz', .88)}/>}
              {!hidden.has('freeDz') && <Bar dataKey="freeDz" name="DZ frei" stackId="capacity" fill="var(--ops-tone-success-text)" radius={[4,4,0,0]} opacity={opacity('freeDz', .88)}/>}
            </> : <>
              {!hidden.has('assigned') && <Bar dataKey={config.assigned} name="Disponiert" stackId="capacity" fill="var(--ops-primary)" opacity={opacity('assigned')}/>}
              {!hidden.has('free') && <Bar dataKey={config.free} name="Frei" stackId="capacity" fill="var(--ops-success)" radius={[4,4,0,0]} opacity={opacity('free', .78)}/>}
            </>}
            {!hidden.has('supply') && <Line type="step" dataKey={config.supply} name="Kontingent" stroke="var(--ops-text-muted)" strokeWidth={1.25} strokeDasharray="3 3" dot={false} opacity={opacity('supply', .72)}/>}
            {metric === 'rooms' ? <>
              {!hidden.has('demandEz') && <Line type="monotone" dataKey={source === 'event' ? 'plannedEz' : 'demandEz'} name="EZ-Bedarf" stroke="var(--ops-warning)" strokeWidth={4} dot={{ r: 4, fill: 'var(--ops-warning)', stroke: 'var(--ops-surface)', strokeWidth: 2 }} activeDot={{ r: 7 }} opacity={opacity('demandEz')}/>}
              {!hidden.has('demandTotal') && <Line type="monotone" dataKey={source === 'event' ? 'plannedRooms' : 'demandRooms'} name="Gesamtbedarf (EZ + DZ)" stroke="var(--ops-error)" strokeWidth={4} dot={{ r: 4, fill: 'var(--ops-error)', stroke: 'var(--ops-surface)', strokeWidth: 2 }} activeDot={{ r: 7 }} opacity={opacity('demandTotal')}/>}
            </> : !hidden.has('demand') && <Line type="monotone" dataKey={source === 'event' ? config.plan : config.demand} name="Bedarf" stroke="var(--ops-error)" strokeWidth={4} dot={{ r: 4, fill: 'var(--ops-error)', stroke: 'var(--ops-surface)', strokeWidth: 2 }} activeDot={{ r: 7, strokeWidth: 2 }} opacity={opacity('demand')}/>}
          </ComposedChart>
          </ResponsiveContainer>
        </div>
        {activeIndex !== null && <div className="pointer-events-none absolute top-5 z-20 -translate-x-1/2" style={{ left: barCenters[activeIndex] }}><CapacityTooltip active payload={[{ payload: timeline[activeIndex] }]} metric={metric} source={source}/></div>}
        <div className="grid border-y border-[var(--ops-divider)] text-xs" style={{ gridTemplateColumns: `${labelWidth}px repeat(${timeline.length}, ${columnWidth}px)` }} aria-label="X-Achse: Tage">
          <div className="sticky left-0 z-10 bg-[var(--ops-surface-raised)] px-3 py-2 font-semibold text-[var(--ops-text-muted)]">Tag</div>
          {timeline.map((day, index) => <button type="button" key={day.date} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} onClick={() => onDayClick(day)} className={clsx('py-2 text-center font-bold transition-colors', activeIndex === index && 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-text)]')}>{day.label}</button>)}
        </div>
        <table className="table-fixed border-collapse text-xs" style={{ width: contentWidth }} aria-label="Tageswerte">
        <colgroup><col style={{ width: labelWidth }}/>{timeline.map(day => <col key={day.date} style={{ width: columnWidth }}/>)}</colgroup>
        <tbody>{rows.map(row => <tr key={row.label} className="border-b border-[var(--ops-divider)]"><th className="sticky left-0 z-10 bg-[var(--ops-surface-raised)] px-3 py-2 text-left font-semibold">{row.label}</th>{timeline.map((day, index) => { const value = Number(day[row.key]); const reserve = row.key === config.reserve; return <td key={day.date} onMouseEnter={() => setActiveIndex(index)} onClick={() => onDayClick(day)} className={clsx('cursor-pointer py-2 text-center font-mono tabular-nums transition-colors', activeIndex === index && 'bg-[var(--ops-tone-primary-surface)]', reserve && (value < 0 ? 'font-bold text-[var(--ops-error)]' : 'font-bold text-[var(--ops-success)]'))}>{reserve && value > 0 ? '+' : ''}{value}</td>; })}</tr>)}</tbody>
      </table>
      </div>
    </div>
    {!timeline.length && <EmptyState title="Keine Zeiträume vorhanden" />}
  </div>;
}

function CapacityView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [metric, setMetric] = useState<'beds' | 'rooms'>('rooms');
  const hasNations = data.athletes.length > 0;
  const requestedSource = params.get('source');
  const [source, setSource] = useState<DemandSource>(() => requestedSource === 'event' || requestedSource === 'live' ? requestedSource : hasNations ? 'live' : 'event');
  useEffect(() => { if (requestedSource === 'event' || requestedSource === 'live') setSource(requestedSource); }, [requestedSource]);
  const dates = [
    ...data.events.flatMap(event => [dayKey(event.startDate), dayKey(event.endDate)]),
    ...data.hotels.flatMap(hotel => (hotel.roomInventories || []).flatMap(item => [dayKey(item.availableFrom), dayKey(item.availableUntil)])),
    ...data.athletes.flatMap(athlete => (athlete.stays?.length ? athlete.stays : [athlete]).flatMap(stay => [dayKey(stay.arrivalDate), dayKey(stay.departureDate)])),
    ...data.bookings.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)]),
  ].filter(Boolean).sort();
  const days = dates.length ? range(dates[0], dates.at(-1)!) : [];
  const timeline: CapacityDay[] = days.map(date => {
    const inventory = data.hotels.flatMap(h => h.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);
    const events = data.events.filter(event => dayKey(event.startDate) <= date && dayKey(event.endDate) >= date);
    const bedSupply = inventory.reduce((sum, item) => sum + item.roomCount * item.roomType.maxPersons, 0);
    const supply = calculateRoomPlan(bedSupply);
    const plans = events.map(eventRoomPlan);
    const plannedBeds = plans.reduce((sum, plan) => sum + plan.beds, 0);
    const plannedRooms = plans.reduce((sum, plan) => sum + plan.rooms, 0);
    const actualPeople = data.athletes.filter(athlete => athleteOnDay(athlete, date));
    const livePlan = calculateRoomPlan(actualPeople.length);
    const activeBookings = data.bookings.filter(booking => bookingOnDay(booking, date));
    const assignedRooms = activeBookings.length;
    const assignedBeds = activeBookings.reduce((sum, booking) => sum + booking.occupants.length, 0);
    const assignedEz = calculateQuotaUsage(quotaAssignmentsFromBookings(activeBookings));
    const assignedDz = Math.max(0, assignedBeds - assignedEz);
    const plannedEz = plans.reduce((sum, plan) => sum + plan.singleRooms, 0);
    const plannedDz = plans.reduce((sum, plan) => sum + plan.doubleRooms, 0);
    // Real assignments replace the planning split while the still-free rooms retain
    // the 50/50 planning assumption. This keeps all four stack segments equal to
    // the calculated room contingent at every point in the project.
    const freeRooms = Math.max(supply.rooms - assignedRooms, 0);
    const freeEz = freeRooms / 2;
    const freeDz = freeRooms - freeEz;
    return {
      date, label: formatDay(date), roomSupply: supply.rooms, bedSupply, ezSupply: assignedEz + freeEz, dzSupply: assignedDz + freeDz,
      plannedRooms, plannedBeds, plannedEz, plannedDz,
      demandRooms: livePlan.rooms, demandBeds: livePlan.beds, demandEz: livePlan.singleRooms, demandDz: livePlan.doubleRooms,
      assignedRooms, assignedBeds, assignedEz, assignedDz,
      freeRooms, freeBeds: Math.max(bedSupply - assignedBeds, 0), freeEz, freeDz,
      eventRoomReserve: supply.rooms - plannedRooms, eventBedReserve: bedSupply - plannedBeds, eventEzReserve: supply.singleRooms - plannedEz, eventDzReserve: supply.doubleRooms - plannedDz,
      liveRoomReserve: supply.rooms - livePlan.rooms, liveBedReserve: bedSupply - livePlan.beds, liveEzReserve: supply.singleRooms - livePlan.singleRooms, liveDzReserve: supply.doubleRooms - livePlan.doubleRooms,
    };
  });
  const metricConfig = {
    beds: { label: 'Betten', supply: 'bedSupply', demand: 'demandBeds', assigned: 'assignedBeds', free: 'freeBeds', plan: 'plannedBeds', reserve: source === 'event' ? 'eventBedReserve' : 'liveBedReserve', group: 'beds' as const },
    rooms: { label: 'Zimmer', supply: 'roomSupply', demand: 'demandRooms', assigned: 'assignedRooms', free: 'freeRooms', plan: 'plannedRooms', reserve: source === 'event' ? 'eventRoomReserve' : 'liveRoomReserve', group: 'rooms' as const },
  }[metric];
  const demandKey = source === 'event' ? metricConfig.plan : metricConfig.demand;
  const peak = timeline.reduce((best, day) => Number(day[demandKey]) > Number(best?.[demandKey] || -1) ? day : best, timeline[0]);
  const value = (key: keyof CapacityDay) => Number(peak?.[key] || 0);
  const reserve = value(metricConfig.reserve);
  const riskDays = timeline.filter(day => Number(day[metricConfig.reserve]) < 0);
  const firstRisk = riskDays[0];
  const minimum = timeline.reduce((lowest, day) => Number(day[metricConfig.reserve]) < Number(lowest?.[metricConfig.reserve] ?? Number.POSITIVE_INFINITY) ? day : lowest, timeline[0]);
  const minimumReserve = Number(minimum?.[metricConfig.reserve] || 0);
  return <div className="min-w-0 space-y-4">
    <Kpis><ClickMetric onClick={() => navigate(source === 'live' ? '/athletes' : '/events')} label="Bedarfspeak" value={value(demandKey)} helper={peak?.label || '—'} trend={`${source === 'live' ? 'Live' : 'Plan'} · ${metricConfig.label}`} tone="primary"/><ClickMetric onClick={() => firstRisk && navigate(`/hotels?date=${firstRisk.date}`)} label="Erster Risikotag" value={firstRisk ? firstRisk.label : '—'} helper={firstRisk ? 'Reserve wird negativ' : 'Keine Unterdeckung'} trend={firstRisk ? 'prüfen' : 'gedeckt'} tone={firstRisk ? 'error' : 'success'}/><ClickMetric onClick={() => minimum && navigate(`/hotels?date=${minimum.date}`)} label="Kleinste Reserve" value={`${minimumReserve > 0 ? '+' : ''}${minimumReserve}`} helper={minimum?.label || '—'} trend={minimumReserve < 0 ? 'Unterdeckung' : 'gedeckt'} tone={minimumReserve < 0 ? 'error' : 'success'}/><ClickMetric onClick={() => firstRisk && navigate(`/analytics?view=capacity&date=${firstRisk.date}`)} label="Tage mit Unterdeckung" value={riskDays.length} helper={`von ${timeline.length} betrachteten Tagen`} trend={riskDays.length ? 'Zeitraum analysieren' : 'keine'} tone={riskDays.length ? 'warning' : 'success'}/></Kpis>
    <DataPanel title={<ChartHeading title="Kontingentverlauf" subtitle="Entwicklung von Bedarf, Kontingent und verfügbarer Reserve." description="Balken zeigen Belegung und freie Kapazität; Linien zeigen Kontingent und Bedarf je Tag."/>} actions={<div className="flex flex-wrap items-end gap-3"><div><div className="mb-1 pl-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Darstellung</div><div className="flex rounded-lg bg-[var(--ops-surface-elevated)] p-1">{(['rooms','beds'] as const).map(key => <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)} className={clsx('rounded-md px-3 py-1.5 text-xs font-bold', metric === key ? 'bg-[var(--ops-primary)] text-white' : 'text-[var(--ops-text-muted)]')}>{key === 'rooms' ? 'Zimmer · EZ & DZ' : 'Betten'}</button>)}</div></div><div><div className="mb-1 pl-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Bedarfsquelle</div><div className="flex rounded-lg bg-[var(--ops-surface-elevated)] p-1">{(['event','live'] as const).map(key => <button type="button" key={key} aria-pressed={source === key} onClick={() => setSource(key)} className={clsx('rounded-md px-3 py-1.5 text-xs font-bold', source === key ? 'bg-[var(--ops-primary)] text-white' : 'text-[var(--ops-text-muted)]')}>{key === 'event' ? 'Event' : 'Live'}</button>)}</div></div></div>}>
      <CapacityChartTable timeline={timeline} config={metricConfig} metric={metric} source={source} onDayClick={day => navigate(`/hotels?date=${day.date}`)}/>
    </DataPanel>
  </div>;
}
function HotelsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const dates = [...data.hotels.flatMap(hotel => (hotel.roomInventories || []).flatMap(item => [dayKey(item.availableFrom), dayKey(item.availableUntil)])), ...data.bookings.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)])].filter(Boolean).sort();
  const days = dates.length ? range(dates[0], dates.at(-1)!) : [];
  const rows = data.hotels.map(hotel => {
    const hotelBookings = data.bookings.filter(booking => booking.hotel.id === hotel.id);
    const daily = days.map(date => {
      const inventories = (hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);
      const rooms = inventories.reduce((sum, item) => sum + item.roomCount, 0);
      const singleRooms = inventories.filter(item => isSingle(item.roomType)).reduce((sum, item) => sum + item.roomCount, 0);
      const activeBookings = hotelBookings.filter(booking => bookingOnDay(booking, date));
      const occupied = activeBookings.length;
      const occupiedSingle = activeBookings.filter(booking => isSingle(booking.roomType)).length;
      return { date, rooms, occupied, reserve: rooms - occupied, singleReserve: singleRooms - occupiedSingle };
    }).filter(day => day.rooms > 0 || day.occupied > 0);
    const worst = daily.reduce((lowest, day) => day.reserve < (lowest?.reserve ?? Number.POSITIVE_INFINITY) ? day : lowest, daily[0]);
    const firstCritical = daily.find(day => day.rooms === 0 ? day.occupied > 0 : day.reserve / day.rooms <= .1);
    const criticalDays = daily.filter(day => day.rooms === 0 ? day.occupied > 0 : day.reserve / day.rooms <= .1).length;
    const reservePercent = worst?.rooms ? Math.round(worst.reserve / worst.rooms * 100) : worst?.occupied ? -100 : 100;
    const cause = worst?.reserve < 0 ? 'Zimmerunterdeckung' : worst?.singleReserve < 0 ? 'EZ-Mix' : reservePercent <= 10 ? 'Reserve ≤ 10 %' : 'Stabil';
    return { id: hotel.id, name: hotel.name, daily, worst, firstCritical, criticalDays, reservePercent, cause };
  }).sort((a, b) => (a.firstCritical?.date || '9999').localeCompare(b.firstCritical?.date || '9999') || a.reservePercent - b.reservePercent);
  const critical = rows.filter(row => row.firstCritical);
  const worst = [...rows].sort((a, b) => a.reservePercent - b.reservePercent)[0];
  const criticalTone = (reserve: number, rooms: number) => reserve < 0 ? 'bg-[var(--ops-error)]' : rooms > 0 && reserve / rooms <= .1 ? 'bg-[var(--ops-warning)]' : 'bg-[var(--ops-tone-success-surface)]';
  return <ViewShell title="Hotelrisiken" subtitle="Reserve und Handlungsbedarf je Hotel und Tag verstehen.">
    <Kpis>
      <ClickMetric onClick={() => worst && navigate(`/hotels?hotelId=${worst.id}&date=${worst.worst?.date || ''}`)} label="Kleinste Reserve" value={worst?.worst ? `${worst.worst.reserve > 0 ? '+' : ''}${worst.worst.reserve}` : '—'} helper={worst?.name || 'Kein Hotel'} trend={worst?.worst ? formatDay(worst.worst.date) : 'kein Zeitraum'} tone={worst && worst.reservePercent <= 10 ? 'error' : 'success'}/>
      <ClickMetric onClick={() => critical[0] && navigate(`/hotels?hotelId=${critical[0].id}&date=${critical[0].firstCritical?.date}`)} label="Erster Risikotag" value={critical[0]?.firstCritical ? formatDay(critical[0].firstCritical!.date) : '—'} helper={critical[0]?.name || 'Kein Risiko'} trend={critical.length ? `${critical.length} Hotels betroffen` : 'stabil'} tone={critical.length ? 'warning' : 'success'}/>
      <ClickMetric onClick={() => navigate('/hotels')} label="Kritische Hoteltage" value={critical.reduce((sum, row) => sum + row.criticalDays, 0)} helper="Reserve maximal 10 %" trend="über den Zeitraum" tone={critical.length ? 'warning' : 'success'}/>
    </Kpis>
    <DataPanel title={<ChartHeading title="Risiko über den Zeitraum" subtitle="Tägliche Zimmerreserve je Hotel." description="Die Farbe zeigt, ob Kapazität stabil, knapp oder unterdeckt ist."/>} actions={<StatusChip tone={critical.length ? 'warning' : 'success'}>{critical.length ? `${critical.length} Hotels kritisch` : 'Alle Hotels stabil'}</StatusChip>}>
      {!rows.length || !days.length ? <EmptyState title="Keine Hotelzeiträume vorhanden"/> : <div className="overflow-x-auto p-3">
        <div className="min-w-max">
          <div className="grid items-end gap-1 text-[10px] text-[var(--ops-text-subtle)]" style={{ gridTemplateColumns: `11rem repeat(${days.length}, 1.5rem)` }}><span>Hotel</span>{days.map((day, index) => <span key={day} className="-rotate-45 origin-bottom-left pb-1">{index % 2 === 0 ? formatDay(day) : ''}</span>)}</div>
          {rows.map(row => <button type="button" key={row.id} onClick={() => navigate(`/hotels?hotelId=${row.id}&date=${row.firstCritical?.date || row.worst?.date || ''}`)} className="grid items-center gap-1 border-t border-[var(--ops-divider)] py-1 text-left hover:bg-[var(--ops-surface-elevated)]" style={{ gridTemplateColumns: `11rem repeat(${days.length}, 1.5rem)` }}><span className="truncate pr-3 text-xs font-bold" title={row.name}>{row.name}</span>{days.map(day => { const value = row.daily.find(item => item.date === day); return <span key={day} title={`${row.name} · ${formatFullDay(day)} · ${value ? `Reserve: ${value.reserve} Zimmer · Auslastung: ${value.rooms ? Math.round(value.occupied / value.rooms * 100) : value.occupied ? 100 : 0} % · Status: ${value.reserve < 0 ? 'kritisch' : value.rooms && value.reserve / value.rooms <= .1 ? 'Warnung' : 'stabil'} · Grund: ${value.reserve < 0 ? 'Zimmerunterdeckung' : value.rooms && value.reserve / value.rooms <= .1 ? 'Reserve maximal 10 %' : 'ausreichende Reserve'}` : 'kein Kontingent'}`} className={clsx('h-5 rounded-sm border border-[var(--ops-surface)]', value ? criticalTone(value.reserve, value.rooms) : 'bg-[var(--ops-surface-overlay)]')}/>; })}</button>)}
        </div>
        <div className="mt-3 grid gap-2 text-[11px] text-[var(--ops-text-muted)] sm:grid-cols-3"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--ops-tone-success-surface)]"/><b>Stabil</b> · mehr als 10 % Reserve</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--ops-warning)]"/><b>Warnung</b> · maximal 10 % Reserve</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--ops-error)]"/><b>Kritisch</b> · belegte Zimmer über Kontingent</span></div>
      </div>}
    </DataPanel>
    <DataPanel title="Frühester Handlungsbedarf" actions={<span className="text-xs text-[var(--ops-text-muted)]">Verdichtete Analyse · Bearbeitung in Hotels</span>}>
      {!critical.length ? <EmptyState title="Keine kritischen Hotelzeiträume"/> : <div className="divide-y divide-[var(--ops-divider)]">{critical.slice(0, 8).map((row, index) => <button type="button" key={row.id} onClick={() => navigate(`/hotels?hotelId=${row.id}&date=${row.firstCritical!.date}`)} className="grid w-full grid-cols-[2rem_minmax(9rem,1fr)_7rem_7rem_8rem_auto] items-center gap-3 p-3 text-left text-xs hover:bg-[var(--ops-surface-elevated)]"><b className="font-mono text-[var(--ops-text-subtle)]">{index + 1}</b><b>{row.name}</b><span>{formatDay(row.firstCritical!.date)}</span><span>{row.criticalDays} krit. Tage</span><StatusChip tone={row.worst?.reserve && row.worst.reserve < 0 ? 'error' : 'warning'}>{row.cause}</StatusChip><ArrowRight size={16} className="text-[var(--ops-primary)]"/></button>)}</div>}
    </DataPanel>
  </ViewShell>;
}

function NationsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const quotaEvaluation = new Map(quotaAssignmentsFromBookings(data.bookings).map(assignment => [assignment.personId, assignment.countsAsSingle] as const));
  const dates = data.athletes.flatMap(person => person.stays?.length ? person.stays.flatMap(stay => [dayKey(stay.arrivalDate), dayKey(stay.departureDate)]) : [dayKey(person.arrivalDate), dayKey(person.departureDate)]).filter(Boolean).sort();
  const days = dates.length ? range(dates[0], dates.at(-1)!) : [];
  const rows = Object.values(data.athletes.reduce<Record<string, { nation: string; people: Athlete[]; athletes: number; officials: number; ez: number; dzPeople: number }>>((result, person) => {
    const nation = person.nationCode || '—';
    const row = result[nation] ||= { nation, people: [], athletes: 0, officials: 0, ez: 0, dzPeople: 0 };
    row.people.push(person);
    if (/official|coach|staff|trainer/i.test(person.function || '')) row.officials += 1; else row.athletes += 1;
    if (quotaEvaluation.get(person.id)) row.ez += 1; else row.dzPeople += 1;
    return result;
  }, {})).map(row => {
    const presence = days.map(date => row.people.filter(person => athleteOnDay(person, date)).length);
    const bedNights = presence.reduce((sum, count) => sum + count, 0);
    const stays = row.people.map(person => {
      const arrival = dayKey(person.arrivalDate || person.stays?.[0]?.arrivalDate); const departure = dayKey(person.departureDate || person.stays?.[0]?.departureDate);
      return arrival && departure ? Math.max(0, Math.round((new Date(`${departure}T00:00:00Z`).getTime() - new Date(`${arrival}T00:00:00Z`).getTime()) / 86400000)) : 0;
    });
    return { ...row, count: row.people.length, dz: Math.ceil(row.dzPeople / 2), share: data.athletes.length ? row.people.length / data.athletes.length * 100 : 0, presence, bedNights, averageStay: stays.length ? stays.reduce((a, b) => a + b, 0) / stays.length : 0, peak: Math.max(...presence, 0) };
  }).sort((a, b) => b.bedNights - a.bedNights || b.count - a.count);
  const top = rows.slice(0, 12);
  const maxNights = Math.max(...top.map(row => row.bedNights), 1);
  const maxPresence = Math.max(...top.flatMap(row => row.presence), 1);
  const biggestPeak = [...rows].sort((a, b) => b.peak - a.peak)[0];
  const highestEz = [...rows].filter(row => row.count).sort((a, b) => b.ez / b.count - a.ez / a.count)[0];
  return <ViewShell title="Nationen & Bedarfsstruktur" subtitle="Delegationsgröße, Aufenthaltsdauer und Zimmermix vergleichen.">
    <Kpis>
      <ClickMetric onClick={() => biggestPeak && navigate(`/lists?entity=persons&group=nation&nation=${biggestPeak.nation}`)} label="Höchster Delegationspeak" value={biggestPeak?.peak || 0} helper={biggestPeak?.nation || '—'} trend="gleichzeitig anwesend" tone="primary"/>
      <ClickMetric onClick={() => rows[0] && navigate(`/lists?entity=persons&group=nation&nation=${rows[0].nation}`)} label="Meiste Bettennächte" value={rows[0]?.bedNights || 0} helper={rows[0]?.nation || '—'} trend={`${rows[0]?.share.toLocaleString('de-DE', { maximumFractionDigits: 1 }) || 0} % der Personen`} tone="info"/>
      <ClickMetric onClick={() => highestEz && navigate(`/lists?entity=persons&group=nation&nation=${highestEz.nation}`)} label="Höchster EZ-Anteil" value={highestEz?.count ? `${Math.round(highestEz.ez / highestEz.count * 100)} %` : '—'} helper={highestEz?.nation || '—'} trend="Bedarfsstruktur" tone="warning"/>
    </Kpis>
    <DataPanel title={<ChartHeading title="Bedarf nach Nation" subtitle="Bettennächte und Aufenthaltsdauer der Top-Nationen." description="Längere Balken bedeuten mehr belegte Betten über den gesamten Aufenthalt."/>} actions={<span className="text-xs text-[var(--ops-text-muted)]">Top 12 · sortiert nach Bettennächten</span>}>
      {!top.length ? <EmptyState title="Noch keine Nationenanmeldungen"/> : <div className="space-y-2 p-4">{top.map((row, index) => <button type="button" key={row.nation} onClick={() => navigate(`/lists?entity=persons&group=nation&nation=${row.nation}`)} className="grid w-full grid-cols-[2rem_4rem_minmax(12rem,1fr)_5rem_6rem] items-center gap-3 rounded-lg p-1.5 text-left text-xs hover:bg-[var(--ops-surface-elevated)]"><span className="font-mono text-[var(--ops-text-subtle)]">{index + 1}</span><b>{row.nation}</b><span className="relative h-5 overflow-hidden rounded bg-[var(--ops-surface-overlay)]"><i className="absolute inset-y-0 left-0 bg-[var(--ops-primary)]" style={{ width: `${row.bedNights / maxNights * 100}%` }}/><span className="relative z-10 px-2 font-mono font-bold text-white mix-blend-difference">{row.bedNights} Bettennächte</span></span><span>{row.count} Pers.</span><span>{row.averageStay.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Nächte Ø</span></button>)}</div>}
    </DataPanel>
    <DataPanel title={<ChartHeading title="Aufenthaltsprofil der Top-Nationen" subtitle="Gleichzeitig anwesende Personen je Tag." description="Dunklere Felder bedeuten eine höhere Anwesenheit im Vergleich zum größten Tageswert."/>} actions={<span className="text-xs text-[var(--ops-text-muted)]">Gleichzeitig anwesende Personen</span>}>
      {!top.length || !days.length ? <EmptyState title="Keine Aufenthaltszeiträume vorhanden"/> : <div className="overflow-x-auto p-3"><div className="min-w-max"><div className="grid items-end gap-1 text-[10px] text-[var(--ops-text-subtle)]" style={{ gridTemplateColumns: `6rem repeat(${days.length}, 1.5rem)` }}><span>Nation</span>{days.map((day, index) => <span key={day} className="-rotate-45 origin-bottom-left pb-1">{index % 2 === 0 ? formatDay(day) : ''}</span>)}</div>{top.map(row => <button type="button" key={row.nation} onClick={() => navigate(`/lists?entity=persons&group=nation&nation=${row.nation}`)} className="grid items-center gap-1 border-t border-[var(--ops-divider)] py-1 hover:bg-[var(--ops-surface-elevated)]" style={{ gridTemplateColumns: `6rem repeat(${days.length}, 1.5rem)` }}><b className="text-left text-xs">{row.nation}</b>{row.presence.map((count, index) => <span key={days[index]} title={`Nation ${row.nation} · ${formatFullDay(days[index])} · ${count} Personen · Anteil am Tagesmaximum: ${Math.round(count / maxPresence * 100)} %`} className="flex h-5 items-center justify-center rounded-sm text-[9px] font-bold" style={{ background: count ? `color-mix(in srgb, var(--ops-primary) ${Math.max(18, count / maxPresence * 100)}%, var(--ops-surface))` : 'var(--ops-surface-overlay)', color: count / maxPresence > .55 ? 'white' : 'var(--ops-text-muted)' }}>{count || ''}</span>)}</button>)}</div></div>}
    </DataPanel>
    <DataPanel title={<ChartHeading title="Zimmer- und Rollenstruktur" subtitle="Benötigte Einzel- und Doppelzimmer je Nation." description="Blau steht für belegte Doppelzimmer; Orange kennzeichnet den besonderen Einzelzimmerbedarf."/>}><div className="grid gap-2 border-b border-[var(--ops-divider)] px-4 py-3 text-xs sm:grid-cols-2"><span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-[var(--ops-warning)]"/><b>EZ</b> · benötigte Einzelzimmer</span><span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-[var(--ops-primary)]"/><b>DZ</b> · benötigte Doppelzimmer</span></div><div className="h-80 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={top} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid stroke="var(--ops-divider)" horizontal={false}/><XAxis type="number" stroke="var(--ops-text-muted)" label={{ value: 'Zimmer', position: 'insideBottomRight', offset: -4, fill: 'var(--ops-text-muted)', fontSize: 11 }}/><YAxis type="category" dataKey="nation" width={55} tick={{ fill: 'var(--ops-text-muted)', fontSize: 11 }}/><Tooltip cursor={{ fill: 'var(--ops-surface-overlay)' }} content={<NationTooltip/>}/><Bar dataKey="ez" name="EZ" stackId="rooms" fill="var(--ops-warning)"/><Bar dataKey="dz" name="DZ" stackId="rooms" fill="var(--ops-primary)" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer></div></DataPanel>
  </ViewShell>;
}

function Navigation({ active, onSelect }: { active: ViewKey; onSelect: (key: ViewKey) => void }) {
  return <ContentCard surface="raised" className="overflow-hidden xl:w-[21rem] xl:shrink-0"><div className="border-b border-[var(--ops-divider)] p-4"><SectionHeader title="Analysen" subtitle="Fragestellung auswählen und Zusammenhänge verstehen" /></div><div className="grid gap-2 p-3 sm:grid-cols-3 xl:grid-cols-1" role="tablist">{NAV.map(item => { const Icon = item.icon; return <button key={item.key} type="button" role="tab" aria-selected={active === item.key} onClick={() => onSelect(item.key)} className={clsx('group flex items-center gap-3 rounded-xl border p-3 text-left transition-colors', active === item.key ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)] shadow-[0_0_0_1px_var(--ops-primary)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)] hover:bg-[var(--ops-surface-elevated)]')}><span className="rounded-lg bg-[var(--ops-surface-elevated)] p-2 text-[var(--ops-primary)]"><Icon size={19}/></span><span className="min-w-0 flex-1"><b className="block text-sm">{item.label}</b><small className="block leading-5 text-[var(--ops-text-muted)]">{item.question}</small></span><ArrowRight size={16} className="shrink-0 text-[var(--ops-primary)]"/></button>; })}</div></ContentCard>;
}

export function RoomAnalytics() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const active: ViewKey = NAV.some(item => item.key === requested) ? requested as ViewKey : 'capacity';
  const [data, setData] = useState<AnalyticsData>({ hotels: [], events: [], athletes: [], bookings: [] }); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => Promise.all([api.getHotels(), api.getEvents(), api.getAthletes(), api.getRoomAssignments()]).then(([hotels, events, athletes, bookings]) => { setData({ hotels, events, athletes, bookings }); setError(null); }).catch(() => setError('Analytics-Daten konnten nicht geladen werden.')).finally(() => setLoading(false));
    void load(); const refresh = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(refresh);
  }, []);
  const updated = useMemo(() => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date()), [data]);
  const phase = data.bookings.length ? 'Phase 3 · Betrieb' : data.athletes.length ? 'Phase 2 · Durchführung' : 'Phase 1 · Planung';
  const select = (view: ViewKey) => setParams(current => { const next = new URLSearchParams(current); next.set('view', view); return next; });
  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600"/></div>;
  return <SplitPageLayout><PageHeader eyebrow="Unterkunftsplanung · Verstehen" title="Analytics" subtitle="Ursachen, Entwicklungen und Kapazitätsrisiken erkennen." meta={<><StatusChip tone={data.bookings.length ? 'primary' : data.athletes.length ? 'info' : 'neutral'}>{phase}</StatusChip><StatusChip tone="success">Live · 30 s</StatusChip><StatusChip tone="neutral">Aktualisiert {updated} Uhr</StatusChip></>}/>{error && <ErrorState title="Daten nicht verfügbar" description={error}/>}<SplitPaneLayout sidebar={<Navigation active={active} onSelect={select}/>}><div role="tabpanel">{active === 'capacity' && <CapacityView data={data}/>} {active === 'hotels' && <HotelsView data={data}/>} {active === 'nations' && <NationsView data={data}/>}</div></SplitPaneLayout></SplitPageLayout>;
}
