import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Building2, CalendarRange, ChartNoAxesCombined, CircleUserRound, Flag, Loader2, ListChecks } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../services/api';
import type { Athlete, Event, Hotel, HotelRoomInventory, RoomBooking } from '../types';
import { ContentCard, DataPanel, EmptyState, ErrorState, MetricCard, PageHeader, PageLayout, SectionHeader, StatusChip } from '../design-system';
import { calculateRoomPlan, eventRoomPlan } from '../services/planningCalculations';

type ViewKey = 'capacity' | 'hotels' | 'nations' | 'assignments' | 'events' | 'singleRooms' | 'conflicts';
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
const athleteIsSingle = (athlete: Athlete) => athlete.single_room_status === 'IN_QUOTA' || athlete.single_room_status === 'APPROVED_EXTRA' || /(^|\W)EZ(\W|$)/i.test(athlete.roomType || '');
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
  { key: 'hotels', label: 'Hotelauslastung', question: 'Welche Hotels laufen voll?', icon: Building2 },
  { key: 'nations', label: 'Nationen', question: 'Wer verursacht welchen Bedarf?', icon: Flag },
  { key: 'assignments', label: 'Zuweisungsfortschritt', question: 'Wie weit ist die Belegung?', icon: ListChecks },
  { key: 'events', label: 'Eventbedarf', question: 'Welche Events treiben den Bedarf?', icon: CalendarRange },
  { key: 'singleRooms', label: 'Einzelzimmer', question: 'Welche Entscheidungen sind offen?', icon: CircleUserRound },
  { key: 'conflicts', label: 'Operative Konflikte', question: 'Wo müssen wir jetzt handeln?', icon: AlertTriangle },
];

function ClickMetric({ onClick, ...props }: Parameters<typeof MetricCard>[0] & { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-w-0 text-left transition-transform hover:-translate-y-0.5 focus-visible:rounded-xl focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]"><MetricCard {...props} /></button>;
}

