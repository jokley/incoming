import { Profiler, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bed,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock,
  FileCheck2,
  Eye,
  Flag,
  Link2,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import { ImportConflictNotice } from './ImportConflictNotice';
import { SingleRoomStatusBadge } from './SingleRoomStatusBadge';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import type { OperationsLocationState } from '../operationsContext';
import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import { markAssignmentDrop, recordAssignmentRender } from '../services/assignmentPerformance';
import type { OfficialQuotaUsage } from '../services/fisRules';
import type {
  AssignmentGridBooking,
  AssignmentGridHotel,
  AssignmentPlanningView,
  AssignmentSlot,
  AssignmentValidationResult,
  Athlete,
  RoomBookingUnit,
  ImportChangeType,
} from '../types';

type AppView = 'dispatch' | 'quotas';
type QueueStatus = 'pending' | 'done' | 'all';
type RoomCategoryFilter = '' | 'ez' | 'dz';
type SelectedState =
  | { type: 'unit'; id: string }
  | { type: 'booking'; id: string }
  | null;

type DragState = {
  unitId: string;
  athleteIds: string[];
  label: string;
};

type PendingAssignmentAction = {
  kind: 'assign' | 'unassign' | 'single';
  unitId?: string;
  athleteIds?: string[];
  hotelId?: string;
  bookingId?: string;
};

const REGION_COLORS: Record<string, string> = {
  Bludenz: '#4F8EF7',
  Montafon: '#34D399',
  Feldkirch: '#8B5CF6',
};

const IMPORT_CHANGE_LABELS: Record<ImportChangeType, string> = {
  NEW_ATHLETE: 'Neuer Athlet',
  DATE_CHANGED: 'Aufenthaltsdatum geändert',
  ROOMMATE_CHANGED: 'Zimmerpartner geändert',
  ROOM_DEMAND_CHANGED: 'Zimmerbedarf geändert',
};

export function Assignments() {
  const permissions = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as ({ athleteId?: string; assignmentId?: string; view?: AppView; quotaKey?: string } & OperationsLocationState) | null;
  const requestedAthleteId = routeState?.athleteId || routeState?.operationsContext?.personId; const requestedAssignmentId=routeState?.assignmentId||routeState?.operationsContext?.assignmentId;
  const [planning, setPlanning] = useState<AssignmentPlanningView | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [quotaUsage, setQuotaUsage] = useState<OfficialQuotaUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAssignmentAction | null>(null);
  const [quotaRefreshing, setQuotaRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);

  const [view, setView] = useState<AppView>(routeState?.view || (routeState?.operationsContext?.quotaKey ? 'quotas' : 'dispatch'));
  const [selected, setSelected] = useState<SelectedState>(null);
  const [activeHotelId, setActiveHotelId] = useState<string | null>(null);
  const [showAlert, setShowAlert] = useState(true);
  const [selectedQuotaKey, setSelectedQuotaKey] = useState<string | null>(routeState?.quotaKey || routeState?.operationsContext?.quotaKey || null);

  const [queueSearch, setQueueSearch] = useState('');
  const [hotelSearch, setHotelSearch] = useState('');
  const [filterNation, setFilterNation] = useState('');
  const [filterDiscipline, setFilterDiscipline] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const [filterStatus, setFilterStatus] = useState<QueueStatus>('pending');
  const [filterRoomCategory, setFilterRoomCategory] = useState<RoomCategoryFilter>('');
  const [filterImportReview, setFilterImportReview] = useState(false);
  const [regionFilter, setRegionFilter] = useState('');

  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dragOverHotelId, setDragOverHotelId] = useState<string | null>(null);
  const [dragOverRoomTypeKey, setDragOverRoomTypeKey] = useState<string | null>(null);
  const [dragOverBookingId, setDragOverBookingId] = useState<string | null>(null);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadQuotaUsage();
  }, [filterNation, filterDiscipline, filterGender]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [planningData, athletesData] = await Promise.all([
        api.getAssignmentPlanningView(),
        api.getAthletes(),
      ]);
      setPlanning(planningData);
      setAthletes(athletesData);
      if (requestedAssignmentId) {
        const booking = planningData.hotels.flatMap(hotel => hotel.slots.flatMap(slot => slot.bookings)).find(candidate => candidate.bookingId === requestedAssignmentId);
        const unit = [...planningData.units.unassigned, ...planningData.units.assigned].find(candidate => candidate.unitId === requestedAssignmentId);
        if (booking) { setSelected({type:'booking',id:booking.bookingId}); setActiveHotelId(booking.hotelId); } else if(unit) setSelected({type:'unit',id:unit.unitId});
      } else if (requestedAthleteId) {
        const booking = planningData.hotels
          .flatMap((hotel) => hotel.slots.flatMap((slot) => slot.bookings))
          .find((candidate) => candidate.occupants.some((occupant) => occupant.athleteId === requestedAthleteId));
        const unit = [...planningData.units.unassigned, ...planningData.units.assigned]
          .find((candidate) => candidate.occupants.some((occupant) => occupant.athleteId === requestedAthleteId));

        if (booking) {
          setSelected({ type: 'booking', id: booking.bookingId });
          setActiveHotelId(booking.hotelId);
        } else if (unit) {
          setSelected({ type: 'unit', id: unit.unitId });
        }
      }
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Fehler beim Laden der Dispositionsansicht');
    } finally {
      setLoading(false);
    }
  };

  const refreshPlanningData = async ({ silent = true }: { silent?: boolean } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const planningData = await api.getAssignmentPlanningView();
      setPlanning(planningData);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Fehler beim Aktualisieren der Dispositionsansicht');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const loadQuotaUsage = async () => {
    try {
      setQuotaRefreshing(true);
      const rows = await api.getOfficialQuotaUsage({
        nationCode: filterNation || undefined,
        discipline: filterDiscipline || undefined,
        gender: filterGender || undefined,
      });
      setQuotaUsage(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setQuotaRefreshing(false);
    }
  };

  // Keep collection identities stable while unrelated UI state (saving, dialogs,
  // drag targets) changes. The profiler showed these short-lived arrays invalidated
  // every downstream memo on each parent render even though planning was unchanged.
  const allUnits = useMemo(() => planning?.units.unassigned ?? [], [planning]);
  const assignedUnits = useMemo(() => planning?.units.assigned ?? [], [planning]);
  const allUnitsCombined = useMemo(() => [...allUnits, ...assignedUnits], [allUnits, assignedUnits]);
  const allHotels = useMemo(() => planning?.hotels ?? [], [planning]);
  const validationByUnit = useMemo(() => planning?.validationByUnit ?? {}, [planning]);

  const unitById = useMemo(() => {
    const map = new Map<string, RoomBookingUnit>();
    for (const unit of allUnitsCombined) map.set(unit.unitId, unit);
    return map;
  }, [allUnitsCombined]);

  const slotById = useMemo(() => {
    const map = new Map<string, AssignmentSlot>();
    for (const hotel of allHotels) {
      for (const slot of hotel.slots) map.set(slot.slotId, slot);
    }
    return map;
  }, [allHotels]);

  const bookingContextById = useMemo(() => {
    const map = new Map<string, { booking: AssignmentGridBooking; slot: AssignmentSlot; hotel: AssignmentGridHotel }>();
    for (const hotel of allHotels) {
      for (const slot of hotel.slots) {
        for (const booking of slot.bookings) {
          map.set(booking.bookingId, { booking, slot, hotel });
        }
      }
    }
    return map;
  }, [allHotels]);

  const nationOptions = useMemo(
    () => Array.from(new Set(allUnitsCombined.map((unit) => unit.nationCode).filter(Boolean))).sort(),
    [allUnitsCombined]
  );

  const disciplineOptions = useMemo(() => {
    const values = new Set<string>();
    for (const unit of allUnitsCombined) {
      for (const occupant of unit.occupants) {
        if (occupant.discipline) values.add(occupant.discipline);
      }
    }
    return Array.from(values).sort();
  }, [allUnitsCombined]);

  const genderOptions = useMemo(() => {
    const values = new Set<string>();
    for (const unit of allUnitsCombined) {
      for (const occupant of unit.occupants) {
        const gender = normalizeGender(occupant.gender);
        if (gender) values.add(gender);
      }
    }
    return Array.from(values).sort();
  }, [allUnitsCombined]);

  const queueUnits = useMemo(() => {
    const source =
      filterStatus === 'pending' ? allUnits :
      filterStatus === 'done' ? assignedUnits :
      allUnitsCombined;

    const query = queueSearch.trim().toLowerCase();
    return source.filter((unit) => {
      const matchesNation = !filterNation || unit.nationCode === filterNation;
      const matchesDiscipline = !filterDiscipline || unit.occupants.some((occ) => occ.discipline === filterDiscipline);
      const matchesGender = !filterGender || unit.occupants.some((occ) => normalizeGender(occ.gender) === filterGender);
      const matchesRoomCategory = !filterRoomCategory || getUnitRoomCategory(unit) === filterRoomCategory;
      const matchesImportReview = !filterImportReview || unit.occupants.some((occ) => occ.hasPendingReview);
      const haystack = `${unit.nationCode} ${unit.roomTypeLabel} ${unit.occupants.map((o) => `${o.firstname} ${o.lastname}`).join(' ')}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesNation && matchesDiscipline && matchesGender && matchesRoomCategory && matchesImportReview && matchesSearch;
    });
  }, [allUnits, allUnitsCombined, assignedUnits, filterDiscipline, filterGender, filterImportReview, filterNation, filterRoomCategory, filterStatus, queueSearch]);

  const filteredHotels = useMemo(() => {
    const query = hotelSearch.trim().toLowerCase();
    const queueQuery = queueSearch.trim().toLowerCase();
    const matchingUnitIds = new Set(queueUnits.map((unit) => unit.unitId));
    return allHotels.filter((hotel) => {
      const matchesRegion = !regionFilter || hotel.region === regionFilter;
      const haystack = `${hotel.hotelName} ${hotel.location || ''}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      if (!matchesRegion || !matchesSearch) return false;
      if (!queueQuery) return true;
      const containsMatchingOccupant = hotel.slots.some((slot) => slot.bookings.some((booking) =>
        booking.occupants.some((occupant) => queueUnits.some((unit) => unit.occupants.some((person) => person.athleteId === occupant.athleteId)))
      ));
      const hasAssignableSlot = queueUnits.some((unit) => (validationByUnit[unit.unitId] || []).some((validation) =>
        validation.status !== 'blocked' && hotel.slots.some((slot) => slot.slotId === validation.slotId)
      ));
      return matchingUnitIds.size > 0 && (containsMatchingOccupant || hasAssignableSlot);
    });
  }, [allHotels, hotelSearch, queueSearch, queueUnits, regionFilter, validationByUnit]);

  const activeHotel = filteredHotels.find((hotel) => hotel.hotelId === activeHotelId) ?? null;

  useEffect(() => {
    if (!queueSearch.trim() || queueUnits.length !== 1) return;
    const athleteIds = new Set(queueUnits[0].occupants.map((occupant) => occupant.athleteId));
    const assignedHotel = filteredHotels.find((hotel) => hotel.slots.some((slot) => slot.bookings.some((booking) =>
      booking.occupants.some((occupant) => athleteIds.has(occupant.athleteId))
    )));
    const target = assignedHotel ?? filteredHotels[0];
    if (target && target.hotelId !== activeHotelId) setActiveHotelId(target.hotelId);
  }, [activeHotelId, filteredHotels, queueSearch, queueUnits]);

  const queueProgress = useMemo(() => {
    const total = allUnitsCombined.length;
    const done = assignedUnits.length;
    return {
      done,
      total,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [allUnitsCombined.length, assignedUnits.length]);

  const quotaViolations = useMemo(
    () => quotaUsage.filter((row) => row.assignedOfficials > row.officialQuota || row.singleRoomsUsed > row.singleRoomsAllowed),
    [quotaUsage]
  );

  const shareRequests = useMemo(() => {
    return queueUnits
      .filter((unit) => unit.occupants.length >= 2)
      .slice(0, 8)
      .map((unit) => ({
        unit,
        compatible: sameGender(unit) && sameNation(unit),
        mixed: !sameGender(unit) || !sameNation(unit),
      }));
  }, [queueUnits]);

  const shareRequestUnitIds = useMemo(
    () => new Set(shareRequests.map(({ unit }) => unit.unitId)),
    [shareRequests]
  );

  const regularQueueUnits = useMemo(
    () => queueUnits.filter((unit) => !shareRequestUnitIds.has(unit.unitId)),
    [queueUnits, shareRequestUnitIds]
  );

  const selectedUnit = selected?.type === 'unit' ? unitById.get(selected.id) ?? null : null;
  const selectedBookingContext = selected?.type === 'booking' ? bookingContextById.get(selected.id) ?? null : null;
  const selectedAssignedUnit = selectedBookingContext ? findAssignedUnitForBooking(selectedBookingContext.booking.bookingId, assignedUnits) : null;

  const handleAssignToHotel = async (unitId: string, hotelId: string, athleteIds?: string[]) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    const validationKey = getValidationKey(unitId, athleteIds);
    const validSlot = findFirstValidSlot(validationByUnit[validationKey] || [], allHotels, hotelId);
    if (!validSlot) {
      setError('Für dieses Hotel gibt es keinen gültigen Slot für die ausgewählte Einheit.');
      return;
    }
    await assignUnitToSlot(unitId, validSlot, athleteIds);
  };

  const handleAssignToRoomType = async (unitId: string, hotelId: string, roomTypeId: string, athleteIds?: string[]) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    const validationKey = getValidationKey(unitId, athleteIds);
    const slot = findFirstValidSlotForRoomType(validationByUnit[validationKey] || [], allHotels, hotelId, roomTypeId);
    if (!slot) {
      setError('Für diesen Zimmertyp gibt es keinen gültigen freien Slot.');
      return;
    }
    await assignUnitToSlot(unitId, slot, athleteIds);
  };

  const assignUnitToSlot = async (unitId: string, slot: AssignmentSlot, athleteIds?: string[]) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    const unit = unitById.get(unitId);
    if (!unit) return;
    const normalizedAthleteIds = athleteIds?.length ? athleteIds : unit.occupants.map((occupant) => occupant.athleteId);
    try {
      setPendingAction({ kind: 'assign', unitId, athleteIds: normalizedAthleteIds, hotelId: slot.hotelId });
      setSaving(true);
      setError(null);
      await api.assignRoomBookingUnit({
        hotelId: slot.hotelId,
        roomTypeId: slot.roomTypeId,
        roomNumber: slot.roomNumber || undefined,
        checkInDate: unit.checkInDate || undefined,
        checkOutDate: unit.checkOutDate || undefined,
        assignedBookingId: normalizedAthleteIds.length === unit.occupants.length ? unit.assignedBookingId || undefined : undefined,
        athleteIds: normalizedAthleteIds,
      });
      setDragging(null);
      setDragOverHotelId(null);
      setDragOverRoomTypeKey(null);
      setDragOverBookingId(null);
      await Promise.all([
        refreshPlanningData(),
        loadQuotaUsage(),
      ]);
    } catch (err) {
      setError(extractErrorMessage(err, 'Zuweisung fehlgeschlagen'));
    } finally {
      setPendingAction(null);
      setSaving(false);
    }
  };

  const handleUnassignBooking = async (bookingId: string) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    try {
      setPendingAction({ kind: 'unassign', bookingId });
      setSaving(true);
      setError(null);
      await api.unassignRoomBookingUnit(bookingId);
      setSelected(null);
      await Promise.all([
        refreshPlanningData(),
        loadQuotaUsage(),
      ]);
    } catch (err) {
      setError(extractErrorMessage(err, 'Ausbuchen fehlgeschlagen'));
    } finally {
      setPendingAction(null);
      setSaving(false);
    }
  };

  const handleUnassignOccupant = async (bookingId: string, athleteId: string) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    try {
      setPendingAction({ kind: 'unassign', bookingId, athleteIds: [athleteId] });
      setSaving(true);
      setError(null);
      await api.unassignRoomBookingOccupant(bookingId, athleteId);
      await Promise.all([
        refreshPlanningData(),
        loadQuotaUsage(),
      ]);
    } catch (err) {
      setError(extractErrorMessage(err, 'Teil-Ausbuchung fehlgeschlagen'));
    } finally {
      setPendingAction(null);
      setSaving(false);
    }
  };

  const handleMarkBookingAsSingle = async (bookingId: string, countsAsSingle: boolean) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    try {
      setPendingAction({ kind: 'single', bookingId });
      setSaving(true);
      setError(null);
      await api.updateAssignedUnit(bookingId, { countsAsSingle });
      await Promise.all([
        refreshPlanningData(),
        loadQuotaUsage(),
      ]);
    } catch (err) {
      setError(extractErrorMessage(err, 'EZ-Markierung fehlgeschlagen'));
    } finally {
      setPendingAction(null);
      setSaving(false);
    }
  };

  const handleAssignToExistingBooking = async (
    unitId: string,
    booking: AssignmentGridBooking,
    athleteIds?: string[],
  ) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    const unit = unitById.get(unitId);
    if (!unit) return;
    const incomingAthleteIds = athleteIds?.length ? athleteIds : unit.occupants.map((occupant) => occupant.athleteId);
    const combinedAthleteIds = Array.from(new Set([
      ...booking.occupants.map((occupant) => occupant.athleteId),
      ...incomingAthleteIds,
    ]));

    try {
      setPendingAction({ kind: 'assign', unitId, athleteIds: incomingAthleteIds, hotelId: booking.hotelId, bookingId: booking.bookingId });
      setSaving(true);
      setError(null);
      await api.assignRoomBookingUnit({
        hotelId: booking.hotelId,
        roomTypeId: booking.roomTypeId,
        roomNumber: booking.roomNumber || undefined,
        checkInDate: booking.checkInDate || unit.checkInDate || undefined,
        checkOutDate: booking.checkOutDate || unit.checkOutDate || undefined,
        assignedBookingId: booking.bookingId,
        athleteIds: combinedAthleteIds,
      });
      setDragging(null);
      setDragOverHotelId(null);
      setDragOverRoomTypeKey(null);
      setDragOverBookingId(null);
      await Promise.all([
        refreshPlanningData(),
        loadQuotaUsage(),
      ]);
    } catch (err) {
      setError(extractErrorMessage(err, 'Partner zum Doppelzimmer hinzufügen fehlgeschlagen'));
    } finally {
      setPendingAction(null);
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([
      refreshPlanningData({ silent: false }),
      loadQuotaUsage(),
    ]);
  };

  const handleAcknowledgeImportChanges = async (unit: RoomBookingUnit) => {
    try {
      setSaving(true);
      await Promise.all(unit.occupants.filter((occ) => occ.hasPendingReview).map((occ) => api.acknowledgeAthleteRoomlistChange(occ.athleteId)));
      setSelected(null);
      await refreshPlanningData();
    } catch (err) {
      setError(extractErrorMessage(err, 'Prüfung konnte nicht gespeichert werden'));
    } finally {
      setSaving(false);
    }
  };

  const onProfileRender = useCallback((id: string, _phase: string, actualDuration: number) => {
    recordAssignmentRender(id, actualDuration);
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <>
    <Profiler id="Assignments" onRender={onProfileRender}>
    <div className="relative" aria-busy={saving}>
      {saving && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-50" role="status" aria-live="polite">
          <div className="h-1 overflow-hidden bg-blue-950"><div className="h-full w-1/2 animate-pulse bg-blue-400" /></div>
          <div className="absolute right-4 top-3 flex items-center gap-2 rounded-lg bg-[#122033] px-3 py-2 text-xs font-semibold text-blue-100 shadow-xl">
            <RefreshCw className="h-4 w-4 animate-spin" /> Zuweisung wird verarbeitet …
          </div>
        </div>
      )}
    <div className="relative flex h-[calc(100vh-106px)] w-full items-center justify-center overflow-hidden px-1 py-2">
      <div className="flex h-full w-full max-w-[1980px] flex-col overflow-hidden rounded-[28px] border border-[var(--ops-border)] bg-[var(--ops-surface)] text-[var(--ops-text)] shadow-[var(--ops-shadow-md)] [--ops-background:#111d2e] [--ops-surface:#1a2a40] [--ops-surface-raised:#21334c] [--ops-surface-elevated:#2a3e59] [--ops-surface-overlay:#344b67] [--ops-border:#4b6380] [--ops-divider:#405773] [--ops-primary:#60a5fa] [--ops-primary-emphasis:#60a5fa] [--ops-text-muted:#c5cfdb]">
        <div className="p-3 pb-0"><ImportConflictNotice/></div>
        <TopBar
          view={view}
          onViewChange={setView}
          progress={queueProgress}
          violations={quotaViolations.length}
          saving={saving}
          onRefresh={handleRefresh}
          quotaRows={quotaUsage}
          quotaRefreshing={quotaRefreshing}
        />

        {showAlert && quotaViolations.length > 0 && (
          <AlertBanner row={quotaViolations[0]} onClose={() => setShowAlert(false)} onGoQuotas={() => setView('quotas')} />
        )}

        <div className={`grid min-h-0 flex-1 border-t border-[var(--ops-divider)] ${view === 'dispatch' ? 'grid-cols-[352px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
          {view === 'dispatch' && <aside className="min-h-0 border-r border-[var(--ops-divider)] bg-[var(--ops-surface-raised)]">
            <QueueSidebar
              units={queueUnits}
              regularUnits={regularQueueUnits}
              progress={queueProgress}
              shareRequests={shareRequests}
              filterNation={filterNation}
              onFilterNation={setFilterNation}
              filterDiscipline={filterDiscipline}
              onFilterDiscipline={setFilterDiscipline}
              filterGender={filterGender}
              onFilterGender={setFilterGender}
              filterStatus={filterStatus}
              onFilterStatus={setFilterStatus}
              filterRoomCategory={filterRoomCategory}
              onFilterRoomCategory={setFilterRoomCategory}
              filterImportReview={filterImportReview}
              onFilterImportReview={setFilterImportReview}
              search={queueSearch}
              onSearch={setQueueSearch}
              nationOptions={nationOptions}
              disciplineOptions={disciplineOptions}
              genderOptions={genderOptions}
              draggingUnitId={dragging?.unitId || null}
              draggingAthleteIds={dragging?.athleteIds || []}
              canEditAssignments={permissions.canManageAssignments}
              onDragStart={(unitId, athleteIds, label) => {
                if (!permissions.canManageAssignments) return;
                setDragging({ unitId, athleteIds, label });
              }}
              onDragEnd={() => {
                setDragging(null);
                setDragOverHotelId(null);
                setDragOverRoomTypeKey(null);
                setDragOverBookingId(null);
              }}
              onSelectUnit={(unitId) => setSelected({ type: 'unit', id: unitId })}
              onQuickAssignPair={(unitId, athleteIds) => {
                if (!permissions.canManageAssignments) return;
                const targetHotel = activeHotel ?? filteredHotels[0];
                if (targetHotel) void handleAssignToHotel(unitId, targetHotel.hotelId, athleteIds);
              }}
              selectedUnitId={selected?.type === 'unit' ? selected.id : null}
              pendingAction={pendingAction}
            />
          </aside>}

          <main className="min-h-0 overflow-hidden bg-[var(--ops-surface-elevated)]">
            {view === 'dispatch' && (
              filteredHotels.length > 0 ? (
                <DispatchWorkspace
                  hotels={filteredHotels}
                  activeHotel={activeHotel}
                  allHotels={allHotels}
                  validationByUnit={validationByUnit}
                  draggingUnitId={dragging?.unitId || null}
                  draggingValidationKey={dragging ? getValidationKey(dragging.unitId, dragging.athleteIds) : null}
                  dragOverHotelId={dragOverHotelId}
                  dragOverRoomTypeKey={dragOverRoomTypeKey}
                  onSelectHotel={setActiveHotelId}
                  onDragOverHotel={(hotelId) => setDragOverHotelId(hotelId)}
                  onDragLeaveHotel={() => setDragOverHotelId(null)}
                  onDropHotel={(hotelId) => permissions.canManageAssignments && dragging && void handleAssignToHotel(dragging.unitId, hotelId, dragging.athleteIds)}
                  onDragOverRoomType={(roomTypeKey) => setDragOverRoomTypeKey(roomTypeKey)}
                  onDragLeaveRoomType={() => setDragOverRoomTypeKey(null)}
                  onDropRoomType={(hotelId, roomTypeId) => permissions.canManageAssignments && dragging && void handleAssignToRoomType(dragging.unitId, hotelId, roomTypeId, dragging.athleteIds)}
                  dragOverBookingId={dragOverBookingId}
                  onDragOverBooking={(bookingId) => setDragOverBookingId(bookingId)}
                  onDragLeaveBooking={() => setDragOverBookingId(null)}
                  onDropBooking={(booking) => permissions.canManageAssignments && dragging && void handleAssignToExistingBooking(dragging.unitId, booking, dragging.athleteIds)}
                  hotelSearch={hotelSearch}
                  onHotelSearch={setHotelSearch}
                  regionFilter={regionFilter}
                  onRegionFilter={setRegionFilter}
                  onClearActiveHotel={() => setActiveHotelId(null)}
                  selectedBookingId={selected?.type === 'booking' ? selected.id : null}
                  onSelectBooking={(bookingId) => setSelected({ type: 'booking', id: bookingId })}
                  pendingAction={pendingAction}
                />
              ) : (
                <EmptyCenter text="Keine Hotels für die aktuelle Auswahl gefunden." />
              )
            )}

            {view === 'quotas' && (
              <QuotasPanel
                rows={quotaUsage}
                assignedUnits={assignedUnits}
                allUnits={allUnitsCombined}
                onSelect={setSelectedQuotaKey}
                filterNation={filterNation}
                onFilterNation={setFilterNation}
                filterDiscipline={filterDiscipline}
                onFilterDiscipline={setFilterDiscipline}
                filterGender={filterGender}
                onFilterGender={setFilterGender}
                nationOptions={nationOptions}
                disciplineOptions={disciplineOptions}
                genderOptions={genderOptions}
                refreshing={quotaRefreshing}
              />
            )}
          </main>

        </div>

        {selected && (
          <AssignmentDialog onClose={() => setSelected(null)}>
          <DetailPanel
              selectedUnit={selectedUnit}
              selectedBookingContext={selectedBookingContext}
              selectedAssignedUnit={selectedAssignedUnit}
              onUnassignBooking={handleUnassignBooking}
              onUnassignOccupant={handleUnassignOccupant}
              onMarkBookingAsSingle={handleMarkBookingAsSingle}
              pendingAction={pendingAction}
            onAcknowledgeImportChanges={handleAcknowledgeImportChanges}
            onShowDecision={setDecisionId}
          />
          </AssignmentDialog>
        )}

        {selectedQuotaKey && (
          <AssignmentDialog onClose={() => setSelectedQuotaKey(null)}>
            <QuotaDetail
              quotaKey={selectedQuotaKey}
              rows={quotaUsage}
              assignedUnits={assignedUnits}
              allUnits={allUnitsCombined}
              hotels={planning?.hotels ?? []}
              onShowDecision={(id) => {
                setSelectedQuotaKey(null);
                setDecisionId(id);
              }}
            />
          </AssignmentDialog>
        )}

        {error && <OperationsNotice message={error} onClose={() => setError(null)} />}
    </div>
    </div>
    </div>
    </Profiler>
    <ImportDecisionDialog decisionId={decisionId} onClose={() => setDecisionId(null)} onOpenSession={sessionId => void navigate(`/import?sessionId=${sessionId}`)} />
    </>
  );
}

function TopBar({
  view,
  onViewChange,
  progress,
  violations,
  saving,
  onRefresh,
  quotaRows,
  quotaRefreshing,
}: {
  view: AppView;
  onViewChange: (view: AppView) => void;
  progress: { done: number; total: number; percent: number };
  violations: number;
  saving: boolean;
  onRefresh: () => void;
  quotaRows: OfficialQuotaUsage[];
  quotaRefreshing: boolean;
}) {
  return (
    <div className="flex h-14 items-center justify-between border-b border-[#334766] bg-[#122033] px-4">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-xs font-bold text-blue-300">
            FIS
          </div>
          <div>
            <div className="text-sm font-bold text-white">NWSC 2027</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Zimmer-Disposition</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[
            { id: 'dispatch', label: 'Disposition' },
            { id: 'quotas', label: 'Quoten' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id as AppView)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition-all ${
                view === item.id
                  ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                  : 'border-transparent text-slate-500 hover:bg-[#152034] hover:text-slate-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <LiveQuotaStrip rows={quotaRows} onOpen={() => onViewChange('quotas')} refreshing={quotaRefreshing} />
        <div className="flex items-center gap-2">
          <div className="w-20">
            <CapacityBar pct={progress.percent} trackClassName="bg-[#314766]" />
          </div>
          <span className="font-mono text-slate-400">
            <strong className="text-slate-200">{progress.done}</strong> / {progress.total}
          </span>
        </div>

        {violations > 0 && (
          <div className="rounded-full border border-amber-700/60 bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-300">
            {violations} Quote
          </div>
        )}

        <button
          onClick={onRefresh}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-[#152034] hover:text-slate-200"
        >
          <RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
        </button>
        <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-[#152034] hover:text-slate-200">
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function LiveQuotaStrip({ rows, onOpen, refreshing }: { rows: OfficialQuotaUsage[]; onOpen: () => void; refreshing: boolean }) {
  const row = rows[0];
  if (!row) return <span className="hidden text-slate-500 xl:inline">Keine Quoten verfügbar</span>;

  return (
    <button onClick={onOpen} aria-busy={refreshing} aria-label={`Quoten: Officials ${row.assignedOfficials} von ${row.officialQuota}, Single Rooms ${row.singleRoomsUsed} von ${row.singleRoomsAllowed}`} className="relative hidden items-stretch overflow-hidden rounded-xl border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] text-left shadow-[var(--ops-shadow-xs)] transition-all hover:border-[var(--ops-primary)] hover:bg-[#263a54] xl:flex">
      {refreshing && <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-[#122033]/95 py-0.5 text-[9px] text-blue-200" role="status" aria-live="polite"><RefreshCw className="h-2.5 w-2.5 animate-spin" /> wird aktualisiert</span>}
      <span className="min-w-[100px] border-r border-[var(--ops-divider)] px-3 py-1.5">
        <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]">Officials</span>
        <span className={`flex items-center gap-1.5 font-mono font-bold ${row.assignedOfficials > row.officialQuota ? 'text-amber-300' : 'text-[var(--ops-text)]'}`}>
          {row.assignedOfficials} / {row.officialQuota}
          {row.assignedOfficials <= row.officialQuota && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        </span>
      </span>
      <span className="min-w-[112px] px-3 py-1.5">
        <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]">Single Rooms</span>
        <span className={`flex items-center gap-1.5 font-mono font-bold ${row.singleRoomsUsed > row.singleRoomsAllowed ? 'text-amber-300' : 'text-[var(--ops-text)]'}`}>
          {row.singleRoomsUsed} / {row.singleRoomsAllowed}
          {row.singleRoomsUsed <= row.singleRoomsAllowed && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        </span>
      </span>
    </button>
  );
}

function AssignmentDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Assignment Details" className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--ops-backdrop)] p-5 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="relative h-[min(760px,calc(100vh-150px))] w-full max-w-2xl overflow-hidden rounded-[var(--ops-radius-xxl)] border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] shadow-[var(--ops-shadow-lg)]" onMouseDown={(event) => event.stopPropagation()}>
        <button onClick={onClose} aria-label="Dialog schließen" className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-overlay)] text-[var(--ops-text-muted)] hover:text-white"><X className="h-4 w-4" /></button>
        {children}
      </div>
    </div>
  );
}

function OperationsNotice({ message, onClose }: { message: string; onClose: () => void }) {
  const isMissingContingent = /no kontingent available|keinen gültigen (slot|freien slot)/i.test(message);
  return (
    <div className="absolute inset-x-4 bottom-4 z-40 mx-auto max-w-2xl rounded-[var(--ops-radius-xl)] border border-[var(--ops-tone-info-border)] bg-[var(--ops-surface-raised)] p-4 shadow-[var(--ops-shadow-lg)]" role="status">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ops-tone-info-surface)] text-[var(--ops-info)]"><Building2 className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-[var(--ops-text)]">{isMissingContingent ? 'Zimmerkontingent prüfen' : 'Hinweis zur Disposition'}</div>
          <p className="mt-1 text-sm leading-5 text-[var(--ops-text-subtle)]">
            {isMissingContingent ? 'Für den gewählten Zeitraum ist kein passendes Zimmerkontingent vorhanden.' : message}
          </p>
        </div>
        <button onClick={onClose} aria-label="Meldung schließen" className="rounded-lg p-1.5 text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-overlay)] hover:text-[var(--ops-text)]"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function AlertBanner({
  row,
  onClose,
  onGoQuotas,
}: {
  row: OfficialQuotaUsage;
  onClose: () => void;
  onGoQuotas: () => void;
}) {
  const officialText = row.assignedOfficials > row.officialQuota
    ? `Official-Quote überschritten: ${row.nationCode} (${row.assignedOfficials}/${row.officialQuota})`
    : '';
  const singleText = row.singleRoomsUsed > row.singleRoomsAllowed
    ? `Single-Room-Kontingent überschritten (${row.singleRoomsUsed}/${row.singleRoomsAllowed})`
    : '';
  const message = [officialText, singleText].filter(Boolean).join(' und ');

  return (
    <div className="flex items-center gap-3 border-b border-amber-700/40 bg-[#3a2614] px-4 py-2.5 text-sm text-amber-200">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1 truncate">
        {message || 'Quoten-Warnung'}
      </div>
      <button onClick={onGoQuotas} className="font-semibold text-amber-200 hover:text-white">
        Zu den Quoten →
      </button>
      <button onClick={onClose} className="text-amber-400 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function QueueSidebar({
  units,
  regularUnits,
  progress,
  shareRequests,
  filterNation,
  onFilterNation,
  filterDiscipline,
  onFilterDiscipline,
  filterGender,
  onFilterGender,
  filterStatus,
  onFilterStatus,
  filterRoomCategory,
  onFilterRoomCategory,
  filterImportReview,
  onFilterImportReview,
  search,
  onSearch,
  nationOptions,
  disciplineOptions,
  genderOptions,
  draggingUnitId,
  draggingAthleteIds,
  canEditAssignments,
  onDragStart,
  onDragEnd,
  onSelectUnit,
  onQuickAssignPair,
  selectedUnitId,
  pendingAction,
}: {
  units: RoomBookingUnit[];
  regularUnits: RoomBookingUnit[];
  progress: { done: number; total: number; percent: number };
  shareRequests: Array<{ unit: RoomBookingUnit; compatible: boolean; mixed: boolean }>;
  filterNation: string;
  onFilterNation: (value: string) => void;
  filterDiscipline: string;
  onFilterDiscipline: (value: string) => void;
  filterGender: string;
  onFilterGender: (value: string) => void;
  filterStatus: QueueStatus;
  onFilterStatus: (value: QueueStatus) => void;
  filterRoomCategory: RoomCategoryFilter;
  onFilterRoomCategory: (value: RoomCategoryFilter) => void;
  filterImportReview: boolean;
  onFilterImportReview: (value: boolean) => void;
  search: string;
  onSearch: (value: string) => void;
  nationOptions: string[];
  disciplineOptions: string[];
  genderOptions: string[];
  draggingUnitId: string | null;
  draggingAthleteIds: string[];
  canEditAssignments: boolean;
  onDragStart: (unitId: string, athleteIds: string[], label: string) => void;
  onDragEnd: () => void;
  onSelectUnit: (unitId: string) => void;
  onQuickAssignPair: (unitId: string, athleteIds: string[]) => void;
  selectedUnitId: string | null;
  pendingAction: PendingAssignmentAction | null;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--ops-border)] px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-slate-100">Dispo-Warteschlange</div>
            <div className="text-xs text-slate-400">{units.length} passende Einheiten</div>
          </div>
          <div className="rounded-xl border border-amber-700/40 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-300">
            {units.length}
          </div>
        </div>

        <SearchInput value={search} onChange={onSearch} placeholder="Athleten suchen..." />

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <DarkSelect value={filterNation} onChange={onFilterNation} options={nationOptions} placeholder="Alle Nationen" />
          <DarkSelect value={filterDiscipline} onChange={onFilterDiscipline} options={disciplineOptions} placeholder="Alle Disziplinen" />
          <DarkSelect value={filterGender} onChange={onFilterGender} options={genderOptions} placeholder="Alle Gender" labelMap={{ M: 'Männlich', F: 'Weiblich' }} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => onFilterImportReview(!filterImportReview)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filterImportReview ? 'bg-amber-500 text-slate-950' : 'bg-[var(--ops-surface-elevated)] text-amber-200'}`}
          >
            Disposition prüfen
          </button>
          {[
            { id: 'pending', label: 'Offen' },
            { id: 'done', label: 'Erledigt' },
            { id: 'all', label: 'Alle' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onFilterStatus(item.id as QueueStatus)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                filterStatus === item.id
                  ? 'bg-[var(--ops-primary-emphasis)] text-[var(--ops-on-accent)]'
                  : 'bg-[var(--ops-surface-elevated)] text-[var(--ops-text-subtle)] hover:bg-[var(--ops-surface-overlay)] hover:text-[var(--ops-text)]'
              }`}
            >
              {item.label}
            </button>
          ))}
          {[
            { id: 'ez', label: 'EZ' },
            { id: 'dz', label: 'DZ' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onFilterRoomCategory(filterRoomCategory === item.id ? '' : item.id as RoomCategoryFilter)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                filterRoomCategory === item.id
                  ? 'bg-[var(--ops-primary-emphasis)] text-[var(--ops-on-accent)]'
                  : 'bg-[var(--ops-surface-elevated)] text-[var(--ops-text-subtle)] hover:bg-[var(--ops-surface-overlay)] hover:text-[var(--ops-text)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shareRequests.length > 0 && (
          <div className="border-b border-[var(--ops-divider)] px-3 py-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                <Link2 className="h-3.5 w-3.5 text-violet-400" />
                Zimmerpartner
              </div>
              <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                {shareRequests.length}
              </span>
            </div>
            <div className="space-y-2">
              {shareRequests.map(({ unit }) => (
                <QueueUnitCard
                  key={unit.unitId}
                  unit={unit}
                  selected={selectedUnitId === unit.unitId}
                  dragging={draggingUnitId === unit.unitId}
                  draggingAthleteIds={draggingAthleteIds}
                  canEditAssignments={canEditAssignments}
                  highlighted
                  onSelect={() => onSelectUnit(unit.unitId)}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onQuickAssign={onQuickAssignPair}
                  pending={pendingAction?.unitId === unit.unitId}
                />
              ))}
            </div>
          </div>
        )}

        <div className="px-3 py-3">
          <div className="space-y-2">
            {regularUnits.map((unit) => (
              <QueueUnitCard
                key={unit.unitId}
                unit={unit}
                selected={selectedUnitId === unit.unitId}
                dragging={draggingUnitId === unit.unitId}
                draggingAthleteIds={draggingAthleteIds}
                canEditAssignments={canEditAssignments}
                onSelect={() => onSelectUnit(unit.unitId)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onQuickAssign={onQuickAssignPair}
                pending={pendingAction?.unitId === unit.unitId}
              />
            ))}
            {!regularUnits.length && !shareRequests.length && (
              <div className="rounded-2xl border border-dashed border-[#5a7391] bg-[#2a3d58] px-4 py-10 text-center text-sm text-slate-300">
                Keine Einheiten mit den aktuellen Filtern.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--ops-divider)] px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-slate-400">Gesamtfortschritt</span>
          <span className="font-mono text-slate-300">{progress.done}/{progress.total}</span>
        </div>
        <CapacityBar pct={progress.percent} />
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-blue-300">{progress.percent}%</span>
          <span className="text-slate-400">{Math.max(progress.total - progress.done, 0)} offen</span>
        </div>
      </div>
    </div>
  );
}

function QueueUnitCard({
  unit,
  selected,
  dragging,
  draggingAthleteIds,
  canEditAssignments,
  highlighted = false,
  onSelect,
  onDragStart,
  onDragEnd,
  onQuickAssign,
  pending,
}: {
  unit: RoomBookingUnit;
  selected: boolean;
  dragging: boolean;
  draggingAthleteIds: string[];
  canEditAssignments: boolean;
  highlighted?: boolean;
  onSelect: () => void;
  onDragStart: (unitId: string, athleteIds: string[], label: string) => void;
  onDragEnd: () => void;
  onQuickAssign: (unitId: string, athleteIds: string[]) => void;
  pending: boolean;
}) {
  const primaryOccupant = unit.occupants[0];
  const partnerOccupant = unit.occupants[1] ?? null;
  const hasPairWarning = !sameGender(unit) || !sameNation(unit);
  const roomCategory = getUnitRoomCategory(unit).toUpperCase();
  const cardBase = highlighted
    ? 'border-transparent bg-[var(--ops-surface)] hover:bg-[var(--ops-surface-overlay)]'
    : selected
      ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]'
      : 'border-transparent bg-[var(--ops-surface)] hover:bg-[var(--ops-surface-elevated)]';

  return (
    <div
      onClick={onSelect}
      aria-busy={pending}
      className={`relative w-full cursor-pointer rounded-xl border px-2.5 py-2 text-left transition-all ${cardBase} ${dragging || pending ? 'opacity-60' : ''}`}
    >
      {pending && <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-[#122033] px-2 py-1 text-[9px] font-semibold text-blue-200" role="status" aria-live="polite"><RefreshCw className="h-3 w-3 animate-spin" /> Verarbeitung...</div>}
      {unit.occupants.some((occ) => occ.hasPendingReview) && <span className="mb-1 inline-flex rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">Disposition prüfen</span>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-extrabold leading-5 text-[var(--ops-text)]">
            {primaryOccupant ? `${primaryOccupant.firstname} ${primaryOccupant.lastname}` : '—'}
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-[var(--ops-text-subtle)]">
            Zimmerpartner: {partnerOccupant ? `${partnerOccupant.firstname} ${partnerOccupant.lastname}` : 'Zimmerpartner offen'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-mono font-semibold text-[var(--ops-text-subtle)]">
            <span>{unit.nationCode || '—'}</span>
            <span>·</span>
            <span>{roomCategory}</span>
            <span>·</span>
            <span>{formatShortDate(unit.checkInDate)} → {formatShortDate(unit.checkOutDate)}</span>
          </div>
          {primaryOccupant && <div className="mt-1.5"><SingleRoomStatusBadge status={primaryOccupant.single_room_status} /></div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${hasPairWarning ? 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] text-[var(--ops-warning)]' : 'border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)] text-[var(--ops-success)]'}`}>
            {hasPairWarning ? 'Warnung' : 'Bereit'}
          </span>
          <span className="text-[10px] text-slate-400">
            {unit.isFullyAssigned ? 'erledigt' : unit.hasAnyAssigned ? 'teilweise' : 'offen'}
          </span>
        </div>
      </div>

      {hasPairWarning && (
        <div className="mt-1.5 rounded-lg border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] px-2 py-1.5 text-[10px] text-[var(--ops-tone-warning-text)]">
          Gemischtes Paar erkannt — Zuweisung ist erlaubt, bitte kurz prüfen.
        </div>
      )}

      <div className="mt-2 grid gap-1.5">
        <QueueOccupantActionRow
          title="Athlet"
          occupant={primaryOccupant}
          isDragging={dragging && draggingAthleteIds.length === 1 && draggingAthleteIds[0] === primaryOccupant?.athleteId}
          canEditAssignments={canEditAssignments}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onQuickAssign={onQuickAssign}
          unitId={unit.unitId}
          pending={pending}
        />
        <QueueOccupantActionRow
          title="Zimmerpartner"
          occupant={partnerOccupant}
          emptyLabel="Zimmerpartner offen"
          isDragging={dragging && draggingAthleteIds.length === 1 && draggingAthleteIds[0] === partnerOccupant?.athleteId}
          canEditAssignments={canEditAssignments}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onQuickAssign={onQuickAssign}
          unitId={unit.unitId}
          pending={pending}
        />
        {unit.occupants.length >= 2 && (
          <button
            draggable={canEditAssignments && !pending}
            disabled={pending}
            title={!canEditAssignments ? 'Nur für Benutzer mit Bearbeitungsrechten verfügbar.' : undefined}
            onDragStart={() => onDragStart(unit.unitId, unit.occupants.map((occupant) => occupant.athleteId), 'Beide zusammen')}
            onDragEnd={onDragEnd}
            onClick={(event) => {
              event.stopPropagation();
              onQuickAssign(unit.unitId, unit.occupants.map((occupant) => occupant.athleteId));
            }}
            className="rounded-lg bg-[var(--ops-primary-emphasis)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--ops-on-accent)] transition-colors hover:opacity-90 disabled:cursor-wait"
          >
            Beide zusammen zuweisen
          </button>
        )}
      </div>
    </div>
  );
}

