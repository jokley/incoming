import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';

import { api } from '../services/api';
import { describeAuditEvent } from '../services/auditActivity';
import { athleteWorkCategory } from '../services/workflowStatus';
import type { ImportSession } from '../data/importSessions';
import type { Athlete, AuditEvent, Event, Hotel as HotelType, RoomBooking, RoomType } from '../types';
import type { OfficialQuotaUsage } from '../services/fisRules';
import { buildCapacityTimeline, buildHotelRiskRows, capacitySummary, type DemandSource } from '../services/planningCalculations';
import {
  ContentCard,
  DataPanel,
  MetricCard,
  SectionHeader,
  StatusChip,
} from '../design-system';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

type AlertItem = {
  id: string;
  title: string;
  detail: string;
  tone: Tone;
  status: string;
  href: string;
};

const formatNumber = (value: number) => new Intl.NumberFormat('de-DE').format(value);
const formatPercent = (value: number) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)}%`;
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'offen';
const dayKey = (value?: string | null) => value?.slice(0, 10) || '';
const signed = (value: number) => `${value > 0 ? '+' : ''}${formatNumber(value)}`;

const getStatusTone = (percent: number): Tone => {
  if (percent >= 100) return 'error';
  if (percent >= 90) return 'warning';
  if (percent >= 70) return 'info';
  return 'success';
};


const toneAccent: Record<Tone, string> = {
  neutral: 'bg-[var(--ops-surface-overlay)] text-[var(--ops-text-muted)]',
  primary: 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]',
  success: 'bg-[var(--ops-tone-success-surface)] text-[var(--ops-success)]',
  warning: 'bg-[var(--ops-tone-warning-surface)] text-[var(--ops-warning)]',
  error: 'bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]',
  info: 'bg-[var(--ops-tone-info-surface)] text-[var(--ops-info)]',
};

function IconTile({ icon, tone = 'neutral' }: { icon: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ops-radius-lg)] ${toneAccent[tone]}`}>{icon}</span>;
}

function TextLink({ children, to }: { children: ReactNode; to: string }) {
  return <Link to={to} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ops-primary)] transition-colors hover:text-[var(--ops-primary-emphasis)] focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]">{children}<OpenInNewRoundedIcon fontSize="inherit" /></Link>;
}

function CapacityValue({ rooms, beds, signedValues = false }: { rooms: number; beds: number; signedValues?: boolean }) {
  const value = signedValues ? signed : formatNumber;
  return <span className="block space-y-1 text-left text-base leading-tight tracking-[-0.02em]"><span className="block">{value(rooms)} <small className="font-sans text-[11px] font-bold tracking-normal text-[var(--ops-text-muted)]">Zimmer</small></span><span className="block">{value(beds)} <small className="font-sans text-[11px] font-bold tracking-normal text-[var(--ops-text-muted)]">Betten</small></span></span>;
}

function DispositionValue({ rooms, roomTarget, beds, bedTarget }: { rooms: number; roomTarget: number; beds: number; bedTarget: number }) {
  const progress = (value: number, target: number) => target > 0 ? Math.min((value / target) * 100, 100) : 0;
  return <span className="block space-y-1 text-left text-sm leading-tight tracking-[-0.02em]">
    <span className="block"><b>{formatNumber(rooms)} / {formatNumber(roomTarget)}</b> Zimmer <small className="font-bold text-[var(--ops-text-muted)]">({formatPercent(progress(rooms, roomTarget))})</small></span>
    <span className="block"><b>{formatNumber(beds)} / {formatNumber(bedTarget)}</b> Betten <small className="font-bold text-[var(--ops-text-muted)]">({formatPercent(progress(beds, bedTarget))})</small></span>
  </span>;
}

function DashboardSkeleton() {
  return <div role="status" aria-label="Dashboard-Lagebild wird geladen" className="space-y-3 rounded-[var(--ops-radius-xxl)] bg-[var(--ops-background)] p-3 animate-pulse">
    <div className="h-8 w-72 rounded-[var(--ops-radius-lg)] bg-[var(--ops-surface-overlay)]" />
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[6.5rem] rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)]" />)}
    </div>
    <div className="h-24 rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)]" />
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
      <div className="h-44 rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)]" />
      <div className="h-44 rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)]" />
    </div>
    <span className="sr-only">Dashboard-Lagebild wird geladen…</span>
  </div>;
}

