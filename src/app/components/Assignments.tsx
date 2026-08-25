import { Profiler, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Dialog, DialogContent, IconButton, Switch, Tooltip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
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
  Eye,
  Flag,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import { ImportConflictNotice } from './ImportConflictNotice';
import { AssignmentStatusChip, PendingChanges } from './assignment/AssignmentInfo';
import { OccupantCard } from './assignment/OccupantCard';
import { SingleRoomStatusBadge } from './SingleRoomStatusBadge';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import { ActivitySummaryCard } from './activity';
import { compareOperationalHotels, matchesOperationalHotelFilter, OperationalHotelFilters, type OperationalHotelFilter, type OperationalHotelState } from './OperationalHotelFilters';
import { DialogFooter, DialogHeader, OpsButton, WorkspaceFrame } from '../design-system';
import type { OperationsLocationState } from '../operationsContext';
import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import { assignmentPerformanceEnabled, markAssignmentDrop, recordAssignmentRender } from '../services/assignmentPerformance';
import type { OfficialQuotaUsage } from '../services/fisRules';
import { evaluateAllQuotaGroups, evaluateCurrentQuotaUsage, evaluateQuotaUsageRow, quotaAssignmentsFromPlanning, quotaUsageKey } from '../services/quotaEvaluation';
import type {
  AssignmentGridBooking,
  AssignmentGridHotel,
  AssignmentPlanningView,
  AssignmentSlot,
  AssignmentValidationResult,
  Athlete,
  RoomBookingUnit,
} from '../types';

type AppView = 'dispatch' | 'quotas';
type QueueStatus = 'pending' | 'all';
type FilterMode = 'synchronized' | 'queue';
type RoomCategoryFilter = '' | 'ez' | 'dz';
type AssignmentFilterCriteria = {
  search: string;
  nation: string;
  discipline: string;
  gender: string;
  status: QueueStatus;
  roomCategory: RoomCategoryFilter;
  importReview: boolean;
};
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
  Bludenz: 'var(--ops-primary)',
  Montafon: 'var(--ops-success)',
  Feldkirch: 'var(--ops-secondary)',
};

function AssignmentPerformanceBoundary({ id, children }: { id: string; children: ReactNode }) {
  return assignmentPerformanceEnabled
    ? <Profiler id={id} onRender={recordAssignmentRender}>{children}</Profiler>
    : children;
}

