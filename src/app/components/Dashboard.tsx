import { useEffect, useMemo, useState } from 'react';

import { api } from '../services/api';
import type { Athlete, Event, Hotel as HotelType, RoomAssignment, RoomAvailability, RoomType } from '../types';
import {
  ContentCard,
  DataPanel,
  EntityCard,
  LoadingState,
  MetricCard,
  ProgressCard,
  SectionHeader,
  StatusCard,
  StatusChip,
  TimelineCard,
} from '../design-system';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

type AlertItem = {
  id: string;
  title: string;
  detail: string;
  tone: Tone;
  status: string;
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

const dashboardReadabilityTheme = {
  '--ops-background': '#0D1117',
  '--ops-surface': '#161B22',
  '--ops-surface-raised': '#1C2128',
  '--ops-surface-elevated': '#22272E',
  '--ops-surface-overlay': '#2D333B',
  '--ops-border': 'rgba(240, 246, 252, 0.10)',
  '--ops-border-strong': 'rgba(240, 246, 252, 0.18)',
  '--ops-divider': 'rgba(240, 246, 252, 0.08)',
  '--ops-primary': '#6CB6FF',
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
  '--ops-type-section-title-size': '0.875rem',
  '--ops-type-caption-size': '0.8125rem',
  '--ops-type-label-size': '0.75rem',
  '--ops-type-kpi-size': '2rem',
  '--ops-shadow-xs': '0 1px 2px rgba(1, 4, 9, 0.18)',
  '--ops-shadow-sm': '0 10px 28px rgba(1, 4, 9, 0.22)',
  '--ops-shadow-md': '0 16px 44px rgba(1, 4, 9, 0.26)',
  '--ops-shadow-lg': '0 22px 60px rgba(1, 4, 9, 0.30)',
};

export function Dashboard() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [hotels, setHotels] = useState<HotelType[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [availability, setAvailability] = useState<RoomAvailability[]>([]);
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [athletesData, hotelsData, roomTypesData, eventsData, availabilityData, assignmentsData] = await Promise.all([
        api.getAthletes(),
        api.getHotels(),
        api.getRoomTypes(),
        api.getEvents(),
        api.getRoomAvailability(),
        api.getRoomAssignments(),
      ]);
      setAthletes(athletesData);
      setHotels(hotelsData);
      setRoomTypes(roomTypesData);
      setEvents(eventsData);
      setAvailability(availabilityData);
      setAssignments(assignmentsData);
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
    };
  }, [assignments.length, athletes, events, hotels, roomTypes.length]);

  const criticalAlerts = useMemo<AlertItem[]>(() => {
    const alerts: AlertItem[] = [];
    if (operations.roomDelta < 0) alerts.push({ id: 'rooms-missing', title: 'Fehlende Zimmer', detail: `${Math.abs(operations.roomDelta)} Zimmer fehlen gegenüber dem Spitzenbedarf.`, tone: 'error', status: 'kritisch' });
    if (operations.bedDelta < 0) alerts.push({ id: 'beds-missing', title: 'Fehlende Betten', detail: `${Math.abs(operations.bedDelta)} Betten fehlen gegenüber dem Spitzenbedarf.`, tone: 'error', status: 'kritisch' });
    if (operations.openAssignments > 0) alerts.push({ id: 'open-assignments', title: 'Offene Assignments', detail: `${operations.openAssignments} benötigte Zimmer sind noch nicht disponiert.`, tone: operations.openAssignments > 10 ? 'warning' : 'info', status: 'offen' });
    availability.filter(item => item.difference < 0).slice(0, 3).forEach(item => alerts.push({ id: `availability-${item.roomType.id}`, title: `Quote verletzt: ${item.roomType.name}`, detail: `${Math.abs(item.difference)} Zimmer fehlen in dieser Kategorie.`, tone: 'warning', status: 'prüfen' }));
    return alerts.length > 0 ? alerts : [{ id: 'stable', title: 'Keine kritischen Hinweise', detail: 'Kapazität, Bedarf und Zuweisungen liegen aktuell im operativen Rahmen.', tone: 'success', status: 'stabil' }];
  }, [availability, operations.bedDelta, operations.openAssignments, operations.roomDelta]);

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

  const activityItems = [
    { id: 'assignments', title: `${formatNumber(operations.assignedRooms)} Zimmerzuweisungen geladen`, meta: `${formatPercent(operations.assignmentCoverage)} Abdeckung des Bedarfs`, tone: operations.openAssignments > 0 ? 'warning' as Tone : 'success' as Tone },
    { id: 'events', title: `${formatNumber(events.length)} Events synchronisiert`, meta: nextEvents[0] ? `Nächstes Event: ${nextEvents[0].discipline}` : 'Keine Events vorhanden', tone: 'info' as Tone },
    { id: 'hotels', title: `${formatNumber(hotels.length)} Hotels im Lagebild`, meta: `${formatNumber(operations.roomsAvailable)} Zimmer im Spitzenfenster verfügbar`, tone: 'primary' as Tone },
  ];

  if (loading) return <LoadingState label="Dashboard-Lagebild wird geladen…" />;

  return (
    <div className="space-y-[calc(var(--ops-space)*3)] rounded-[var(--ops-radius-xxl)] bg-[var(--ops-background)] p-5 text-[var(--ops-text)] md:p-6" style={dashboardReadabilityTheme}>
      <ContentCard className="p-7" surface="raised">
        <SectionHeader title="Operations Center" subtitle="Aktuelles WM-Lagebild für Unterkünfte, Events und Disposition." actions={<StatusChip tone={operations.roomDelta < 0 ? 'error' : 'success'}>{operations.roomDelta < 0 ? 'Handlungsbedarf' : 'Operations stabil'}</StatusChip>} />
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Athleten" value={formatNumber(operations.athletes)} helper="registrierte Teilnehmer" tone="primary" trend="Live" />
          <MetricCard label="Officials" value={formatNumber(operations.officials)} helper="Staff & Betreuung" />
          <MetricCard label="Hotels" value={formatNumber(operations.hotels)} helper={`${operations.roomTypes} Zimmerkategorien`} />
          <MetricCard label="Zimmer" value={formatNumber(operations.roomsAvailable)} helper={`${formatNumber(operations.roomsDemand)} benötigt`} tone={operations.roomDelta < 0 ? 'error' : 'success'} trend={operations.roomDelta >= 0 ? `+${operations.roomDelta}` : operations.roomDelta} />
          <MetricCard label="Assignments" value={formatNumber(operations.assignedRooms)} helper={`${formatNumber(operations.openAssignments)} offen`} tone={operations.openAssignments > 0 ? 'warning' : 'success'} trend={formatPercent(operations.assignmentCoverage)} />
          <MetricCard label="Auslastung" value={formatPercent(operations.utilization)} helper="Bedarf vs. Kapazität" tone={getStatusTone(operations.utilization)} trend={operations.utilization > 100 ? 'Limit' : 'OK'} />
        </div>
      </ContentCard>

      <div className="grid grid-cols-1 gap-7 xl:grid-cols-[1.1fr_0.9fr]">
        <DataPanel title="Kritische Hinweise">
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            {criticalAlerts.map(alert => <StatusCard key={alert.id} title={alert.title} status={alert.status} tone={alert.tone}>{alert.detail}</StatusCard>)}
          </div>
        </DataPanel>

        <TimelineCard title="Event Übersicht" items={nextEvents.map(event => ({
          id: event.id,
          title: event.discipline,
          meta: `${formatDate(event.startDate)} – ${formatDate(event.endDate)} · ${(event.roomDemands || []).reduce((sum, demand) => sum + demand.roomCount, 0)} Zimmer Bedarf`,
          tone: 'primary',
        }))} />
      </div>

      <DataPanel title="Hotelübersicht" actions={<StatusChip tone="info">Top Auslastung</StatusChip>}>
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-3">
          {hotelOverview.map(item => (
            <ProgressCard key={item.hotel.id} title={item.hotel.name} value={item.assigned} max={Math.max(item.rooms, 1)} label={<StatusChip tone={item.tone}>{formatPercent(item.percent)}</StatusChip>} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 px-5 pb-5 lg:grid-cols-3">
          {hotelOverview.map(item => (
            <EntityCard key={`${item.hotel.id}-meta`} title={item.hotel.name} subtitle={[item.hotel.location, item.hotel.region].filter(Boolean).join(' · ') || 'Standort offen'} meta={<><StatusChip tone={item.tone}>{item.tone === 'error' ? 'überbelegt' : item.tone === 'warning' ? 'angespannt' : 'verfügbar'}</StatusChip><StatusChip>{item.remaining} Zimmer frei</StatusChip><StatusChip>{item.availableBeds} Betten verfügbar</StatusChip></>} />
          ))}
        </div>
      </DataPanel>

      <div className="grid grid-cols-1 gap-7 xl:grid-cols-[1fr_0.8fr]">
        <DataPanel title="Importstatus">
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            {importStatuses.map(status => <StatusCard key={status.id} title={status.title} status={status.count} tone={status.tone}>{status.helper}</StatusCard>)}
          </div>
        </DataPanel>

        <TimelineCard title="Aktivitäten" items={activityItems} />
      </div>
    </div>
  );
}