export function Dashboard() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [hotels, setHotels] = useState<HotelType[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [assignments, setAssignments] = useState<RoomBooking[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [importSessions, setImportSessions] = useState<ImportSession[]>([]);
  const [quotaUsage, setQuotaUsage] = useState<OfficialQuotaUsage[]>([]);
  const [demandSource, setDemandSource] = useState<DemandSource>('live');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);

      // Audit and import status enrich the lower dashboard only. They must not
      // delay the operational KPIs and primary actions above the fold.
      void api.getAuditEvents(1)
        .then(data => { if (!cancelled) setAuditEvents(data.items.slice(0, 3)); })
        .catch(() => undefined);
      void api.getImportSessions()
        .then(data => { if (!cancelled) setImportSessions(data); })
        .catch(() => undefined);
      void api.getOfficialQuotaUsage().then(data => { if (!cancelled) setQuotaUsage(data); }).catch(() => undefined);

      try {
        const [athletesData, hotelsData, roomTypesData, eventsData, assignmentsData] = await Promise.all([
          api.getAthletes(),
          api.getHotels(),
          api.getRoomTypes(),
          api.getEvents(),
          api.getRoomAssignments(),
        ]);
        if (cancelled) return;
        setAthletes(athletesData);
        setHotels(hotelsData);
        setRoomTypes(roomTypesData);
        setEvents(eventsData);
        setAssignments(assignmentsData);
      } catch (err) {
        console.error('Fehler beim Laden der Daten', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadData();
    return () => { cancelled = true; };
  }, []);

  const operations = useMemo(() => {
    const hotelDates = hotels.flatMap(hotel =>
      (hotel.roomInventories || []).flatMap(inventory => [
        new Date(inventory.availableFrom),
        new Date(inventory.availableUntil),
      ])
    );
    const eventDates = events.flatMap(event => [new Date(event.startDate), new Date(event.endDate)]);
    const allDates = [...hotelDates, ...eventDates].filter(date => !Number.isNaN(date.getTime()));

    let totalBedsAvailable = 0;
    let totalBedsDemand = 0;
    let totalRoomsAvailable = 0;
    let totalRoomsDemand = 0;

    if (allDates.length > 0) {
      const minDate = new Date(Math.min(...allDates.map(date => date.getTime())));
      const maxDate = new Date(Math.max(...allDates.map(date => date.getTime())));
      const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const dailyAvailableBeds = new Array(totalDays).fill(0);
      const dailyDemandBeds = new Array(totalDays).fill(0);

      hotels.forEach(hotel => {
        hotel.roomInventories?.forEach(inventory => {
          const start = new Date(inventory.availableFrom);
          const end = new Date(inventory.availableUntil);
          const beds = inventory.roomCount * inventory.roomType.maxPersons;

          for (let day = 0; day < totalDays; day++) {
            const currentDate = new Date(minDate);
            currentDate.setDate(currentDate.getDate() + day);
            if (currentDate >= start && currentDate <= end) dailyAvailableBeds[day] += beds;
          }
        });
      });

      events.forEach(event => {
        const start = new Date(event.startDate);
        const end = new Date(event.endDate);
        const eventBeds = event.roomDemands?.reduce((sum, demand) => sum + demand.roomCount * demand.roomType.maxPersons, 0) || 0;

        for (let day = 0; day < totalDays; day++) {
          const currentDate = new Date(minDate);
          currentDate.setDate(currentDate.getDate() + day);
          if (currentDate >= start && currentDate <= end) dailyDemandBeds[day] += eventBeds;
        }
      });

      totalBedsAvailable = Math.max(...dailyAvailableBeds, 0);
      totalBedsDemand = Math.max(...dailyDemandBeds, 0);
      totalRoomsAvailable = Math.max(...dailyAvailableBeds.map(beds => Math.ceil(beds / 1.5)), 0);
      totalRoomsDemand = Math.max(...dailyDemandBeds.map(beds => Math.ceil(beds / 1.5)), 0);
    }

    const officials = athletes.filter(athlete => {
      const role = `${athlete.function || ''} ${athlete.roomType || ''}`.toLowerCase();
      return role.includes('official') || role.includes('coach') || role.includes('staff') || role.includes('trainer');
    }).length;
    const athleteCount = Math.max(athletes.length - officials, 0);
    const assignedRooms = assignments.length;
    const assignedPersonIds = new Set(assignments.flatMap(assignment =>
      assignment.occupants.map(occupant => occupant.athlete.id)
    ));
    const assignedPeople = athletes.filter(athlete => athlete.assignment?.hasAssignment || assignedPersonIds.has(athlete.id)).length;
    const peopleWithoutRoom = Math.max(athletes.length - assignedPeople, 0);
    const pendingSingleRooms = athletes.filter(athlete => athlete.single_room_status === 'PENDING_APPROVAL').length;
    const pendingImportReviews = athletes.filter(athlete => athleteWorkCategory(athlete) === 'review').length;
    const invalidMasterData = athletes.filter(athlete => athleteWorkCategory(athlete) === 'conflict').length;
    const surchargeRisks = athletes.filter(athlete => athlete.lateCheckout || Boolean(athlete.specialMeal) || Boolean(athlete.additionalItems)).length;
    const utilization = totalRoomsAvailable > 0 ? (totalRoomsDemand / totalRoomsAvailable) * 100 : 0;
    const assignmentCoverage = totalRoomsDemand > 0 ? (assignedRooms / totalRoomsDemand) * 100 : 0;

    return {
      athletes: athleteCount,
      officials,
      hotels: hotels.length,
      roomTypes: roomTypes.length,
      roomsAvailable: totalRoomsAvailable,
      roomsDemand: totalRoomsDemand,
      bedsAvailable: totalBedsAvailable,
      bedsDemand: totalBedsDemand,
      assignedRooms,
      assignedPeople,
      peopleWithoutRoom,
      pendingSingleRooms,
      openAssignments: Math.max(totalRoomsDemand - assignedRooms, 0),
      roomDelta: totalRoomsAvailable - totalRoomsDemand,
      bedDelta: totalBedsAvailable - totalBedsDemand,
      utilization,
      assignmentCoverage,
      pendingImportReviews,
      invalidMasterData,
      surchargeRisks,
    };
  }, [assignments.length, athletes, events, hotels, roomTypes.length]);

  const capacityTimeline = useMemo(() => buildCapacityTimeline({ athletes, hotels, events, bookings: assignments }), [assignments, athletes, events, hotels]);
  const capacity = useMemo(() => {
    const { peak, critical, firstRisk } = capacitySummary(capacityTimeline, demandSource);
    const demandRooms = peak?.[demandSource === 'event' ? 'plannedRooms' : 'demandRooms'] || 0;
    const demandBeds = peak?.[demandSource === 'event' ? 'plannedBeds' : 'demandBeds'] || 0;
    return { date: peak?.date, criticalDate: critical?.date, firstRiskDate: firstRisk?.date, rooms: peak?.roomSupply || 0, beds: peak?.bedSupply || 0, demandRooms, demandBeds, assignedRooms: peak?.assignedRooms || 0, assignedBeds: peak?.assignedBeds || 0, reserveRooms: peak?.[demandSource === 'event' ? 'eventRoomReserve' : 'liveRoomReserve'] || 0, reserveBeds: peak?.[demandSource === 'event' ? 'eventBedReserve' : 'liveBedReserve'] || 0 };
  }, [capacityTimeline, demandSource]);

  const roomChanges = athletes.filter(athlete => athlete.importChangeTypes?.some(type => type === 'ROOMMATE_CHANGED' || type === 'HOTEL_CHANGED' || type === 'ROOM_DEMAND_CHANGED')).length;
  const importChanges = athletes.filter(athlete => Boolean(athlete.importChangeTypes?.length)).length;
  const exceededQuotas = quotaUsage.filter(row => row.assignedOfficials > row.officialQuota || row.singleRoomsUsed > row.singleRoomsAllowed).length;

  const criticalHotels = useMemo(() => buildHotelRiskRows(hotels, assignments)
    .filter(item => Boolean(item.firstCritical))
    .map(item => {
      const day = item.worst!;
      const percent = day.rooms > 0 ? (day.occupied / day.rooms) * 100 : 100;
      const beds = item.hotel.roomInventories?.reduce((sum, inventory) => sum + inventory.roomCount * inventory.roomType.maxPersons, 0) || 0;
      return { hotel: item.hotel, rooms: day.rooms, remaining: Math.max(day.reserve, 0), availableBeds: Math.max(beds - day.occupied, 0), percent, tone: getStatusTone(percent) };
    }).sort((a, b) => a.remaining - b.remaining || b.percent - a.percent), [assignments, hotels]);
  const reserveTone: Tone = capacity.reserveRooms < 0 || capacity.reserveBeds < 0 ? 'error' : capacity.reserveRooms <= 2 || capacity.reserveBeds <= 4 ? 'warning' : 'success';
  const reserveStatus = reserveTone === 'error' ? 'Unterdeckung' : reserveTone === 'warning' ? 'Reserve niedrig' : 'Kapazität gedeckt';
  // Kontingentquoten sind Planungshinweise, keine operativen Importkonflikte.
  const operationalConflicts = operations.invalidMasterData;

  const criticalAlerts = useMemo<AlertItem[]>(() => {
    const overbooked = criticalHotels.filter(item => item.percent >= 100).length;
    return [
      { id: 'open-assignments', title: 'Personen ohne Zimmer', detail: `${operations.peopleWithoutRoom} Personen sind noch keiner Unterkunft zugewiesen.`, tone: operations.peopleWithoutRoom ? 'error' : 'success', status: operations.peopleWithoutRoom ? 'Sofort' : 'Erledigt', href: '/lists?entity=persons&hint=without-room' },
      { id: 'single-rooms', title: 'Einzelzimmer entscheiden', detail: `${operations.pendingSingleRooms} Einzelzimmer-Anfragen warten auf eine Entscheidung.`, tone: operations.pendingSingleRooms ? 'warning' : 'success', status: operations.pendingSingleRooms ? 'Heute' : 'Erledigt', href: '/lists?entity=persons&hint=single-room' },
      { id: 'overbooked', title: 'Hotel überbucht', detail: `${overbooked} Hotels haben keine verbleibende Zimmerreserve.`, tone: overbooked ? 'error' : 'success', status: overbooked ? 'Sofort' : 'Erledigt', href: '/hotels?filter=critical' },
      { id: 'import-conflicts', title: 'Importkonflikte', detail: `${operationalConflicts} Datensätze blockieren oder gefährden die Disposition.`, tone: operationalConflicts ? 'error' : 'success', status: operationalConflicts ? 'Prüfen' : 'Erledigt', href: '/import' },
      { id: 'quota-exceeded', title: 'Kontingent überschritten', detail: `${exceededQuotas} Kontingentgruppen liegen über der zulässigen Belegung.`, tone: exceededQuotas ? 'warning' : 'success', status: exceededQuotas ? 'Entscheiden' : 'Erledigt', href: '/assignments?view=quotas' },
    ].filter(alert => alert.tone !== 'success') as AlertItem[];
  }, [criticalHotels, exceededQuotas, operationalConflicts, operations.pendingSingleRooms, operations.peopleWithoutRoom]);

  const today = new Date().toLocaleDateString('en-CA');
  const upcomingMovements = useMemo(() => athletes.flatMap(athlete => [
    athlete.arrivalDate && athlete.arrivalDate >= today ? { id: `arrival-${athlete.id}`, athlete, date: athlete.arrivalDate, kind: 'Anreise' as const } : null,
    athlete.departureDate && athlete.departureDate >= today ? { id: `departure-${athlete.id}`, athlete, date: athlete.departureDate, kind: 'Abreise' as const } : null,
  ]).filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3), [athletes, today]);

  const importStatuses = [
    { id: 'sessions', title: 'Importsessions', count: importSessions.length, helper: `${importSessions.filter(session => !['IMPORTED', 'REPLACED', 'ARCHIVED'].includes(session.status)).length} in Bearbeitung`, tone: importSessions.length > 0 ? 'success' : 'warning' as Tone, href: importSessions[0] ? `/import?sessionId=${importSessions[0].id}` : '/import' },
    { id: 'reviews', title: 'Disposition prüfen', count: operations.pendingImportReviews, helper: 'geänderte bestehende Zuweisungen', tone: operations.pendingImportReviews > 0 ? 'warning' : 'success' as Tone, href: '/lists?entity=persons&status=review' },
    { id: 'validation', title: 'Importprüfungen', count: operationalConflicts, helper: 'Referenzen und Konflikte im Import', tone: operationalConflicts > 0 ? 'error' : 'success' as Tone, href: '/import' },
  ];

  const activityItems = auditEvents.length > 0 ? auditEvents.map(event => {
    const description = describeAuditEvent(event, { athletes, hotels, roomTypes, events });
    return {
      id: event.id,
      title: description.activity,
      meta: `${description.category} · ${description.entity}`,
      time: new Date(event.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      tone: 'info' as Tone,
      href: description.href || '/audit',
    };
  }) : [
    { id: 'assignments', title: `${formatNumber(operations.assignedPeople)} Personen disponiert`, meta: `${formatNumber(operations.peopleWithoutRoom)} Personen ohne Zimmer`, time: 'Live', tone: operations.peopleWithoutRoom > 0 ? 'warning' as Tone : 'success' as Tone, href: '/assignments' },
    { id: 'imports', title: `${formatNumber(operationalConflicts)} operative Konflikte`, meta: 'Import und Kontingente', time: 'Live', tone: operationalConflicts > 0 ? 'warning' as Tone : 'success' as Tone, href: '/import' },
  ];

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-1.5 rounded-[var(--ops-radius-xxl)] bg-[var(--ops-background)] p-3 text-[var(--ops-text)]">
      <ContentCard className="p-2.5" surface="raised" elevation="none">
        <SectionHeader title="Bedarf & Kontingente" subtitle="Reicht das Kontingent für den aktuellen Bedarf?" actions={<div className="flex items-center gap-3"><div className="flex rounded-lg bg-[var(--ops-surface-elevated)] p-1" aria-label="Bedarfsquelle">{(['event', 'live'] as const).map(source => <button type="button" key={source} aria-pressed={demandSource === source} onClick={() => setDemandSource(source)} className={`rounded-md px-3 py-1.5 text-xs font-bold ${demandSource === source ? 'bg-[var(--ops-primary)] text-white' : 'text-[var(--ops-text-muted)]'}`}>{source === 'event' ? 'Event' : 'Live'}</button>)}</div><StatusChip tone={reserveTone}>{reserveStatus}</StatusChip></div>} />
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard compact label="Kontingent" value={<CapacityValue rooms={capacity.rooms} beds={capacity.beds}/>} helper="maximal im Zeitraum" tone="primary" icon={<ApartmentRoundedIcon />} href={`/analytics?view=capacity&source=${demandSource}`} />
          <MetricCard compact label="Bedarf" value={<CapacityValue rooms={capacity.demandRooms} beds={capacity.demandBeds}/>} helper={`${demandSource === 'event' ? 'Event' : 'Live'} · Peak`} tone="info" icon={<TimelineRoundedIcon />} href={`/analytics?view=capacity&source=${demandSource}`} />
          <MetricCard compact label="Disponiert" value={<DispositionValue rooms={capacity.assignedRooms} roomTarget={capacity.demandRooms} beds={capacity.assignedBeds} bedTarget={capacity.demandBeds}/>} helper={`${demandSource === 'event' ? 'Event' : 'Live'} · am Peak`} tone="primary" icon={<CheckRoundedIcon />} href="/assignments" />
          <MetricCard compact label="Reserve" value={<CapacityValue rooms={capacity.reserveRooms} beds={capacity.reserveBeds} signedValues/>} helper={capacity.date ? formatDate(capacity.date) : 'Kein Zeitraum'} action={reserveTone === 'error' ? 'Sofort prüfen' : reserveTone === 'warning' ? 'Beobachten' : 'Gedeckt'} tone={reserveTone} icon={<ShieldRoundedIcon />} href={`/analytics?view=capacity&source=${demandSource}${capacity.date ? `&date=${capacity.date}` : ''}`} />
          <MetricCard compact label="Kritische Hotels" value={formatNumber(criticalHotels.length)} helper="nach verbleibender Reserve" action={criticalHotels.length > 0 ? 'Prüfen' : 'Stabil'} tone={criticalHotels.length > 0 ? 'warning' : 'success'} icon={<WarningAmberRoundedIcon />} href="/hotels?filter=critical" />
        </div>
      </ContentCard>

      <ContentCard className="p-2.5" surface="raised" elevation="none">
        <SectionHeader title="Disposition" subtitle="Wie weit ist die Unterkunfts-Disposition?" actions={<TextLink to="/assignments">Zuweisungen öffnen</TextLink>} />
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard compact label="Athleten gesamt" value={formatNumber(athletes.length)} helper="Personen" tone="neutral" href="/lists?entity=persons" />
          <MetricCard compact label="Disponiert" value={formatNumber(operations.assignedPeople)} helper="Personen mit Zimmer" action={operations.peopleWithoutRoom ? 'In Arbeit' : 'Vollständig'} tone={operations.peopleWithoutRoom ? 'primary' : 'success'} href="/lists?entity=persons&assignedOnly=true" />
          <MetricCard compact label="Ohne Zimmer" value={formatNumber(operations.peopleWithoutRoom)} helper="offene Personen" action={operations.peopleWithoutRoom ? 'Sofort' : 'Erledigt'} tone={operations.peopleWithoutRoom ? 'error' : 'success'} href="/lists?entity=persons&hint=without-room" />
          <MetricCard compact label="Offene Einzelzimmer" value={formatNumber(operations.pendingSingleRooms)} helper="Entscheidung ausstehend" action={operations.pendingSingleRooms ? 'Heute' : 'Erledigt'} tone={operations.pendingSingleRooms ? 'warning' : 'success'} href="/lists?entity=persons&hint=single-room" />
          <MetricCard compact label="Zimmerwechsel" value={formatNumber(roomChanges)} helper="seit letztem Import" action={roomChanges ? 'Prüfen' : 'Keine'} tone={roomChanges ? 'warning' : 'success'} href="/lists?entity=persons&hint=room-change" />
          <MetricCard compact label="Importänderungen" value={formatNumber(importChanges)} helper="seit letztem Import" action={importChanges ? 'Prüfen' : 'Keine'} tone={importChanges ? 'info' : 'success'} href="/lists?entity=persons&hint=import" />
        </div>
      </ContentCard>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[1fr_1.02fr]">
        <DataPanel title={<span className="inline-flex items-center gap-2"><WarningAmberRoundedIcon fontSize="small" />Entscheidungen</span>}>
          <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-2 xl:grid-cols-3">
            {criticalAlerts.length === 0 ? <ContentCard className="col-span-full flex items-center justify-center gap-3 p-4" surface="elevated" elevation="none"><IconTile tone="success" icon={<CheckRoundedIcon />} /><strong className="text-sm text-[var(--ops-success)]">Keine offenen Entscheidungen</strong></ContentCard> : criticalAlerts.map(alert => <ContentCard key={alert.id} className="p-3" surface="elevated" elevation="none"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><IconTile tone={alert.tone} icon={alert.tone === 'warning' ? <ShieldRoundedIcon /> : <WarningAmberRoundedIcon />} /><h3 className="text-sm font-extrabold uppercase text-[var(--ops-text)]">{alert.title}</h3></div><StatusChip tone={alert.tone}>{alert.status}</StatusChip></div><p className="mt-2 text-xs leading-5 text-[var(--ops-text-muted)]">{alert.detail}</p><div className="mt-2"><TextLink to={alert.href}>Details anzeigen</TextLink></div></ContentCard>)}
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><CalendarMonthRoundedIcon fontSize="small" />Nächste Bewegungen</span>} actions={<TextLink to="/lists?entity=persons&movement=arrival&period=week">Anreisen dieser Woche</TextLink>}>
          <div className="divide-y divide-[var(--ops-divider)] p-3">
            {upcomingMovements.length > 0 ? upcomingMovements.map(item => <Link to={`/athletes?athleteId=${item.athlete.id}`} key={item.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-[var(--ops-radius-lg)] px-3 py-2 text-xs transition-colors hover:bg-[var(--ops-surface-overlay)]"><IconTile tone={item.kind === 'Anreise' ? 'info' : 'neutral'} icon={item.kind === 'Anreise' ? <LoginRoundedIcon fontSize="small" /> : <LogoutRoundedIcon fontSize="small" />} /><strong>{item.athlete.firstname} {item.athlete.lastname}</strong><span className="text-[var(--ops-text-muted)]">{item.athlete.nationCode}</span><span className="text-[var(--ops-text-muted)]">{item.kind} · {formatDate(item.date)}</span></Link>) : <p className="px-3 py-6 text-center text-sm text-[var(--ops-text-muted)]">Keine bevorstehenden An- oder Abreisen erfasst.</p>}
          </div>
        </DataPanel>
      </div>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[1.15fr_0.55fr_0.8fr]">
        <DataPanel title={<span className="inline-flex items-center gap-2"><ApartmentRoundedIcon fontSize="small" />Kritische Hotels</span>} actions={<StatusChip tone="info">Nach Priorität</StatusChip>} className="xl:col-span-1">
          <div className="space-y-2 p-3">
            {criticalHotels.slice(0, 4).map(item => <Link to={`/hotels?hotelId=${item.hotel.id}`} key={item.hotel.id} className="grid gap-3 rounded-[var(--ops-radius-lg)] p-2 transition-colors hover:bg-[var(--ops-surface-overlay)] md:grid-cols-[1fr_9rem_10rem]"><div><div className="mb-2 flex items-center justify-between"><strong>{item.hotel.name}</strong><StatusChip tone={item.tone}>{formatPercent(item.percent)}</StatusChip></div><div className="h-2 overflow-hidden rounded-full bg-[var(--ops-surface-overlay)]"><div className="h-full rounded-full bg-[var(--ops-primary)]" style={{ width: `${Math.min(item.percent, 100)}%` }} /></div></div><div className="text-sm text-[var(--ops-text-muted)]">{item.tone === 'error' ? 'Ausgelastet' : 'Verfügbar'}<br />{item.remaining} Zimmer frei</div><div className="text-sm text-[var(--ops-text-muted)]">{item.availableBeds} Betten verfügbar<br />{item.rooms} Zimmer gesamt</div></Link>)}
            {criticalHotels.length === 0 && <p className="rounded-[var(--ops-radius-lg)] border border-dashed border-[var(--ops-border)] px-3 py-5 text-center text-sm text-[var(--ops-text-muted)]">Keine kritischen Hotels – alle Reserven sind stabil.</p>}
            <div className="pt-2 text-center"><TextLink to="/hotels?filter=critical">Kritische Hotels öffnen</TextLink></div>
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><CloudUploadRoundedIcon fontSize="small" />Importstatus</span>}>
          <div className="space-y-2 p-3">
            {importStatuses.map(status => <ContentCard key={status.id} interactive className="p-0" surface="elevated" elevation="none"><Link to={status.href} className="flex items-center justify-between gap-3 p-3 focus-visible:outline-none"><div className="flex min-w-0 items-center gap-3"><IconTile tone={status.tone} icon={status.tone === 'success' ? <CheckRoundedIcon /> : <SyncRoundedIcon />} /><div><strong className="text-sm">{status.title}</strong><div className="text-xs text-[var(--ops-text-muted)]">{status.helper}</div></div></div><StatusChip tone={status.tone}>{status.tone === 'success' ? 'Abgeschlossen' : status.count}</StatusChip></Link></ContentCard>)}
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><TimelineRoundedIcon fontSize="small" />Relevante Änderungen</span>} actions={<TextLink to="/audit">Alle Aktivitäten</TextLink>}>
          <ol className="relative m-3 space-y-3 border-l border-[var(--ops-divider)] pl-5">
            {activityItems.map((item) => <li key={item.id} className="relative"><span className="absolute -left-[1.58rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--ops-primary)] ring-4 ring-[var(--ops-surface)]" /><Link to={item.href} className="grid grid-cols-[3rem_1fr] gap-3 rounded-[var(--ops-radius-lg)] text-sm transition-colors hover:text-[var(--ops-primary)]"><span className="text-[var(--ops-text-muted)]">{item.time}</span><div><strong>{item.title}</strong><p className="mt-1 text-[var(--ops-text-muted)]">{item.meta}</p></div></Link></li>)}
          </ol>
          <div className="border-t border-[var(--ops-divider)] p-3 text-center"><TextLink to="/audit">Alle Aktivitäten anzeigen</TextLink></div>
        </DataPanel>
      </div>

      <div className="flex flex-col justify-between gap-2 px-1 text-xs text-[var(--ops-text-muted)] md:flex-row"><span>Letzte Aktualisierung: {new Date().toLocaleDateString('de-DE')}, {new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span><span>Alle Zeiten in Europe/Vienna</span></div>
    </div>
  );
}