function QueueOccupantActionRow({
  title,
  occupant,
  emptyLabel = '—',
  isDragging,
  canEditAssignments,
  onDragStart,
  onDragEnd,
  onQuickAssign,
  unitId,
  pending,
}: {
  title: string;
  occupant?: RoomBookingUnit['occupants'][number] | null;
  emptyLabel?: string;
  isDragging: boolean;
  canEditAssignments: boolean;
  onDragStart: (unitId: string, athleteIds: string[], label: string) => void;
  onDragEnd: () => void;
  onQuickAssign: (unitId: string, athleteIds: string[]) => void;
  unitId: string;
  pending: boolean;
}) {
  if (!occupant) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--ops-border-strong)] px-2.5 py-1.5 text-[10px] text-[var(--ops-text-muted)]">
        {title}: {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${occupant.isAssigned ? 'border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)]'} ${isDragging ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{title}</div>
          <div className="text-xs font-bold text-[var(--ops-text)]">{occupant.firstname} {occupant.lastname}</div>
        </div>
        <span className={`text-[10px] font-semibold ${occupant.isAssigned ? 'text-emerald-300' : 'text-slate-300'}`}>
          {occupant.isAssigned ? 'zugewiesen' : 'offen'}
        </span>
      </div>
      <div className="mt-1 flex gap-1.5">
        <button
          draggable={canEditAssignments && !pending}
          disabled={pending}
          title={!canEditAssignments ? 'Nur für Benutzer mit Bearbeitungsrechten verfügbar.' : undefined}
          onDragStart={() => onDragStart(unitId, [occupant.athleteId], occupant.firstname)}
          onDragEnd={onDragEnd}
          onClick={(event) => {
            event.stopPropagation();
            onQuickAssign(unitId, [occupant.athleteId]);
          }}
          className="flex-1 rounded-md border border-[var(--ops-border-strong)] bg-[var(--ops-surface-overlay)] px-2 py-1 text-[10px] font-semibold text-[var(--ops-text)] transition-colors hover:border-[var(--ops-primary)] disabled:cursor-wait"
        >
          Einzeln zuweisen
        </button>
      </div>
    </div>
  );
}
function DispatchWorkspace({
  hotels,
  activeHotel,
  allHotels,
  validationByUnit,
  draggingUnitId,
  draggingValidationKey,
  dragOverHotelId,
  dragOverRoomTypeKey,
  dragOverBookingId,
  onSelectHotel,
  onDragOverHotel,
  onDragLeaveHotel,
  onDropHotel,
  onDragOverRoomType,
  onDragLeaveRoomType,
  onDropRoomType,
  onDragOverBooking,
  onDragLeaveBooking,
  onDropBooking,
  hotelSearch,
  onHotelSearch,
  regionFilter,
  onRegionFilter,
  onClearActiveHotel,
  selectedBookingId,
  onSelectBooking,
  pendingAction,
}: {
  hotels: AssignmentGridHotel[];
  activeHotel: AssignmentGridHotel | null;
  allHotels: AssignmentGridHotel[];
  validationByUnit: Record<string, AssignmentValidationResult[]>;
  draggingUnitId: string | null;
  draggingValidationKey: string | null;
  dragOverHotelId: string | null;
  dragOverRoomTypeKey: string | null;
  dragOverBookingId: string | null;
  onSelectHotel: (hotelId: string) => void;
  onDragOverHotel: (hotelId: string) => void;
  onDragLeaveHotel: () => void;
  onDropHotel: (hotelId: string) => void;
  onDragOverRoomType: (roomTypeKey: string) => void;
  onDragLeaveRoomType: () => void;
  onDropRoomType: (hotelId: string, roomTypeId: string) => void;
  onDragOverBooking: (bookingId: string) => void;
  onDragLeaveBooking: () => void;
  onDropBooking: (booking: AssignmentGridBooking) => void;
  hotelSearch: string;
  onHotelSearch: (value: string) => void;
  regionFilter: string;
  onRegionFilter: (value: string) => void;
  onClearActiveHotel: () => void;
  selectedBookingId: string | null;
  onSelectBooking: (bookingId: string) => void;
  pendingAction: PendingAssignmentAction | null;
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)]">
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)]">
        <HotelGridOrDetail
          hotels={hotels}
          activeHotel={activeHotel}
          allHotels={allHotels}
          validationByUnit={validationByUnit}
          draggingUnitId={draggingUnitId}
          draggingValidationKey={draggingValidationKey}
          dragOverHotelId={dragOverHotelId}
          dragOverRoomTypeKey={dragOverRoomTypeKey}
          dragOverBookingId={dragOverBookingId}
          onSelectHotel={onSelectHotel}
          onDragOverHotel={onDragOverHotel}
          onDragLeaveHotel={onDragLeaveHotel}
          onDropHotel={onDropHotel}
          onDragOverRoomType={onDragOverRoomType}
          onDragLeaveRoomType={onDragLeaveRoomType}
          onDropRoomType={onDropRoomType}
          onDragOverBooking={onDragOverBooking}
          onDragLeaveBooking={onDragLeaveBooking}
          onDropBooking={onDropBooking}
          hotelSearch={hotelSearch}
          onHotelSearch={onHotelSearch}
          regionFilter={regionFilter}
          onRegionFilter={onRegionFilter}
          onClearActiveHotel={onClearActiveHotel}
          selectedBookingId={selectedBookingId}
          onSelectBooking={onSelectBooking}
          pendingAction={pendingAction}
        />
      </div>
    </div>
  );
}

