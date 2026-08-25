import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';

import { api } from '../services/api';
import { describeAuditEvent } from '../services/auditActivity';
import { athleteWorkCategory } from '../services/workflowStatus';
import { completedImportStatuses, type ImportSession } from '../data/importSessions';
import type { Athlete, AuditEvent, Event, Hotel, RoomBooking, RoomType } from '../types';
import { ContentCard, DataPanel, OperationalActionCard, SectionHeader, StatusChip } from '../design-system';

const number = (value: number) => new Intl.NumberFormat('de-DE').format(value);
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'ohne Termin';

function DashboardSkeleton() {
  return <div role="status" aria-label="Operatives Lagebild wird geladen" className="space-y-3 animate-pulse">
    <div className="h-20 rounded-[var(--ops-radius-xl)] bg-[var(--ops-surface-overlay)]" />
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[7.5rem] rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)]" />)}</div>
    <div className="grid gap-3 xl:grid-cols-2"><div className="h-56 rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)]" /><div className="h-56 rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)]" /></div>
  </div>;
}

export function Dashboard() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [assignments, setAssignments] = useState<RoomBooking[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [importSessions, setImportSessions] = useState<ImportSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Context below the primary queue may load progressively.
      void api.getAuditEvents(1).then(result => { if (!cancelled) setAuditEvents(result.items); }).catch(() => undefined);
      void api.getImportSessions().then(result => { if (!cancelled) setImportSessions(result); }).catch(() => undefined);
      try {
        const [people, hotelData, bookingData] = await Promise.all([api.getAthletes(), api.getHotels(), api.getRoomAssignments()]);
        if (!cancelled) { setAthletes(people); setHotels(hotelData); setAssignments(bookingData); }
      } catch (error) {
        console.error('Fehler beim Laden des operativen Lagebilds', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const today = new Date().toLocaleDateString('en-CA');
  const assignedIds = useMemo(() => new Set(assignments.flatMap(booking => booking.occupants.map(item => item.athlete.id))), [assignments]);
  const withoutRoom = athletes.filter(person => !person.assignment?.hasAssignment && !assignedIds.has(person.id));
  const assignmentReviews = athletes.filter(person => athleteWorkCategory(person) === 'review');
  const invalidPeople = athletes.filter(person => athleteWorkCategory(person) === 'conflict');
  const singleRoomDecisions = athletes.filter(person => person.single_room_status === 'PENDING_APPROVAL');
  const importDecisions = importSessions.flatMap(session => session.approvals.filter(approval => approval.decision === 'PENDING').map(approval => ({ session, approval })));
  const activeImports = importSessions.filter(session => !completedImportStatuses.has(session.status));

  const hotelRisks = useMemo(() => hotels.map(hotel => {
    const capacity = hotel.roomInventories?.reduce((sum, inventory) => sum + inventory.roomCount, 0) || 0;
    const occupied = assignments.filter(booking => booking.hotel?.id === hotel.id).length;
    const remaining = Math.max(capacity - occupied, 0);
    const utilization = capacity > 0 ? occupied / capacity * 100 : 0;
    return { hotel, capacity, remaining, utilization };
  }).filter(item => item.capacity > 0 && (item.utilization >= 90 || item.remaining <= 2)).sort((a, b) => a.remaining - b.remaining || b.utilization - a.utilization), [assignments, hotels]);

  const arrivals = athletes.filter(person => person.arrivalDate === today);
  const departures = athletes.filter(person => person.departureDate === today);
  const unpreparedArrivals = arrivals.filter(person => !person.assignment?.hasAssignment && !assignedIds.has(person.id));
  const hasImmediate = withoutRoom.length > 0 || invalidPeople.length > 0;
  const hasToday = assignmentReviews.length > 0 || singleRoomDecisions.length > 0 || importDecisions.length > 0;
  const stable = !hasImmediate && !hasToday && hotelRisks.length === 0 && unpreparedArrivals.length === 0;

  const priorityItems = [
    { key: 'rooms', title: 'Personen ohne Zimmer', count: withoutRoom.length, impact: 'Personen nicht untergebracht', context: 'Aktueller Dispositionsstand', action: 'Jetzt disponieren', href: '/assignments?workflow=open', priority: withoutRoom.length ? 'immediate' as const : 'done' as const, icon: <WarningAmberRoundedIcon /> },
    { key: 'reviews', title: 'Disposition prüfen', count: assignmentReviews.length, impact: 'Zuweisungen durch Import berührt', context: 'Seit der letzten Importänderung', action: 'Prüfqueue öffnen', href: '/assignments?workflow=review', priority: assignmentReviews.length ? 'today' as const : 'done' as const, icon: <SyncRoundedIcon /> },
    { key: 'single-room-decisions', title: 'Einzelzimmer entscheiden', count: singleRoomDecisions.length, impact: 'Anfragen warten auf Freigabe', context: 'Verantwortungsziel: Athleten', action: 'Anfragen klären', href: '/athletes?singleRoomStatus=PENDING_APPROVAL', priority: singleRoomDecisions.length ? 'today' as const : 'done' as const, icon: <ShieldRoundedIcon /> },
    { key: 'import-decisions', title: 'Import entscheiden', count: importDecisions.length, impact: 'Fachliche Freigaben offen', context: 'Verantwortungsziel: Import', action: 'Entscheidung öffnen', href: importDecisions[0] ? `/import?sessionId=${importDecisions[0].session.id}&decisionId=${importDecisions[0].approval.id}` : '/import', priority: importDecisions.length ? 'today' as const : 'done' as const, icon: <SyncRoundedIcon /> },
    { key: 'hotels', title: 'Kritische Hotels', count: hotelRisks.length, impact: hotelRisks[0] ? `${hotelRisks[0].hotel.name}: ${hotelRisks[0].remaining} Zimmer Reserve` : 'Keine akute Kapazitätsabweichung', context: 'Aktuell · Reserve ≤ 2 oder ≥ 90 %', action: 'Hotelfall öffnen', href: hotelRisks[0] ? `/hotels?hotelId=${hotelRisks[0].hotel.id}` : '/hotels', priority: hotelRisks.length ? 'watch' as const : 'done' as const, icon: <ApartmentRoundedIcon /> },
    { key: 'data', title: 'Blockierende Stammdaten', count: invalidPeople.length, impact: 'Personen fachlich unvollständig', context: 'Blockiert heutige Disposition', action: 'Fehler beheben', href: '/athletes?review=invalid', priority: invalidPeople.length ? 'immediate' as const : 'done' as const, icon: <ShieldRoundedIcon /> },
  ].sort((a, b) => ({ immediate: 0, today: 1, watch: 2, done: 3 })[a.priority] - ({ immediate: 0, today: 1, watch: 2, done: 3 })[b.priority]);

  const relevantChanges = auditEvents.slice(0, 4).map(event => {
    const description = describeAuditEvent(event, { athletes, hotels, roomTypes: [] as RoomType[], events: [] as Event[] });
    const impact = description.category === 'Import' ? 'Importfolge prüfen' : description.category === 'Disposition' ? 'Zuweisung prüfen' : description.category === 'Hotels' ? 'Kapazität prüfen' : 'Datensatz prüfen';
    return { id: event.id, title: description.activity, entity: description.entity, impact, href: description.href || '/audit' };
  });

  if (loading) return <DashboardSkeleton />;
  return <div className="space-y-3 rounded-[var(--ops-radius-xxl)] bg-[var(--ops-background)] p-3 text-[var(--ops-text)]">
    <ContentCard className="p-4" surface="raised" elevation="none">
      <SectionHeader title="Heutiges Lagebild" subtitle="Was jetzt entschieden werden muss – nach Auswirkung und Dringlichkeit." actions={<StatusChip tone={stable ? 'success' : hasImmediate ? 'error' : 'warning'}>{stable ? 'Operations stabil' : hasImmediate ? 'Sofortiger Handlungsbedarf' : 'Heute handeln'}</StatusChip>} />
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{priorityItems.map(item => <OperationalActionCard key={item.key} {...item} />)}</div>
    </ContentCard>

    <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
      <DataPanel title={<span className="inline-flex items-center gap-2"><CalendarMonthRoundedIcon fontSize="small" />Heute vorbereiten</span>} actions={<StatusChip tone={unpreparedArrivals.length ? 'error' : 'success'}>{unpreparedArrivals.length ? `${unpreparedArrivals.length} ungeklärt` : 'Vorbereitet'}</StatusChip>}>
        <div className="border-b border-[var(--ops-divider)] px-4 py-3 text-xs text-[var(--ops-text-muted)]">{number(arrivals.length)} Anreisen · {number(departures.length)} Abreisen heute. Nur ungeklärte Bewegungen werden als Aufgabe gezeigt.</div>
        {unpreparedArrivals.length ? <div className="divide-y divide-[var(--ops-divider)]">{unpreparedArrivals.slice(0, 4).map(person => <Link key={person.id} to={`/assignments?workflow=open&athleteId=${person.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-[var(--ops-surface-overlay)]"><LoginRoundedIcon className="text-[var(--ops-error)]" fontSize="small" /><div><strong>{person.firstname} {person.lastname}</strong><p className="text-xs text-[var(--ops-text-muted)]">{person.nationCode} · Anreise {date(person.arrivalDate)} · keine Unterkunft</p></div><span className="text-xs font-bold text-[var(--ops-primary)]">Disponieren →</span></Link>)}</div> : <div className="flex items-center gap-3 px-4 py-6 text-sm text-[var(--ops-text-muted)]"><CheckRoundedIcon className="text-[var(--ops-success)]" />Alle heutigen Anreisen besitzen eine Unterkunft.</div>}
        <div className="border-t border-[var(--ops-divider)] px-4 py-3 text-right"><Link to={`/athletes?movement=arrival&date=${today}`} className="text-sm font-bold text-[var(--ops-primary)]">Alle heutigen Bewegungen <OpenInNewRoundedIcon fontSize="inherit" /></Link></div>
      </DataPanel>

      <DataPanel title={<span className="inline-flex items-center gap-2"><SyncRoundedIcon fontSize="small" />Relevante Änderungen</span>} actions={<Link to="/audit" className="text-sm font-bold text-[var(--ops-primary)]">Nachweis öffnen</Link>}>
        {relevantChanges.length ? <div className="divide-y divide-[var(--ops-divider)]">{relevantChanges.map(change => <Link key={change.id} to={change.href} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 hover:bg-[var(--ops-surface-overlay)]"><div className="min-w-0"><strong className="block truncate text-sm">{change.title}</strong><span className="block truncate text-xs text-[var(--ops-text-muted)]">Betroffen: {change.entity}</span></div><StatusChip tone="warning">{change.impact}</StatusChip></Link>)}</div> : <div className="px-4 py-6 text-sm text-[var(--ops-text-muted)]">Keine relevanten Änderungen verfügbar.</div>}
      </DataPanel>
    </div>

    {activeImports.length > 0 && <div className="px-1 text-xs text-[var(--ops-text-muted)]">{activeImports.length} Importvorgänge laufen. Sie erscheinen oben nur, wenn daraus eine fachliche Entscheidung oder Dispositionsprüfung entsteht.</div>}
  </div>;
}