function Kpis({ children }: { children: ReactNode }) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>; }
function ViewShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-4"><ContentCard surface="raised" className="p-5"><h2 className="text-2xl font-extrabold">{title}</h2>{subtitle && <p className="mt-1 text-sm text-[var(--ops-text-muted)]">{subtitle}</p>}</ContentCard>{children}</div>;
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
    <Row label="EZ disponiert" value={day.assignedEz} color="#285A8C"/><Row label="DZ disponiert" value={day.assignedDz} color="#5585B5"/>
    <Row label="EZ frei" value={day.freeEz} color="#57A773"/><Row label="DZ frei" value={day.freeDz} color="#9BD0AE"/>
    <Row label={`EZ-Bedarf (${source === 'event' ? 'Event' : 'Live'})`} value={source === 'event' ? day.plannedEz : day.demandEz} color="#F59E0B"/>
    <Row label={`DZ-Bedarf (${source === 'event' ? 'Event' : 'Live'})`} value={source === 'event' ? day.plannedDz : day.demandDz} color="#D9467B"/>
    <Row label="Reserve gesamt" value={`${reserve > 0 ? '+' : ''}${reserve}`} color={reserve < 0 ? 'var(--ops-error)' : 'var(--ops-success)'}/>
  </div>;
  return <div className="pointer-events-auto rounded-lg border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] p-3 text-xs shadow-xl">
    <div className="mb-1.5 border-b border-[var(--ops-divider)] pb-1.5 text-sm font-extrabold">{day.label}</div>
    <Row label="Kontingent" value={supply} /><Row label="Disponiert" value={assigned} color="var(--ops-primary)"/><Row label="Frei" value={free} color="var(--ops-success)"/><Row label={`Bedarf (${source === 'event' ? 'Event' : 'Live'})`} value={demand} color="#FFB224"/><Row label="Reserve" value={`${reserve > 0 ? '+' : ''}${reserve}`} color={reserve < 0 ? 'var(--ops-error)' : 'var(--ops-success)'}/>
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
    { key: 'supply', label: 'Kontingent', color: '#DCE6F2', line: true },
    { key: 'assignedEz', label: 'EZ disponiert', color: '#285A8C', line: false },
    { key: 'assignedDz', label: 'DZ disponiert', color: '#5585B5', line: false },
    { key: 'freeEz', label: 'EZ frei', color: '#57A773', line: false },
    { key: 'freeDz', label: 'DZ frei', color: '#9BD0AE', line: false },
    { key: 'demandEz', label: 'EZ-Bedarf', color: '#F59E0B', line: true },
    { key: 'demandDz', label: 'DZ-Bedarf', color: '#D9467B', line: true },
  ] : [
    { key: 'supply', label: 'Kontingent', color: '#DCE6F2', line: false },
    { key: 'assigned', label: 'Disponiert', color: 'var(--ops-primary)', line: false },
    { key: 'free', label: 'Frei', color: 'var(--ops-success)', line: false },
    { key: 'demand', label: 'Bedarf', color: '#FFB224', line: true },
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
              {!hidden.has('assignedEz') && <Bar dataKey="assignedEz" name="EZ disponiert" stackId="capacity" fill="#285A8C" opacity={opacity('assignedEz')}/>}
              {!hidden.has('assignedDz') && <Bar dataKey="assignedDz" name="DZ disponiert" stackId="capacity" fill="#5585B5" opacity={opacity('assignedDz')}/>}
              {!hidden.has('freeEz') && <Bar dataKey="freeEz" name="EZ frei" stackId="capacity" fill="#57A773" opacity={opacity('freeEz', .88)}/>}
              {!hidden.has('freeDz') && <Bar dataKey="freeDz" name="DZ frei" stackId="capacity" fill="#9BD0AE" radius={[4,4,0,0]} opacity={opacity('freeDz', .88)}/>}
            </> : <>
              {!hidden.has('assigned') && <Bar dataKey={config.assigned} name="Disponiert" stackId="capacity" fill="var(--ops-primary)" opacity={opacity('assigned')}/>}
              {!hidden.has('free') && <Bar dataKey={config.free} name="Frei" stackId="capacity" fill="var(--ops-success)" radius={[4,4,0,0]} opacity={opacity('free', .78)}/>}
            </>}
            {!hidden.has('supply') && <Line type="step" dataKey={config.supply} name="Kontingent" stroke="#DCE6F2" strokeWidth={1.25} strokeDasharray="3 3" dot={false} opacity={opacity('supply', .72)}/>}
            {metric === 'rooms' ? <>
              {!hidden.has('demandEz') && <Line type="monotone" dataKey={source === 'event' ? 'plannedEz' : 'demandEz'} name="EZ-Bedarf" stroke="#F59E0B" strokeWidth={4} dot={{ r: 4, fill: '#F59E0B', stroke: '#111D2E', strokeWidth: 2 }} activeDot={{ r: 7 }} opacity={opacity('demandEz')}/>}
              {!hidden.has('demandDz') && <Line type="monotone" dataKey={source === 'event' ? 'plannedDz' : 'demandDz'} name="DZ-Bedarf" stroke="#D9467B" strokeWidth={4} dot={{ r: 4, fill: '#D9467B', stroke: '#111D2E', strokeWidth: 2 }} activeDot={{ r: 7 }} opacity={opacity('demandDz')}/>}
            </> : !hidden.has('demand') && <Line type="monotone" dataKey={source === 'event' ? config.plan : config.demand} name="Bedarf" stroke="#F59E0B" strokeWidth={4} dot={{ r: 4, fill: '#F59E0B', stroke: '#111D2E', strokeWidth: 2 }} activeDot={{ r: 7, strokeWidth: 2 }} opacity={opacity('demand')}/>}
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
    const assignedEz = activeBookings.filter(booking => booking.countsAsSingle || isSingle(booking.roomType)).length;
    const assignedDz = assignedRooms - assignedEz;
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
  const rows = data.hotels.map(hotel => { const capacity = calculateRoomPlan(inventoryBeds(hotel.roomInventories)); const beds = inventoryBeds(hotel.roomInventories); const bookings = data.bookings.filter(item => item.hotel.id === hotel.id); const occupiedRooms = bookings.length; const occupiedBeds = bookings.reduce((sum, item) => sum + item.occupants.length, 0); return { id: hotel.id, name: hotel.name, rooms: capacity.rooms, beds, occupiedRooms, freeRooms: Math.max(0, capacity.rooms - occupiedRooms), freeBeds: Math.max(0, beds - occupiedBeds), utilization: capacity.rooms ? Math.round(occupiedRooms / capacity.rooms * 100) : 0 }; }).sort((a, b) => b.utilization - a.utilization);
  return <ViewShell title="Wo wird das Hotelkontingent knapp?" subtitle="Jede Zeile zeigt: disponiert + frei = gesamtes, aus Betten berechnetes Zimmerkontingent.">
    <Kpis><ClickMetric onClick={() => navigate('/hotels')} label="Kontingent" value={rows.reduce((s,r)=>s+r.rooms,0)} helper="Zimmer aus Betten ÷ 1,5" trend="Gesamt" tone="info"/><ClickMetric onClick={() => navigate('/assignments')} label="Disponiert" value={rows.reduce((s,r)=>s+r.occupiedRooms,0)} helper="über alle Hotels" trend="Belegt" tone="primary"/><ClickMetric onClick={() => navigate('/hotels?availability=free')} label="Noch frei" value={rows.reduce((s,r)=>s+r.freeRooms,0)} helper="über alle Hotels" trend="Frei" tone="success"/></Kpis>
    <DataPanel title="Hotelauslastung · belegt und frei"><div className="space-y-2 p-4">{rows.map(row => <button type="button" key={row.id} onClick={() => navigate(`/hotels?hotelId=${row.id}`)} className="grid w-full gap-3 rounded-lg p-3 text-left hover:bg-[var(--ops-surface-elevated)] md:grid-cols-[minmax(11rem,1fr)_minmax(16rem,2fr)_9rem]"><div><strong>{row.name}</strong><div className="mt-1 text-xs text-[var(--ops-text-muted)]">{row.occupiedRooms} / {row.rooms} Zimmer · {row.utilization}%</div></div><div className="flex h-5 overflow-hidden rounded-md bg-[var(--ops-surface-overlay)]" aria-label={`${row.occupiedRooms} Zimmer belegt, ${row.freeRooms} Zimmer frei`}><span className="h-full bg-[var(--ops-primary)]" style={{width:`${row.utilization}%`}}/><span className="h-full flex-1 bg-[var(--ops-success)]"/></div><div className="text-xs leading-5"><span className="text-[var(--ops-primary)]">{row.occupiedRooms} belegt</span><br/><span className="text-[var(--ops-success)]">{row.freeRooms} frei</span></div></button>)}</div></DataPanel>
    <DataPanel title="Kapazität je Hotel"><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Hotel</th><th>Kontingent</th><th>Disponiert</th><th>Frei</th><th>Betten frei</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.id} onClick={() => navigate(`/hotels?hotelId=${row.id}`)} className={rowClass}><td className="p-3 font-bold">{row.name}</td><td>{row.rooms}</td><td>{row.occupiedRooms}</td><td>{row.freeRooms}</td><td>{row.freeBeds}</td><td><ActionCell/></td></tr>)}</tbody></table></div></DataPanel>
  </ViewShell>;
}
function NationsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate();
  const rows = Object.values(data.athletes.reduce<Record<string, { nation: string; people: number; athletes: number; officials: number; ez: number; dzPeople: number }>>((result, person) => {
    const nation = person.nationCode || '—';
    const row = result[nation] ||= { nation, people: 0, athletes: 0, officials: 0, ez: 0, dzPeople: 0 };
    row.people += 1;
    if (/official|coach|staff|trainer/i.test(person.function || '')) row.officials += 1; else row.athletes += 1;
    if (athleteIsSingle(person)) row.ez += 1; else row.dzPeople += 1;
    return result;
  }, {})).map(row => ({ ...row, dz: Math.ceil(row.dzPeople / 2), share: data.athletes.length ? Math.round(row.people / data.athletes.length * 100) : 0 })).sort((a, b) => b.people - a.people);
  const leader = rows[0];
  return <ViewShell title="Welche Nationen treiben den tatsächlichen Bedarf?" subtitle="Personenstruktur und Zimmeranforderungen aus den eingegangenen Meldungen."><Kpis><ClickMetric onClick={() => navigate('/athletes')} label="Gemeldete Nationen" value={rows.length} helper="mit konkreten Personen" trend="Ist" tone="info"/><ClickMetric onClick={() => leader && navigate(`/athletes?nation=${leader.nation}`)} label="Größte Delegation" value={leader?.nation || '—'} helper={`${leader?.people || 0} Personen`} trend={`${leader?.share || 0}% Anteil`} tone="primary"/><ClickMetric onClick={() => navigate('/athletes?singleRoom=true')} label="EZ-Anforderungen" value={rows.reduce((sum, row) => sum + row.ez, 0)} helper="bestätigt / genehmigt" trend="prüfen" tone="warning"/></Kpis><DataPanel title="Athleten & Officials je Nation"><button onClick={() => navigate('/athletes')} className="h-80 w-full p-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows.slice(0, 12)} layout="vertical" margin={{ left: 20 }}><CartesianGrid stroke="var(--ops-divider)" horizontal={false}/><XAxis type="number" stroke="var(--ops-text-muted)"/><YAxis type="category" dataKey="nation" width={50} stroke="var(--ops-text-muted)"/><ChartTip/><Legend/><Bar dataKey="athletes" name="Athleten" stackId="people" fill="var(--ops-primary)"/><Bar dataKey="officials" name="Officials" stackId="people" fill="var(--ops-info)" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></button></DataPanel><DataPanel title="Bedarf je Nation"><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Nation</th><th>Personen</th><th>Athleten / Officials</th><th>EZ</th><th>DZ</th><th>Anteil</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.nation} onClick={() => navigate(`/athletes?nation=${row.nation}`)} className={rowClass}><td className="p-3 font-bold">{row.nation}</td><td>{row.people}</td><td>{row.athletes} / {row.officials}</td><td>{row.ez}</td><td>{row.dz}</td><td>{row.share}%</td><td><ActionCell/></td></tr>)}</tbody></table>{!rows.length && <EmptyState title="Noch keine Nationenanmeldungen" description="Bis zum ersten Import basiert die Planung ausschließlich auf dem Soll-Bedarf der Events."/>}</div></DataPanel></ViewShell>;
}

function AssignmentsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate(); const assigned = data.athletes.filter(isAssigned).length; const open = data.athletes.length - assigned; const percent = data.athletes.length ? Math.round(assigned / data.athletes.length * 100) : 0;
  const rows = data.events.map(event => { const athletes = data.athletes.filter(a => eventForAthlete(a, [event])); const done = athletes.filter(isAssigned).length; return { id: event.id, name: event.discipline, demand: event.personDemand || athletes.length, assigned: done, open: Math.max(0, (event.personDemand || athletes.length) - done) }; }).sort((a, b) => b.open - a.open);
  return <ViewShell title="Wie weit ist die Belegung?" subtitle="Zugewiesene und offene Personen – aufgeschlüsselt nach Event."><Kpis><ClickMetric onClick={() => navigate('/athletes')} label="Personen" value={data.athletes.length} helper="im WM-Zeitraum" trend="gesamt"/><ClickMetric onClick={() => navigate('/assignments?status=assigned')} label="Zugewiesen" value={assigned} helper="mit Zimmer" trend={`${percent}%`} tone="success"/><ClickMetric onClick={() => navigate('/assignments?status=open')} label="Offen" value={open} helper="ohne Zimmer" trend={open ? 'bearbeiten' : 'erledigt'} tone={open ? 'error' : 'success'}/><ClickMetric onClick={() => navigate('/assignments')} label="Fortschritt" value={`${percent}%`} helper="Zuweisungsquote" trend={percent >= 90 ? 'im Plan' : 'offen'} tone={percent >= 90 ? 'success' : 'warning'}/></Kpis><DataPanel title="Zuweisung pro Event"><button onClick={() => navigate('/assignments')} className="h-80 w-full p-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows}><CartesianGrid stroke="var(--ops-divider)" vertical={false}/><XAxis dataKey="name" stroke="var(--ops-text-muted)" fontSize={11}/><YAxis stroke="var(--ops-text-muted)"/><ChartTip/><Legend/><Bar stackId="a" dataKey="assigned" name="Zugewiesen" fill="var(--ops-success)"/><Bar stackId="a" dataKey="open" name="Offen" fill="var(--ops-error)" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer></button></DataPanel><DataPanel title="Fortschritt nach Event"><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Event</th><th>Bedarf</th><th>Zugewiesen</th><th>Offen</th><th>Status</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.id} onClick={() => navigate(`/assignments?eventId=${row.id}`)} className={rowClass}><td className="p-3 font-bold">{row.name}</td><td>{row.demand}</td><td>{row.assigned}</td><td className="font-bold">{row.open}</td><td><StatusChip tone={row.open ? 'warning' : 'success'}>{row.open ? 'in Arbeit' : 'vollständig'}</StatusChip></td><td><ActionCell/></td></tr>)}</tbody></table></div></DataPanel></ViewShell>;
}

function EventsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate(); const rows = data.events.map(event => { const dz = (event.roomDemands || []).filter(d => !isSingle(d.roomType)).reduce((s, d) => s + d.roomCount, 0); const ez = (event.roomDemands || []).filter(d => isSingle(d.roomType)).reduce((s, d) => s + d.roomCount, 0); return { id: event.id, name: event.discipline, dz, ez, rooms: dz + ez, beds: (event.roomDemands || []).reduce((s, d) => s + d.roomCount * d.roomType.maxPersons, 0), persons: event.personDemand, period: `${formatDay(dayKey(event.startDate))}–${formatDay(dayKey(event.endDate))}` }; }).sort((a, b) => b.beds - a.beds); const biggest = rows[0];
  return <ViewShell title="Welche Events erzeugen den größten Bedarf?" subtitle="Zimmer- und Bettenbedarf pro Event und Veranstaltungszeitraum."><Kpis><ClickMetric onClick={() => biggest && navigate(`/events?eventId=${biggest.id}`)} label="Größtes Event" value={biggest?.name || '—'} helper={biggest?.period || 'kein Zeitraum'} trend="öffnen" tone="primary"/><ClickMetric onClick={() => biggest && navigate(`/events?eventId=${biggest.id}`)} label="Betten" value={biggest?.beds || 0} helper="Spitzenbedarf Event" trend="Bedarf" tone="info"/><ClickMetric onClick={() => biggest && navigate(`/events?eventId=${biggest.id}`)} label="Zimmer" value={biggest?.rooms || 0} helper="Spitzenbedarf Event" trend="Bedarf" tone="info"/></Kpis><DataPanel title="Eventbedarf nach Zeitraum"><button onClick={() => navigate('/events')} className="h-80 w-full p-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ left: 30 }}><CartesianGrid stroke="var(--ops-divider)" horizontal={false}/><XAxis type="number" stroke="var(--ops-text-muted)"/><YAxis type="category" dataKey="name" width={150} tick={{ fill: 'var(--ops-text-muted)', fontSize: 11 }}/><ChartTip/><Legend/><Bar dataKey="dz" name="DZ" stackId="a" fill="var(--ops-primary)"/><Bar dataKey="ez" name="EZ" stackId="a" fill="var(--ops-warning)" radius={[0, 5, 5, 0]}/></BarChart></ResponsiveContainer></button></DataPanel><DataPanel title="Bedarf je Event"><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Event</th><th>Zeitraum</th><th>DZ</th><th>EZ</th><th>Betten</th><th>Personen</th><th/></tr></thead><tbody>{rows.map(row => <tr key={row.id} onClick={() => navigate(`/events?eventId=${row.id}`)} className={rowClass}><td className="p-3 font-bold">{row.name}</td><td>{row.period}</td><td>{row.dz}</td><td>{row.ez}</td><td>{row.beds}</td><td>{row.persons}</td><td><ActionCell/></td></tr>)}</tbody></table></div></DataPanel></ViewShell>;
}

function SingleRoomsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate(); const defs: Array<{ status: Athlete['single_room_status']; label: string; tone: Tone }> = [{ status: 'PENDING_APPROVAL', label: 'Offen', tone: 'warning' }, { status: 'IN_QUOTA', label: 'Innerhalb Quote', tone: 'success' }, { status: 'APPROVED_EXTRA', label: 'Genehmigt', tone: 'info' }, { status: 'NONE', label: 'Abgelehnt / kein EZ', tone: 'neutral' }]; const chart = defs.map(def => ({ ...def, value: data.athletes.filter(a => a.single_room_status === def.status).length })); const people = data.athletes.filter(a => a.single_room_status !== 'NONE').sort((a, b) => (a.single_room_status === 'PENDING_APPROVAL' ? -1 : b.single_room_status === 'PENDING_APPROVAL' ? 1 : a.lastname.localeCompare(b.lastname)));
  return <ViewShell title="Wo stehen die Einzelzimmerentscheidungen?" subtitle="Status, Quote und offene Entscheidungen mit direktem Sprung zur Person."><Kpis>{chart.map(item => <ClickMetric key={item.status} onClick={() => navigate(`/athletes?singleRoomStatus=${item.status}`)} label={item.label} value={item.value} helper="Personen" trend="anzeigen" tone={item.tone}/>)}</Kpis><DataPanel title="Verteilung Einzelzimmerstatus"><button onClick={() => navigate('/athletes?singleRoom=true')} className="h-72 w-full p-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid stroke="var(--ops-divider)" vertical={false}/><XAxis dataKey="label" stroke="var(--ops-text-muted)"/><YAxis stroke="var(--ops-text-muted)" allowDecimals={false}/><ChartTip/><Bar dataKey="value" name="Personen" radius={[5,5,0,0]}>{chart.map(item => <Cell key={item.status} fill={item.status === 'PENDING_APPROVAL' ? 'var(--ops-warning)' : item.status === 'IN_QUOTA' ? 'var(--ops-success)' : 'var(--ops-primary)'}/>)}</Bar></BarChart></ResponsiveContainer></button></DataPanel><DataPanel title="Personen"><div className="overflow-x-auto"><table className={tableClass}><thead className={headClass}><tr><th className="p-3">Person</th><th>Nation</th><th>Disziplin</th><th>Status</th><th/></tr></thead><tbody>{people.map(person => { const def = defs.find(d => d.status === person.single_room_status)!; return <tr key={person.id} onClick={() => navigate(`/athletes?athleteId=${person.id}`)} className={rowClass}><td className="p-3 font-bold">{person.firstname} {person.lastname}</td><td>{person.nationCode}</td><td>{person.discipline || person.disciplines?.join(', ') || '—'}</td><td><StatusChip tone={def.tone}>{def.label}</StatusChip></td><td><ActionCell/></td></tr>})}</tbody></table></div></DataPanel></ViewShell>;
}