function HotelGridOrDetail({
  hotels,
  activeHotel,
  validationByUnit,
  draggingUnitId,
  draggingValidationKey,
  dragOverHotelId,
  dragOverRoomTypeKey,
  dragOverBookingId,
  onSelectHotel,
  onDragOverHotel,
  onDragLeaveHotel,
  onDropHotel,
  onDragOverRoomType,
  onDragLeaveRoomType,
  onDropRoomType,
  onDragOverBooking,
  onDragLeaveBooking,
  onDropBooking,
  hotelSearch,
  onHotelSearch,
  regionFilter,
  onRegionFilter,
  onClearActiveHotel,
  selectedBookingId,
  onSelectBooking,
  pendingAction,
}: {
  hotels: AssignmentGridHotel[];
  activeHotel: AssignmentGridHotel | null;
  validationByUnit: Record<string, AssignmentValidationResult[]>;
  draggingUnitId: string | null;
  draggingValidationKey: string | null;
  dragOverHotelId: string | null;
  dragOverRoomTypeKey: string | null;
  dragOverBookingId: string | null;
  onSelectHotel: (hotelId: string) => void;
  onDragOverHotel: (hotelId: string) => void;
  onDragLeaveHotel: () => void;
  onDropHotel: (hotelId: string) => void;
  onDragOverRoomType: (roomTypeKey: string) => void;
  onDragLeaveRoomType: () => void;
  onDropRoomType: (hotelId: string, roomTypeId: string) => void;
  onDragOverBooking: (bookingId: string) => void;
  onDragLeaveBooking: () => void;
  onDropBooking: (booking: AssignmentGridBooking) => void;
  hotelSearch: string;
  onHotelSearch: (value: string) => void;
  regionFilter: string;
  onRegionFilter: (value: string) => void;
  onClearActiveHotel: () => void;
  selectedBookingId: string | null;
  onSelectBooking: (bookingId: string) => void;
  pendingAction: PendingAssignmentAction | null;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)]">
      {!activeHotel && <div>
        <HotelGridView
          hotels={hotels}
          hotelSearch={hotelSearch}
          onHotelSearch={onHotelSearch}
          regionFilter={regionFilter}
          onRegionFilter={onRegionFilter}
          activeHotelId={activeHotel?.hotelId ?? null}
          draggingUnitId={draggingUnitId}
          draggingValidationKey={draggingValidationKey}
          dragOverHotelId={dragOverHotelId}
          validationByUnit={validationByUnit}
          onSelectHotel={onSelectHotel}
          onDragOverHotel={onDragOverHotel}
          onDragLeaveHotel={onDragLeaveHotel}
          onDropHotel={onDropHotel}
          pendingHotelId={pendingAction?.hotelId ?? null}
        />
      </div>}
      {activeHotel && (
        <div className="min-h-0">
          <HotelDetailView
            hotel={activeHotel}
            draggingUnitId={draggingUnitId}
            dragOverRoomTypeKey={dragOverRoomTypeKey}
            dragOverBookingId={dragOverBookingId}
            onDragOverRoomType={onDragOverRoomType}
            onDragLeaveRoomType={onDragLeaveRoomType}
            onDropRoomType={onDropRoomType}
            onDragOverBooking={onDragOverBooking}
            onDragLeaveBooking={onDragLeaveBooking}
            onDropBooking={onDropBooking}
            onBack={onClearActiveHotel}
            selectedBookingId={selectedBookingId}
            onSelectBooking={onSelectBooking}
            pendingAction={pendingAction}
          />
        </div>
      )}
    </div>
  );
}

