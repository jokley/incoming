import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Building2, CalendarRange, ChartNoAxesCombined, CircleUserRound, Flag, Loader2, ListChecks } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../services/api';
import type { Athlete, Event, Hotel, HotelRoomInventory, RoomBooking } from '../types';
import { ContentCard, DataPanel, EmptyState, ErrorState, MetricCard, PageHeader, SplitPageLayout, SplitPaneLayout, SectionHeader, StatusChip } from '../design-system';
import { calculateRoomPlan, eventRoomPlan } from '../services/planningCalculations';
import { calculateQuotaUsage, quotaAssignmentsFromBookings } from '../services/quotaEvaluation';

type ViewKey = 'capacity' | 'hotels' | 'nations' | 'assignments' | 'singleRooms' | 'conflicts';
type AnalyticsData = { hotels: Hotel[]; events: Event[]; athletes: Athlete[]; bookings: RoomBooking[] };
type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary';

const isSingle = (room: { name: string; maxPersons: number }) => room.maxPersons === 1 || /(^|\W)EZ(\W|$)/i.test(room.name);
const dayKey = (value?: string | null) => value?.slice(0, 10) || '';
const formatDay = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
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
  { key: 'capacity', label: 'Bedarf & Kontingent', question: 'Haben wir genügend Zimmer?', icon: ChartNoAxesCombined },
  { key: 'hotels', label: 'Hotelrisiken', question: 'Welche Hotels werden kritisch?', icon: Building2 },
  { key: 'nations', label: 'Nationen', question: 'Wer verursacht welchen Bedarf?', icon: Flag },
  { key: 'assignments', label: 'Zuweisungsarbeit', question: 'Wer braucht als Nächstes ein Zimmer?', icon: ListChecks },
  { key: 'singleRooms', label: 'Einzelzimmer', question: 'Welche Entscheidungen sind offen?', icon: CircleUserRound },
  { key: 'conflicts', label: 'Operative Konflikte', question: 'Wo müssen wir jetzt handeln?', icon: AlertTriangle },
];

function ClickMetric({ onClick, ...props }: Parameters<typeof MetricCard>[0] & { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-w-0 text-left transition-transform hover:-translate-y-0.5 focus-visible:rounded-xl focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]"><MetricCard {...props} /></button>;
}