function ConflictsView({ data }: { data: AnalyticsData }) {
  const navigate = useNavigate(); const conflicts = data.athletes.flatMap(athlete => { const base = { athlete, id: athlete.id }; if (!isAssigned(athlete)) return [{ ...base, priority: 1, title: 'Athlet ohne Zimmer', detail: 'Keine gültige Zimmerzuweisung vorhanden', route: `/assignments?athleteId=${athlete.id}` }]; if (athlete.hasPendingRoomlistReview) return [{ ...base, priority: 2, title: 'Zuweisung nach Import prüfen', detail: athlete.roomlistChangeSummary || 'Zimmerrelevante Daten wurden geändert', route: `/athletes?athleteId=${athlete.id}` }]; if (athlete.single_room_status === 'PENDING_APPROVAL') return [{ ...base, priority: 3, title: 'EZ-Entscheidung offen', detail: 'Einzelzimmerbedarf ist noch nicht entschieden', route: `/athletes?athleteId=${athlete.id}` }]; return []; }).sort((a, b) => a.priority - b.priority);
  return <ViewShell title="Wo besteht akuter Handlungsbedarf?" subtitle="Keine Statistik: eine priorisierte Arbeitsliste mit direktem Einstieg in die Lösung."><Kpis><ClickMetric onClick={() => navigate('/assignments?status=open')} label="Kritisch" value={conflicts.filter(c => c.priority === 1).length} helper="Zimmer fehlt" trend="sofort" tone="error"/><ClickMetric onClick={() => navigate('/athletes?review=pending')} label="Zu prüfen" value={conflicts.filter(c => c.priority === 2).length} helper="Importkonflikte" trend="heute" tone="warning"/><ClickMetric onClick={() => navigate('/athletes?singleRoomStatus=PENDING_APPROVAL')} label="Entscheidungen" value={conflicts.filter(c => c.priority === 3).length} helper="EZ offen" trend="bearbeiten" tone="warning"/><ClickMetric onClick={() => navigate('/assignments')} label="Gesamt" value={conflicts.length} helper="offene Aufgaben" trend={conflicts.length ? 'Handlungsbedarf' : 'alles stabil'} tone={conflicts.length ? 'error' : 'success'}/></Kpis><DataPanel title="Priorisierte Aufgaben" actions={<StatusChip tone={conflicts.length ? 'error' : 'success'}>{conflicts.length ? `${conflicts.length} offen` : 'Keine Konflikte'}</StatusChip>}><div className="divide-y divide-[var(--ops-divider)]">{conflicts.map(item => <button key={`${item.id}-${item.priority}`} onClick={() => navigate(item.route)} className="group flex w-full items-center gap-4 p-4 text-left hover:bg-[var(--ops-surface-elevated)]"><span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono font-bold', item.priority === 1 ? 'bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]' : 'bg-[var(--ops-tone-warning-surface)] text-[var(--ops-warning)]')}>{item.priority}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusChip tone={item.priority === 1 ? 'error' : 'warning'}>{item.title}</StatusChip><b>{item.athlete.firstname} {item.athlete.lastname}</b></div><p className="mt-1 text-xs text-[var(--ops-text-muted)]">{item.athlete.nationCode} · {item.athlete.discipline || item.athlete.disciplines?.join(', ') || 'Ohne Disziplin'} · {item.detail}</p></div><ActionCell/></button>)}{!conflicts.length && <div className="p-4"><EmptyState title="Keine operativen Konflikte" description="Aktuell besteht kein Handlungsbedarf." /></div>}</div></DataPanel></ViewShell>;
}

function Navigation({ active, data, onSelect }: { active: ViewKey; data: AnalyticsData; onSelect: (key: ViewKey) => void }) {
  const urgent = data.athletes.filter(a => !isAssigned(a) || a.hasPendingRoomlistReview || a.single_room_status === 'PENDING_APPROVAL').length;
  return <ContentCard surface="raised" className="overflow-hidden xl:w-[21rem] xl:shrink-0"><div className="border-b border-[var(--ops-divider)] p-4"><SectionHeader title="Entscheidungsbereiche" subtitle="Frage auswählen und direkt handeln" /></div><div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-1" role="tablist">{NAV.map(item => { const Icon = item.icon; return <button key={item.key} type="button" role="tab" aria-selected={active === item.key} onClick={() => onSelect(item.key)} className={clsx('group flex items-center gap-3 rounded-xl border p-3 text-left transition-colors', active === item.key ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)] shadow-[0_0_0_1px_var(--ops-primary)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)] hover:bg-[var(--ops-surface-elevated)]')}><span className="rounded-lg bg-[var(--ops-surface-elevated)] p-2 text-[var(--ops-primary)]"><Icon size={19}/></span><span className="min-w-0 flex-1"><b className="block text-sm">{item.label}</b><small className="block truncate text-[var(--ops-text-muted)]">{item.question}</small></span>{item.key === 'conflicts' && urgent > 0 ? <StatusChip tone="error">{urgent}</StatusChip> : <ArrowRight size={16} className="text-[var(--ops-primary)]"/>}</button>; })}</div></ContentCard>;
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
  return <PageLayout className="[--ops-background:#111d2e] [--ops-surface:#1a2a40] [--ops-surface-raised:#21334c] [--ops-surface-elevated:#2a3e59] [--ops-surface-overlay:#344b67] [--ops-border:#4b6380] [--ops-divider:#405773] [--ops-text-muted:#b7c4d4]"><PageHeader eyebrow="Operations Center · Unterkunftsplanung" title="Operations Cockpit" subtitle="Engpässe erkennen, Soll und Ist vergleichen und ohne Umweg in den richtigen Arbeitsbereich springen." meta={<><StatusChip tone={data.bookings.length ? 'primary' : data.athletes.length ? 'info' : 'neutral'}>{phase}</StatusChip><StatusChip tone="success">Live · 30 s</StatusChip><StatusChip tone="neutral"><CalendarRange className="mr-1 h-3 w-3"/>Aktualisiert {updated} Uhr</StatusChip></>}/>{error && <ErrorState title="Daten nicht verfügbar" description={error}/>}<div className="flex flex-col gap-4 xl:flex-row"><Navigation active={active} data={data} onSelect={setActive}/><main className="min-w-0 flex-1" role="tabpanel">{active === 'capacity' && <CapacityView data={data}/>} {active === 'hotels' && <HotelsView data={data}/>} {active === 'nations' && <NationsView data={data}/>} {active === 'assignments' && <AssignmentsView data={data}/>} {active === 'events' && <EventsView data={data}/>} {active === 'singleRooms' && <SingleRoomsView data={data}/>} {active === 'conflicts' && <ConflictsView data={data}/>}</main></div></PageLayout>;
}