function HotelGridView({
  hotels,
  hotelSearch,
  onHotelSearch,
  regionFilter,
  onRegionFilter,
  activeHotelId,
  draggingUnitId,
  draggingValidationKey,
  dragOverHotelId,
  validationByUnit,
  onSelectHotel,
  onDragOverHotel,
  onDragLeaveHotel,
  onDropHotel,
  pendingHotelId,
}: {
  hotels: AssignmentGridHotel[];
  hotelSearch: string;
  onHotelSearch: (value: string) => void;
  regionFilter: string;
  onRegionFilter: (value: string) => void;
  activeHotelId: string | null;
  draggingUnitId: string | null;
  draggingValidationKey: string | null;
  dragOverHotelId: string | null;
  validationByUnit: Record<string, AssignmentValidationResult[]>;
  onSelectHotel: (hotelId: string) => void;
  onDragOverHotel: (hotelId: string) => void;
  onDragLeaveHotel: () => void;
  onDropHotel: (hotelId: string) => void;
  pendingHotelId: string | null;
}) {
  const usedBeds = hotels.reduce((sum, hotel) => sum + hotel.slots.reduce((slotSum, slot) => slotSum + slot.bookings.reduce((bSum, booking) => bSum + booking.occupants.length, 0), 0), 0);
  const totalBeds = hotels.reduce((sum, hotel) => sum + hotel.slots.reduce((slotSum, slot) => slotSum + slot.capacity, 0), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#49617d] px-4 py-3">
        <SearchInput value={hotelSearch} onChange={onHotelSearch} placeholder="Hotels oder Orte suchen..." dark />
        <div className="flex items-center gap-1">
          {['', 'Bludenz', 'Feldkirch', 'Montafon'].map((region) => (
            <button
              key={region || 'all'}
              onClick={() => onRegionFilter(region)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                regionFilter === region
                  ? region
                    ? 'border border-blue-700/40 bg-blue-500/15 text-blue-300'
                  : 'bg-[#314763] text-slate-100'
                  : 'text-slate-400 hover:bg-[#344b68] hover:text-white'
              }`}
            >
              {region || 'Alle Regionen'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="font-mono text-slate-300">
            <strong className="text-white">{usedBeds}</strong> / {totalBeds} Betten
          </span>
          <div className="w-24">
            <CapacityBar pct={totalBeds > 0 ? Math.round((usedBeds / totalBeds) * 100) : 0} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 [scrollbar-color:#5e7aa0_#263a54] [scrollbar-width:thin]">
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
          {hotels.map((hotel) => (
            <HotelCard
              key={hotel.hotelId}
              hotel={hotel}
              active={activeHotelId === hotel.hotelId}
              dragOver={dragOverHotelId === hotel.hotelId}
              dragging={!!draggingUnitId}
              canDrop={draggingValidationKey ? hotelHasValidDrop(validationByUnit[draggingValidationKey] || [], hotel.hotelId) : false}
              onSelect={() => onSelectHotel(hotel.hotelId)}
              onDragOver={() => onDragOverHotel(hotel.hotelId)}
              onDragLeave={onDragLeaveHotel}
              onDrop={() => onDropHotel(hotel.hotelId)}
              pending={pendingHotelId === hotel.hotelId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HotelCard({
  hotel,
  active,
  dragOver,
  dragging,
  canDrop,
  onSelect,
  onDragOver,
  onDragLeave,
  onDrop,
  pending,
}: {
  hotel: AssignmentGridHotel;
  active: boolean;
  dragOver: boolean;
  dragging: boolean;
  canDrop: boolean;
  onSelect: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  pending: boolean;
}) {
  const totals = summarizeHotel(hotel);
  const regionColor = REGION_COLORS[hotel.region || ''] || '#4F8EF7';
  const contingentRange = getHotelContingentRange(hotel);

  return (
    <div
      onClick={onSelect}
      onDrop={(event) => {
        event.preventDefault();
        markAssignmentDrop();
        onDrop();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      aria-busy={pending}
      className={`group relative flex h-full min-h-[220px] cursor-pointer flex-col overflow-hidden rounded-2xl border transition-all ${
        dragOver
          ? canDrop
            ? 'scale-[1.02] border-blue-400/60 bg-blue-500/15'
            : 'border-red-400/50 bg-red-500/10'
          : active
            ? 'border-blue-400/60 bg-[#395274]'
            : 'border-[#506987] bg-[#314763] hover:border-[#6580a1] hover:bg-[#395274]'
      }`}
    >
      {pending && <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#122033]/55" role="status" aria-live="polite"><span className="flex items-center gap-2 rounded-lg bg-[#122033] px-3 py-2 text-xs font-semibold text-blue-100"><RefreshCw className="h-4 w-4 animate-spin" /> Loading</span></div>}
      <div className="h-[3px] w-full" style={{ backgroundColor: regionColor }} />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-extrabold text-[var(--ops-text)]">{hotel.hotelName}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
              <span className="text-[var(--ops-text-muted)]">{hotel.location || '—'}</span>
            </div>
            <div className="mt-1 text-xs font-bold text-[var(--ops-primary)]">{contingentRange}</div>
          </div>
          <div className="rounded-md border border-[#5e7898] bg-[#405978] px-2 py-0.5 text-[10px] font-bold text-slate-100">
            {totals.totalRooms} Zimmer
          </div>
        </div>

        <div className="rounded-lg bg-[var(--ops-surface-raised)] px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[var(--ops-text-subtle)]"><strong className="text-sm font-extrabold text-[var(--ops-text)]">{totals.usedBeds}</strong> belegt · <strong className="text-sm font-extrabold text-[var(--ops-success)]">{Math.max(0, totals.totalBeds - totals.usedBeds)}</strong> frei</span>
            <span className={`font-mono text-xs font-bold ${totals.percent >= 75 ? 'text-amber-300' : totals.percent > 0 ? 'text-blue-200' : 'text-slate-500'}`}>
              {totals.percent}%
            </span>
          </div>
          <CapacityBar pct={totals.percent} className="h-1.5" />
          <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-400">
            <span>{totals.usedRooms} Zimmer belegt</span>
            <span>{totals.totalRooms - totals.usedRooms} frei</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {totals.roomTypes.map((row) => (
            <div key={row.roomTypeId}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[9px]">
                <span className="truncate text-[10px] font-bold text-[var(--ops-text-subtle)]">{row.roomTypeName}</span>
                <span className="whitespace-nowrap font-mono text-[10px] font-bold text-[var(--ops-text)]">{row.usedBeds} / <span className="text-[var(--ops-success)]">{row.totalBeds - row.usedBeds}</span></span>
              </div>
              <CapacityBar pct={row.totalBeds > 0 ? Math.round((row.usedBeds / row.totalBeds) * 100) : 0} className="h-1" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[#49617d]/60 px-3 py-2">
        <span className="text-[10px] text-slate-400">{totals.roomTypes.length} Zimmertypen</span>
        <div className={`flex items-center gap-1 text-[11px] font-bold ${dragOver && canDrop ? 'text-blue-200' : active ? 'text-blue-200' : 'text-slate-400 group-hover:text-blue-200'}`}>
          {dragging && dragOver ? (canDrop ? 'Loslassen zum Zuweisen' : 'Blockiert') : 'Öffnen →'}
        </div>
      </div>
    </div>
  );
}

function HotelDetailView({
  hotel,
  draggingUnitId,
  dragOverRoomTypeKey,
  dragOverBookingId,
  onDragOverRoomType,
  onDragLeaveRoomType,
  onDropRoomType,
  onDragOverBooking,
  onDragLeaveBooking,
  onDropBooking,
  onBack,
  selectedBookingId,
  onSelectBooking,
  pendingAction,
}: {
  hotel: AssignmentGridHotel;
  draggingUnitId: string | null;
  dragOverRoomTypeKey: string | null;
  dragOverBookingId: string | null;
  onDragOverRoomType: (roomTypeKey: string) => void;
  onDragLeaveRoomType: () => void;
  onDropRoomType: (hotelId: string, roomTypeId: string) => void;
  onDragOverBooking: (bookingId: string) => void;
  onDragLeaveBooking: () => void;
  onDropBooking: (booking: AssignmentGridBooking) => void;
  onBack: () => void;
  selectedBookingId: string | null;
  onSelectBooking: (bookingId: string) => void;
  pendingAction: PendingAssignmentAction | null;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, AssignmentSlot[]>();
    for (const slot of hotel.slots) {
      const key = `${slot.roomTypeId}|${slot.roomTypeName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return Array.from(map.entries()).map(([key, slots]) => ({
      roomTypeId: key.split('|')[0],
      roomTypeName: key.split('|')[1],
      slots,
    }));
  }, [hotel.slots]);

  const [openRoomTypes, setOpenRoomTypes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenRoomTypes((current) => {
      const next = { ...current };
      for (const group of grouped) {
        if (!(group.roomTypeId in next)) next[group.roomTypeId] = true;
      }
      return next;
    });
  }, [grouped]);

  const totals = summarizeHotel(hotel);
  const contingentRange = getHotelContingentRange(hotel);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#49617d] bg-[#314763] px-4 py-2.5">
        <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#496688] hover:text-white"
            >
              <ChevronLeft className="mr-1 inline h-3.5 w-3.5" />
            Alle Hotels
          </button>
          <div className="flex-1">
            <h2 className="truncate text-lg font-extrabold text-[var(--ops-text)]">{hotel.hotelName}</h2>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>{hotel.location || '—'}</span>
              <span>·</span>
              <span style={{ color: REGION_COLORS[hotel.region || ''] || '#4F8EF7' }}>{hotel.region}</span>
            </div>
            <div className="mt-1 text-xs font-bold text-[var(--ops-primary)]">{contingentRange}</div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-base font-bold text-slate-100">
                {totals.usedBeds}
                <span className="text-sm text-slate-500">/{totals.totalBeds}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">belegte Betten</div>
            </div>
            <div className="w-24">
              <CapacityBar pct={totals.percent} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#2b405d] p-3 [scrollbar-color:#5e7aa0_#263a54] [scrollbar-width:thin]">
        <div className="space-y-2.5">
          {grouped.map((group) => {
            const summary = summarizeRoomType(group.slots);
            const roomTypeKey = `${hotel.hotelId}_${group.roomTypeId}`;
            const isOpen = openRoomTypes[group.roomTypeId] ?? true;
            const canDrop = !!draggingUnitId && hasSlotForRoomType(group.slots);

            return (
              <div key={group.roomTypeId} className="overflow-hidden rounded-2xl border border-[#506987]">
                <button
                  onClick={() => setOpenRoomTypes((current) => ({ ...current, [group.roomTypeId]: !isOpen }))}
                  className="flex w-full items-center gap-3 bg-[#395274] px-3 py-2.5 text-left hover:bg-[#45607f]"
                >
                  <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-extrabold text-white">{group.roomTypeName}</span>
                      <span className="rounded-md bg-[#4a6382] px-2 py-0.5 text-[10px] font-bold text-slate-100">
                        {summary.capacityPerRoom}p max
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs font-mono text-slate-400">
                      {summary.usedRooms}/{summary.totalRooms} Zimmer · {summary.usedBeds}/{summary.totalBeds} Betten
                    </div>
                  </div>
                  <div className="w-32">
                    <CapacityBar pct={summary.percent} />
                  </div>
                </button>

                {isOpen && (
                  <div className="grid auto-rows-fr grid-cols-1 gap-2 bg-[var(--ops-surface-elevated)] p-2 2xl:grid-cols-2">
                    {flattenBookingsFromSlots(group.slots).map((entry, index) => (
                      (() => {
                        const canAddPartner =
                          !!draggingUnitId &&
                          (entry.booking.capacity || 0) > entry.booking.occupants.length &&
                          entry.booking.occupants.length >= 1;
                        const isBookingDropTarget = dragOverBookingId === entry.booking.bookingId;
                        return (
                      <button
                        key={entry.booking.bookingId}
                        onClick={() => onSelectBooking(entry.booking.bookingId)}
                        onDrop={(event) => {
                          if (!canAddPartner) return;
                          event.preventDefault();
                          event.stopPropagation();
                          markAssignmentDrop();
                          onDropBooking(entry.booking);
                        }}
                        onDragOver={(event) => {
                          if (!canAddPartner) return;
                          event.preventDefault();
                          event.stopPropagation();
                          onDragOverBooking(entry.booking.bookingId);
                        }}
                        onDragLeave={onDragLeaveBooking}
                        aria-busy={pendingAction?.bookingId === entry.booking.bookingId}
                        disabled={pendingAction?.bookingId === entry.booking.bookingId}
                        className={`relative flex h-full w-full items-start justify-between rounded-xl border px-3 py-2 text-left transition-all ${
                          selectedBookingId === entry.booking.bookingId
                            ? 'border-blue-400/60 bg-[#45607f]'
                            : isBookingDropTarget && canAddPartner
                              ? 'border-violet-400/70 bg-violet-500/15'
                              : 'border-[#506987] bg-[#395274] hover:border-[#6580a1]'
                        }`}
                      >
                        {pendingAction?.bookingId === entry.booking.bookingId && <span className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-[#122033]/75 text-xs font-semibold text-blue-100" role="status" aria-live="polite"><RefreshCw className="h-4 w-4 animate-spin" /> Loading</span>}
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 flex h-6 min-w-8 flex-shrink-0 items-center justify-center rounded-md bg-[var(--ops-surface-overlay)] px-1.5 text-[9px] font-medium text-[var(--ops-text-muted)]">
                            {entry.slot.roomNumber || `#${index + 1}`}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-white">
                              {entry.slot.roomNumber ? `Zimmer ${entry.slot.roomNumber}` : `${group.roomTypeName} · Slot ${String(entry.slot.slotIndex).padStart(2, '0')}`}
                            </div>
                            <div className="mt-0.5 truncate text-xs font-bold text-[var(--ops-text)]">
                              {entry.booking.occupants.map((occ) => occ.name).join(' · ')}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px]">
                              {entry.booking.countsAsSingle ? <span className="rounded-md border border-amber-600/50 bg-amber-500/10 px-1.5 py-0.5 font-bold text-amber-200">DZ als EZ · exklusiv belegt</span> : <><span className={`rounded-md px-1.5 py-0.5 font-bold ${entry.booking.occupants.length < (entry.booking.capacity || 0) ? 'border border-emerald-700/50 bg-emerald-500/10 text-emerald-300' : 'bg-slate-500/10 text-slate-300'}`}>
                                {entry.booking.occupants.length} / {entry.booking.capacity || 0} belegt
                              </span>{entry.booking.occupants.length < (entry.booking.capacity || 0) && <span className="font-bold text-emerald-300">{(entry.booking.capacity || 0) - entry.booking.occupants.length} frei</span>}</>}
                              {canAddPartner && (
                                <span className={`${isBookingDropTarget ? 'text-blue-200' : 'text-slate-400'}`}>
                                  Partner hinzufügen
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 text-xs font-mono font-semibold text-[var(--ops-text-subtle)]">
                              {entry.booking.checkInDate || '—'} → {entry.booking.checkOutDate || '—'}
                            </div>
                          </div>
                        </div>
                      </button>
                        );
                      })()
                    ))}

                    {summary.remainingRooms > 0 ? (
                      <div
                        onDrop={(event) => {
                          event.preventDefault();
                          markAssignmentDrop();
                          onDropRoomType(hotel.hotelId, group.roomTypeId);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          onDragOverRoomType(roomTypeKey);
                        }}
                        onDragLeave={onDragLeaveRoomType}
                        className={`rounded-xl border border-dashed px-4 py-3 text-sm transition-all ${
                          dragOverRoomTypeKey === roomTypeKey
                            ? canDrop
                              ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                              : 'border-red-500/60 bg-red-500/10 text-red-200'
                            : 'border-[#5a7391] bg-[#395274] text-slate-200'
                        }`}
                      >
                        {dragOverRoomTypeKey === roomTypeKey
                          ? 'Loslassen, um neue Zuweisung anzulegen'
                          : `${summary.remainingRooms} freie Zimmer — hier zum Zuweisen ablegen`}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-xl border border-red-900/30 bg-red-950/20 px-4 py-2 text-xs text-red-500">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Voll belegt
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AthletesPanel({
  athletes,
  selectedAthleteId,
  onSelectAthlete,
}: {
  athletes: Athlete[];
  selectedAthleteId: string | null;
  onSelectAthlete: (athleteId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return athletes.filter((athlete) => {
      const haystack = `${athlete.firstname} ${athlete.lastname} ${athlete.nationCode} ${athlete.discipline || ''}`.toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [athletes, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#2D4260] bg-[#1C2B42] px-4 py-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Athleten suchen..." dark />
      </div>
      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-[#0C1624]">
            <tr>
              {['Name', 'Nation', 'Disz.', 'Gender', 'Anr.', 'Abr.', 'Status'].map((heading) => (
                <th key={heading} className="px-3 py-2.5 text-left text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1A2035]">
            {filtered.map((athlete) => (
              <tr
                key={athlete.id}
                onClick={() => onSelectAthlete(athlete.id)}
                className={`cursor-pointer transition-colors ${selectedAthleteId === athlete.id ? 'bg-[#1E3358]' : 'hover:bg-[#1C2B42]'}`}
              >
                <td className="px-3 py-2.5 text-xs font-semibold text-slate-200">{athlete.firstname} {athlete.lastname}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{athlete.nationCode}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{athlete.discipline || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{normalizeGender(athlete.gender) || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{athlete.arrivalDate || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{athlete.departureDate || '—'}</td>
                <td className="px-3 py-2.5 text-xs">
                  {athlete.assignment?.hasAssignment ? (
                    <span className="rounded-lg border border-emerald-800/50 bg-emerald-950/50 px-2 py-0.5 font-semibold text-emerald-400">Erledigt</span>
                  ) : (
                    <span className="rounded-lg border border-amber-800/40 bg-amber-950/40 px-2 py-0.5 font-semibold text-amber-400">Offen</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type QuotaCard = {
  key: string;
  nationCode: string;
  discipline: string;
  gender: string;
  athletes: number;
  officialQuota: number;
  assignedOfficials: number;
  singleRoomsAllowed: number;
  singleRoomsUsed: number;
  approvedExtraSingleRooms: number;
  requiredSingleRooms: number;
  implementedSingleRooms: number;
  remainingSingleRooms: number;
  openApprovals: number;
  approvedExceptions: number;
  quotaStatus: OfficialQuotaUsage['quotaStatus'];
  peopleTotal: number;
  peopleAssigned: number;
};

function buildQuotaCards(rows: OfficialQuotaUsage[], allUnits: RoomBookingUnit[], assignedUnits: RoomBookingUnit[]): QuotaCard[] {
  const cards = new Map<string, QuotaCard>();
  for (const row of rows) {
    const key = `${row.nationCode}::${row.discipline || '—'}::${row.gender}`;
    const current = cards.get(key) ?? {
      key,
      nationCode: row.nationCode,
      discipline: row.discipline || '—',
      gender: row.gender,
      athletes: 0,
      officialQuota: 0,
      assignedOfficials: 0,
      singleRoomsAllowed: 0,
      singleRoomsUsed: 0,
      approvedExtraSingleRooms: 0,
      requiredSingleRooms: 0,
      implementedSingleRooms: 0,
      remainingSingleRooms: 0,
      openApprovals: 0,
      approvedExceptions: 0,
      quotaStatus: 'FULFILLED',
      peopleTotal: 0,
      peopleAssigned: 0,
    };
    current.athletes += row.athletesEntered;
    current.officialQuota += row.officialQuota;
    current.assignedOfficials += row.assignedOfficials;
    current.singleRoomsAllowed += row.singleRoomsAllowed;
    current.singleRoomsUsed += row.singleRoomsUsed;
    current.approvedExtraSingleRooms += row.approvedExtraSingleRooms || 0;
    current.requiredSingleRooms += row.requiredSingleRooms || 0;
    current.implementedSingleRooms += row.implementedSingleRooms || 0;
    current.remainingSingleRooms += row.remainingSingleRooms || 0;
    current.openApprovals += row.openApprovals || 0;
    current.approvedExceptions += row.approvedExceptions || 0;
    if (row.quotaStatus === 'DECISION_REQUIRED' || (row.quotaStatus === 'EXCEPTION_APPROVED' && current.quotaStatus === 'FULFILLED')) current.quotaStatus = row.quotaStatus;
    cards.set(key, current);
  }

  for (const card of cards.values()) {
    const matches = (unit: RoomBookingUnit) => unit.nationCode === card.nationCode
      && unit.occupants.some((occupant) => (occupant.discipline || '—') === card.discipline
        && normalizeGender(occupant.gender) === card.gender);
    card.peopleTotal = allUnits.filter(matches).reduce((sum, unit) => sum + unit.occupants.length, 0);
    card.peopleAssigned = assignedUnits.filter(matches).reduce((sum, unit) => sum + unit.occupants.length, 0);
  }
  return [...cards.values()].sort((a, b) => a.nationCode.localeCompare(b.nationCode)
    || a.discipline.localeCompare(b.discipline) || a.gender.localeCompare(b.gender));
}

function quotaGenderLabel(gender: string) {
  if (gender === 'F') return 'Damen';
  if (gender === 'M') return 'Herren';
  return gender || '—';
}

function getQuotaState(card: QuotaCard) {
  if (card.quotaStatus === 'EXCEPTION_APPROVED') return { label: 'Quote verletzt · Ausnahme genehmigt', tone: 'success' as const, icon: FileCheck2 };
  if (card.quotaStatus === 'DECISION_REQUIRED') return { label: 'Quote verletzt · Entscheidung erforderlich', tone: 'warning' as const, icon: AlertTriangle };
  return { label: 'Quote erfüllt', tone: 'success' as const, icon: CheckCircle2 };
}

function QuotasPanel({
  rows, allUnits, assignedUnits, onSelect,
  filterNation, onFilterNation, filterDiscipline, onFilterDiscipline,
  filterGender, onFilterGender, nationOptions, disciplineOptions, genderOptions, refreshing,
}: {
  rows: OfficialQuotaUsage[];
  allUnits: RoomBookingUnit[];
  assignedUnits: RoomBookingUnit[];
  onSelect: (key: string) => void;
  filterNation: string;
  onFilterNation: (value: string) => void;
  filterDiscipline: string;
  onFilterDiscipline: (value: string) => void;
  filterGender: string;
  onFilterGender: (value: string) => void;
  nationOptions: string[];
  disciplineOptions: string[];
  genderOptions: string[];
  refreshing: boolean;
}) {
  const cards = buildQuotaCards(rows, allUnits, assignedUnits);
  const issues = cards.filter((card) => getQuotaState(card).tone !== 'success').length;
  return (
    <div className="h-full overflow-auto bg-[var(--ops-background)] p-5 lg:p-6" aria-busy={refreshing}>
      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--ops-divider)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--ops-primary)]"><Flag className="h-3.5 w-3.5" /> Live-Regelzentrale</div>
          <h2 className="text-xl font-bold text-[var(--ops-text)]">Quoten nach Nation, Disziplin &amp; Gender</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-[var(--ops-text-muted)]">Regelverstöße, Freigaben und Dispositionsstand auf einen Blick. {refreshing && <span className="flex items-center gap-1 text-blue-200" role="status" aria-live="polite"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> wird aktualisiert</span>}</p>
        </div>
        <div className="flex gap-2">
          <SummaryPill label="Kombinationen" value={cards.length} />
          <SummaryPill label="Handlungsbedarf" value={issues} warning={issues > 0} />
        </div>
      </div>
      <div className="mb-5 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] p-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-text-muted)]">Quotengruppen filtern</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <DarkSelect value={filterNation} onChange={onFilterNation} options={nationOptions} placeholder="Alle Nationen" />
          <DarkSelect value={filterDiscipline} onChange={onFilterDiscipline} options={disciplineOptions} placeholder="Alle Disziplinen" />
          <DarkSelect value={filterGender} onChange={onFilterGender} options={genderOptions} placeholder="Alle Gender" labelMap={{ M: 'Herren', F: 'Damen' }} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {cards.map((card) => {
          const state = getQuotaState(card);
          const StateIcon = state.icon;
          const officialsOver = card.assignedOfficials > card.officialQuota;
          const singlesOver = card.singleRoomsUsed > card.singleRoomsAllowed;
          const dispatchPct = card.peopleTotal > 0 ? Math.round(card.peopleAssigned / card.peopleTotal * 100) : 0;

          return (
            <button key={card.key} onClick={() => onSelect(card.key)} className="group overflow-hidden rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] text-left shadow-[var(--ops-shadow-xs)] transition-all hover:-translate-y-0.5 hover:border-[var(--ops-border-strong)] hover:shadow-[var(--ops-shadow-sm)] focus-visible:shadow-[var(--ops-focus-ring)]">
              <div className={`h-1 ${state.tone === 'success' ? 'bg-[var(--ops-success)]' : state.tone === 'warning' ? 'bg-[var(--ops-warning)]' : 'bg-[var(--ops-error)]'}`} />
              <div className="p-5">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] font-mono text-sm font-extrabold text-white">{card.nationCode}</div>
                    <div><div className="font-bold text-white">{card.nationCode} · {card.discipline} · {quotaGenderLabel(card.gender)}</div><div className="mt-1 text-xs text-[var(--ops-text-muted)]">Quotengruppe</div></div>
                  </div>
                  <StatusPill tone={state.tone} icon={<StateIcon className="h-3.5 w-3.5" />} label={state.label} />
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <KpiBlock label="Athleten" value={`${card.athletes}`} />
                  <KpiBlock label="Officials" value={`${card.assignedOfficials} / ${card.officialQuota}`} warning={officialsOver} />
                  <KpiBlock label="Single Rooms" value={`${card.singleRoomsUsed} / ${card.singleRoomsAllowed}`} warning={singlesOver} />
                  <KpiBlock label="Disposition" value={`${card.peopleAssigned} / ${card.peopleTotal}`} />
                </div>

                <div className="mt-4 space-y-3 rounded-xl border border-[var(--ops-divider)] bg-[var(--ops-surface)] p-3.5">
                  <QuotaProgress label="Officials" current={card.assignedOfficials} max={card.officialQuota} warning={officialsOver} />
                  <QuotaProgress label="Single Rooms" current={card.singleRoomsUsed} max={card.singleRoomsAllowed} warning={singlesOver} />
                  <QuotaProgress label="Disposition" current={card.peopleAssigned} max={card.peopleTotal} />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 text-xs">
                  <ApprovalInfo label="Offene Genehmigungen" value={String(card.openApprovals)} warning={card.openApprovals > 0} />
                  <ApprovalInfo label="Genehmigte Ausnahmen" value={String(card.approvedExceptions)} />
                  <ApprovalInfo label="Mehrpreis genehmigt" value={String(card.approvedExtraSingleRooms)} />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-[var(--ops-divider)] pt-4 text-xs"><span className="text-[var(--ops-text-muted)]">{dispatchPct}% disponiert</span><span className="flex items-center gap-1 font-semibold text-[var(--ops-primary)]">Details öffnen <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span></div>
              </div>
            </button>
          );
        })}

        {!cards.length && (
          <div className="col-span-full py-20 text-center text-sm text-[var(--ops-text-muted)]">Keine Quoten verfügbar</div>
        )}
      </div>
    </div>
  );
}

function SummaryPill({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] px-3.5 py-2"><span className="text-[10px] uppercase tracking-wider text-[var(--ops-text-muted)]">{label}</span><span className={`ml-2 font-mono font-bold ${warning ? 'text-[var(--ops-warning)]' : 'text-white'}`}>{value}</span></div>;
}

function StatusPill({ tone, label, icon }: { tone: 'success' | 'warning' | 'error'; label: string; icon: ReactNode }) {
  const classes = tone === 'success' ? 'border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)] text-[var(--ops-success)]' : tone === 'warning' ? 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] text-[var(--ops-warning)]' : 'border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]';
  return <span className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${classes}`}>{icon}{label}</span>;
}

function KpiBlock({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="rounded-xl border border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)] p-3"><div className="text-[9px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]">{label}</div><div className={`mt-1.5 font-mono text-lg font-bold ${warning ? 'text-[var(--ops-warning)]' : 'text-white'}`}>{value}</div></div>;
}

function QuotaProgress({ label, current, max, warning = false }: { label: string; current: number; max: number; warning?: boolean }) {
  const pct = max > 0 ? Math.round(current / max * 100) : 0;
  return <div><div className="mb-1.5 flex justify-between text-[10px]"><span className="text-[var(--ops-text-muted)]">{label}</span><span className={`font-mono ${warning ? 'text-[var(--ops-warning)]' : 'text-[var(--ops-text-subtle)]'}`}>{current} / {max}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--ops-surface-elevated)]"><div className={`h-full rounded-full ${warning ? 'bg-[var(--ops-warning)]' : 'bg-[var(--ops-primary-emphasis)]'}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>;
}

function ApprovalInfo({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div><div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--ops-text-muted)]">{label}</div><div className={`font-mono font-semibold ${warning ? 'text-[var(--ops-warning)]' : 'text-[var(--ops-text-subtle)]'}`}>{value}</div></div>;
}

type SingleRoomControlPerson = {
  athleteId: string;
  name: string;
  status: 'IN_QUOTA' | 'APPROVED_EXTRA';
  decisionId?: string | null;
  operationalLabel: string;
  operationalWarning: boolean;
};

function buildSingleRoomControlPeople(card: QuotaCard, allUnits: RoomBookingUnit[], hotels: AssignmentGridHotel[]): SingleRoomControlPerson[] {
  const bookingsByAthlete = new Map<string, AssignmentGridBooking>();
  hotels.forEach((hotel) => hotel.slots.forEach((slot) => slot.bookings.forEach((booking) => {
    booking.occupants.forEach((occupant) => bookingsByAthlete.set(occupant.athleteId, booking));
  })));

  const people = new Map<string, SingleRoomControlPerson>();
  allUnits.forEach((unit) => unit.occupants.forEach((occupant) => {
    if (occupant.nationCode !== card.nationCode
      || (occupant.discipline || '—') !== card.discipline
      || normalizeGender(occupant.gender) !== card.gender
      || (occupant.single_room_status !== 'IN_QUOTA' && occupant.single_room_status !== 'APPROVED_EXTRA')) return;

    const booking = bookingsByAthlete.get(occupant.athleteId);
    const isExclusive = Boolean(booking && booking.occupants.length === 1
      && (booking.countsAsSingle || booking.capacity === 1));
    people.set(occupant.athleteId, {
      athleteId: occupant.athleteId,
      name: occupant.name,
      status: occupant.single_room_status,
      decisionId: occupant.single_room_decision_id,
      operationalLabel: !booking
        ? 'Noch nicht disponiert'
        : isExclusive
          ? booking.capacity === 2 ? 'DZ als EZ exklusiv' : 'Einzelzimmer disponiert'
          : 'Zimmerpartner offen',
      operationalWarning: !isExclusive,
    });
  }));
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function QuotaDetail({ quotaKey, rows, allUnits, assignedUnits, hotels, onShowDecision }: {
  quotaKey: string;
  rows: OfficialQuotaUsage[];
  allUnits: RoomBookingUnit[];
  assignedUnits: RoomBookingUnit[];
  hotels: AssignmentGridHotel[];
  onShowDecision: (decisionId: string) => void;
}) {
  const card = buildQuotaCards(rows, allUnits, assignedUnits).find((candidate) => candidate.key === quotaKey);
  if (!card) return <EmptyCenter text="Quote nicht mehr verfügbar." />;
  const state = getQuotaState(card);
  const StateIcon = state.icon;
  const officialsOver = card.assignedOfficials > card.officialQuota;
  const singlesOver = card.singleRoomsUsed > card.singleRoomsAllowed;
  const controlPeople = buildSingleRoomControlPeople(card, allUnits, hotels);

  return <div className="flex h-full flex-col">
    <header className="border-b border-[var(--ops-divider)] bg-[var(--ops-surface)] px-6 py-5 pr-16">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3"><div className="flex h-12 min-w-12 items-center justify-center rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] font-mono text-sm font-extrabold text-white">{card.nationCode}</div><div><div className="text-lg font-bold text-white">{card.nationCode} · {card.discipline} · {quotaGenderLabel(card.gender)}</div><div className="mt-1 text-xs text-[var(--ops-text-muted)]">Quoten- und Regelstatus</div></div></div>
        <StatusPill tone={state.tone} icon={<StateIcon className="h-3.5 w-3.5" />} label={state.label} />
      </div>
    </header>
    <div className="flex-1 space-y-4 overflow-auto p-6">
      <DetailSection icon={<Eye className="h-4 w-4" />} title="Übersicht">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><KpiBlock label="Athleten" value={`${card.athletes}`} /><KpiBlock label="Officials" value={`${card.assignedOfficials} / ${card.officialQuota}`} warning={officialsOver} /><KpiBlock label="Single Rooms" value={`${card.singleRoomsUsed} / ${card.singleRoomsAllowed}`} warning={singlesOver} /><KpiBlock label="Disposition" value={`${card.peopleAssigned} / ${card.peopleTotal}`} /></div>
      </DetailSection>
      <DetailSection icon={<Bed className="h-4 w-4" />} title="Einzelzimmerentscheidungen">
        {controlPeople.length ? <div className="overflow-hidden rounded-xl border border-[var(--ops-border)]">
          {controlPeople.map((person) => <div key={person.athleteId} className="grid items-center gap-3 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)] p-3 last:border-0 md:grid-cols-[minmax(150px,1fr)_minmax(170px,auto)_auto]">
            <div>
              <strong className="block text-sm text-white">{person.name}</strong>
              <div className="mt-1.5"><SingleRoomStatusBadge status={person.status} /></div>
            </div>
            <span className={`flex items-center gap-1.5 text-sm font-semibold ${person.operationalWarning ? 'text-[var(--ops-tone-warning-text)]' : 'text-[var(--ops-tone-success-text)]'}`}>
              {person.operationalWarning && <AlertTriangle className="h-4 w-4 shrink-0" />}{person.operationalLabel}
            </span>
            <button type="button" disabled={!person.decisionId} title={!person.decisionId ? 'Innerhalb der Quote ist keine separate Importentscheidung hinterlegt.' : undefined} onClick={() => person.decisionId && onShowDecision(person.decisionId)} className="justify-self-start whitespace-nowrap text-sm font-semibold text-blue-300 hover:text-blue-200 disabled:cursor-not-allowed disabled:text-[var(--ops-text-subtle)] md:justify-self-end">Entscheidung anzeigen</button>
          </div>)}
        </div> : <p className="text-sm text-[var(--ops-text-muted)]">Keine Personen mit Einzelzimmeranspruch in dieser Quotengruppe.</p>}
      </DetailSection>
    </div>
  </div>;
}

function DetailSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4"><h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--ops-primary)]">{icon}{title}</h3>{children}</section>;
}

function DetailPanel({
  selectedUnit,
  selectedBookingContext,
  selectedAssignedUnit,
  onUnassignBooking,
  onUnassignOccupant,
  onMarkBookingAsSingle,
  pendingAction,
  onAcknowledgeImportChanges,
  onShowDecision,
}: {
  selectedUnit: RoomBookingUnit | null;
  selectedBookingContext: { booking: AssignmentGridBooking; slot: AssignmentSlot; hotel: AssignmentGridHotel } | null;
  selectedAssignedUnit: RoomBookingUnit | null;
  onUnassignBooking: (bookingId: string) => void;
  onUnassignOccupant: (bookingId: string, athleteId: string) => void;
  onMarkBookingAsSingle: (bookingId: string, countsAsSingle: boolean) => void;
  pendingAction: PendingAssignmentAction | null;
  onAcknowledgeImportChanges: (unit: RoomBookingUnit) => void;
  onShowDecision: (decisionId: string) => void;
}) {
  if (!selectedUnit && !selectedBookingContext) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#2D4260] bg-[#243550] text-slate-500">
          <Eye className="h-5 w-5" />
        </div>
        <div className="text-lg font-semibold text-slate-300">Nichts ausgewählt</div>
        <div className="mt-2 text-sm text-slate-500">Wähle eine Buchung oder eine Einheit aus</div>
        <div className="mt-6 rounded-2xl border border-dashed border-[#2D4260] px-6 py-4 text-sm text-slate-500">
          Ziehe eine Einheit aus der Warteschlange auf freie Zimmerbereiche
        </div>
      </div>
    );
  }

  if (selectedBookingContext) {
    const { booking, hotel, slot } = selectedBookingContext;
    return (
      <div className="flex h-full flex-col overflow-y-auto" aria-busy={pendingAction?.bookingId === booking.bookingId}>
        <div className="flex items-start justify-between border-b border-[#334766] px-4 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Zimmerdetail</div>
            <div className="mt-2 text-sm font-bold text-slate-100">{hotel.hotelName}</div>
            <div className="mt-1 text-[10px] font-mono text-slate-400">
              {slot.roomTypeName} · {booking.checkInDate || '—'} → {booking.checkOutDate || '—'}
            </div>
          </div>
        </div>
        <div className="border-b border-[#334766] px-4 py-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Bewohner</div>
          <div className="space-y-2">
            {booking.occupants.map((occupant) => (
              <div key={occupant.athleteId} className="rounded-xl border border-[#425a79] bg-[#2a3e5d] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{occupant.name}</div>
                    <div className="mt-1 text-[10px] font-mono text-slate-400">{occupant.nationCode}</div>
                    <div className="mt-1.5"><SingleRoomStatusBadge status={occupant.single_room_status} /></div>
                  </div>
                  {booking.occupants.length > 1 && (
                    <button
                      disabled={pendingAction?.bookingId === booking.bookingId}
                      onClick={() => onUnassignOccupant(booking.bookingId, occupant.athleteId)}
                      className="rounded-lg border border-amber-700/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20"
                    >
                      {pendingAction?.athleteIds?.includes(occupant.athleteId) ? <><RefreshCw className="mr-1 inline h-3 w-3 animate-spin" /> Loading</> : 'Nur diese Person'}
                    </button>
                  )}
                </div>
                {occupant.single_room_status !== 'NONE' && occupant.single_room_status !== 'PENDING_APPROVAL' && (
                  <SingleRoomDecisionCard decisionId={occupant.single_room_decision_id} onShowDecision={onShowDecision} />
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Zuweisung</div>
          <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <div>
                <div className="text-xs font-bold text-emerald-300">{hotel.hotelName}</div>
                <div className="mt-0.5 text-[10px] font-mono text-emerald-500">
                  {slot.roomTypeName} · {slot.roomNumber || `Slot ${String(slot.slotIndex).padStart(2, '0')}`}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-[#39506f] bg-[#243650] p-3 text-xs text-slate-300">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Hotel</div>
                <div className="mt-1 font-semibold text-slate-100">{hotel.hotelName}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Ort</div>
                <div className="mt-1 font-semibold text-slate-100">{hotel.location || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Anreise</div>
                <div className="mt-1 font-mono text-slate-200">{booking.checkInDate || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Abreise</div>
                <div className="mt-1 font-mono text-slate-200">{booking.checkOutDate || '—'}</div>
              </div>
            </div>
          </div>
          {(booking.capacity || 0) === 2 && (
            <div className="mt-3 rounded-xl border border-[#39506f] bg-[#243650] p-3 text-xs font-semibold text-slate-200">
              {booking.countsAsSingle ? 'DZ wird aktuell exklusiv genutzt' : 'DZ wird gemeinsam genutzt'}
            </div>
          )}
          {((booking.capacity || 0) > 1 && booking.occupants.length === 1) && (
            <button
              disabled={pendingAction?.bookingId === booking.bookingId}
              onClick={() => onMarkBookingAsSingle(booking.bookingId, !booking.countsAsSingle)}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold transition-colors ${
                booking.countsAsSingle
                  ? 'border-amber-700/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                  : 'border-[#5e7aa0] bg-[#314763] text-slate-100 hover:bg-[#395274]'
              }`}
            >
              {pendingAction?.kind === 'single' && pendingAction.bookingId === booking.bookingId ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Bed className="h-3.5 w-3.5" />}
              {booking.countsAsSingle ? 'EZ-Markierung entfernen' : 'Als EZ werten'}
            </button>
          )}
          <button
            disabled={pendingAction?.bookingId === booking.bookingId}
            onClick={() => onUnassignBooking(booking.bookingId)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-800/50 bg-red-950/30 py-2.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-950/50"
          >
            {pendingAction?.kind === 'unassign' && pendingAction.bookingId === booking.bookingId ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {pendingAction?.kind === 'unassign' && pendingAction.bookingId === booking.bookingId ? 'Ausbuchen läuft...' : 'Zuweisung entfernen'}
          </button>
        </div>
      </div>
    );
  }

  if (!selectedUnit) return null;

  const pendingChanges = Array.from(new Set(selectedUnit.occupants.filter((occ) => occ.hasPendingReview).flatMap((occ) => occ.importChangeTypes)));

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {pendingChanges.length > 0 && (
        <div className="m-4 mb-0 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">
          <div className="text-xs font-bold">Importänderungen</div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{pendingChanges.map((change) => <li key={change}>{IMPORT_CHANGE_LABELS[change]}</li>)}</ul>
          <button onClick={() => onAcknowledgeImportChanges(selectedUnit)} className="mt-3 w-full rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950">Keine Änderung notwendig · geprüft speichern</button>
        </div>
      )}
      <div className="border-b border-[#334766] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-400/15 text-sm font-bold text-blue-200">
            {selectedUnit.nationCode}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Einheitsdetail</div>
            <div className="mt-2 text-sm font-bold text-slate-100">
              {selectedUnit.occupants.map((occ) => `${occ.firstname} ${occ.lastname}`).join(' / ')}
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-400">
              {selectedUnit.roomTypeLabel} · {selectedUnit.checkInDate || '—'} → {selectedUnit.checkOutDate || '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-[#334766] px-4 py-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Bewohner</div>
        <div className="space-y-2">
          {selectedUnit.occupants.map((occupant) => (
            <div key={occupant.athleteId} className="rounded-xl border border-[#425a79] bg-[#2a3e5d] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{occupant.firstname} {occupant.lastname}</div>
                  <div className="mt-1 text-[10px] font-mono text-slate-400">
                    {occupant.nationCode} · {occupant.discipline || '—'} · {normalizeGender(occupant.gender) || '—'}
                  </div>
                  <div className="mt-1.5"><SingleRoomStatusBadge status={occupant.single_room_status} /></div>
                </div>
                <span className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${occupant.isAssigned ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-500/10 text-slate-300'}`}>
                  {occupant.isAssigned ? 'zugewiesen' : 'offen'}
                </span>
              </div>
              {occupant.single_room_status !== 'NONE' && occupant.single_room_status !== 'PENDING_APPROVAL' && (
                <SingleRoomDecisionCard decisionId={occupant.single_room_decision_id} onShowDecision={onShowDecision} />
              )}
            </div>
          ))}
        </div>

        {selectedUnit.occupants.length >= 2 && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-violet-700/40 bg-violet-950/25 px-3 py-2 text-xs text-violet-200">
            <Link2 className="h-3.5 w-3.5" />
            Gewünschtes Zimmerpartner-Paar erkannt
          </div>
        )}
      </div>

      <div className="px-4 py-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Zuweisung</div>
        {selectedAssignedUnit && selectedAssignedUnit.hasAnyAssigned ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <div>
                  <div className="text-xs font-bold text-emerald-300">{selectedAssignedUnit.isFullyAssigned ? (selectedAssignedUnit.assignedRoomNumber || 'Aktive Zuweisung') : 'Teilweise zugewiesen'}</div>
                  <div className="mt-0.5 text-[10px] font-mono text-emerald-500">
                    {selectedAssignedUnit.isFullyAssigned ? 'Bereits zugewiesen' : 'Mindestens eine Person ist bereits eingeplant'}
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-[#39506f] bg-[#243650] p-3 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Nation</div>
                  <div className="mt-1 font-semibold text-slate-100">{selectedUnit.nationCode}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Typ</div>
                  <div className="mt-1 font-semibold text-slate-100">{selectedUnit.roomTypeLabel}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Anreise</div>
                  <div className="mt-1 font-mono text-slate-200">{selectedUnit.checkInDate || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Abreise</div>
                  <div className="mt-1 font-mono text-slate-200">{selectedUnit.checkOutDate || '—'}</div>
                </div>
              </div>
            </div>
            {selectedAssignedUnit.assignedBookingId && (
              <button
                onClick={() => onUnassignBooking(selectedAssignedUnit.assignedBookingId!)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-800/50 bg-red-950/30 py-2.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-950/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Zuweisung entfernen
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-amber-700/40 bg-amber-950/15 px-3 py-3 text-xs text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Zuweisung starten — auf einen Zimmerbereich ziehen
          </div>
        )}
      </div>
    </div>
  );
}

function SingleRoomDecisionCard({ decisionId, onShowDecision }: { decisionId?: string | null; onShowDecision: (decisionId: string) => void }) {
  return (
    <div className="mt-2 border-t border-[#425a79] pt-2 text-xs text-slate-300">
      <div className="font-bold text-slate-100">Einzelzimmerstatus</div>
      <div className="mt-1">Importentscheidung: <span className="font-semibold text-emerald-300">Genehmigt</span></div>
      {decisionId && <button onClick={() => onShowDecision(decisionId)} className="mt-1.5 font-semibold text-blue-300 hover:text-blue-200">Entscheidung anzeigen</button>}
    </div>
  );
}
function EmptyCenter({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
  dark,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  dark?: boolean;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border pl-9 pr-3 py-2 text-sm transition-all focus:outline-none ${
          dark
            ? 'border-[#425a79] bg-[#213550] text-slate-100 placeholder:text-slate-500 focus:border-blue-400/50'
            : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-blue-500'
        }`}
      />
    </div>
  );
}

function DarkSelect({
  value,
  onChange,
  options,
  placeholder,
  labelMap,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  labelMap?: Record<string, string>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-xl border border-[#2D4260] bg-[#152034] px-3 py-2 text-sm text-slate-300 transition-all focus:border-blue-500/50 focus:outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labelMap?.[option] || option}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    </div>
  );
}

function CapacityBar({
  pct,
  className = '',
  trackClassName = 'bg-[#253A56]',
}: {
  pct: number;
  className?: string;
  trackClassName?: string;
}) {
  const color = pct >= 95 ? 'var(--ops-error)' : pct >= 75 ? 'var(--ops-warning)' : pct > 0 ? 'var(--ops-primary)' : 'var(--ops-border)';
  return (
    <div className={`h-2 overflow-hidden rounded-full ${trackClassName} ${className}`}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(pct, 100))}%`, backgroundColor: color }} />
    </div>
  );
}

function StatusTag({ tone, label }: { tone: 'green' | 'red'; label: string }) {
  return (
    <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${
      tone === 'green'
        ? 'border-emerald-800/50 bg-emerald-950/50 text-emerald-400'
        : 'border-red-800/50 bg-red-950/50 text-red-400'
    }`}>
      {label}
    </span>
  );
}

function QuotaMetric({
  label,
  current,
  max,
  tone = 'blue',
}: {
  label: string;
  current: number;
  max: number;
  tone?: 'blue' | 'red';
}) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mb-2 flex items-end gap-1">
        <span className={`font-mono text-2xl font-bold ${tone === 'red' ? 'text-red-400' : 'text-slate-200'}`}>{current}</span>
        <span className="pb-0.5 text-xs text-slate-600">/ {max}</span>
      </div>
      <CapacityBar pct={pct} />
    </div>
  );
}

function normalizeGender(value?: string | null) {
  if (!value) return '';
  const normalized = value.trim().toUpperCase();
  if (normalized.startsWith('M')) return 'M';
  if (normalized.startsWith('F') || normalized.startsWith('W')) return 'F';
  return normalized;
}

function sameGender(unit: RoomBookingUnit) {
  const genders = Array.from(new Set(unit.occupants.map((occ) => normalizeGender(occ.gender)).filter(Boolean)));
  return genders.length <= 1;
}

function sameNation(unit: RoomBookingUnit) {
  const nations = Array.from(new Set(unit.occupants.map((occ) => occ.nationCode).filter(Boolean)));
  return nations.length <= 1;
}

function getValidationKey(unitId: string, athleteIds?: string[]) {
  if (!athleteIds || athleteIds.length !== 1) return unitId;
  return `${unitId}:athlete:${athleteIds[0]}`;
}

function getUnitRoomCategory(unit: RoomBookingUnit): RoomCategoryFilter {
  if (unit.roomCategoryLabel === 'ez' || unit.roomCategoryLabel === 'dz') {
    return unit.roomCategoryLabel;
  }
  if (unit.roomTypeLabel === 'single') return 'ez';
  if (unit.roomTypeLabel === 'double') return 'dz';
  return '';
}

function formatShortDate(value?: string | null) {
  if (!value) return '—';
  return value.slice(5);
}

function summarizeHotel(hotel: AssignmentGridHotel) {
  const roomTypeMap = new Map<string, { roomTypeId: string; roomTypeName: string; usedBeds: number; totalBeds: number; capacity: number }>();
  let usedBeds = 0;
  let totalBeds = 0;
  let usedRooms = 0;

  for (const slot of hotel.slots) {
    const key = `${slot.roomTypeId}|${slot.roomTypeName}`;
    const slotUsedBeds = slot.bookings.reduce((sum, booking) => sum + booking.occupants.length, 0);
    usedBeds += slotUsedBeds;
    totalBeds += slot.capacity;
    if (slot.bookings.length > 0) usedRooms += 1;

    if (!roomTypeMap.has(key)) {
      roomTypeMap.set(key, {
        roomTypeId: slot.roomTypeId,
        roomTypeName: slot.roomTypeName,
        usedBeds: 0,
        totalBeds: 0,
        capacity: slot.capacity,
      });
    }

    const current = roomTypeMap.get(key)!;
    current.usedBeds += slotUsedBeds;
    current.totalBeds += slot.capacity;
  }

  const starts = hotel.slots.map((slot) => slot.dateCoverage.availableFrom).filter(Boolean) as string[];
  const ends = hotel.slots.map((slot) => slot.dateCoverage.availableUntil).filter(Boolean) as string[];
  const days = starts.length && ends.length
    ? Math.max(1, differenceInDays(starts.sort()[0], ends.sort()[ends.length - 1]))
    : 0;

  return {
    usedBeds,
    totalBeds,
    usedRooms,
    totalRooms: hotel.slots.length,
    percent: totalBeds > 0 ? Math.round((usedBeds / totalBeds) * 100) : 0,
    days,
    roomTypes: Array.from(roomTypeMap.values()),
  };
}

function summarizeRoomType(slots: AssignmentSlot[]) {
  const totalRooms = slots.length;
  const totalBeds = slots.reduce((sum, slot) => sum + slot.capacity, 0);
  const usedRooms = slots.filter((slot) => slot.bookings.length > 0).length;
  const usedBeds = slots.reduce((sum, slot) => sum + slot.bookings.reduce((bookingSum, booking) => bookingSum + booking.occupants.length, 0), 0);
  return {
    totalRooms,
    remainingRooms: Math.max(0, totalRooms - usedRooms),
    totalBeds,
    usedRooms,
    usedBeds,
    percent: totalBeds > 0 ? Math.round((usedBeds / totalBeds) * 100) : 0,
    capacityPerRoom: slots[0]?.capacity || 0,
  };
}

function flattenBookingsFromSlots(slots: AssignmentSlot[]) {
  return slots.flatMap((slot) => slot.bookings.map((booking) => ({ booking, slot })));
}

function getHotelContingentRange(hotel: AssignmentGridHotel) {
  const starts = hotel.slots.map((slot) => slot.dateCoverage.availableFrom).filter((date): date is string => Boolean(date)).sort();
  const ends = hotel.slots.map((slot) => slot.dateCoverage.availableUntil).filter((date): date is string => Boolean(date)).sort();
  if (!starts.length || !ends.length) return 'Zeitraum nicht hinterlegt';
  return `${formatGermanDate(starts[0])} – ${formatGermanDate(ends[ends.length - 1])}`;
}

function formatGermanDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return day && month && year ? `${day}.${month}.${year}` : value;
}

function hasSlotForRoomType(slots: AssignmentSlot[]) {
  return slots.some((slot) => slot.bookings.length === 0);
}

function hotelHasValidDrop(validations: AssignmentValidationResult[], hotelId: string) {
  return validations.some((validation) => validation.status !== 'blocked' && validation.slotId.startsWith(`${hotelId}:`));
}

function findFirstValidSlot(validations: AssignmentValidationResult[], hotels: AssignmentGridHotel[], hotelId: string) {
  const hotel = hotels.find((item) => item.hotelId === hotelId);
  if (!hotel) return null;
  for (const slot of hotel.slots) {
    const result = validations.find((entry) => entry.slotId === slot.slotId);
    if (result && result.status !== 'blocked') return slot;
  }
  return null;
}

function findFirstValidSlotForRoomType(validations: AssignmentValidationResult[], hotels: AssignmentGridHotel[], hotelId: string, roomTypeId: string) {
  const hotel = hotels.find((item) => item.hotelId === hotelId);
  if (!hotel) return null;
  for (const slot of hotel.slots.filter((entry) => entry.roomTypeId === roomTypeId)) {
    const result = validations.find((entry) => entry.slotId === slot.slotId);
    if (result && result.status !== 'blocked') return slot;
  }
  return null;
}

function findAssignedUnitForBooking(bookingId: string, assignedUnits: RoomBookingUnit[]) {
  return assignedUnits.find((unit) => unit.assignedBookingId === bookingId) ?? null;
}

function differenceInDays(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = endDate.getTime() - startDate.getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function extractErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}