function Kpis({ children }: { children: ReactNode }) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>; }
function ViewShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  void title; void subtitle;
  return <div className="min-w-0 space-y-4">{children}</div>;
}
function ActionCell() { return <ArrowRight size={16} className="text-[var(--ops-primary)]" />; }
function ChartTip() { return <Tooltip cursor={{ stroke: 'var(--ops-text-muted)', strokeWidth: 1 }} contentStyle={{ background: 'var(--ops-surface-elevated)', border: '1px solid var(--ops-border)', borderRadius: 8 }} />; }
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
    { key: 'supply', label: 'Kontingent', color: 'var(--ops-text-muted)', line: true },
    { key: 'assignedEz', label: 'EZ disponiert', color: 'var(--ops-primary-emphasis)', line: false },
    { key: 'assignedDz', label: 'DZ disponiert', color: 'var(--ops-primary)', line: false },
    { key: 'freeEz', label: 'EZ frei', color: 'var(--ops-success)', line: false },
    { key: 'freeDz', label: 'DZ frei', color: 'var(--ops-tone-success-text)', line: false },
    { key: 'demandEz', label: 'EZ-Bedarf', color: 'var(--ops-warning)', line: true },
    { key: 'demandTotal', label: 'Gesamtbedarf (EZ + DZ)', color: 'var(--ops-error)', line: true },
  ] : [
    { key: 'supply', label: 'Kontingent', color: 'var(--ops-text-muted)', line: false },
    { key: 'assigned', label: 'Disponiert', color: 'var(--ops-primary)', line: false },
    { key: 'free', label: 'Frei', color: 'var(--ops-success)', line: false },
    { key: 'demand', label: 'Bedarf', color: 'var(--ops-warning)', line: true },
  ];
  const opacity = (key: string, normal = 1) => hoveredSeries && hoveredSeries !== key ? .2 : normal;
  const toggle = (key: string) => setHidden(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const isolate = (key: string) => { if (clickTimer.current) clearTimeout(clickTimer.current); setHidden(new Set(legend.filter(item => item.key !== key).map(item => item.key))); };
  return <div className="min-w-0 overflow-hidden" aria-label="Kontingentverlauf mit Tageswerten">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--ops-divider)] px-3 py-2" aria-label="Diagrammlegende">{legend.map(item => <button type="button" key={item.key} aria-pressed={!hidden.has(item.key)} onMouseEnter={() => setHoveredSeries(item.key)} onMouseLeave={() => setHoveredSeries(null)} onClick={() => { if (clickTimer.current) clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => toggle(item.key), 220); }} onDoubleClick={() => isolate(item.key)} className={clsx('flex items-center gap-2 text-xs font-semibold transition-opacity focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]', hidden.has(item.key) && 'opacity-35 line-through')}><span className={item.line ? 'h-[3px] w-5 rounded-full' : 'h-3 w-3 rounded-sm'} style={{ background: item.color }}/>{item.label}</button>)}</div>
    <div className="max-w-full overflow-x-auto" onMouseLeave={() => setActiveIndex(null)}>
      <div className="relative" style={{ width: contentWidth }}>
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={timeline} barCategoryGap="24%" margin={{ top: 20, right: 0, bottom: 0, left: labelWidth - 50 }} onMouseMove={state => setActiveIndex(typeof state.activeTooltipIndex === 'number' ? state.activeTooltipIndex : null)} onClick={state => { if (typeof state.activeTooltipIndex === 'number') onDayClick(timeline[state.activeTooltipIndex]); }}>
            <CartesianGrid stroke="var(--ops-divider)" vertical={false}/><XAxis dataKey="label" hide/><YAxis stroke="var(--ops-text-muted)" width={50}/>
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
            </> : !hidden.has('demand') && <Line type="monotone" dataKey={source === 'event' ? config.plan : config.demand} name="Bedarf" stroke="var(--ops-warning)" strokeWidth={4} dot={{ r: 4, fill: 'var(--ops-warning)', stroke: 'var(--ops-surface)', strokeWidth: 2 }} activeDot={{ r: 7, strokeWidth: 2 }} opacity={opacity('demand')}/>}
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
  const [metric, setMetric] = useState<'beds' | 'rooms'>('rooms');
  const hasNations = data.athletes.length > 0;
  const [source, setSource] = useState<DemandSource>(() => hasNations ? 'live' : 'event');
  useEffect(() => setSource(hasNations ? 'live' : 'event'), [hasNations]);
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
  return <div className="min-w-0 space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><ClickMetric onClick={() => navigate('/hotels')} label="Kontingent" value={value(metricConfig.supply)} helper={peak?.label || '—'} trend="Gesamt" tone="info"/><ClickMetric onClick={() => navigate('/assignments')} label="Disponiert" value={value(metricConfig.assigned)} helper={peak?.label || '—'} trend="Belegt" tone="primary"/><ClickMetric onClick={() => navigate('/hotels')} label="Frei" value={value(metricConfig.free)} helper={peak?.label || '—'} trend="Frei" tone="success"/><ClickMetric onClick={() => navigate(source === 'live' ? '/athletes' : '/events')} label={`${source === 'live' ? 'Live' : 'Event'}bedarf`} value={value(demandKey)} helper={peak?.label || '—'} trend={source === 'live' ? 'Live' : 'Plan'} tone="warning"/><ClickMetric onClick={() => navigate('/analytics')} label="Reserve" value={`${reserve > 0 ? '+' : ''}${reserve}`} helper={peak?.label || '—'} trend={reserve < 0 ? 'Unterdeckung' : 'Gedeckt'} tone={reserve < 0 ? 'error' : 'success'}/></div>
    <DataPanel title="Kontingentverlauf" actions={<div className="flex flex-wrap items-end gap-3"><div><div className="mb-1 pl-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Darstellung</div><div className="flex rounded-lg bg-[var(--ops-surface-elevated)] p-1">{(['rooms','beds'] as const).map(key => <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)} className={clsx('rounded-md px-3 py-1.5 text-xs font-bold', metric === key ? 'bg-[var(--ops-primary)] text-white' : 'text-[var(--ops-text-muted)]')}>{key === 'rooms' ? 'Zimmer · EZ & DZ' : 'Betten'}</button>)}</div></div><div><div className="mb-1 pl-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Bedarfsquelle</div><div className="flex rounded-lg bg-[var(--ops-surface-elevated)] p-1">{(['event','live'] as const).map(key => <button type="button" key={key} aria-pressed={source === key} onClick={() => setSource(key)} className={clsx('rounded-md px-3 py-1.5 text-xs font-bold', source === key ? 'bg-[var(--ops-primary)] text-white' : 'text-[var(--ops-text-muted)]')}>{key === 'event' ? 'Event' : 'Live'}</button>)}</div></div></div>}>
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
      const rooms = (hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date).reduce((sum, item) => sum + item.roomCount, 0);
      const occupied = hotelBookings.filter(booking => bookingOnDay(booking, date)).length;
      return { date, rooms, occupied, reserve: rooms - occupied };
    }).filter(day => day.rooms > 0 || day.occupied > 0);
    const peak = daily.reduce((lowest, day) => day.reserve < (lowest?.reserve ?? Number.POSITIVE_INFINITY) ? day : lowest, daily[0]);
    const reservePercent = peak?.rooms ? Math.round(peak.reserve / peak.rooms * 100) : peak?.occupied ? -100 : 100;
    return { id: hotel.id, name: hotel.name, date: peak?.date || '', rooms: peak?.rooms || 0, occupied: peak?.occupied || 0, reserve: peak?.reserve || 0, reservePercent };
  }).sort((a, b) => a.reservePercent - b.reservePercent || a.reserve - b.reserve);
  const critical = rows.filter(row => row.reservePercent <= 10);
  const shortages = rows.filter(row => row.reserve < 0);
  const next = rows[0];
  return <ViewShell title="Welche Hotels werden kritisch?" subtitle="Priorisiert nach der kleinsten Zimmerreserve an ihrem jeweils kritischsten Tag.">
    <Kpis><ClickMetric onClick={() => next && navigate(`/hotels?hotelId=${next.id}&date=${next.date}`)} label="Nächstes Risiko" value={next?.name || '—'} helper={next?.date ? formatDay(next.date) : 'kein Zeitraum'} trend={next ? `${next.reserve} Zimmer` : 'stabil'} tone={next && next.reservePercent <= 10 ? 'error' : 'success'}/><ClickMetric onClick={() => navigate('/hotels')} label="Kritische Hotels" value={critical.length} helper="maximal 10 % Reserve" trend={critical.length ? 'prüfen' : 'keine'} tone={critical.length ? 'warning' : 'success'}/><ClickMetric onClick={() => navigate('/assignments')} label="Unterdeckungen" value={shortages.length} helper="Hotels mit negativer Reserve" trend={shortages.length ? 'sofort' : 'gedeckt'} tone={shortages.length ? 'error' : 'success'}/></Kpis>
    <DataPanel title="Kleinste Zimmerreserve je Hotel" actions={<StatusChip tone={critical.length ? 'warning' : 'success'}>{critical.length ? `${critical.length} kritisch` : 'Alle stabil'}</StatusChip>}><button type="button" onClick={() => next && navigate(`/hotels?hotelId=${next.id}&date=${next.date}`)} className="h-80 w-full p-4 text-left"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows.slice(0, 12)} layout="vertical" margin={{ left: 30 }}><CartesianGrid stroke="var(--ops-divider)" horizontal={false}/><XAxis type="number" stroke="var(--ops-text-muted)"/><YAxis type="category" dataKey="name" width={150} tick={{ fill: 'var(--ops-text-muted)', fontSize: 11 }}/><ChartTip/><Bar dataKey="reserve" name="Zimmerreserve" radius={[0,5,5,0]}>{rows.slice(0, 12).map(row => <Cell key={row.id} fill={row.reserve < 0 ? 'var(--ops-error)' : row.reservePercent <= 10 ? 'var(--ops-warning)' : 'var(--ops-success)'}/>)}</Bar></BarChart></ResponsiveContainer></button></DataPanel>
    {critical.length > 0 && <DataPanel title="Handlungsbedarf"><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Hotel</th><th>Kritischer Tag</th><th>Kontingent</th><th>Disponiert</th><th>Reserve</th><th>Status</th><th/></tr></thead><tbody>{critical.map(row => <tr key={row.id} onClick={() => navigate(`/hotels?hotelId=${row.id}&date=${row.date}`)} className={rowClass}><td className="p-3 font-bold">{row.name}</td><td>{formatDay(row.date)}</td><td>{row.rooms}</td><td>{row.occupied}</td><td className={clsx('font-bold', row.reserve < 0 ? 'text-[var(--ops-error)]' : 'text-[var(--ops-warning)]')}>{row.reserve > 0 ? '+' : ''}{row.reserve}</td><td><StatusChip tone={row.reserve < 0 ? 'error' : 'warning'}>{row.reserve < 0 ? 'Unterdeckung' : 'knapp'}</StatusChip></td><td><ActionCell/></td></tr>)}</tbody></table></div></DataPanel>}
  </ViewShell>;
}
function NationsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const quotaEvaluation = new Map(quotaAssignmentsFromBookings(data.bookings).map(assignment =>
    [assignment.personId, assignment.countsAsSingle] as const));
  const colors = ['var(--ops-primary)', 'var(--ops-success)', 'var(--ops-warning)', 'var(--ops-error)', 'var(--ops-secondary)', 'var(--ops-info)', 'var(--ops-primary-emphasis)', 'var(--ops-text-muted)'];
  const rows = Object.values(data.athletes.reduce<Record<string, { nation: string; people: number; athletes: number; officials: number; ez: number; dzPeople: number }>>((result, person) => {
    const nation = person.nationCode || '—';
    const row = result[nation] ||= { nation, people: 0, athletes: 0, officials: 0, ez: 0, dzPeople: 0 };
    row.people += 1;
    if (/official|coach|staff|trainer/i.test(person.function || '')) row.officials += 1; else row.athletes += 1;
    if (quotaEvaluation.get(person.id)) row.ez += 1; else row.dzPeople += 1;
    return result;
  }, {})).map(row => ({ ...row, dz: Math.ceil(row.dzPeople / 2), share: data.athletes.length ? row.people / data.athletes.length * 100 : 0 })).sort((a, b) => b.people - a.people);
  const leader = rows[0];
  const NationTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: typeof rows[number] }> }) => {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    return <div className="rounded-lg border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] p-3 text-xs shadow-xl"><b className="mb-2 block text-sm">{row.nation}</b><div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-[var(--ops-text-muted)]"><span>Personen</span><strong className="text-right text-[var(--ops-text)]">{row.people}</strong><span>Zimmer</span><strong className="text-right text-[var(--ops-text)]">{row.ez + row.dz}</strong><span>EZ</span><strong className="text-right text-[var(--ops-text)]">{row.ez}</strong><span>DZ</span><strong className="text-right text-[var(--ops-text)]">{row.dz}</strong><span>Anteil</span><strong className="text-right text-[var(--ops-text)]">{row.share.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</strong></div></div>;
  };
  return <ViewShell title="Nationen"><Kpis><ClickMetric onClick={() => navigate('/athletes')} label="Gemeldete Nationen" value={rows.length} helper="mit konkretem Bedarf" trend="Ist" tone="info"/><ClickMetric onClick={() => leader && navigate(`/athletes?nation=${leader.nation}`)} label="Größte Delegation" value={leader?.nation || '—'} helper={`${leader?.people || 0} Personen`} trend={`${leader?.share.toLocaleString('de-DE', { maximumFractionDigits: 1 }) || 0} %`} tone="primary"/></Kpis><DataPanel title="Anteil am Gesamtbedarf"><div className="grid min-h-[24rem] items-center gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(13rem,1fr)]"><div className="h-[22rem]"><ResponsiveContainer width="100%" height="100%"><PieChart><Tooltip content={<NationTooltip/>}/><Pie data={rows} dataKey="people" nameKey="nation" innerRadius="52%" outerRadius="86%" paddingAngle={1} stroke="var(--ops-surface-raised)" strokeWidth={2} onClick={row => navigate(`/athletes?nation=${row.nation}`)}>{rows.map((row, index) => <Cell key={row.nation} fill={colors[index % colors.length]} className="cursor-pointer outline-none"/>)}</Pie></PieChart></ResponsiveContainer></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-1">{rows.map((row, index) => <button key={row.nation} onClick={() => navigate(`/athletes?nation=${row.nation}`)} className="flex items-center justify-between gap-3 rounded-lg p-2 text-left text-sm hover:bg-[var(--ops-surface-elevated)]"><span className="flex min-w-0 items-center gap-2"><i className="h-3 w-3 shrink-0 rounded-sm" style={{ background: colors[index % colors.length] }}/><b className="truncate">{row.nation}</b></span><span className="font-mono text-[var(--ops-text-muted)]">{row.share.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</span></button>)}</div></div></DataPanel><DataPanel title="Bedarf je Nation"><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Nation</th><th>Personen</th><th>Zimmer</th><th>EZ</th><th>DZ</th><th>Anteil</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.nation} onClick={() => navigate(`/athletes?nation=${row.nation}`)} className={rowClass}><td className="p-3 font-bold">{row.nation}</td><td>{row.people}</td><td>{row.ez + row.dz}</td><td>{row.ez}</td><td>{row.dz}</td><td>{row.share.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</td><td><ActionCell/></td></tr>)}</tbody></table>{!rows.length && <EmptyState title="Noch keine Nationenanmeldungen"/>}</div></DataPanel></ViewShell>;
}

function AssignmentsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const open = data.athletes.filter(athlete => !isAssigned(athlete)).map(athlete => {
    const arrival = dayKey(athlete.arrivalDate || athlete.stays?.[0]?.arrivalDate);
    const roomDecisionOpen = athlete.single_room_status === 'PENDING_APPROVAL';
    const missingStay = !arrival || !dayKey(athlete.departureDate || athlete.stays?.[0]?.departureDate);
    return { athlete, arrival, roomDecisionOpen, missingStay, priority: missingStay ? 1 : roomDecisionOpen ? 2 : 3 };
  }).sort((a, b) => a.priority - b.priority || (a.arrival || '9999').localeCompare(b.arrival || '9999') || a.athlete.lastname.localeCompare(b.athlete.lastname));
  const missingStay = open.filter(item => item.missingStay).length;
  const blocked = open.filter(item => item.roomDecisionOpen).length;
  return <ViewShell title="Zuweisungsarbeit"><Kpis><ClickMetric onClick={() => navigate('/assignments?workflow=open')} label="Ohne Zimmer" value={open.length} helper="offene Zuweisungen" trend={open.length ? 'bearbeiten' : 'erledigt'} tone={open.length ? 'error' : 'success'}/><ClickMetric onClick={() => navigate('/athletes?stay=missing')} label="Aufenthalt fehlt" value={missingStay} helper="nicht disponierbar" trend={missingStay ? 'zuerst klären' : 'vollständig'} tone={missingStay ? 'error' : 'success'}/><ClickMetric onClick={() => navigate('/athletes?singleRoomStatus=PENDING_APPROVAL')} label="Durch EZ blockiert" value={blocked} helper="Entscheidung offen" trend={blocked ? 'entscheiden' : 'keine'} tone={blocked ? 'warning' : 'success'}/></Kpis><DataPanel title="Nächste Zuweisungen" actions={<StatusChip tone={open.length ? 'warning' : 'success'}>{open.length ? `${open.length} offen` : 'Alles zugewiesen'}</StatusChip>}><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Priorität</th><th>Person</th><th>Nation</th><th>Anreise</th><th>Blocker</th><th/></tr></thead><tbody>{open.map((item, index) => <tr key={item.athlete.id} onClick={() => navigate(`/assignments?athleteId=${item.athlete.id}`)} className={rowClass}><td className="p-3 font-mono font-bold">{index + 1}</td><td className="font-bold">{item.athlete.firstname} {item.athlete.lastname}</td><td>{item.athlete.nationCode}</td><td>{item.arrival ? formatDay(item.arrival) : '—'}</td><td><StatusChip tone={item.missingStay ? 'error' : item.roomDecisionOpen ? 'warning' : 'info'}>{item.missingStay ? 'Aufenthalt fehlt' : item.roomDecisionOpen ? 'EZ offen' : 'zuweisen'}</StatusChip></td><td><ActionCell/></td></tr>)}</tbody></table>{!open.length && <EmptyState title="Keine offenen Zuweisungen"/>}</div></DataPanel></ViewShell>;
}

function SingleRoomsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const defs: Array<{ status: Athlete['single_room_status']; label: string; tone: Tone; rank: number }> = [
    { status: 'PENDING_APPROVAL', label: 'Entscheidung offen', tone: 'warning', rank: 0 },
    { status: 'IN_QUOTA', label: 'Innerhalb Quote', tone: 'success', rank: 1 },
    { status: 'APPROVED_EXTRA', label: 'Genehmigt', tone: 'info', rank: 2 },
  ];
  const counts = defs.map(def => ({ ...def, value: data.athletes.filter(a => a.single_room_status === def.status).length }));
  const people = data.athletes.filter(person => defs.some(def => def.status === person.single_room_status)).sort((a, b) => (defs.find(def => def.status === a.single_room_status)?.rank ?? 9) - (defs.find(def => def.status === b.single_room_status)?.rank ?? 9) || a.lastname.localeCompare(b.lastname));
  return <ViewShell title="Einzelzimmer"><Kpis>{counts.map(item => <ClickMetric key={item.status} onClick={() => navigate(`/athletes?singleRoomStatus=${item.status}`)} label={item.label} value={item.value} helper="Personen mit Einzelzimmerbedarf" trend={item.status === 'PENDING_APPROVAL' ? 'jetzt entscheiden' : 'anzeigen'} tone={item.tone}/>)}</Kpis><DataPanel title="Einzelzimmerentscheidungen" actions={<StatusChip tone={counts[0].value ? 'warning' : 'success'}>{counts[0].value ? `${counts[0].value} Entscheidungen offen` : 'Keine Entscheidung offen'}</StatusChip>}><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Person</th><th>Nation</th><th>Disziplin</th><th>EZ-Status</th><th/></tr></thead><tbody>{people.map(person => { const def = defs.find(d => d.status === person.single_room_status)!; return <tr key={person.id} onClick={() => navigate(`/athletes?athleteId=${person.id}`)} className={rowClass}><td className="p-3 font-bold">{person.firstname} {person.lastname}</td><td>{person.nationCode}</td><td>{person.discipline || person.disciplines?.join(', ') || '—'}</td><td><StatusChip tone={def.tone}>{def.label}</StatusChip></td><td><ActionCell/></td></tr>})}</tbody></table>{!people.length && <EmptyState title="Keine Einzelzimmerentscheidungen vorhanden"/>}</div></DataPanel></ViewShell>;
}

function ConflictsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const personTasks = data.athletes.flatMap(athlete => {
    const base = { athlete, id: `person-${athlete.id}` };
    if (athlete.missingFromLatestRoomlistImport && isAssigned(athlete)) return [{ ...base, priority: 1, title: 'Ungültige Zuordnung', detail: 'Person fehlt in der aktuellen Zimmerliste', route: `/assignments?athleteId=${athlete.id}` }];
    if (!isAssigned(athlete)) return [{ ...base, priority: 2, title: 'Zimmer fehlt', detail: 'Keine gültige Zimmerzuweisung vorhanden', route: `/assignments?athleteId=${athlete.id}` }];
    if (athlete.hasPendingRoomlistReview) return [{ ...base, priority: 3, title: 'Importkonflikt', detail: athlete.roomlistChangeSummary || 'Zimmerrelevante Daten wurden geändert', route: `/athletes?athleteId=${athlete.id}` }];
    if (athlete.single_room_status === 'PENDING_APPROVAL') return [{ ...base, priority: 4, title: 'EZ-Entscheidung offen', detail: 'Einzelzimmerbedarf ist noch nicht entschieden', route: `/athletes?athleteId=${athlete.id}` }];
    return [];
  });
  const hotelTasks = data.hotels.flatMap(hotel => {
    const dates = (hotel.roomInventories || []).flatMap(item => range(dayKey(item.availableFrom), dayKey(item.availableUntil)));
    const worst = [...new Set(dates)].map(date => ({ date, rooms: (hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date).reduce((sum, item) => sum + item.roomCount, 0), occupied: data.bookings.filter(booking => booking.hotel.id === hotel.id && bookingOnDay(booking, date)).length })).sort((a, b) => (a.rooms - a.occupied) - (b.rooms - b.occupied))[0];
    if (!worst || worst.occupied <= worst.rooms) return [];
    return [{ athlete: null, id: `hotel-${hotel.id}`, priority: 1, title: 'Hotel überbucht', detail: `${formatDay(worst.date)} · ${worst.occupied - worst.rooms} Zimmer Unterdeckung`, route: `/hotels?hotelId=${hotel.id}&date=${worst.date}`, subject: hotel.name }];
  });
  const conflicts = [...hotelTasks, ...personTasks].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
  const critical = conflicts.filter(item => item.priority <= 2).length;
  return <ViewShell title="Operative Konflikte"><Kpis><ClickMetric onClick={() => navigate('/assignments?workflow=open')} label="Sofort erledigen" value={critical} helper="Überbuchung / Zimmer fehlt" trend="Priorität 1" tone={critical ? 'error' : 'success'}/><ClickMetric onClick={() => navigate('/athletes?review=invalid')} label="Importkonflikte" value={conflicts.filter(item => item.title === 'Importkonflikt' || item.title === 'Ungültige Zuordnung').length} helper="Zuordnung prüfen" trend="Priorität 2" tone="warning"/><ClickMetric onClick={() => navigate('/athletes?singleRoomStatus=PENDING_APPROVAL')} label="EZ-Entscheidungen" value={conflicts.filter(item => item.title === 'EZ-Entscheidung offen').length} helper="noch offen" trend="Priorität 3" tone="warning"/><ClickMetric onClick={() => navigate('/assignments')} label="Aufgaben gesamt" value={conflicts.length} helper="priorisiert" trend={conflicts.length ? 'abarbeiten' : 'alles stabil'} tone={conflicts.length ? 'error' : 'success'}/></Kpis><DataPanel title="Priorisierte Aufgaben" actions={<StatusChip tone={conflicts.length ? 'error' : 'success'}>{conflicts.length ? `${conflicts.length} offen` : 'Keine Konflikte'}</StatusChip>}><div className="divide-y divide-[var(--ops-divider)]">{conflicts.map((item, index) => <button key={item.id} onClick={() => navigate(item.route)} className="group flex w-full items-center gap-4 p-4 text-left hover:bg-[var(--ops-surface-elevated)]"><span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono font-bold', item.priority <= 2 ? 'bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]' : 'bg-[var(--ops-tone-warning-surface)] text-[var(--ops-warning)]')}>{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusChip tone={item.priority <= 2 ? 'error' : 'warning'}>{item.title}</StatusChip><b>{item.athlete ? `${item.athlete.firstname} ${item.athlete.lastname}` : item.subject}</b></div><p className="mt-1 text-xs text-[var(--ops-text-muted)]">{item.athlete ? `${item.athlete.nationCode} · ${item.athlete.discipline || item.athlete.disciplines?.join(', ') || 'Ohne Disziplin'} · ` : ''}{item.detail}</p></div><ActionCell/></button>)}{!conflicts.length && <div className="p-4"><EmptyState title="Keine operativen Konflikte"/></div>}</div></DataPanel></ViewShell>;
}