export function Assignments() {
  const permissions = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as ({ athleteId?: string; assignmentId?: string; view?: AppView; quotaKey?: string } & OperationsLocationState) | null;
  const routeQuery = new URLSearchParams(location.search);
  const requestedAthleteId = routeQuery.get('athleteId') || routeState?.athleteId || routeState?.operationsContext?.personId; const requestedAssignmentId=routeQuery.get('assignmentId')||routeState?.assignmentId||routeState?.operationsContext?.assignmentId;
  const requestedRoomTypeId = routeQuery.get('roomTypeId');
  const [planning, setPlanning] = useState<AssignmentPlanningView | null>(null);
  const [validationByUnit, setValidationByUnit] = useState<Record<string, AssignmentValidationResult[]>>({});
  const validationCacheRef = useRef<Record<string, AssignmentValidationResult[]>>({});
  const validationRequestsRef = useRef(new Map<string, Promise<AssignmentValidationResult[]>>());
  const validationGenerationRef = useRef(0);
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
  const [activeHotelId, setActiveHotelId] = useState<string | null>(routeQuery.get('hotelId'));
  const [showAlert, setShowAlert] = useState(true);
  const [selectedQuotaKey, setSelectedQuotaKey] = useState<string | null>(routeState?.quotaKey || routeState?.operationsContext?.quotaKey || null);

  const [queueSearch, setQueueSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('queue');
  const [hotelSearch, setHotelSearch] = useState('');
  const [filterNation, setFilterNation] = useState('');
  const [filterDiscipline, setFilterDiscipline] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const requestedWorkflow = routeQuery.get('workflow') || (routeQuery.get('status') === 'open' ? 'open' : '');
  const [filterStatus, setFilterStatus] = useState<QueueStatus>(requestedWorkflow === 'review' ? 'all' : 'pending');
  const [filterRoomCategory, setFilterRoomCategory] = useState<RoomCategoryFilter>('');
  const [filterImportReview, setFilterImportReview] = useState(requestedWorkflow === 'review');
  const [regionFilter, setRegionFilter] = useState('');
  const [hotelOperationalFilter, setHotelOperationalFilter] = useState<OperationalHotelFilter>('attention');

  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dragOverHotelId, setDragOverHotelId] = useState<string | null>(null);
  const [dragOverRoomTypeKey, setDragOverRoomTypeKey] = useState<string | null>(null);
  const [dragOverBookingId, setDragOverBookingId] = useState<string | null>(null);

  const replacePlanning = (planningData: AssignmentPlanningView) => {
    validationGenerationRef.current += 1;
    validationCacheRef.current = {};
    validationRequestsRef.current.clear();
    setValidationByUnit({});
    setPlanning(planningData);
  };

  const ensureAssignmentValidations = (unitId: string, athleteIds?: string[]) => {
    const validationKey = getValidationKey(unitId, athleteIds);
    if (Object.prototype.hasOwnProperty.call(validationCacheRef.current, validationKey)) {
      return Promise.resolve(validationCacheRef.current[validationKey]);
    }
    const pendingRequest = validationRequestsRef.current.get(validationKey);
    if (pendingRequest) return pendingRequest;

    const generation = validationGenerationRef.current;
    const request = api.getAssignmentValidations(validationKey).then((result) => {
      if (generation === validationGenerationRef.current) {
        validationCacheRef.current[validationKey] = result.validations;
        setValidationByUnit((current) => ({
          ...current,
          [validationKey]: result.validations,
        }));
      }
      return result.validations;
    }).finally(() => {
      if (validationRequestsRef.current.get(validationKey) === request) {
        validationRequestsRef.current.delete(validationKey);
      }
    });
    validationRequestsRef.current.set(validationKey, request);
    return request;
  };

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadQuotaUsage();
  }, [filterNation, filterDiscipline, filterGender]);

  useEffect(() => {
    if (!requestedRoomTypeId || !planning || !activeHotelId) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`room-group-${requestedRoomTypeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeHotelId, planning, requestedRoomTypeId]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [planningData, athletesData] = await Promise.all([
        api.getAssignmentPlanningView(),
        api.getAthletes(),
      ]);
      replacePlanning(planningData);
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
      replacePlanning(planningData);
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

  const refreshOperationalState = async () => {
    const [planningData, athletesData] = await Promise.all([
      api.getAssignmentPlanningView(),
      api.getAthletes(),
      loadQuotaUsage(),
    ]);
    replacePlanning(planningData);
    setAthletes(athletesData);
    window.dispatchEvent(new CustomEvent('operations:state-changed', { detail: { source: 'disposition' } }));
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
  const currentQuotaUsage = useMemo(() => evaluateCurrentQuotaUsage(quotaUsage, quotaAssignmentsFromPlanning(allHotels)), [allHotels, quotaUsage]);
  const additionalCostPersonIds = useMemo(() => new Set(evaluateAllQuotaGroups(quotaUsage, quotaAssignmentsFromPlanning(allHotels)).flatMap(group => group.people.filter(person => person.additionalCost).map(person => person.personId))), [allHotels, quotaUsage]);
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

  const importReviewCount = useMemo(
    () => allUnitsCombined.filter((unit) => unit.occupants.some((occupant) => occupant.hasPendingReview)).length,
    [allUnitsCombined]
  );

  useEffect(() => {
    if (importReviewCount === 0 && filterImportReview) setFilterImportReview(false);
  }, [filterImportReview, importReviewCount]);

  // Every assignment filter is represented once and evaluated by one predicate.
  // The mode only controls whether that result is also projected onto the hotel pane.
  const assignmentFilters = useMemo<AssignmentFilterCriteria>(() => ({
    search: queueSearch,
    nation: filterNation,
    discipline: filterDiscipline,
    gender: filterGender,
    status: filterStatus,
    roomCategory: filterRoomCategory,
    importReview: filterImportReview,
  }), [filterDiscipline, filterGender, filterImportReview, filterNation, filterRoomCategory, filterStatus, queueSearch]);

  const queueUnits = useMemo(
    () => allUnitsCombined.filter((unit) => matchesAssignmentFilters(unit, assignmentFilters)),
    [allUnitsCombined, assignmentFilters],
  );

  const synchronizedHotels = useMemo(
    () => filterMode === 'synchronized' && hasActiveAssignmentFilters(assignmentFilters)
      ? filterHotelsByMatchingUnits(allHotels, queueUnits)
      : allHotels,
    [allHotels, assignmentFilters, filterMode, queueUnits],
  );

  const filteredHotels = useMemo(() => {
    const query = hotelSearch.trim().toLowerCase();
    return synchronizedHotels.filter((hotel) => {
      const matchesRegion = !regionFilter || hotel.region === regionFilter;
      const haystack = `${hotel.hotelName} ${hotel.location || ''}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesRegion && matchesSearch && matchesOperationalHotelFilter(assignmentHotelOperationalState(hotel), hotelOperationalFilter);
    }).sort((a,b)=>compareOperationalHotels(assignmentHotelOperationalState(a),assignmentHotelOperationalState(b)));
  }, [hotelOperationalFilter, hotelSearch, regionFilter, synchronizedHotels]);

  const activeHotel = filteredHotels.find((hotel) => hotel.hotelId === activeHotelId) ?? null;

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
    () => currentQuotaUsage.filter((row) => row.assignedOfficials > row.officialQuota || evaluateQuotaUsageRow(row).hasViolation),
    [currentQuotaUsage]
  );
  const pendingQuotaDecisions = useMemo(
    () => currentQuotaUsage.filter((row) => row.quotaStatus === 'DECISION_REQUIRED' || row.openApprovals > 0),
    [currentQuotaUsage]
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
    let validations: AssignmentValidationResult[];
    try {
      validations = await ensureAssignmentValidations(unitId, athleteIds);
    } catch (err) {
      setError(extractErrorMessage(err, 'Zimmerprüfung konnte nicht geladen werden.'));
      return;
    }
    const validSlot = findFirstValidSlot(validations, allHotels, hotelId);
    if (!validSlot) {
      setError('Für dieses Hotel gibt es kein gültiges Zimmer für die ausgewählte Einheit.');
      return;
    }
    await assignUnitToSlot(unitId, validSlot, athleteIds);
  };

  const handleAssignToRoomType = async (unitId: string, hotelId: string, roomTypeId: string, athleteIds?: string[]) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    let validations: AssignmentValidationResult[];
    try {
      validations = await ensureAssignmentValidations(unitId, athleteIds);
    } catch (err) {
      setError(extractErrorMessage(err, 'Zimmerprüfung konnte nicht geladen werden.'));
      return;
    }
    const slot = findFirstValidSlotForRoomType(validations, allHotels, hotelId, roomTypeId);
    if (!slot) {
      setError('Für diesen Zimmertyp gibt es kein gültiges freies Zimmer.');
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
      setError(extractErrorMessage(err, 'Quotenbewertung konnte nicht geändert werden'));
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

  const handleAcknowledgeImportChanges = async (unit: { occupants: ChangeOccupant[] }) => {
    try {
      setSaving(true);
      await Promise.all(unit.occupants.filter((occ) => occ.hasPendingReview).map((occ) => api.acknowledgeAthleteRoomlistChange(occ.athleteId)));
      await refreshOperationalState();
    } catch (err) {
      setError(extractErrorMessage(err, 'Prüfung konnte nicht gespeichert werden'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <>
    <div className="relative" aria-busy={saving}>
      {saving && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-50" role="status" aria-live="polite">
          <div className="h-1 overflow-hidden bg-blue-950"><div className="h-full w-1/2 animate-pulse bg-blue-400" /></div>
          <div className="absolute right-4 top-3 flex items-center gap-2 rounded-lg bg-[var(--ops-surface)] px-3 py-2 text-xs font-semibold text-blue-100 shadow-xl">
            <RefreshCw className="h-4 w-4 animate-spin" /> Zuweisung wird verarbeitet …
          </div>
        </div>
      )}
    <div className="relative flex h-[calc(100vh-106px)] w-full items-center justify-center overflow-hidden px-1 py-2">
      <WorkspaceFrame>
        <div className="p-3 pb-0"><ImportConflictNotice/></div>
        <TopBar
          view={view}
          onViewChange={setView}
          progress={queueProgress}
          violations={quotaViolations.length}
          saving={saving}
          onRefresh={handleRefresh}
          quotaRows={currentQuotaUsage}
          quotaRefreshing={quotaRefreshing}
        />

        {showAlert && pendingQuotaDecisions.length > 0 && (
          <AlertBanner row={pendingQuotaDecisions[0]} onClose={() => setShowAlert(false)} onGoQuotas={() => setView('quotas')} />
        )}

        <div className={`grid min-h-0 flex-1 border-t border-[var(--ops-divider)] ${view === 'dispatch' ? 'grid-cols-[352px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
          {view === 'dispatch' && <aside className="relative z-[1] min-h-0 border-r border-[var(--ops-assignment-sidebar-border)] bg-[var(--ops-assignment-sidebar)] shadow-[var(--ops-assignment-sidebar-shadow)]">
            <AssignmentPerformanceBoundary id="Queue">
            <QueueSidebar
              units={queueUnits}
              filterMode={filterMode}
              onFilterMode={setFilterMode}
              regularUnits={regularQueueUnits}
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
              importReviewCount={importReviewCount}
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
                void ensureAssignmentValidations(unitId, athleteIds).catch((err) => {
                  setError(extractErrorMessage(err, 'Zimmerprüfung konnte nicht geladen werden.'));
                });
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
            </AssignmentPerformanceBoundary>
          </aside>}

          <main className="min-h-0 overflow-hidden bg-[var(--ops-assignment-canvas)]">
            {view === 'dispatch' && (
                <DispatchWorkspace
                  hotels={filteredHotels}
                  additionalCostPersonIds={additionalCostPersonIds}
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
                  hotelOperationalFilter={hotelOperationalFilter}
                  onHotelOperationalFilter={setHotelOperationalFilter}
                  onClearActiveHotel={() => setActiveHotelId(null)}
                  selectedBookingId={selected?.type === 'booking' ? selected.id : null}
                  onSelectBooking={(bookingId) => setSelected({ type: 'booking', id: bookingId })}
                  pendingAction={pendingAction}
                />
            )}

            {view === 'quotas' && (
              <AssignmentPerformanceBoundary id="Quotas">
              <QuotasPanel
                rows={currentQuotaUsage}
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
              </AssignmentPerformanceBoundary>
            )}
          </main>

        </div>

        {selected && (
          <AssignmentDialog title="Zimmer / Zuweisung" subtitle="Bewohner, Importinformationen und Disposition im Überblick" onClose={() => setSelected(null)}>
          <DetailPanel
              selectedUnit={selectedUnit}
              selectedBookingContext={selectedBookingContext}
              selectedAssignedUnit={selectedAssignedUnit}
              hotels={allHotels}
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
          <AssignmentDialog title="Quotendetails" subtitle="Quoten- und Regelstatus" onClose={() => setSelectedQuotaKey(null)}>
            <QuotaDetail
              quotaKey={selectedQuotaKey}
              rows={currentQuotaUsage}
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
    </WorkspaceFrame>
    </div>
    </div>
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
    <div className="flex h-14 items-center justify-between border-b border-[var(--ops-divider)] bg-[var(--ops-surface)] px-4">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-xs font-bold text-[var(--ops-assignment-text-accent-strong)]">
            FIS
          </div>
          <div>
            <div className="text-sm font-bold text-[var(--ops-assignment-text-bright)]">NWSC 2027</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ops-assignment-text-muted)]">Zimmer-Disposition</div>
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
                  ? 'border-blue-500/50 bg-blue-500/15 text-[var(--ops-assignment-text-accent)]'
                  : 'border-transparent text-[var(--ops-assignment-text-faint)] hover:bg-[var(--ops-surface-raised)] hover:text-[var(--ops-assignment-text-body)]'
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
            <CapacityBar pct={progress.percent} />
          </div>
          <span className="font-mono text-[var(--ops-assignment-text-muted)]" title={`${progress.done} von ${progress.total} disponiert`}>
            <strong className="text-[var(--ops-assignment-text-body)]">{progress.percent}%</strong>
          </span>
        </div>

        {violations > 0 && (
          <div className="rounded-full border border-amber-700/60 bg-amber-500/10 px-2.5 py-1 font-semibold text-[var(--ops-assignment-text-warning)]">
            {violations} Quote
          </div>
        )}

        <button
          onClick={onRefresh}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ops-assignment-text-faint)] transition-colors hover:bg-[var(--ops-surface-raised)] hover:text-[var(--ops-assignment-text-body)]"
        >
          <RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
        </button>
        <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ops-assignment-text-faint)] transition-colors hover:bg-[var(--ops-surface-raised)] hover:text-[var(--ops-assignment-text-body)]">
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function LiveQuotaStrip({ rows, onOpen, refreshing }: { rows: OfficialQuotaUsage[]; onOpen: () => void; refreshing: boolean }) {
  const row = rows[0];
  if (!row) return <span className="hidden text-[var(--ops-assignment-text-faint)] xl:inline">Keine Quoten verfügbar</span>;

  return (
    <button onClick={onOpen} aria-busy={refreshing} aria-label={`Quoten: Officials ${row.assignedOfficials} von ${row.officialQuota}, als EZ gewertete Personen ${row.singleRoomsUsed} von ${row.singleRoomsAllowed}`} className="relative hidden items-stretch overflow-hidden rounded-xl border border-[var(--ops-border-strong)] bg-[var(--ops-assignment-card)] text-left shadow-[var(--ops-assignment-kpi-shadow)] transition-all hover:border-[var(--ops-primary)] hover:bg-[var(--ops-assignment-card-hover)] hover:shadow-[var(--ops-assignment-kpi-hover-shadow)] xl:flex">
      {refreshing && <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-[var(--ops-surface)]/95 py-0.5 text-[9px] text-[var(--ops-assignment-text-accent)]" role="status" aria-live="polite"><RefreshCw className="h-2.5 w-2.5 animate-spin" /> wird aktualisiert</span>}
      <span className="min-w-[100px] border-r border-[var(--ops-divider)] px-3 py-1.5">
        <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]">Officials</span>
        <span className={`flex items-center gap-1.5 font-mono font-bold ${row.assignedOfficials > row.officialQuota ? 'text-[var(--ops-assignment-text-warning)]' : 'text-[var(--ops-text)]'}`}>
          {row.assignedOfficials} / {row.officialQuota}
          {row.assignedOfficials <= row.officialQuota && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        </span>
      </span>
      <span className="min-w-[112px] px-3 py-1.5">
        <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]">Einzelzimmer</span>
        <span className={`flex items-center gap-1.5 font-mono font-bold ${evaluateQuotaUsageRow(row).hasViolation ? 'text-[var(--ops-assignment-text-warning)]' : 'text-[var(--ops-text)]'}`}>
          {row.singleRoomsUsed} / {row.singleRoomsAllowed}
          {!evaluateQuotaUsageRow(row).hasViolation && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        </span>
      </span>
    </button>
  );
}

function AssignmentDialog({ children, title, subtitle, onClose }: { children: ReactNode; title: string; subtitle?: string; onClose: () => void }) {
  return <Dialog open onClose={onClose} fullWidth maxWidth="md">
    <div className="flex max-h-[calc(100vh-64px)] flex-col bg-[var(--ops-surface)] text-[var(--ops-text)]">
      <DialogHeader title={title} subtitle={subtitle} />
      <DialogContent dividers className="min-h-0 p-0">{children}</DialogContent>
      <DialogFooter><OpsButton onClick={onClose}>Schließen</OpsButton></DialogFooter>
    </div>
  </Dialog>;
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
  const quotaEvaluation = evaluateQuotaUsageRow(row);
  const singleText = quotaEvaluation.hasViolation
    ? `EZ-Quotenbewertung überschritten (${quotaEvaluation.usedSingleRooms}/${quotaEvaluation.allowedSingleRooms})`
    : '';
  const message = [officialText, singleText].filter(Boolean).join(' und ');

  return (
    <div className="flex items-center gap-3 border-b border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] px-4 py-2.5 text-sm text-[var(--ops-tone-warning-text)]">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1 truncate">
        {message || 'Quoten-Warnung'}
      </div>
      <button onClick={onGoQuotas} className="font-semibold text-[var(--ops-tone-warning-text)] hover:text-[var(--ops-warning)]">
        Zu den Quoten →
      </button>
      <button onClick={onClose} className="text-[var(--ops-warning)] hover:text-[var(--ops-tone-warning-text)]">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function QueueSidebar({
  units,
  filterMode,
  onFilterMode,
  regularUnits,
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
  importReviewCount,
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
  filterMode: FilterMode;
  onFilterMode: (value: FilterMode) => void;
  regularUnits: RoomBookingUnit[];
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
  importReviewCount: number;
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
        <fieldset className="mb-3 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2">
          <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-assignment-text-muted)]">Filtermodus</legend>
          <div className="mt-0.5 flex gap-4 text-xs font-semibold text-[var(--ops-assignment-text-strong)]">
            <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="assignment-filter-mode" checked={filterMode === 'queue'} onChange={() => onFilterMode('queue')} />Nur Warteschlange</label>
            <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="assignment-filter-mode" checked={filterMode === 'synchronized'} onChange={() => onFilterMode('synchronized')} />Synchron</label>
          </div>
        </fieldset>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-[var(--ops-assignment-text-strong)]">Dispo-Warteschlange</div>
            <div className="text-xs text-[var(--ops-assignment-text-muted)]">{units.length} passende Einheiten</div>
          </div>
        </div>

        <SearchInput value={search} onChange={onSearch} placeholder="Athleten suchen..." />

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <DarkSelect value={filterNation} onChange={onFilterNation} options={nationOptions} placeholder="Alle Nationen" />
          <DarkSelect value={filterDiscipline} onChange={onFilterDiscipline} options={disciplineOptions} placeholder="Alle Disziplinen" />
          <DarkSelect value={filterGender} onChange={onFilterGender} options={genderOptions} placeholder="Alle Gender" labelMap={{ M: 'Männlich', F: 'Weiblich' }} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <FilterButtonGroup
            label="Status"
            value={filterStatus}
            options={[{ id: 'all', label: 'Alle' }, { id: 'pending', label: 'Offen' }]}
            onChange={(value) => onFilterStatus(value as QueueStatus)}
          />
          <FilterButtonGroup
            label="Zimmerwunsch"
            value={filterRoomCategory || 'all'}
            options={[{ id: 'all', label: 'Alle' }, { id: 'ez', label: 'EZ' }, { id: 'dz', label: 'DZ' }]}
            onChange={(value) => onFilterRoomCategory(value === 'all' ? '' : value as RoomCategoryFilter)}
          />
        </div>

        {importReviewCount > 0 && (
          <button
            onClick={() => onFilterImportReview(!filterImportReview)}
            aria-pressed={filterImportReview}
            className={`assignment-review-warning mt-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${filterImportReview ? 'border-amber-500/60 bg-amber-500/15 text-amber-100' : 'border-amber-500/30 bg-[var(--ops-surface-elevated)] text-amber-200 hover:border-amber-500/50'}`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {importReviewCount} {importReviewCount === 1 ? 'Disposition' : 'Dispositionen'} prüfen
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 py-3">
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
              <div className="rounded-2xl border border-dashed border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] px-4 py-10 text-center text-sm text-[var(--ops-assignment-text-body)]">
                Keine Einheiten mit den aktuellen Filtern.
              </div>
            )}
          </div>
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
  const hasPairWarning = !sameGender(unit) || !sameNation(unit);
  const isReadOnly = unit.isFullyAssigned;
  const contextValues = (values: Array<string | null | undefined>, fallback: string) =>
    Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))).join(' + ') || fallback;
  const nations = contextValues(unit.occupants.map(occupant => occupant.nationCode), unit.nationCode || '—');
  const disciplines = contextValues(unit.occupants.map(occupant => occupant.discipline), '—');
  const roles = unit.occupants.map(occupant => occupant.function?.trim() || 'Athlet');
  const roleContext = contextValues(roles, 'Athlet');
  const hasMixedRoles = new Set(roles).size > 1;
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
      {pending && <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-[var(--ops-surface)] px-2 py-1 text-[9px] font-semibold text-[var(--ops-assignment-text-accent)]" role="status" aria-live="polite"><RefreshCw className="h-3 w-3 animate-spin" /> Verarbeitung...</div>}
      {unit.assignmentWarnings.map(warning => <div key={`${warning.code}-${warning.message}`} className={`mb-1.5 flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-bold ${warning.level === 'error' ? 'border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]' : 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] text-[var(--ops-tone-warning-text)]'}`}><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0"/>{warning.message}</div>)}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold text-[var(--ops-text-subtle)]">
            {nations} · {disciplines} · {roleContext}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--ops-text-subtle)]">
            <b>{unit.roomTypeLabel || '—'}</b>
            <span aria-hidden="true">·</span><span className="min-w-0 truncate" title={unit.assignedHotelName || undefined}>{unit.assignedHotelName || 'Hotel offen'}</span>
          </div>
        </div>
      </div>

      {hasPairWarning && (
        <div className="mt-1.5 rounded-lg border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] px-2 py-1.5 text-[10px] text-[var(--ops-tone-warning-text)]">
          Gemischtes Paar erkannt — Zuweisung ist erlaubt, bitte kurz prüfen.
        </div>
      )}

      <div className="mt-2 grid gap-1.5">
        {unit.occupants.map(occupant => <QueueOccupantActionRow
          key={occupant.athleteId}
          occupant={occupant}
          isDragging={dragging && draggingAthleteIds.length === 1 && draggingAthleteIds[0] === occupant.athleteId}
          canEditAssignments={canEditAssignments && !isReadOnly}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onQuickAssign={onQuickAssign}
          unitId={unit.unitId}
          pending={pending}
          fallbackArrival={unit.checkInDate}
          fallbackDeparture={unit.checkOutDate}
          showRole={hasMixedRoles}
        />)}
        {unit.occupants.length >= 2 && (
          <button
            draggable={canEditAssignments && !isReadOnly && !pending}
            disabled={pending || isReadOnly || !canEditAssignments}
            title={isReadOnly ? 'Disposition bereits erledigt.' : !canEditAssignments ? 'Nur für Benutzer mit Bearbeitungsrechten verfügbar.' : undefined}
            onDragStart={() => onDragStart(unit.unitId, unit.occupants.map((occupant) => occupant.athleteId), 'Beide zusammen')}
            onDragEnd={onDragEnd}
            onClick={(event) => {
              event.stopPropagation();
              onQuickAssign(unit.unitId, unit.occupants.map((occupant) => occupant.athleteId));
            }}
            className="rounded-lg bg-[var(--ops-primary-emphasis)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--ops-on-accent)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Beide zusammen zuweisen
          </button>
        )}
      </div>
    </div>
  );
}

function QueueOccupantActionRow({
  occupant,
  isDragging,
  canEditAssignments,
  onDragStart,
  onDragEnd,
  onQuickAssign,
  unitId,
  pending,
  fallbackArrival,
  fallbackDeparture,
  showRole,
}: {
  occupant: RoomBookingUnit['occupants'][number];
  isDragging: boolean;
  canEditAssignments: boolean;
  onDragStart: (unitId: string, athleteIds: string[], label: string) => void;
  onDragEnd: () => void;
  onQuickAssign: (unitId: string, athleteIds: string[]) => void;
  unitId: string;
  pending: boolean;
  fallbackArrival?: string | null;
  fallbackDeparture?: string | null;
  showRole: boolean;
}) {
  return (
    <OccupantCard
      person={occupant}
      status={occupant.hasPendingReview ? 'review' : occupant.isAssigned ? 'assigned' : 'open'}
      fallbackArrival={fallbackArrival}
      fallbackDeparture={fallbackDeparture}
      hideNation
      hideDiscipline
      hideRole={!showRole}
      className={isDragging ? 'opacity-70' : ''}
      footer={<><div className="flex items-center gap-1.5">
        {occupant.single_room_status !== 'NONE' && <SingleRoomStatusBadge status={occupant.single_room_status} />}
        <button
          draggable={canEditAssignments && !pending}
          disabled={pending || !canEditAssignments}
          title={!canEditAssignments ? 'Nur für Benutzer mit Bearbeitungsrechten verfügbar.' : undefined}
          onDragStart={() => onDragStart(unitId, [occupant.athleteId], occupant.firstname)}
          onDragEnd={onDragEnd}
          onClick={(event) => {
            event.stopPropagation();
            onQuickAssign(unitId, [occupant.athleteId]);
          }}
          className="flex-1 rounded-md border border-[var(--ops-border-strong)] bg-[var(--ops-surface-overlay)] px-2 py-1 text-[10px] font-semibold text-[var(--ops-text)] transition-colors hover:border-[var(--ops-primary)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Einzeln zuweisen
        </button>
      </div>{occupant.hasPendingReview && <PendingChanges changes={occupant.importChangeDetails} compact className="mt-1.5" />}</>}
    />
  );
}
function DispatchWorkspace({
  hotels,
  additionalCostPersonIds,
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
  hotelOperationalFilter,
  onHotelOperationalFilter,
  onClearActiveHotel,
  selectedBookingId,
  onSelectBooking,
  pendingAction,
}: {
  hotels: AssignmentGridHotel[];
  additionalCostPersonIds: Set<string>;
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
  hotelOperationalFilter: OperationalHotelFilter;
  onHotelOperationalFilter: (value: OperationalHotelFilter) => void;
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
          additionalCostPersonIds={additionalCostPersonIds}
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
          hotelOperationalFilter={hotelOperationalFilter}
          onHotelOperationalFilter={onHotelOperationalFilter}
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
  additionalCostPersonIds,
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
  hotelOperationalFilter,
  onHotelOperationalFilter,
  onClearActiveHotel,
  selectedBookingId,
  onSelectBooking,
  pendingAction,
}: {
  hotels: AssignmentGridHotel[];
  additionalCostPersonIds: Set<string>;
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
  hotelOperationalFilter: OperationalHotelFilter;
  onHotelOperationalFilter: (value: OperationalHotelFilter) => void;
  onClearActiveHotel: () => void;
  selectedBookingId: string | null;
  onSelectBooking: (bookingId: string) => void;
  pendingAction: PendingAssignmentAction | null;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)]">
      {!activeHotel && <div>
        <AssignmentPerformanceBoundary id="HotelOverview">
        <HotelGridView
          hotels={hotels}
          regionOptions={[...new Set(allHotels.map(hotel => hotel.region).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'de'))}
          hotelSearch={hotelSearch}
          onHotelSearch={onHotelSearch}
          regionFilter={regionFilter}
          onRegionFilter={onRegionFilter}
          hotelOperationalFilter={hotelOperationalFilter}
          onHotelOperationalFilter={onHotelOperationalFilter}
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
        </AssignmentPerformanceBoundary>
      </div>}
      {activeHotel && (
        <div className="min-h-0">
          <AssignmentPerformanceBoundary id="HotelDetail">
          <HotelDetailView
            hotel={activeHotel}
            additionalCostPersonIds={additionalCostPersonIds}
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
          </AssignmentPerformanceBoundary>
        </div>
      )}
    </div>
  );
}

