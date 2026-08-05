import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
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
import PaidRoundedIcon from '@mui/icons-material/PaidRounded';

import { api } from '../services/api';
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
  return <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--ops-radius-lg)] ${toneAccent[tone]}`}>{icon}</span>;
}

function KpiCard({ label, value, helper, trend, tone = 'neutral', icon, href }: { label: string; value: ReactNode; helper: ReactNode; trend?: ReactNode; tone?: Tone; icon: ReactNode; href: string }) {
  return <ContentCard interactive className="min-h-[10.5rem] p-5" surface="elevated" elevation="none"><Link to={href} className="flex h-full items-start gap-4 focus-visible:outline-none"><IconTile icon={icon} tone={tone} /><div className="min-w-0 flex-1"><div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--ops-text-subtle)]">{label}</div><div className="mt-4 text-[var(--ops-type-kpi-size)] font-extrabold leading-none tracking-[-0.04em] text-[var(--ops-text)]">{value}</div><div className="mt-4 flex items-center justify-between gap-2 text-sm leading-5 text-[var(--ops-text-muted)]"><span className="truncate">{helper}</span>{trend && <StatusChip tone={tone}>{trend}</StatusChip>}</div></div></Link></ContentCard>;
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
  '--ops-type-kpi-size': '2.45rem',
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [athletesData, hotelsData, roomTypesData, eventsData, availabilityData, assignmentsData, auditData] = await Promise.all([
        api.getAthletes(),
        api.getHotels(),
        api.getRoomTypes(),
        api.getEvents(),
        api.getRoomAvailability(),
        api.getRoomAssignments(),
        api.getAuditEvents(1).catch(() => ({ items: [], total: 0, pages: 0 })),
      ]);
      setAthletes(athletesData);
      setHotels(hotelsData);
      setRoomTypes(roomTypesData);
      setEvents(eventsData);
      setAvailability(availabilityData);
      setAssignments(assignmentsData);
      setAuditEvents(auditData.items.slice(0, 4));
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
      openAssignments: Math.max(totalRoomsDemand - assignedRooms, 0),
      roomDelta: totalRoomsAvailable - totalRoomsDemand,
      bedDelta: totalBedsAvailable - totalBedsDemand,
      utilization,
      assignmentCoverage,
      pendingImportReviews,
      surchargeRisks,
    };
  }, [assignments.length, athletes, events, hotels, roomTypes.length]);

  const criticalAlerts = useMemo<AlertItem[]>(() => {
    const alerts: AlertItem[] = [];
    if (operations.roomDelta < 0) alerts.push({ id: 'rooms-missing', title: 'Fehlende Zimmer', detail: `${Math.abs(operations.roomDelta)} Zimmer fehlen gegenüber dem Spitzenbedarf.`, tone: 'error', status: 'kritisch', href: '/analytics' });
    if (operations.bedDelta < 0) alerts.push({ id: 'beds-missing', title: 'Fehlende Betten', detail: `${Math.abs(operations.bedDelta)} Betten fehlen gegenüber dem Spitzenbedarf.`, tone: 'error', status: 'kritisch', href: '/analytics' });
    if (operations.openAssignments > 0) alerts.push({ id: 'open-assignments', title: 'Offene Assignments', detail: `${operations.openAssignments} benötigte Zimmer sind noch nicht disponiert.`, tone: operations.openAssignments > 10 ? 'warning' : 'info', status: 'offen', href: '/assignments' });
    if (operations.pendingImportReviews > 0) alerts.push({ id: 'import-reviews', title: 'Import-Prüfungen offen', detail: `${operations.pendingImportReviews} Personen benötigen eine Prüfung aus dem letzten Import.`, tone: 'warning', status: 'Import', href: '/import' });
    if (operations.surchargeRisks > 0) alerts.push({ id: 'surcharge-risks', title: 'Aufpreis-Risiken', detail: `${operations.surchargeRisks} Profile enthalten Late Checkout, Sonderessen oder Zusatzleistungen.`, tone: 'info', status: 'Kosten', href: '/athletes' });
    availability.filter(item => item.difference < 0).slice(0, 3).forEach(item => alerts.push({ id: `availability-${item.roomType.id}`, title: `Quote verletzt: ${item.roomType.name}`, detail: `${Math.abs(item.difference)} Zimmer fehlen in dieser Kategorie.`, tone: 'warning', status: 'prüfen', href: '/analytics' }));
    return alerts.length > 0 ? alerts : [{ id: 'stable', title: 'Keine kritischen Hinweise', detail: 'Kapazität, Bedarf und Zuweisungen liegen aktuell im operativen Rahmen.', tone: 'success', status: 'stabil', href: '/analytics' }];
  }, [availability, operations.bedDelta, operations.openAssignments, operations.pendingImportReviews, operations.roomDelta, operations.surchargeRisks]);

  const nextEvents = useMemo(() => [...events]
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 5), [events]);

  const hotelOverview = useMemo(() => hotels.map(hotel => {
    const rooms = hotel.roomInventories?.reduce((sum, inventory) => sum + inventory.roomCount, 0) || 0;
    const beds = hotel.roomInventories?.reduce((sum, inventory) => sum + inventory.roomCount * inventory.roomType.maxPersons, 0) || 0;
    const assigned = assignments.filter(assignment => assignment.hotel.id === hotel.id).length;
    const percent = rooms > 0 ? (assigned / rooms) * 100 : 0;
    return { hotel, rooms, beds, assigned, remaining: Math.max(rooms - assigned, 0), availableBeds: Math.max(beds - assigned, 0), percent, tone: getStatusTone(percent) };
  }).sort((a, b) => b.percent - a.percent).slice(0, 6), [assignments, hotels]);

  const importStatuses = [
    { id: 'athletes', title: 'Athletenimport', count: athletes.length, helper: `${operations.athletes} Athleten · ${operations.officials} Officials`, tone: athletes.length > 0 ? 'success' : 'warning' as Tone },
    { id: 'hotels', title: 'Hotelimport', count: hotels.length, helper: `${hotels.filter(hotel => (hotel.roomInventories || []).length > 0).length} Hotels mit Inventar`, tone: hotels.length > 0 ? 'success' : 'warning' as Tone },
    { id: 'rooms', title: 'Zimmerimport', count: operations.roomsAvailable, helper: `${operations.bedsAvailable} Betten verfügbar`, tone: operations.roomsAvailable > 0 ? 'success' : 'warning' as Tone },
    { id: 'validation', title: 'Validierung', count: criticalAlerts.filter(alert => alert.tone === 'error' || alert.tone === 'warning').length, helper: 'kritische und offene Prüfpunkte', tone: criticalAlerts.some(alert => alert.tone === 'error') ? 'error' : criticalAlerts.some(alert => alert.tone === 'warning') ? 'warning' : 'success' as Tone },
  ];

  const activityItems = auditEvents.length > 0 ? auditEvents.map(event => ({
    id: event.id,
    title: `${event.displayName || event.username}: ${event.action}`,
    meta: `${event.entityType} · ${event.method} ${event.path}`,
    time: new Date(event.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    tone: 'info' as Tone,
  })) : [
    { id: 'assignments', title: `${formatNumber(operations.assignedRooms)} Zimmerzuweisungen geladen`, meta: `${formatPercent(operations.assignmentCoverage)} Abdeckung des Bedarfs`, time: 'Live', tone: operations.openAssignments > 0 ? 'warning' as Tone : 'success' as Tone },
    { id: 'events', title: `${formatNumber(events.length)} Events synchronisiert`, meta: nextEvents[0] ? `Nächstes Event: ${nextEvents[0].discipline}` : 'Keine Events vorhanden', time: 'Live', tone: 'info' as Tone },
  ];

  if (loading) return <LoadingState label="Dashboard-Lagebild wird geladen…" />;

  return (
    <div className="space-y-4 rounded-[var(--ops-radius-xxl)] bg-[var(--ops-background)] p-4 text-[var(--ops-text)] md:p-6" style={dashboardReadabilityTheme}>
      <ContentCard className="p-5 md:p-6" surface="raised" elevation="none">
        <SectionHeader title="Operations Center" subtitle="Aktuelles WM-Lagebild für Unterkünfte, Events und Disposition." actions={<StatusChip tone={operations.roomDelta < 0 ? 'error' : 'success'}>{operations.roomDelta < 0 ? 'Handlungsbedarf' : 'Operations stabil'}</StatusChip>} />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
          <KpiCard label="Athleten" value={formatNumber(operations.athletes)} helper="registrierte Teilnehmer" tone="primary" trend="Live" icon={<GroupsRoundedIcon />} href="/athletes" />
          <KpiCard label="Officials" value={formatNumber(operations.officials)} helper="Staff & Betreuung" tone="neutral" icon={<AdminPanelSettingsRoundedIcon />} href="/athletes" />
          <KpiCard label="Hotels" value={formatNumber(operations.hotels)} helper={`${operations.roomTypes} Zimmerkategorien`} tone="success" icon={<ApartmentRoundedIcon />} href="/hotels" />
          <KpiCard label="Zimmer" value={formatNumber(operations.roomsAvailable)} helper={`${formatNumber(operations.roomsDemand)} benötigt`} tone={operations.roomDelta < 0 ? 'error' : 'success'} trend={operations.roomDelta >= 0 ? `+${operations.roomDelta}` : operations.roomDelta} icon={<BedRoundedIcon />} href="/analytics" />
          <KpiCard label="Assignments" value={formatNumber(operations.assignedRooms)} helper={`${formatNumber(operations.openAssignments)} offen`} tone={operations.openAssignments > 0 ? 'warning' : 'success'} trend={formatPercent(operations.assignmentCoverage)} icon={<AssignmentTurnedInRoundedIcon />} href="/assignments" />
          <KpiCard label="Auslastung" value={formatPercent(operations.utilization)} helper="Bedarf vs. Kapazität" tone={getStatusTone(operations.utilization)} trend={operations.utilization > 100 ? 'Limit' : 'OK'} icon={<PieChartRoundedIcon />} href="/analytics" />
          <KpiCard label="Aufpreise" value={formatNumber(operations.surchargeRisks)} helper="Late Checkout & Extras" tone={operations.surchargeRisks > 0 ? 'warning' : 'success'} trend={operations.surchargeRisks > 0 ? 'Prüfen' : 'OK'} icon={<PaidRoundedIcon />} href="/athletes" />
        </div>
      </ContentCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.02fr]">
        <DataPanel title={<span className="inline-flex items-center gap-2"><WarningAmberRoundedIcon fontSize="small" />Kritische Hinweise</span>}>
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
            {criticalAlerts.map(alert => <ContentCard key={alert.id} className="p-4" surface="elevated" elevation="none"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><IconTile tone={alert.tone} icon={alert.tone === 'warning' ? <ShieldRoundedIcon /> : <WarningAmberRoundedIcon />} /><h3 className="text-sm font-extrabold uppercase text-[var(--ops-text)]">{alert.title}</h3></div><StatusChip tone={alert.tone}>{alert.status}</StatusChip></div><p className="mt-4 text-sm leading-6 text-[var(--ops-text-muted)]">{alert.detail}</p><div className="mt-4"><TextLink to={alert.href}>Details anzeigen</TextLink></div></ContentCard>)}
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><CalendarMonthRoundedIcon fontSize="small" />Event Übersicht</span>} actions={<TextLink to="/events">Alle Events</TextLink>}>
          <div className="divide-y divide-[var(--ops-divider)] p-4">
            {nextEvents.map(event => <Link to="/events" key={event.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-[var(--ops-radius-lg)] px-3 py-3 text-sm transition-colors hover:bg-[var(--ops-surface-overlay)]"><span className="h-2.5 w-2.5 rounded-full bg-[var(--ops-primary)]" /><strong>{event.discipline}</strong><span className="text-[var(--ops-text-muted)]">{formatDate(event.startDate)} – {formatDate(event.endDate)}</span><span className="text-[var(--ops-text-muted)]">{(event.roomDemands || []).reduce((sum, demand) => sum + demand.roomCount, 0)} Zimmer Bedarf</span></Link>)}
          </div>
        </DataPanel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.55fr_0.8fr]">
        <DataPanel title={<span className="inline-flex items-center gap-2"><ApartmentRoundedIcon fontSize="small" />Hotelübersicht</span>} actions={<StatusChip tone="info">Top Auslastung</StatusChip>} className="xl:col-span-1">
          <div className="space-y-4 p-4">
            {hotelOverview.map(item => <Link to="/hotels" key={item.hotel.id} className="grid gap-3 rounded-[var(--ops-radius-lg)] p-3 transition-colors hover:bg-[var(--ops-surface-overlay)] md:grid-cols-[1fr_9rem_10rem]"><div><div className="mb-2 flex items-center justify-between"><strong>{item.hotel.name}</strong><StatusChip tone={item.tone}>{formatPercent(item.percent)}</StatusChip></div><div className="h-2 overflow-hidden rounded-full bg-[var(--ops-surface-overlay)]"><div className="h-full rounded-full bg-[var(--ops-primary)]" style={{ width: `${Math.min(item.percent, 100)}%` }} /></div></div><div className="text-sm text-[var(--ops-text-muted)]">{item.tone === 'error' ? 'Ausgelastet' : 'Verfügbar'}<br />{item.remaining} Zimmer frei</div><div className="text-sm text-[var(--ops-text-muted)]">{item.availableBeds} Betten verfügbar<br />{item.rooms} Zimmer gesamt</div></Link>)}
            <div className="pt-2 text-center"><TextLink to="/hotels">Alle Hotels anzeigen</TextLink></div>
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><CloudUploadRoundedIcon fontSize="small" />Importstatus</span>}>
          <div className="space-y-3 p-4">
            {importStatuses.map(status => <ContentCard key={status.id} interactive className="p-0" surface="elevated" elevation="none"><Link to="/import" className="flex items-center justify-between gap-3 p-3 focus-visible:outline-none"><div className="flex min-w-0 items-center gap-3"><IconTile tone={status.tone} icon={status.tone === 'success' ? <CheckRoundedIcon /> : <SyncRoundedIcon />} /><div><strong className="text-sm">{status.title}</strong><div className="text-xs text-[var(--ops-text-muted)]">{status.helper}</div></div></div><StatusChip tone={status.tone}>{status.tone === 'success' ? 'Abgeschlossen' : status.count}</StatusChip></Link></ContentCard>)}
          </div>
        </DataPanel>

        <DataPanel title={<span className="inline-flex items-center gap-2"><TimelineRoundedIcon fontSize="small" />Aktivitäten</span>} actions={<TextLink to="/audit">Alle Aktivitäten</TextLink>}>
          <ol className="relative m-4 space-y-5 border-l border-[var(--ops-divider)] pl-5">
            {activityItems.map((item) => <li key={item.id} className="relative"><span className="absolute -left-[1.58rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--ops-primary)] ring-4 ring-[var(--ops-surface)]" /><div className="grid grid-cols-[3rem_1fr] gap-3 text-sm"><span className="text-[var(--ops-text-muted)]">{item.time}</span><div><strong>{item.title}</strong><p className="mt-1 text-[var(--ops-text-muted)]">{item.meta}</p></div></div></li>)}
          </ol>
          <div className="border-t border-[var(--ops-divider)] p-4 text-center"><TextLink to="/audit">Alle Aktivitäten anzeigen</TextLink></div>
        </DataPanel>
      </div>

      <div className="flex flex-col justify-between gap-2 px-1 text-xs text-[var(--ops-text-muted)] md:flex-row"><span>Letzte Aktualisierung: {new Date().toLocaleDateString('de-DE')}, {new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span><span>Alle Zeiten in Europe/Vienna</span></div>
    </div>
  );
}