function Navigation({ active, data, onSelect }: { active: ViewKey; data: AnalyticsData; onSelect: (key: ViewKey) => void }) {
  const openAssignments = data.athletes.filter(a => !isAssigned(a)).length;
  const openSingleRooms = data.athletes.filter(a => a.single_room_status === 'PENDING_APPROVAL').length;
  const openConflicts = data.athletes.filter(a => (a.missingFromLatestRoomlistImport && isAssigned(a)) || !isAssigned(a) || a.hasPendingRoomlistReview || a.single_room_status === 'PENDING_APPROVAL').length + data.hotels.filter(hotel => {
    const dates = (hotel.roomInventories || []).flatMap(item => range(dayKey(item.availableFrom), dayKey(item.availableUntil)));
    return [...new Set(dates)].some(date => data.bookings.filter(booking => booking.hotel.id === hotel.id && bookingOnDay(booking, date)).length > (hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date).reduce((sum, item) => sum + item.roomCount, 0));
  }).length;
  const badges: Partial<Record<ViewKey, number>> = { assignments: openAssignments, singleRooms: openSingleRooms, conflicts: openConflicts };
  return <ContentCard surface="raised" className="overflow-hidden xl:w-[21rem] xl:shrink-0"><div className="border-b border-[var(--ops-divider)] p-4"><SectionHeader title="Arbeitsbereiche" subtitle="Operative Frage auswählen und handeln" /></div><div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-1" role="tablist">{NAV.map(item => { const Icon = item.icon; const count = badges[item.key] || 0; return <button key={item.key} type="button" role="tab" aria-selected={active === item.key} onClick={() => onSelect(item.key)} className={clsx('group flex items-center gap-3 rounded-xl border p-3 text-left transition-colors', active === item.key ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)] shadow-[0_0_0_1px_var(--ops-primary)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)] hover:bg-[var(--ops-surface-elevated)]')}><span className="rounded-lg bg-[var(--ops-surface-elevated)] p-2 text-[var(--ops-primary)]"><Icon size={19}/></span><span className="min-w-0 flex-1"><b className="block text-sm">{item.label}</b><small className="block leading-5 text-[var(--ops-text-muted)]">{item.question}</small></span>{count > 0 ? <span aria-label={`${count} offene Aufgaben`} className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] px-1.5 py-0.5 text-xs font-bold tabular-nums text-[var(--ops-text-muted)]">{count}</span> : <ArrowRight size={16} className="shrink-0 text-[var(--ops-primary)]"/>}</button>; })}</div></ContentCard>;
}