function HotelGridView({
  hotels,
  regionOptions,
  hotelSearch,
  onHotelSearch,
  regionFilter,
  onRegionFilter,
  hotelOperationalFilter,
  onHotelOperationalFilter,
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
  regionOptions: string[];
  hotelSearch: string;
  onHotelSearch: (value: string) => void;
  regionFilter: string;
  onRegionFilter: (value: string) => void;
  hotelOperationalFilter: OperationalHotelFilter;
  onHotelOperationalFilter: (value: OperationalHotelFilter) => void;
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
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ops-divider)] px-4 py-3">
        <OperationalHotelFilters value={hotelOperationalFilter} onChange={onHotelOperationalFilter}/>
        <SearchInput value={hotelSearch} onChange={onHotelSearch} placeholder="Hotels oder Orte suchen..." dark />
        <div className="flex items-center gap-1">
          {['', ...regionOptions].map((region) => (
            <button
              key={region || 'all'}
              onClick={() => onRegionFilter(region)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                regionFilter === region
                  ? region
                    ? 'border border-blue-700/40 bg-blue-500/15 text-[var(--ops-assignment-text-accent-strong)]'
                  : 'bg-[var(--ops-surface-elevated)] text-[var(--ops-assignment-text-strong)]'
                  : 'text-[var(--ops-assignment-text-muted)] hover:bg-[var(--ops-surface-overlay)] hover:text-[var(--ops-assignment-text-bright)]'
              }`}
            >
              {region || 'Alle Regionen'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="font-mono text-[var(--ops-assignment-text-body)]">
            <strong className="text-[var(--ops-assignment-text-bright)]">{usedBeds}</strong> / {totalBeds} Betten
          </span>
          <div className="w-24">
            <CapacityBar pct={totalBeds > 0 ? Math.round((usedBeds / totalBeds) * 100) : 0} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {hotels.length ? <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
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
        </div> : <EmptyCenter text="Keine Hotels für die aktuelle Auswahl gefunden."/>}
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
  const regionColor = REGION_COLORS[hotel.region || ''] || 'var(--ops-primary)';
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
            ? 'border-blue-400/60 bg-[var(--ops-surface-overlay)]'
            : 'border-[var(--ops-border)] bg-[var(--ops-assignment-card)] shadow-[var(--ops-assignment-card-shadow)] hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-assignment-card-hover)] hover:shadow-[var(--ops-assignment-card-hover-shadow)]'
      }`}
    >
      {pending && <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--ops-surface)]/55" role="status" aria-live="polite"><span className="flex items-center gap-2 rounded-lg bg-[var(--ops-surface)] px-3 py-2 text-xs font-semibold text-blue-100"><RefreshCw className="h-4 w-4 animate-spin" /> Loading</span></div>}
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
          <div className="rounded-md border border-[var(--ops-border-strong)] bg-[var(--ops-surface-overlay)] px-2 py-0.5 text-[10px] font-bold text-[var(--ops-assignment-text-strong)]">
            {totals.totalRooms} Zimmer
          </div>
        </div>

        <div className="rounded-lg border border-[var(--ops-assignment-card-header-border)] bg-[var(--ops-assignment-card-header)] px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[var(--ops-text-subtle)]"><strong className="text-sm font-extrabold text-[var(--ops-text)]">{totals.usedBeds}</strong> belegt · <strong className="text-sm font-extrabold text-[var(--ops-success)]">{Math.max(0, totals.totalBeds - totals.usedBeds)}</strong> frei</span>
            <span className={`font-mono text-xs font-bold ${totals.percent >= 75 ? 'text-[var(--ops-assignment-text-warning)]' : totals.percent > 0 ? 'text-[var(--ops-assignment-text-accent)]' : 'text-[var(--ops-assignment-text-faint)]'}`}>
              {totals.percent}%
            </span>
          </div>
          <CapacityBar pct={totals.percent} className="h-1.5" />
          <div className="mt-1.5 flex items-center justify-between text-[9px] text-[var(--ops-assignment-text-muted)]">
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

      <div className="flex items-center justify-between border-t border-[var(--ops-divider)]/60 px-3 py-2">
        <span className="text-[10px] text-[var(--ops-assignment-text-muted)]">{totals.roomTypes.length} Zimmertypen</span>
        <div className={`flex items-center gap-1 text-[11px] font-bold ${dragOver && canDrop ? 'text-[var(--ops-assignment-text-accent)]' : active ? 'text-[var(--ops-assignment-text-accent)]' : 'text-[var(--ops-assignment-text-muted)] group-hover:text-[var(--ops-assignment-text-accent)]'}`}>
          {dragging && dragOver ? (canDrop ? 'Loslassen zum Zuweisen' : 'Blockiert') : 'Öffnen →'}
        </div>
      </div>
    </div>
  );
}

