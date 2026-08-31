import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, BedDouble, Building2, CalendarDays, CheckCircle2,
  LogIn, LogOut, RefreshCw, Upload, Users,
} from 'lucide-react';

import { api } from '../services/api';
import { athleteWorkCategory } from '../services/workflowStatus';
import type { ImportSession } from '../data/importSessions';
import type { Athlete, AuditEvent, Event, Hotel, RoomBooking, RoomType } from '../types';
import { ContentCard, DataPanel, MetricCard, SectionHeader, StatusChip } from '../design-system';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
type Variant = 'capacity' | 'operations' | 'executive';
type HotelRow = { hotel: Hotel; rooms: number; assigned: number; remaining: number; percent: number; tone: Tone };
type DashboardData = {
  roomsAvailable: number; roomsDemand: number; liveRooms: number; roomDelta: number; utilization: number;
  peopleWithoutRoom: number; pendingReviews: number; pendingSingleRooms: number; conflicts: number;
};

const number = (value: number) => new Intl.NumberFormat('de-DE').format(value);
const percent = (value: number) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)} %`;
const toneFor = (value: number): Tone => value >= 100 ? 'error' : value >= 90 ? 'warning' : 'success';

function ActionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex items-center gap-1 text-xs font-bold text-[var(--ops-primary)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]">{children}<ArrowRight size={13} /></Link>;
}

function VariantSelector({ value, onChange }: { value: Variant; onChange: (value: Variant) => void }) {
  const options: Array<{ value: Variant; label: string; question: string }> = [
    { value: 'capacity', label: 'Kapazität', question: 'Reicht die Kapazität?' },
    { value: 'operations', label: 'Operations', question: 'Was ist heute zu tun?' },
    { value: 'executive', label: 'Executive', question: 'Gesamtlage in 20 Sekunden' },
  ];
  return <fieldset aria-label="Dashboard-Variante" className="flex rounded-[var(--ops-radius-lg)] border border-[var(--ops-border)] bg-[var(--ops-surface-overlay)] p-0.5">
    <legend className="sr-only">Dashboard-Variante</legend>
    {options.map(option => <label key={option.value} title={option.question} className={`cursor-pointer rounded-[var(--ops-radius-md)] px-3 py-1.5 text-xs font-bold transition-colors ${value === option.value ? 'bg-[var(--ops-surface)] text-[var(--ops-primary)] shadow-sm' : 'text-[var(--ops-text-muted)] hover:text-[var(--ops-text)]'}`}>
      <input className="sr-only" type="radio" name="dashboard-variant" value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />{option.label}
    </label>)}
  </fieldset>;
}

function PlanningLive({ data }: { data: DashboardData }) {
  const max = Math.max(data.roomsAvailable, data.roomsDemand, data.liveRooms, 1);
  const rows = [
    { label: 'Kapazität', value: data.roomsAvailable, color: 'bg-[var(--ops-info)]' },
    { label: 'Planung', value: data.roomsDemand, color: 'bg-[var(--ops-warning)]' },
    { label: 'Live disponiert', value: data.liveRooms, color: 'bg-[var(--ops-primary)]' },
  ];
  return <DataPanel title="Planung und Live" actions={<ActionLink to="/lists?entity=contingents">Kontingente prüfen</ActionLink>}>
    <div className="space-y-3 p-3">
      {rows.map(row => <div key={row.label} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3 text-xs"><span className="font-semibold">{row.label}</span><div className="h-2.5 overflow-hidden rounded-full bg-[var(--ops-surface-overlay)]"><div className={`h-full rounded-full ${row.color}`} style={{ width: `${(row.value / max) * 100}%` }} /></div><b className="text-right tabular-nums">{number(row.value)}</b></div>)}
      <div className="flex items-center justify-between border-t border-[var(--ops-divider)] pt-2 text-xs"><span className="text-[var(--ops-text-muted)]">Reserve gegenüber Planung</span><StatusChip tone={data.roomDelta < 0 ? 'error' : data.roomDelta < data.roomsAvailable * .1 ? 'warning' : 'success'}>{data.roomDelta >= 0 ? '+' : ''}{number(data.roomDelta)} Zimmer</StatusChip></div>
    </div>
  </DataPanel>;
}

function HotelRisks({ hotels, limit = 5 }: { hotels: HotelRow[]; limit?: number }) {
  const visible = hotels.slice(0, limit);
  return <DataPanel title="Kritische Hotels" actions={<ActionLink to="/hotels?capacity=critical">Gefilterte Hotels</ActionLink>}>
    <div className="divide-y divide-[var(--ops-divider)]">
      {visible.length ? visible.map(item => <Link key={item.hotel.id} to={`/hotels?hotelId=${item.hotel.id}&capacity=critical`} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-3 px-3 py-2 text-xs hover:bg-[var(--ops-surface-overlay)]">
        <div className="min-w-0"><b className="block truncate">{item.hotel.name}</b><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--ops-surface-overlay)]"><div className={`h-full ${item.tone === 'error' ? 'bg-[var(--ops-error)]' : 'bg-[var(--ops-warning)]'}`} style={{ width: `${Math.min(item.percent, 100)}%` }} /></div></div>
        <span className="text-right tabular-nums text-[var(--ops-text-muted)]">{item.remaining} frei</span><StatusChip tone={item.tone}>{percent(item.percent)}</StatusChip>
      </Link>) : <div className="flex items-center gap-2 p-4 text-sm text-[var(--ops-success)]"><CheckCircle2 size={17} />Keine kritischen Hotelreserven</div>}
    </div>
  </DataPanel>;
}

function DecisionQueue({ data }: { data: DashboardData }) {
  const items = [
    { label: 'Personen ohne Zimmer', value: data.peopleWithoutRoom, href: '/assignments?workflow=open', tone: data.peopleWithoutRoom ? 'error' : 'success' as Tone },
    { label: 'Disposition prüfen', value: data.pendingReviews, href: '/assignments?workflow=review', tone: data.pendingReviews ? 'warning' : 'success' as Tone },
    { label: 'Einzelzimmer entscheiden', value: data.pendingSingleRooms, href: '/athletes?singleRoomStatus=PENDING_APPROVAL', tone: data.pendingSingleRooms ? 'warning' : 'success' as Tone },
    { label: 'Importkonflikte klären', value: data.conflicts, href: '/import?status=conflict', tone: data.conflicts ? 'error' : 'success' as Tone },
  ];
  return <DataPanel title="Entscheidungen" actions={<StatusChip tone={items.some(item => item.value) ? 'warning' : 'success'}>{items.reduce((sum, item) => sum + item.value, 0)} offen</StatusChip>}>
    <div className="grid grid-cols-1 divide-y divide-[var(--ops-divider)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
      {items.map(item => <Link key={item.label} to={item.href} className="flex items-center justify-between gap-3 p-3 hover:bg-[var(--ops-surface-overlay)]"><div><div className="text-[10px] font-bold uppercase tracking-wide text-[var(--ops-text-subtle)]">{item.label}</div><b className="text-xl tabular-nums">{number(item.value)}</b></div><StatusChip tone={item.tone}>{item.value ? 'Bearbeiten' : 'Erledigt'}</StatusChip></Link>)}
    </div>
  </DataPanel>;
}

function CapacityDashboard({ data, hotels, events }: { data: DashboardData; hotels: HotelRow[]; events: Event[] }) {
  const eventRows = [...events].sort((a, b) => (b.roomDemands?.reduce((s, d) => s + d.roomCount, 0) || 0) - (a.roomDemands?.reduce((s, d) => s + d.roomCount, 0) || 0)).slice(0, 5);
  return <div className="space-y-3">
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard compact label="Verbleibende Reserve" value={number(data.roomDelta)} helper="Zimmer ggü. Planung" tone={data.roomDelta < 0 ? 'error' : 'success'} icon={<BedDouble />} href="/lists?entity=contingents" />
      <MetricCard compact label="Geplanter Bedarf" value={number(data.roomsDemand)} helper={`${percent(data.utilization)} der Kapazität`} tone={toneFor(data.utilization)} icon={<CalendarDays />} href="/events" />
      <MetricCard compact label="Live disponiert" value={number(data.liveRooms)} helper={`${number(Math.max(data.roomsDemand - data.liveRooms, 0))} bis Planung`} tone="primary" icon={<Users />} href="/assignments" />
      <MetricCard compact label="Kritische Hotels" value={number(hotels.length)} helper="Reserve ≤ 2 oder ≥ 90 %" tone={hotels.length ? 'warning' : 'success'} icon={<Building2 />} href="/hotels?capacity=critical" />
    </div>
    <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]"><PlanningLive data={data} /><HotelRisks hotels={hotels} /></div>
    <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
      <DataPanel title="Eventbedarf" actions={<ActionLink to="/events">Bedarf pflegen</ActionLink>}><div className="divide-y divide-[var(--ops-divider)]">{eventRows.map(event => { const rooms = event.roomDemands?.reduce((s, d) => s + d.roomCount, 0) || 0; return <Link to={`/events?eventId=${event.id}`} key={event.id} className="grid grid-cols-[1fr_7rem_6rem] px-3 py-2 text-xs hover:bg-[var(--ops-surface-overlay)]"><b>{event.discipline}</b><span className="text-[var(--ops-text-muted)]">{event.startDate}</span><b className="text-right tabular-nums">{rooms} Zimmer</b></Link>; })}</div></DataPanel>
      <DecisionQueue data={data} />
    </div>
  </div>;
}

function OperationsDashboard({ data, hotels, athletes, sessions }: { data: DashboardData; hotels: HotelRow[]; athletes: Athlete[]; sessions: ImportSession[] }) {
  const today = new Date().toLocaleDateString('en-CA');
  const arrivals = athletes.filter(a => a.arrivalDate === today).length;
  const departures = athletes.filter(a => a.departureDate === today).length;
  const roomChanges = athletes.filter(a => a.roomlistChangedAt?.startsWith(today)).length;
  const importsOpen = sessions.filter(s => !['IMPORTED', 'REPLACED', 'ARCHIVED'].includes(s.status)).length;
  const items = [
    { label: 'Anreisen heute', value: arrivals, helper: 'Personenliste vorbereiten', href: '/lists?entity=persons&movement=arrival&period=today', icon: <LogIn />, tone: arrivals ? 'info' : 'neutral' as Tone },
    { label: 'Abreisen heute', value: departures, helper: 'Abreisen abstimmen', href: '/lists?entity=persons&movement=departure&period=today', icon: <LogOut />, tone: departures ? 'info' : 'neutral' as Tone },
    { label: 'Zimmeränderungen', value: roomChanges, helper: 'heute importiert', href: '/assignments?workflow=review', icon: <RefreshCw />, tone: roomChanges ? 'warning' : 'success' as Tone },
    { label: 'Offene Imports', value: importsOpen, helper: 'Session fortsetzen', href: '/import?status=open', icon: <Upload />, tone: importsOpen ? 'warning' : 'success' as Tone },
  ];
  return <div className="space-y-3">
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{items.map(item => <MetricCard key={item.label} compact label={item.label} value={number(item.value)} helper={item.helper} tone={item.tone} icon={item.icon} href={item.href} />)}</div>
    <DecisionQueue data={data} />
    <div className="grid gap-3 xl:grid-cols-[1fr_.72fr]">
      <HotelRisks hotels={hotels} limit={6} />
      <DataPanel title="Kapazität im Blick" actions={<ActionLink to="/?dashboard=capacity">Kapazitätsansicht</ActionLink>}><div className="p-3"><PlanningLive data={data} /></div></DataPanel>
    </div>
  </div>;
}

function ExecutiveDashboard({ data, hotels, auditEvents }: { data: DashboardData; hotels: HotelRow[]; auditEvents: AuditEvent[] }) {
  return <div className="space-y-3">
    <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
      <MetricCard compact label="Reserve" value={number(data.roomDelta)} helper="Zimmer" tone={data.roomDelta < 0 ? 'error' : 'success'} href="/lists?entity=contingents" />
      <MetricCard compact label="Auslastung Plan" value={percent(data.utilization)} helper="Kapazität" tone={toneFor(data.utilization)} href="/lists?entity=contingents" />
      <MetricCard compact label="Live disponiert" value={number(data.liveRooms)} helper="Zimmer" tone="primary" href="/assignments" />
      <MetricCard compact label="Ohne Zimmer" value={number(data.peopleWithoutRoom)} helper="Personen" tone={data.peopleWithoutRoom ? 'error' : 'success'} href="/assignments?workflow=open" />
      <MetricCard compact label="Reviews" value={number(data.pendingReviews)} helper="Disposition" tone={data.pendingReviews ? 'warning' : 'success'} href="/assignments?workflow=review" />
      <MetricCard compact label="Kritische Hotels" value={number(hotels.length)} helper="Reserve" tone={hotels.length ? 'warning' : 'success'} href="/hotels?capacity=critical" />
    </div>
    <div className="grid gap-3 xl:grid-cols-[1fr_1fr_.72fr]"><PlanningLive data={data} /><HotelRisks hotels={hotels} limit={4} />
      <DataPanel title="Letzte Änderungen" actions={<ActionLink to="/audit">Aktivitäten</ActionLink>}><div className="divide-y divide-[var(--ops-divider)]">{auditEvents.slice(0, 5).map(event => <Link key={event.id} to="/audit" className="block px-3 py-2 text-xs hover:bg-[var(--ops-surface-overlay)]"><b className="block truncate">{event.activity || event.action}</b><span className="text-[var(--ops-text-muted)]">{event.displayName} · {new Date(event.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></Link>)}{!auditEvents.length && <p className="p-4 text-xs text-[var(--ops-text-muted)]">Keine aktuellen Änderungen geladen.</p>}</div></DataPanel>
    </div>
    <DecisionQueue data={data} />
  </div>;
}

function DashboardSkeleton() { return <div role="status" className="space-y-3 animate-pulse"><div className="h-14 rounded-xl bg-[var(--ops-surface-overlay)]"/><div className="grid grid-cols-4 gap-2">{[1,2,3,4].map(i=><div key={i} className="h-24 rounded-xl bg-[var(--ops-surface-overlay)]"/>)}</div><div className="h-64 rounded-xl bg-[var(--ops-surface-overlay)]"/><span className="sr-only">Dashboard wird geladen</span></div>; }

export function Dashboard() {
  const initial = new URLSearchParams(window.location.search).get('dashboard') as Variant | null;
  const [variant, setVariant] = useState<Variant>(['capacity', 'operations', 'executive'].includes(initial || '') ? initial! : 'operations');
  const [athletes, setAthletes] = useState<Athlete[]>([]); const [hotels, setHotels] = useState<Hotel[]>([]);
  const [events, setEvents] = useState<Event[]>([]); const [assignments, setAssignments] = useState<RoomBooking[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]); const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; Promise.all([api.getAthletes(), api.getHotels(), api.getEvents(), api.getRoomAssignments(), api.getRoomTypes()]).then(([a,h,e,b,r]) => { if(active){setAthletes(a);setHotels(h);setEvents(e);setAssignments(b);setRoomTypes(r);setLoading(false);}}).catch(() => { if(active)setLoading(false); }); api.getImportSessions().then(v=>active&&setSessions(v)).catch(()=>undefined); api.getAuditEvents(1).then(v=>active&&setAuditEvents(v.items)).catch(()=>undefined); return()=>{active=false}; }, []);
  const data = useMemo<DashboardData>(() => {
    const roomsAvailable = hotels.reduce((sum,h)=>sum+(h.roomInventories?.reduce((s,i)=>s+i.roomCount,0)||0),0);
    const roomsDemand = events.reduce((sum,e)=>sum+(e.roomDemands?.reduce((s,d)=>s+d.roomCount,0)||0),0);
    const assignedIds = new Set(assignments.flatMap(b=>b.occupants.map(o=>o.athlete.id)));
    const assignedPeople = athletes.filter(a=>a.assignment?.hasAssignment||assignedIds.has(a.id)).length;
    return { roomsAvailable, roomsDemand, liveRooms: assignments.length, roomDelta: roomsAvailable-roomsDemand, utilization: roomsAvailable ? roomsDemand/roomsAvailable*100 : 0, peopleWithoutRoom: Math.max(athletes.length-assignedPeople,0), pendingReviews: athletes.filter(a=>athleteWorkCategory(a)==='review').length, pendingSingleRooms: athletes.filter(a=>a.single_room_status==='PENDING_APPROVAL').length, conflicts: athletes.filter(a=>athleteWorkCategory(a)==='conflict').length };
  }, [assignments, athletes, events, hotels, roomTypes.length]);
  const criticalHotels = useMemo<HotelRow[]>(()=>hotels.map(h=>{const rooms=h.roomInventories?.reduce((s,i)=>s+i.roomCount,0)||0;const assigned=assignments.filter(a=>a.hotel?.id===h.id).length;const p=rooms?assigned/rooms*100:0;return {hotel:h,rooms,assigned,remaining:Math.max(rooms-assigned,0),percent:p,tone:toneFor(p)}}).filter(h=>h.rooms>0&&(h.percent>=90||h.remaining<=2)).sort((a,b)=>a.remaining-b.remaining),[assignments,hotels]);
  const switchVariant=(next:Variant)=>{setVariant(next);const url=new URL(window.location.href);url.searchParams.set('dashboard',next);window.history.replaceState({},'',url);};
  if(loading)return <DashboardSkeleton/>;
  const titles={capacity:['Kapazitätssteuerung','Reichen Kontingente und Reserven für den geplanten und live disponierten Bedarf?'],operations:['Operations heute','Was muss das Incoming Team heute wissen oder erledigen?'],executive:['Incoming Gesamtlage','Kapazität, Disposition und Risiken in 20 Sekunden erfassen.']} as const;
  return <div className="space-y-3 rounded-[var(--ops-radius-xxl)] bg-[var(--ops-background)] p-3 text-[var(--ops-text)]">
    <ContentCard className="p-3" surface="raised" elevation="none"><SectionHeader title={titles[variant][0]} subtitle={titles[variant][1]} actions={<div className="flex items-center gap-3"><StatusChip tone={data.conflicts||data.peopleWithoutRoom||criticalHotels.length?'warning':'success'}>{data.conflicts||data.peopleWithoutRoom||criticalHotels.length?'Handlungsbedarf':'Stabil'}</StatusChip><VariantSelector value={variant} onChange={switchVariant}/></div>}/></ContentCard>
    {variant==='capacity'&&<CapacityDashboard data={data} hotels={criticalHotels} events={events}/>} {variant==='operations'&&<OperationsDashboard data={data} hotels={criticalHotels} athletes={athletes} sessions={sessions}/>} {variant==='executive'&&<ExecutiveDashboard data={data} hotels={criticalHotels} auditEvents={auditEvents}/>}
    <div className="flex justify-between px-1 text-[10px] text-[var(--ops-text-subtle)]"><span>Planung: manueller Eventbedarf · Live: aktuelle Disposition</span><span>Aktualisiert {new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span></div>
  </div>;
}