export function RoomAnalytics() {
  const [active, setActive] = useState<ViewKey>('capacity'); const [data, setData] = useState<AnalyticsData>({ hotels: [], events: [], athletes: [], bookings: [] }); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => Promise.all([api.getHotels(), api.getEvents(), api.getAthletes(), api.getRoomAssignments()]).then(([hotels, events, athletes, bookings]) => { setData({ hotels, events, athletes, bookings }); setError(null); }).catch(() => setError('Analytics-Daten konnten nicht geladen werden.')).finally(() => setLoading(false));
    void load();
    const refresh = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(refresh);
  }, []);
  const updated = useMemo(() => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date()), [data]);
  const phase = data.bookings.length ? 'Phase 3 · Betrieb' : data.athletes.length ? 'Phase 2 · Durchführung' : 'Phase 1 · Planung';
  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600"/></div>;
  return <SplitPageLayout><PageHeader eyebrow="Operations Center · Unterkunftsplanung" title="Operations Cockpit" meta={<><StatusChip tone={data.bookings.length ? 'primary' : data.athletes.length ? 'info' : 'neutral'}>{phase}</StatusChip><StatusChip tone="success">Live · 30 s</StatusChip><StatusChip tone="neutral"><CalendarRange className="mr-1 h-3 w-3"/>Aktualisiert {updated} Uhr</StatusChip></>}/>{error && <ErrorState title="Daten nicht verfügbar" description={error}/>}<SplitPaneLayout sidebar={<Navigation active={active} data={data} onSelect={setActive}/>}><div role="tabpanel">{active === 'capacity' && <CapacityView data={data}/>} {active === 'hotels' && <HotelsView data={data}/>} {active === 'nations' && <NationsView data={data}/>} {active === 'assignments' && <AssignmentsView data={data}/>} {active === 'singleRooms' && <SingleRoomsView data={data}/>} {active === 'conflicts' && <ConflictsView data={data}/>}</div></SplitPaneLayout></SplitPageLayout>;
}