function HotelDetailView({
  hotel,
  additionalCostPersonIds,
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
  additionalCostPersonIds: Set<string>;
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
      <div className="border-b border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)] px-4 py-2.5">
        <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--ops-assignment-text-body)] transition-colors hover:bg-[var(--ops-surface-overlay)] hover:text-[var(--ops-assignment-text-bright)]"
            >
              <ChevronLeft className="mr-1 inline h-3.5 w-3.5" />
            Alle Hotels
          </button>
          <div className="flex-1">
            <h2 className="truncate text-lg font-extrabold text-[var(--ops-text)]">{hotel.hotelName}</h2>
            <div className="flex items-center gap-2 text-[11px] text-[var(--ops-assignment-text-muted)]">
              <span>{hotel.location || '—'}</span>
              <span>·</span>
              <span style={{ color: REGION_COLORS[hotel.region || ''] || 'var(--ops-primary)' }}>{hotel.region}</span>
            </div>
            <div className="mt-1 text-xs font-bold text-[var(--ops-primary)]">{contingentRange}</div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-base font-bold text-[var(--ops-assignment-text-strong)]">
                {totals.usedBeds}
                <span className="text-sm text-[var(--ops-assignment-text-faint)]">/{totals.totalBeds}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--ops-assignment-text-muted)]">belegte Betten</div>
            </div>
            <div className="w-24">
              <CapacityBar pct={totals.percent} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[var(--ops-surface-raised)] p-3">
        <div className="space-y-2.5">
          {grouped.map((group) => {
            const summary = summarizeRoomType(group.slots);
            const roomTypeKey = `${hotel.hotelId}_${group.roomTypeId}`;
            const isOpen = openRoomTypes[group.roomTypeId] ?? true;
            const canDrop = !!draggingUnitId && hasSlotForRoomType(group.slots);

            return (
              <div id={`room-group-${group.roomTypeId}`} key={group.roomTypeId} className="scroll-mt-4 overflow-hidden rounded-2xl border border-[var(--ops-border)]">
                <button
                  onClick={() => setOpenRoomTypes((current) => ({ ...current, [group.roomTypeId]: !isOpen }))}
                  className="flex w-full items-center gap-3 bg-[var(--ops-surface-overlay)] px-3 py-2.5 text-left hover:bg-[var(--ops-surface-overlay)]"
                >
                  <ChevronDown className={`h-4 w-4 text-[var(--ops-assignment-text-faint)] transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-extrabold text-[var(--ops-assignment-text-bright)]">{group.roomTypeName}</span>
                      <span className="rounded-md bg-[var(--ops-surface-overlay)] px-2 py-0.5 text-[10px] font-bold text-[var(--ops-assignment-text-strong)]">
                        {summary.capacityPerRoom}p max
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs font-mono text-[var(--ops-assignment-text-muted)]">
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
                            ? 'border-blue-400/60 bg-[var(--ops-surface-overlay)]'
                            : isBookingDropTarget && canAddPartner
                              ? 'border-violet-400/70 bg-violet-500/15'
                              : 'border-[var(--ops-border)] bg-[var(--ops-surface-overlay)] hover:border-[var(--ops-border-strong)]'
                        }`}
                      >
                        {pendingAction?.bookingId === entry.booking.bookingId && <span className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-[var(--ops-surface)]/75 text-xs font-semibold text-blue-100" role="status" aria-live="polite"><RefreshCw className="h-4 w-4 animate-spin" /> Loading</span>}
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <span className="mt-0.5 flex h-6 min-w-8 flex-shrink-0 items-center justify-center rounded-md bg-[var(--ops-surface-overlay)] px-1.5 text-[9px] font-medium text-[var(--ops-text-muted)]">
                            {entry.slot.roomNumber || `#${index + 1}`}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[10px] font-medium text-[var(--ops-text-muted)]">
                              {entry.slot.roomNumber || `${group.roomTypeName} · Zimmer ${String(entry.slot.slotIndex).padStart(2, '0')}`}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px]">
                              {entry.booking.countsAsSingle ? <span className={`rounded-md border px-1.5 py-0.5 font-bold ${entry.booking.occupants.some(person => additionalCostPersonIds.has(person.athleteId)) ? 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] text-[var(--ops-tone-warning-text)]' : 'border-[var(--ops-tone-info-border)] bg-[var(--ops-tone-info-surface)] text-[var(--ops-tone-info-text)]'}`}>{entry.booking.occupants.some(person => additionalCostPersonIds.has(person.athleteId)) ? 'Einzelzimmer – Mehrpreis' : 'Einzelzimmer'}</span> : <><span className={`rounded-md px-1.5 py-0.5 font-bold ${entry.booking.occupants.length < (entry.booking.capacity || 0) ? 'border border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)] text-[var(--ops-tone-success-text)]' : 'bg-[var(--ops-tone-neutral-surface)] text-[var(--ops-tone-neutral-text)]'}`}>
                                {entry.booking.occupants.length} / {entry.booking.capacity || 0} belegt
                              </span>{entry.booking.occupants.length < (entry.booking.capacity || 0) && <span className="font-bold text-[var(--ops-success)]">{(entry.booking.capacity || 0) - entry.booking.occupants.length} frei</span>}</>}
                              {canAddPartner && (
                                <span className={`${isBookingDropTarget ? 'text-[var(--ops-assignment-text-accent)]' : 'text-[var(--ops-assignment-text-muted)]'}`}>
                                  Partner hinzufügen
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 grid gap-1">
                              {entry.booking.occupants.map(occupant => <OccupantCard
                                key={occupant.athleteId}
                                person={occupant}
                                status={occupant.hasPendingReview ? 'review' : 'assigned'}
                                fallbackArrival={entry.booking.checkInDate}
                                fallbackDeparture={entry.booking.checkOutDate}
                                hideNation
                                hideDiscipline
                                footer={occupant.hasPendingReview ? <PendingChanges changes={occupant.importChangeDetails} compact /> : undefined}
                              />)}
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
                        className={`flex min-h-20 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-3 text-center transition-all ${
                          dragOverRoomTypeKey === roomTypeKey
                            ? canDrop
                              ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                              : 'border-red-500/60 bg-red-500/10 text-red-200'
                            : 'border-[var(--ops-border-strong)] bg-[var(--ops-surface-overlay)] text-[var(--ops-assignment-text-body)]'
                        }`}
                      >
                        <div className="text-base font-extrabold">
                          {dragOverRoomTypeKey === roomTypeKey
                            ? 'Loslassen, um neue Zuweisung anzulegen'
                            : `${summary.remainingRooms} freie Zimmer`}
                        </div>
                        {dragOverRoomTypeKey !== roomTypeKey && (
                          <div className="mt-1 text-xs font-medium text-[var(--ops-assignment-text-muted)]">Hier zum Zuweisen ablegen</div>
                        )}
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
      <div className="border-b border-[var(--ops-border)] bg-[var(--ops-surface-raised)] px-4 py-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Athleten suchen..." dark />
      </div>
      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-[var(--ops-surface)]">
            <tr>
              {['Name', 'Nation', 'Disz.', 'Gender', 'Anr.', 'Abr.', 'Status'].map((heading) => (
                <th key={heading} className="px-3 py-2.5 text-left text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ops-divider)]">
            {filtered.map((athlete) => (
              <tr
                key={athlete.id}
                onClick={() => onSelectAthlete(athlete.id)}
                className={`cursor-pointer transition-colors ${selectedAthleteId === athlete.id ? 'bg-[var(--ops-tone-primary-surface)]' : 'hover:bg-[var(--ops-surface-raised)]'}`}
              >
                <td className="px-3 py-2.5 text-xs font-semibold text-[var(--ops-assignment-text-body)]">{athlete.firstname} {athlete.lastname}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--ops-assignment-text-muted)]">{athlete.nationCode}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--ops-assignment-text-muted)]">{athlete.discipline || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--ops-assignment-text-muted)]">{normalizeGender(athlete.gender) || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--ops-assignment-text-muted)]">{athlete.arrivalDate || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--ops-assignment-text-muted)]">{athlete.departureDate || '—'}</td>
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
  if (evaluateQuotaUsageRow(card).hasViolation) return { label: 'Quote überschritten · Mehrkosten', tone: 'warning' as const, icon: AlertTriangle };
  if (card.assignedOfficials > card.officialQuota) return { label: 'Official-Quote überschritten', tone: 'warning' as const, icon: AlertTriangle };
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
          <p className="mt-1 flex items-center gap-2 text-sm text-[var(--ops-text-muted)]">Regelverstöße, Freigaben und Dispositionsstand auf einen Blick. {refreshing && <span className="flex items-center gap-1 text-[var(--ops-assignment-text-accent)]" role="status" aria-live="polite"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> wird aktualisiert</span>}</p>
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
          const singlesOver = evaluateQuotaUsageRow(card).hasViolation;
          const dispatchPct = card.peopleTotal > 0 ? Math.round(card.peopleAssigned / card.peopleTotal * 100) : 0;

          return (
            <button key={card.key} onClick={() => onSelect(card.key)} className="group overflow-hidden rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] text-left shadow-[var(--ops-shadow-xs)] transition-all hover:-translate-y-0.5 hover:border-[var(--ops-border-strong)] hover:shadow-[var(--ops-shadow-sm)] focus-visible:shadow-[var(--ops-focus-ring)]">
              <div className={`h-1 ${state.tone === 'success' ? 'bg-[var(--ops-success)]' : state.tone === 'warning' ? 'bg-[var(--ops-warning)]' : 'bg-[var(--ops-error)]'}`} />
              <div className="p-5">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] font-mono text-sm font-extrabold text-[var(--ops-assignment-text-bright)]">{card.nationCode}</div>
                    <div><div className="font-bold text-[var(--ops-assignment-text-bright)]">{card.nationCode} · {card.discipline} · {quotaGenderLabel(card.gender)}</div><div className="mt-1 text-xs text-[var(--ops-text-muted)]">Quotengruppe</div></div>
                  </div>
                  <StatusPill tone={state.tone} icon={<StateIcon className="h-3.5 w-3.5" />} label={state.label} />
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <KpiBlock label="Athleten" value={`${card.athletes}`} />
                  <KpiBlock label="Officials" value={`${card.assignedOfficials} / ${card.officialQuota}`} warning={officialsOver} />
                  <KpiBlock label="Einzelzimmer" value={`${card.singleRoomsUsed} / ${card.singleRoomsAllowed}`} warning={singlesOver} />
                  <KpiBlock label="Disposition" value={`${card.peopleAssigned} / ${card.peopleTotal}`} />
                </div>

                <div className="mt-4 space-y-3 rounded-xl border border-[var(--ops-divider)] bg-[var(--ops-surface)] p-3.5">
                  <QuotaProgress label="Officials" current={card.assignedOfficials} max={card.officialQuota} warning={officialsOver} />
                  <QuotaProgress label="Einzelzimmer" current={card.singleRoomsUsed} max={card.singleRoomsAllowed} warning={singlesOver} />
                  <QuotaProgress label="Disposition" current={card.peopleAssigned} max={card.peopleTotal} />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 text-xs">
                  <ApprovalInfo label="Offene Genehmigungen" value={String(card.openApprovals)} warning={card.openApprovals > 0} />
                  <ApprovalInfo label="Genehmigte Ausnahmen" value={String(card.approvedExceptions)} />
                  <ApprovalInfo label="EZ mit Mehrkosten" value={String(evaluateQuotaUsageRow(card).overflow)} warning={singlesOver} />
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
  return <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] px-3.5 py-2"><span className="text-[10px] uppercase tracking-wider text-[var(--ops-text-muted)]">{label}</span><span className={`ml-2 font-mono font-bold ${warning ? 'text-[var(--ops-warning)]' : 'text-[var(--ops-assignment-text-bright)]'}`}>{value}</span></div>;
}

function StatusPill({ tone, label, icon }: { tone: 'success' | 'warning' | 'error'; label: string; icon: ReactNode }) {
  const classes = tone === 'success' ? 'border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)] text-[var(--ops-success)]' : tone === 'warning' ? 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] text-[var(--ops-warning)]' : 'border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]';
  return <span className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${classes}`}>{icon}{label}</span>;
}

function KpiBlock({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="rounded-xl border border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)] p-3"><div className="text-[9px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]">{label}</div><div className={`mt-1.5 font-mono text-lg font-bold ${warning ? 'text-[var(--ops-warning)]' : 'text-[var(--ops-assignment-text-bright)]'}`}>{value}</div></div>;
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
  decisionId?: string | null;
  additionalCost: boolean;
};

function buildSingleRoomControlPeople(card: QuotaCard, allUnits: RoomBookingUnit[], hotels: AssignmentGridHotel[], additionalCostPersonIds: Set<string>): SingleRoomControlPerson[] {
  const bookingsByAthlete = new Map<string, AssignmentGridBooking>();
  hotels.forEach((hotel) => hotel.slots.forEach((slot) => slot.bookings.forEach((booking) => {
    booking.occupants.forEach((occupant) => bookingsByAthlete.set(occupant.athleteId, booking));
  })));

  const people = new Map<string, SingleRoomControlPerson>();
  allUnits.forEach((unit) => unit.occupants.forEach((occupant) => {
    if (occupant.nationCode !== card.nationCode
      || (occupant.discipline || '—') !== card.discipline
      || normalizeGender(occupant.gender) !== card.gender) return;

    const booking = bookingsByAthlete.get(occupant.athleteId);
    if (!booking?.countsAsSingle) return;
    people.set(occupant.athleteId, {
      athleteId: occupant.athleteId,
      name: occupant.name,
      decisionId: occupant.single_room_decision_id,
      additionalCost: additionalCostPersonIds.has(occupant.athleteId),
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
  const quotaEvaluation = evaluateQuotaUsageRow(card);
  const singlesOver = quotaEvaluation.hasViolation;
  const evaluatedGroup = evaluateAllQuotaGroups(rows, quotaAssignmentsFromPlanning(hotels))
    .find(group => group.key === quotaUsageKey(card.nationCode, card.discipline, card.gender));
  const additionalCostPersonIds = new Set(evaluatedGroup?.people.filter(person => person.additionalCost).map(person => person.personId) || []);
  const controlPeople = buildSingleRoomControlPeople(card, allUnits, hotels, additionalCostPersonIds);
  const additionalCostPeople = controlPeople.filter(person => person.additionalCost);
  const withinQuotaPeople = controlPeople.filter(person => !person.additionalCost);
  const sharedDecisionId = additionalCostPeople.find(person => person.decisionId)?.decisionId
    ?? controlPeople.find(person => person.decisionId)?.decisionId;

  return <div className="flex h-full flex-col">
    <header className="border-b border-[var(--ops-divider)] bg-[var(--ops-surface)] px-6 py-5 pr-16">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3"><div className="flex h-12 min-w-12 items-center justify-center rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] font-mono text-sm font-extrabold text-[var(--ops-assignment-text-bright)]">{card.nationCode}</div><div><div className="text-lg font-bold text-[var(--ops-assignment-text-bright)]">{card.nationCode} · {card.discipline} · {quotaGenderLabel(card.gender)}</div><div className="mt-1 text-xs text-[var(--ops-text-muted)]">Quoten- und Regelstatus</div></div></div>
        <StatusPill tone={state.tone} icon={<StateIcon className="h-3.5 w-3.5" />} label={state.label} />
      </div>
    </header>
    <div className="flex-1 space-y-4 overflow-auto p-6">
      <DetailSection icon={<Eye className="h-4 w-4" />} title="Übersicht">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><KpiBlock label="Athleten" value={`${card.athletes}`} /><KpiBlock label="Officials" value={`${card.assignedOfficials} / ${card.officialQuota}`} warning={officialsOver} /><KpiBlock label="Einzelzimmer" value={`${card.singleRoomsUsed} / ${card.singleRoomsAllowed}`} warning={singlesOver} /><KpiBlock label="Mehrpreise" value={`${quotaEvaluation.overflow}`} warning={singlesOver} /><KpiBlock label="Disposition" value={`${card.peopleAssigned} / ${card.peopleTotal}`} /></div>
      </DetailSection>
      <DetailSection icon={<Bed className="h-4 w-4" />} title="Einzelzimmerentscheidungen">
        {controlPeople.length ? <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <SingleRoomDecisionGroup title="Mehrpreis" people={additionalCostPeople} status="APPROVED_EXTRA" />
            <SingleRoomDecisionGroup title="Innerhalb der Quote" people={withinQuotaPeople} status="IN_QUOTA" />
          </div>
          <div className="flex justify-end border-t border-[var(--ops-divider)] pt-3">
            <OpsButton disabled={!sharedDecisionId} title={!sharedDecisionId ? 'Für diese Quotengruppe ist keine Importentscheidung hinterlegt.' : undefined} onClick={() => sharedDecisionId && onShowDecision(sharedDecisionId)}>Entscheidung anzeigen</OpsButton>
          </div>
        </div> : <p className="text-sm text-[var(--ops-text-muted)]">Keine Personen mit Einzelzimmeranspruch in dieser Quotengruppe.</p>}
      </DetailSection>
    </div>
  </div>;
}

function SingleRoomDecisionGroup({ title, people, status }: { title: string; people: SingleRoomControlPerson[]; status: 'APPROVED_EXTRA' | 'IN_QUOTA' }) {
  return <section className="overflow-hidden rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)]">
    <header className="flex items-center justify-between gap-3 border-b border-[var(--ops-divider)] px-3 py-2.5">
      <div><h4 className="text-sm font-extrabold text-[var(--ops-assignment-text-bright)]">{title}</h4><p className="mt-0.5 text-xs text-[var(--ops-text-muted)]">{people.length} {people.length === 1 ? 'Person' : 'Personen'}</p></div>
      <SingleRoomStatusBadge status={status} />
    </header>
    {people.length ? <ul className="divide-y divide-[var(--ops-divider)]">{people.map(person => <li key={person.athleteId} className="px-3 py-2.5 text-sm font-semibold text-[var(--ops-assignment-text-bright)]">{person.name}</li>)}</ul> : <p className="px-3 py-4 text-sm text-[var(--ops-text-muted)]">Keine Personen</p>}
  </section>;
}

function DetailSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3"><h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ops-primary)]">{icon}{title}</h3>{children}</section>;
}

function DetailPanel({
  selectedUnit,
  selectedBookingContext,
  selectedAssignedUnit,
  hotels,
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
  hotels: AssignmentGridHotel[];
  onUnassignBooking: (bookingId: string) => void;
  onUnassignOccupant: (bookingId: string, athleteId: string) => void;
  onMarkBookingAsSingle: (bookingId: string, countsAsSingle: boolean) => void;
  pendingAction: PendingAssignmentAction | null;
  onAcknowledgeImportChanges: (unit: { occupants: ChangeOccupant[] }) => void;
  onShowDecision: (decisionId: string) => void;
}) {
  if (!selectedUnit && !selectedBookingContext) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] text-[var(--ops-assignment-text-faint)]">
          <Eye className="h-5 w-5" />
        </div>
        <div className="text-lg font-semibold text-[var(--ops-assignment-text-body)]">Nichts ausgewählt</div>
        <div className="mt-2 text-sm text-[var(--ops-assignment-text-faint)]">Wähle eine Buchung oder eine Einheit aus</div>
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--ops-border)] px-6 py-4 text-sm text-[var(--ops-assignment-text-faint)]">
          Ziehe eine Einheit aus der Warteschlange auf freie Zimmerbereiche
        </div>
      </div>
    );
  }

  if (selectedBookingContext) {
    const { booking, hotel, slot } = selectedBookingContext;
    const pendingOccupants = booking.occupants.filter(occupant => occupant.hasPendingReview);
    return (
      <div className="space-y-3 p-4" aria-busy={pendingAction?.bookingId === booking.bookingId}>
        {pendingOccupants.length > 0 && <DetailSection icon={<AlertTriangle className="h-4 w-4" />} title="Disposition prüfen">
          <p className="text-xs font-semibold text-[var(--ops-tone-warning-text)]">Importdaten weichen von der aktuellen Zimmerzuweisung ab.</p>
          <button onClick={() => onAcknowledgeImportChanges(booking)} className="mt-3 w-full rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950">Disposition bestätigen</button>
        </DetailSection>}
        <DetailSection icon={<Users className="h-4 w-4" />} title="Personen">
          <div className="space-y-2">
            {booking.occupants.map((occupant) => (
              <OccupantCard
                key={occupant.athleteId}
                person={occupant}
                status={occupant.hasPendingReview ? 'review' : 'assigned'}
                fallbackArrival={booking.checkInDate}
                fallbackDeparture={booking.checkOutDate}
                hideNation
                hideDiscipline
                footer={<><div className="flex items-start justify-between gap-2">
                  <div><SingleRoomStatusBadge status={occupant.single_room_status} /><SingleRoomDecisionCard status={occupant.single_room_status} decisionId={occupant.single_room_decision_id} onShowDecision={onShowDecision} /></div>
                  {booking.occupants.length > 1 && (
                    <button
                      disabled={pendingAction?.bookingId === booking.bookingId}
                      onClick={() => onUnassignOccupant(booking.bookingId, occupant.athleteId)}
                      className="rounded-lg border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] px-2 py-1 text-[10px] font-semibold text-[var(--ops-tone-warning-text)] hover:bg-[var(--ops-tone-warning-hover)] disabled:border-[var(--ops-tone-warning-disabled-border)] disabled:bg-[var(--ops-tone-warning-disabled-surface)] disabled:text-[var(--ops-tone-warning-disabled-text)]"
                    >
                      {pendingAction?.athleteIds?.includes(occupant.athleteId) ? <><RefreshCw className="mr-1 inline h-3 w-3 animate-spin" /> Loading</> : 'Nur diese Person'}
                    </button>
                  )}
                </div>{occupant.hasPendingReview && <PendingChanges changes={occupant.importChangeDetails} compact className="mt-1.5" />}</>}
              />
            ))}
          </div>
        </DetailSection>
        <DetailSection icon={<Building2 className="h-4 w-4" />} title="Hotel">
          <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[var(--ops-text)]">{hotel.hotelName}</div>
                <div className="mt-1 text-xs text-[var(--ops-text-muted)]">{hotel.location || '—'}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-bold text-[var(--ops-text)]">{slot.roomNumber || `Zimmer ${String(slot.slotIndex).padStart(2, '0')}`}</div>
                <div className="mt-1 text-[10px] font-semibold text-[var(--ops-text-muted)]">{slot.roomTypeName} · {booking.occupants.length} / {booking.capacity || 0} belegt</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--ops-divider)] pt-2 text-[10px]">
              <span className="font-semibold text-[var(--ops-text-muted)]">Hotelkontingent</span>
              <span className="font-mono font-bold text-[var(--ops-text)]">{formatShortDate(slot.dateCoverage.availableFrom)} – {formatShortDate(slot.dateCoverage.availableUntil)}</span>
            </div>
            <ContingentConflict arrival={booking.checkInDate} departure={booking.checkOutDate} availableFrom={slot.dateCoverage.availableFrom} availableUntil={slot.dateCoverage.availableUntil}/>
          </div>
        </DetailSection>
        <DetailSection icon={<Bed className="h-4 w-4" />} title="Quotenbewertung">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2">
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold text-[var(--ops-text)]">Als Einzelzimmer werten</span>
              <Tooltip title={<>Bestimmt ausschließlich die Quotenberechnung.<br/>Die tatsächliche Zimmerart bleibt unverändert.</>} arrow>
                <IconButton size="small" aria-label="Information zur Quotenbewertung"><InfoOutlinedIcon fontSize="inherit" /></IconButton>
              </Tooltip>
            </div>
            <Switch
              checked={Boolean(booking.countsAsSingle)}
              disabled={pendingAction?.bookingId === booking.bookingId}
              onChange={(_, checked) => onMarkBookingAsSingle(booking.bookingId, checked)}
              inputProps={{ 'aria-label': 'Als Einzelzimmer werten' }}
            />
          </div>
        </DetailSection>
        <DetailSection icon={<Trash2 className="h-4 w-4" />} title="Aktionen">
          <button
            disabled={pendingAction?.bookingId === booking.bookingId}
            onClick={() => onUnassignBooking(booking.bookingId)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-800/50 bg-red-950/30 py-2.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-950/50"
          >
            {pendingAction?.kind === 'unassign' && pendingAction.bookingId === booking.bookingId ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {pendingAction?.kind === 'unassign' && pendingAction.bookingId === booking.bookingId ? 'Ausbuchen läuft...' : 'Zuweisung entfernen'}
          </button>
        </DetailSection>
        <ActivitySummaryCard entityType="assignments" entityId={booking.bookingId} />
      </div>
    );
  }

  if (!selectedUnit) return null;

  const pendingChanges = Array.from(new Set(selectedUnit.occupants.filter((occ) => occ.hasPendingReview).flatMap((occ) => occ.importChangeTypes)));
  const assignedHotel = hotels.find(hotel => hotel.hotelId === (selectedAssignedUnit?.assignedHotelId || selectedUnit.assignedHotelId));
  const assignedSlots = assignedHotel?.slots.filter(slot => !selectedUnit.assignedRoomTypeId || slot.roomTypeId === selectedUnit.assignedRoomTypeId) || [];
  const availableFrom = assignedSlots.map(slot => slot.dateCoverage.availableFrom).filter((value): value is string => Boolean(value)).sort()[0];
  const availableUntil = assignedSlots.map(slot => slot.dateCoverage.availableUntil).filter((value): value is string => Boolean(value)).sort().at(-1);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {pendingChanges.length > 0 && (
        <div className="m-4 mb-0 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">
          <div className="text-xs font-bold">Importänderungen</div>
          <button onClick={() => onAcknowledgeImportChanges(selectedUnit)} className="mt-3 w-full rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950">Keine Änderung notwendig · geprüft speichern</button>
        </div>
      )}
      {selectedUnit.assignmentWarnings.length > 0 && <div className="mx-4 mt-4 space-y-2">{selectedUnit.assignmentWarnings.map(warning => <div key={`${warning.code}-${warning.message}`} className={`flex items-start gap-2 rounded-xl border p-3 text-xs font-bold ${warning.level === 'error' ? 'border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]' : 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] text-[var(--ops-tone-warning-text)]'}`}><AlertTriangle className="h-4 w-4 shrink-0"/>{warning.message}</div>)}</div>}
      <div className="border-b border-[var(--ops-divider)] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-400/15 text-sm font-bold text-[var(--ops-assignment-text-accent)]">
            {selectedUnit.nationCode}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-assignment-text-faint)]">Einheitsdetail</div>
            <div className="mt-2 text-sm font-bold text-[var(--ops-assignment-text-strong)]">
              {selectedUnit.occupants.map((occ) => `${occ.firstname} ${occ.lastname}`).join(' / ')}
            </div>
            <div className="mt-1 text-[10px] font-mono text-[var(--ops-assignment-text-muted)]">
              {selectedUnit.roomTypeLabel} · {selectedUnit.checkInDate || '—'} → {selectedUnit.checkOutDate || '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-[var(--ops-divider)] px-4 py-4">
        <div className="rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)]/40 p-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><div className="text-[9px] font-bold uppercase tracking-wide text-[var(--ops-text-muted)]">Hotel</div><div className="mt-1 font-bold text-[var(--ops-text)]">{assignedHotel?.hotelName || 'Noch nicht zugewiesen'}</div></div>
            <div><div className="text-[9px] font-bold uppercase tracking-wide text-[var(--ops-text-muted)]">Hotelkontingent</div><div className="mt-1 font-mono font-bold text-[var(--ops-text)]">{availableFrom && availableUntil ? `${formatShortDate(availableFrom)} – ${formatShortDate(availableUntil)}` : 'Kein Kontingentbezug'}</div></div>
          </div>
          <ContingentConflict arrival={selectedUnit.checkInDate} departure={selectedUnit.checkOutDate} availableFrom={availableFrom} availableUntil={availableUntil}/>
        </div>
      </div>
      <div className="border-b border-[var(--ops-divider)] px-4 py-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ops-assignment-text-faint)]">Personen</div>
        <div className="space-y-2">
          {selectedUnit.occupants.map((occupant) => (
            <OccupantCard
              key={occupant.athleteId}
              person={occupant}
              status={occupant.hasPendingReview ? 'review' : occupant.isAssigned ? 'assigned' : 'open'}
              fallbackArrival={selectedUnit.checkInDate}
              fallbackDeparture={selectedUnit.checkOutDate}
              hideNation
              hideDiscipline
              hideRole={!occupant.function || occupant.function === 'Athlet'}
              footer={<>{occupant.single_room_status !== 'NONE' && occupant.single_room_status !== 'PENDING_APPROVAL' && <SingleRoomDecisionCard status={occupant.single_room_status} decisionId={occupant.single_room_decision_id} onShowDecision={onShowDecision} />}{occupant.hasPendingReview && <PendingChanges changes={occupant.importChangeDetails} compact className="mt-1.5" />}</>}
            />
          ))}
        </div>

      </div>

      <div className="px-4 py-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ops-assignment-text-faint)]">Zuweisung</div>
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
            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-raised)] p-3 text-xs text-[var(--ops-assignment-text-body)]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--ops-assignment-text-faint)]">Nation</div>
                  <div className="mt-1 font-semibold text-[var(--ops-assignment-text-strong)]">{selectedUnit.nationCode}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--ops-assignment-text-faint)]">Typ</div>
                  <div className="mt-1 font-semibold text-[var(--ops-assignment-text-strong)]">{selectedUnit.roomTypeLabel}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--ops-assignment-text-faint)]">Anreise</div>
                  <div className="mt-1 font-mono text-[var(--ops-assignment-text-body)]">{selectedUnit.checkInDate || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--ops-assignment-text-faint)]">Abreise</div>
                  <div className="mt-1 font-mono text-[var(--ops-assignment-text-body)]">{selectedUnit.checkOutDate || '—'}</div>
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
          <div className="flex items-center gap-2 rounded-xl border border-amber-700/40 bg-amber-950/15 px-3 py-3 text-xs text-[var(--ops-assignment-text-warning)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            Zuweisung starten — auf einen Zimmerbereich ziehen
          </div>
        )}
      </div>
      <div className="px-4 pb-4"><ActivitySummaryCard entityType="assignments" entityId={selectedAssignedUnit?.assignedBookingId || selectedUnit.unitId} /></div>
    </div>
  );
}

