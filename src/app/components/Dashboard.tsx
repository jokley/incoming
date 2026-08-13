import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import BedRoundedIcon from '@mui/icons-material/BedRounded';
import AssignmentTurnedInRoundedIcon from '@mui/icons-material/AssignmentTurnedInRounded';
import PieChartRoundedIcon from '@mui/icons-material/PieChartRounded';
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
import type { ImportSession } from '../data/importSessions';
import type { Athlete, AuditEvent, Event, Hotel as HotelType, RoomAssignment, RoomAvailability, RoomType } from '../types';
import {
  ContentCard,
  DataPanel,
  LoadingState,
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
  return <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ops-radius-lg)] ${toneAccent[tone]}`}>{icon}</span>;
}

function KpiCard({ label, value, helper, trend, tone = 'neutral', icon, href }: { label: string; value: ReactNode; helper: ReactNode; trend?: ReactNode; tone?: Tone; icon: ReactNode; href: string }) {
  return <ContentCard interactive className="min-h-[8rem] p-4" surface="elevated" elevation="none"><Link to={href} className="flex h-full items-start gap-3 focus-visible:outline-none"><IconTile icon={icon} tone={tone} /><div className="min-w-0 flex-1"><div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--ops-text-subtle)]">{label}</div><div className="mt-2.5 text-[var(--ops-type-kpi-size)] font-extrabold leading-none tracking-[-0.04em] text-[var(--ops-text)]">{value}</div><div className="mt-2.5 flex items-center justify-between gap-2 text-xs leading-5 text-[var(--ops-text-muted)]"><span className="truncate">{helper}</span>{trend && <StatusChip tone={tone}>{trend}</StatusChip>}</div></div></Link></ContentCard>;
}

function TextLink({ children, to }: { children: ReactNode; to: string }) {
  return <Link to={to} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ops-primary)] transition-colors hover:text-[var(--ops-primary-emphasis)] focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]">{children}<OpenInNewRoundedIcon fontSize="inherit" /></Link>;
}

const dashboardReadabilityTheme = {
  '--ops-background': '#0B1220',
  '--ops-surface': '#172234',
  '--ops-surface-raised': '#1D2A3D',
  '--ops-surface-elevated': '#223149',
  '--ops-surface-overlay': '#2A3B54',
  '--ops-border': 'rgba(240, 246, 252, 0.07)',
  '--ops-border-strong': 'rgba(240, 246, 252, 0.14)',
  '--ops-divider': 'rgba(240, 246, 252, 0.06)',
  '--ops-primary': '#60AFFF',
  '--ops-primary-emphasis': '#58A6FF',
  '--ops-secondary': '#79C0FF',
  '--ops-success': '#3FB950',
  '--ops-warning': '#D29922',
  '--ops-error': '#F85149',
  '--ops-info': '#58A6FF',
  '--ops-text': '#F0F6FC',
  '--ops-text-muted': '#C9D1D9',
  '--ops-text-subtle': '#D0D7DE',
  '--ops-tone-neutral-border': 'rgba(240, 246, 252, 0.12)',
  '--ops-tone-neutral-surface': 'rgba(201, 209, 217, 0.12)',
  '--ops-tone-neutral-text': '#F0F6FC',
  '--ops-tone-primary-border': 'rgba(88, 166, 255, 0.45)',
  '--ops-tone-primary-surface': 'rgba(56, 139, 253, 0.20)',
  '--ops-tone-primary-text': '#DDF4FF',
  '--ops-tone-success-border': 'rgba(63, 185, 80, 0.50)',
  '--ops-tone-success-surface': 'rgba(46, 160, 67, 0.20)',
  '--ops-tone-success-text': '#D2FEDB',
  '--ops-tone-warning-border': 'rgba(210, 153, 34, 0.52)',
  '--ops-tone-warning-surface': 'rgba(187, 128, 9, 0.22)',
  '--ops-tone-warning-text': '#FFF8C5',
  '--ops-tone-error-border': 'rgba(248, 81, 73, 0.52)',
  '--ops-tone-error-surface': 'rgba(218, 54, 51, 0.22)',
  '--ops-tone-error-text': '#FFDCD7',
  '--ops-tone-info-border': 'rgba(88, 166, 255, 0.45)',
  '--ops-tone-info-surface': 'rgba(56, 139, 253, 0.18)',
  '--ops-tone-info-text': '#DDF4FF',
  '--ops-type-section-title-size': '0.9rem',
  '--ops-type-caption-size': '0.8125rem',
  '--ops-type-label-size': '0.75rem',
  '--ops-type-kpi-size': '2rem',
  '--ops-shadow-xs': '0 1px 2px rgba(1, 4, 9, 0.18)',
  '--ops-shadow-sm': '0 8px 24px rgba(1, 4, 9, 0.16)',
  '--ops-shadow-md': '0 14px 36px rgba(1, 4, 9, 0.20)',
  '--ops-shadow-lg': '0 20px 52px rgba(1, 4, 9, 0.24)',
};

export function Dashboard() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [hotels, setHotels] = useState<HotelType[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [availability, setAvailability] = useState<RoomAvailability[]>([]);
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [importSessions, setImportSessions] = useState<ImportSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [athletesData, hotelsData, roomTypesData, eventsData, availabilityData, assignmentsData, auditData, importData] = await Promise.all([
        api.getAthletes(),
        api.getHotels(),
        api.getRoomTypes(),
        api.getEvents(),
        api.getRoomAvailability(),
        api.getRoomAssignments(),
        api.getAuditEvents(1).catch(() => ({ items: [], total: 0, pages: 0 })),
        api.getImportSessions().catch(() => []),
      ]);
      setAthletes(athletesData);
      setHotels(hotelsData);
      setRoomTypes(roomTypesData);
      setEvents(eventsData);
      setAvailability(availabilityData);
      setAssignments(assignmentsData);
      setAuditEvents(auditData.items.slice(0, 4));
      setImportSessions(importData);
    } catch (err) {
      console.error('Fehler beim Laden der Daten', err);
    } finally {
      setLoading(false);
    }
  };

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
    const assignedPersonIds = new Set(assignments.flatMap(assignment => [assignment.athlete.id, assignment.sharedWith?.id].filter(Boolean)));
    const assignedPeople = athletes.filter(athlete => athlete.assignment?.hasAssignment || assignedPersonIds.has(athlete.id)).length;
    const peopleWithoutRoom = Math.max(athletes.length - assignedPeople, 0);
    const pendingSingleRooms = athletes.filter(athlete => athlete.single_room_status === 'PENDING_APPROVAL').length;
    const pendingImportReviews = athletes.filter(athlete => athlete.hasPendingRoomlistReview || athlete.missingFromLatestAthletesImport || athlete.missingFromLatestRoomlistImport).length;
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
      surchargeRisks,
    };
  }, [assignments.length, athletes, events, hotels, roomTypes.length]);

  const hotelOverview = useMemo(() => hotels.map(hotel => {
    const rooms = hotel.roomInventories?.reduce((sum, inventory) => sum + inventory.roomCount, 0) || 0;
    const beds = hotel.roomInventories?.reduce((sum, inventory) => sum + inventory.roomCount * inventory.roomType.maxPersons, 0) || 0;
    const assigned = assignments.filter(assignment => assignment.hotel.id === hotel.id).length;
    const percent = rooms > 0 ? (assigned / rooms) * 100 : 0;
    return { hotel, rooms, beds, assigned, remaining: Math.max(rooms - assigned, 0), availableBeds: Math.max(beds - assigned, 0), percent, tone: getStatusTone(percent) };
  }).sort((a, b) => a.remaining - b.remaining || b.percent - a.percent), [assignments, hotels]);

  const criticalHotels = hotelOverview.filter(item => item.rooms > 0 && (item.percent >= 90 || item.remaining <= 2));
  const operationalConflicts = operations.pendingImportReviews + availability.filter(item => item.difference < 0).length;

  const criticalAlerts = useMemo<AlertItem[]>(() => {
    const alerts: AlertItem[] = [];
    if (operations.roomDelta < 0) alerts.push({ id: 'rooms-missing', title: 'Fehlende Zimmer', detail: `${Math.abs(operations.roomDelta)} Zimmer fehlen gegenüber dem Spitzenbedarf.`, tone: 'error', status: 'kritisch', href: '/analytics' });
    if (operations.bedDelta < 0) alerts.push({ id: 'beds-missing', title: 'Fehlende Betten', detail: `${Math.abs(operations.bedDelta)} Betten fehlen gegenüber dem Spitzenbedarf.`, tone: 'error', status: 'kritisch', href: '/analytics' });
    if (operations.peopleWithoutRoom > 0) alerts.push({ id: 'open-assignments', title: 'Personen ohne Zimmer', detail: `${operations.peopleWithoutRoom} Personen sind noch keiner Unterkunft zugewiesen.`, tone: operations.peopleWithoutRoom > 10 ? 'warning' : 'info', status: 'offen', href: '/assignments' });
    criticalHotels.slice(0, 2).forEach(item => alerts.push({ id: `hotel-${item.hotel.id}`, title: item.percent >= 100 ? 'Hotel überbucht' : 'Hotelreserve kritisch', detail: `${item.hotel.name}: ${item.remaining} Zimmer Reserve bei ${formatPercent(item.percent)} Auslastung.`, tone: item.percent >= 100 ? 'error' : 'warning', status: 'Hotel', href: `/hotels?hotelId=${item.hotel.id}` }));
    if (operations.pendingSingleRooms > 0) alerts.push({ id: 'single-rooms', title: 'EZ-Entscheidungen offen', detail: `${operations.pendingSingleRooms} Einzelzimmer-Anfragen warten auf eine Entscheidung.`, tone: 'warning', status: 'Entscheidung', href: '/import' });
    if (operations.pendingImportReviews > 0) alerts.push({ id: 'import-reviews', title: 'Import-Prüfungen offen', detail: `${operations.pendingImportReviews} Personen benötigen eine Prüfung aus dem letzten Import.`, tone: 'warning', status: 'Import', href: '/import' });
    availability.filter(item => item.difference < 0).slice(0, 3).forEach(item => alerts.push({ id: `availability-${item.roomType.id}`, title: `Quote verletzt: ${item.roomType.name}`, detail: `${Math.abs(item.difference)} Zimmer fehlen in dieser Kategorie.`, tone: 'warning', status: 'prüfen', href: '/analytics' }));
    return alerts.length > 0 ? alerts : [{ id: 'stable', title: 'Keine kritischen Hinweise', detail: 'Kapazität, Bedarf und Zuweisungen liegen aktuell im operativen Rahmen.', tone: 'success', status: 'stabil', href: '/analytics' }];
  }, [availability, criticalHotels, operations.bedDelta, operations.pendingImportReviews, operations.pendingSingleRooms, operations.peopleWithoutRoom, operations.roomDelta]);

  const today = new Date().toLocaleDateString('en-CA');
  const arrivalsToday = athletes.filter(athlete => athlete.arrivalDate === today).length;
  const departuresToday = athletes.filter(athlete => athlete.departureDate === today).length;
  const assignmentsToday = assignments.filter(assignment => assignment.checkInDate === today).length;
  const upcomingMovements = useMemo(() => athletes.flatMap(athlete => [
    athlete.arrivalDate && athlete.arrivalDate >= today ? { id: `arrival-${athlete.id}`, athlete, date: athlete.arrivalDate, kind: 'Anreise' as const } : null,
    athlete.departureDate && athlete.departureDate >= today ? { id: `departure-${athlete.id}`, athlete, date: athlete.departureDate, kind: 'Abreise' as const } : null,
  ]).filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5), [athletes, today]);

  const importStatuses = [
    { id: 'sessions', title: 'Importsessions', count: importSessions.length, helper: `${importSessions.filter(session => !['IMPORTED', 'REPLACED', 'ARCHIVED'].includes(session.status)).length} in Bearbeitung`, tone: importSessions.length > 0 ? 'success' : 'warning' as Tone, href: '/import' },
    { id: 'reviews', title: 'Importprüfungen', count: operations.pendingImportReviews, helper: 'Personen mit Klärungsbedarf', tone: operations.pendingImportReviews > 0 ? 'warning' : 'success' as Tone, href: '/import' },
    { id: 'decisions', title: 'EZ-Entscheidungen', count: operations.pendingSingleRooms, helper: 'offene Einzelzimmer-Freigaben', tone: operations.pendingSingleRooms > 0 ? 'warning' : 'success' as Tone, href: '/import' },
    { id: 'validation', title: 'Importkonflikte', count: operationalConflicts, helper: 'operative Auswirkungen prüfen', tone: operationalConflicts > 0 ? 'error' : 'success' as Tone, href: '/import' },
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

  if (loading) return <LoadingState label="Dashboard-Lagebild wird geladen…" />;

  return (
    <div className="space-y-3 rounded-[var(--ops-radius-xxl)] bg-[var(--ops-background)] p-4 text-[var(--ops-text)]" style={dashboardReadabilityTheme}>
      <ContentCard className="p-4" surface="raised" elevation="none">
        <SectionHeader title="Operations Center" subtitle="Projektstatus, heutige Bewegungen und direkte Einstiege in die Arbeitsbereiche." actions={<StatusChip tone={operationalConflicts > 0 || operations.peopleWithoutRoom > 0 ? 'warning' : 'success'}>{operationalConflicts > 0 || operations.peopleWithoutRoom > 0 ? 'Handlungsbedarf' : 'Operations stabil'}</StatusChip>} />
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          <KpiCard label="Personen gesamt" value={formatNumber(athletes.length)} helper="im Projekt" tone="primary" trend="Live" icon={<GroupsRoundedIcon />} href="/athletes" />
          <KpiCard label="Zimmerkontingent" value={formatNumber(operations.roomsAvailable)} helper={`${formatNumber(operations.bedsAvailable)} Betten`} tone="info" icon={<BedRoundedIcon />} href="/hotels" />
          <KpiCard label="Aktuell disponiert" value={formatNumber(operations.assignedPeople)} helper="Personen mit Zimmer" tone="success" icon={<AssignmentTurnedInRoundedIcon />} href="/assignments" />
          <KpiCard label="Freie Zimmer" value={formatNumber(Math.max(operations.roomDelta, 0))} helper="Reserve am Spitzenbedarf" tone={operations.roomDelta <= 0 ? 'error' : 'success'} trend={operations.roomDelta <= 0 ? 'Limit' : 'Reserve'} icon={<PieChartRoundedIcon />} href="/analytics" />
          <KpiCard label="Kritische Hotels" value={formatNumber(criticalHotels.length)} helper="nach Reserve priorisiert" tone={criticalHotels.length > 0 ? 'warning' : 'success'} icon={<ApartmentRoundedIcon />} href="/hotels" />
          <KpiCard label="Ohne Zimmer" value={formatNumber(operations.peopleWithoutRoom)} helper="Personen offen" tone={operations.peopleWithoutRoom > 0 ? 'error' : 'success'} icon={<WarningAmberRoundedIcon />} href="/assignments" />
          <KpiCard label="Operative Konflikte" value={formatNumber(operationalConflicts)} helper={`${operations.pendingSingleRooms} EZ-Entscheidungen`} tone={operationalConflicts > 0 ? 'warning' : 'success'} icon={<ShieldRoundedIcon />} href="/import" />
        </div>
      </ContentCard>

      <DataPanel title={<span className="inline-flex items-center gap-2"><CalendarMonthRoundedIcon fontSize="small" />Heute</span>} actions={<TextLink to="/assignments">Operations Cockpit öffnen</TextLink>}>
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--ops-divider)] md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
          {[{ label: 'Anreisen', value: arrivalsToday, href: '/athletes' }, { label: 'Abreisen', value: departuresToday, href: '/athletes' }, { label: 'Neue Zimmerzuweisungen', value: assignmentsToday, href: '/assignments' }, { label: 'Offene Zimmerzuweisungen', value: operations.peopleWithoutRoom, href: '/assignments' }, { label: 'Kritische Hotels', value: criticalHotels.length, href: '/hotels' }, { label: 'Offene Entscheidungen', value: operations.pendingSingleRooms, href: '/import' }].map(item => <Link key={item.label} to={item.href} className="px-4 py-3 transition-colors hover:bg-[var(--ops-surface-overlay)]"><div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--ops-text-subtle)]">{item.label}</div><div className="mt-1 text-xl font-extrabold">{formatNumber(item.value)}</div></Link>)}
        </div>
      </DataPanel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.02fr]">
        <DataPanel title={<span className="inline-flex items-center gap-2"><WarningAmberRoundedIcon fontSize="small" />Kritische Hinweise</span>}>
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
            {criticalAlerts.map(alert => <ContentCard key={alert.id} className="p-3" surface="elevated" elevation="none"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><IconTile tone={alert.tone} icon={alert.tone === 'warning' ? <ShieldRoundedIcon /> : <WarningAmberRoundedIcon />} /><h3 className="text-sm font-extrabold uppercase text-[var(--ops-text)]">{alert.title}</h3></div><StatusChip tone={alert.tone}>{alert.status}</StatusChip></div><p className="mt-2 text-xs leading-5 text-[var(--ops-text-muted)]">{alert.detail}</p><div className="mt-2"><TextLink to={alert.href}>Details anzeigen</TextLink></div></ContentCard>)}
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><CalendarMonthRoundedIcon fontSize="small" />Nächste Bewegungen</span>} actions={<TextLink to="/athletes">Personen öffnen</TextLink>}>
          <div className="divide-y divide-[var(--ops-divider)] p-3">
            {upcomingMovements.length > 0 ? upcomingMovements.map(item => <Link to={`/athletes?athleteId=${item.athlete.id}`} key={item.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-[var(--ops-radius-lg)] px-3 py-2 text-xs transition-colors hover:bg-[var(--ops-surface-overlay)]"><IconTile tone={item.kind === 'Anreise' ? 'info' : 'neutral'} icon={item.kind === 'Anreise' ? <LoginRoundedIcon fontSize="small" /> : <LogoutRoundedIcon fontSize="small" />} /><strong>{item.athlete.firstname} {item.athlete.lastname}</strong><span className="text-[var(--ops-text-muted)]">{item.athlete.nationCode}</span><span className="text-[var(--ops-text-muted)]">{item.kind} · {formatDate(item.date)}</span></Link>) : <p className="px-3 py-6 text-center text-sm text-[var(--ops-text-muted)]">Keine bevorstehenden An- oder Abreisen erfasst.</p>}
          </div>
        </DataPanel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.55fr_0.8fr]">
        <DataPanel title={<span className="inline-flex items-center gap-2"><ApartmentRoundedIcon fontSize="small" />Hotelübersicht</span>} actions={<StatusChip tone="info">Nach Priorität</StatusChip>} className="xl:col-span-1">
          <div className="space-y-2 p-3">
            {hotelOverview.slice(0, 6).map(item => <Link to={`/hotels?hotelId=${item.hotel.id}`} key={item.hotel.id} className="grid gap-3 rounded-[var(--ops-radius-lg)] p-2 transition-colors hover:bg-[var(--ops-surface-overlay)] md:grid-cols-[1fr_9rem_10rem]"><div><div className="mb-2 flex items-center justify-between"><strong>{item.hotel.name}</strong><StatusChip tone={item.tone}>{formatPercent(item.percent)}</StatusChip></div><div className="h-2 overflow-hidden rounded-full bg-[var(--ops-surface-overlay)]"><div className="h-full rounded-full bg-[var(--ops-primary)]" style={{ width: `${Math.min(item.percent, 100)}%` }} /></div></div><div className="text-sm text-[var(--ops-text-muted)]">{item.tone === 'error' ? 'Ausgelastet' : 'Verfügbar'}<br />{item.remaining} Zimmer frei</div><div className="text-sm text-[var(--ops-text-muted)]">{item.availableBeds} Betten verfügbar<br />{item.rooms} Zimmer gesamt</div></Link>)}
            <div className="pt-2 text-center"><TextLink to="/hotels">Alle Hotels anzeigen</TextLink></div>
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><CloudUploadRoundedIcon fontSize="small" />Importstatus</span>}>
          <div className="space-y-2 p-3">
            {importStatuses.map(status => <ContentCard key={status.id} interactive className="p-0" surface="elevated" elevation="none"><Link to={status.href} className="flex items-center justify-between gap-3 p-3 focus-visible:outline-none"><div className="flex min-w-0 items-center gap-3"><IconTile tone={status.tone} icon={status.tone === 'success' ? <CheckRoundedIcon /> : <SyncRoundedIcon />} /><div><strong className="text-sm">{status.title}</strong><div className="text-xs text-[var(--ops-text-muted)]">{status.helper}</div></div></div><StatusChip tone={status.tone}>{status.tone === 'success' ? 'Abgeschlossen' : status.count}</StatusChip></Link></ContentCard>)}
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><TimelineRoundedIcon fontSize="small" />Aktivitäten</span>} actions={<TextLink to="/audit">Alle Aktivitäten</TextLink>}>
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