function ContingentConflict({ arrival, departure, availableFrom, availableUntil }: { arrival?: string | null; departure?: string | null; availableFrom?: string | null; availableUntil?: string | null }) {
  const early = Boolean(arrival && availableFrom && arrival < availableFrom);
  const late = Boolean(departure && availableUntil && departure > availableUntil);
  if (!early && !late) return null;
  const message = early && late ? 'Aufenthalt außerhalb Hotelkontingent' : early ? 'Anreise vor Kontingentbeginn' : 'Abreise nach Kontingentende';
  return <div className="mt-2 flex items-center gap-1.5 rounded-md border border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)] px-2 py-1.5 text-[10px] font-extrabold text-[var(--ops-error)]"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{message}</div>;
}

function SingleRoomDecisionCard({ status, decisionId, onShowDecision }: { status?: string | null; decisionId?: string | null; onShowDecision: (decisionId: string) => void }) {
  const importStatus = status === 'PENDING_APPROVAL' ? 'Entscheidung offen' : decisionId ? 'Entscheidung dokumentiert' : 'Aus Import übernommen';
  return (
    <div className="mt-2 border-t border-[var(--ops-divider)] pt-2 text-xs text-[var(--ops-text-muted)]">
      <div><span className="font-bold text-[var(--ops-text)]">Importstatus:</span> {importStatus}</div>
      {decisionId && <button onClick={() => onShowDecision(decisionId)} className="mt-1.5 font-semibold text-[var(--ops-primary)] hover:underline">Entscheidung anzeigen</button>}
    </div>
  );
}
function EmptyCenter({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--ops-assignment-text-faint)]">
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
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ops-assignment-input-icon)]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border pl-9 pr-3 py-2 text-sm transition-all focus:outline-none ${
          dark
            ? 'border-[var(--ops-assignment-input-border)] bg-[var(--ops-assignment-input)] text-[var(--ops-assignment-input-text)] placeholder:text-[var(--ops-assignment-input-placeholder)] hover:bg-[var(--ops-assignment-input-hover)] hover:border-[var(--ops-assignment-input-hover-border)] focus:border-[var(--ops-assignment-input-focus)] focus:shadow-[var(--ops-assignment-input-focus-ring)]'
            : 'border-[var(--ops-assignment-input-alt-border)] bg-[var(--ops-assignment-input-alt)] text-[var(--ops-assignment-input-alt-text)] placeholder:text-[var(--ops-assignment-input-alt-placeholder)] hover:border-[var(--ops-primary)] hover:bg-[var(--ops-assignment-input-hover)] focus:border-[var(--ops-focus)] focus:shadow-[var(--ops-assignment-input-focus-ring)]'
        }`}
      />
    </div>
  );
}

function FilterButtonGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-text-muted)]">{label}</legend>
      <div className="inline-flex w-full rounded-lg bg-[var(--ops-surface-elevated)] p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={`min-w-0 flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
              value === option.id
                ? 'bg-[var(--ops-primary-emphasis)] text-[var(--ops-on-accent)]'
                : 'text-[var(--ops-text-subtle)] hover:bg-[var(--ops-surface-overlay)] hover:text-[var(--ops-text)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
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
        className="w-full appearance-none rounded-xl border border-[var(--ops-assignment-input-border)] bg-[var(--ops-assignment-input)] px-3 py-2 text-sm text-[var(--ops-assignment-select-text)] transition-all hover:border-[var(--ops-assignment-input-hover-border)] hover:bg-[var(--ops-assignment-input-hover)] focus:border-[var(--ops-assignment-input-focus)] focus:outline-none focus:shadow-[var(--ops-assignment-input-focus-ring)]"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labelMap?.[option] || option}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ops-assignment-text-faint)]" />
    </div>
  );
}

function CapacityBar({
  pct,
  className = '',
  trackClassName = 'bg-[var(--ops-assignment-progress-track)]',
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
      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--ops-assignment-text-faint)]">{label}</div>
      <div className="mb-2 flex items-end gap-1">
        <span className={`font-mono text-2xl font-bold ${tone === 'red' ? 'text-red-400' : 'text-[var(--ops-assignment-text-body)]'}`}>{current}</span>
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

/**
 * The single predicate for filters owned by the assignment queue. Adding a
 * future filter means extending the criteria and this function; consumers do
 * not need target-specific filter branches.
 */
function matchesAssignmentFilters(unit: RoomBookingUnit, filters: AssignmentFilterCriteria) {
  if (filters.status === 'pending' && unit.isFullyAssigned) return false;
  if (filters.nation && unit.nationCode !== filters.nation) return false;
  if (filters.discipline && !unit.occupants.some((occupant) => occupant.discipline === filters.discipline)) return false;
  if (filters.gender && !unit.occupants.some((occupant) => normalizeGender(occupant.gender) === filters.gender)) return false;
  if (filters.roomCategory && getUnitRoomCategory(unit) !== filters.roomCategory) return false;
  if (filters.importReview && !unit.occupants.some((occupant) => occupant.hasPendingReview)) return false;

  const query = filters.search.trim().toLowerCase();
  if (!query) return true;
  const haystack = `${unit.nationCode} ${unit.roomTypeLabel} ${unit.occupants
    .map((occupant) => `${occupant.firstname} ${occupant.lastname}`)
    .join(' ')}`.toLowerCase();
  return haystack.includes(query);
}

function hasActiveAssignmentFilters(filters: AssignmentFilterCriteria) {
  return Boolean(
    filters.search.trim()
    || filters.nation
    || filters.discipline
    || filters.gender
    || filters.status !== 'all'
    || filters.roomCategory
    || filters.importReview,
  );
}

/**
 * The synchronized result is intentionally hotel-level: a matching occupancy
 * keeps the original hotel, including every room and booking, intact. The
 * right-hand side is an overview and must never turn into a filtered person or
 * slot list.
 */
function filterHotelsByMatchingUnits(hotels: AssignmentGridHotel[], units: RoomBookingUnit[]) {
  const athleteIds = new Set(units.flatMap((unit) => unit.occupants.map((occupant) => occupant.athleteId)));
  return hotels.filter((hotel) => hotel.slots.some((slot) =>
    slot.bookings.some((booking) => booking.occupants.some((occupant) => athleteIds.has(occupant.athleteId))),
  ));
}

function formatShortDate(value?: string | null) {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.` : value;
}

function assignmentHotelOperationalState(hotel: AssignmentGridHotel):OperationalHotelState {
  const summary=summarizeHotel(hotel);
  const hasFree=(pattern:RegExp)=>summary.roomTypes.some(row=>pattern.test(row.roomTypeName)&&row.usedBeds<row.totalBeds);
  return {name:hotel.hotelName,occupancy:summary.percent,totalCapacity:summary.totalBeds,freeCapacity:Math.max(0,summary.totalBeds-summary.usedBeds),hasFreeSingle:hasFree(/(^|\W)EZ(\W|$)|einzel/i),hasFreeDouble:hasFree(/(^|\W)DZ(\W|$)|doppel/i)};
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
