import { useEffect, useMemo, useState } from 'react';
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
  Eye,
  Link2,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import type { OfficialQuotaUsage } from '../services/fisRules';
import type {
  AssignmentGridBooking,
  AssignmentGridHotel,
  AssignmentPlanningView,
  AssignmentSlot,
  AssignmentValidationResult,
  Athlete,
  RoomBookingUnit,
} from '../types';

type AppView = 'dispatch' | 'athletes' | 'quotas';
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

const REGION_COLORS: Record<string, string> = {
  Bludenz: '#4F8EF7',
  Montafon: '#34D399',
  Feldkirch: '#8B5CF6',
};

export function Assignments() {
  const permissions = usePermissions();
  const [planning, setPlanning] = useState<AssignmentPlanningView | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [quotaUsage, setQuotaUsage] = useState<OfficialQuotaUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<AppView>('dispatch');
  const [selected, setSelected] = useState<SelectedState>(null);
  const [activeHotelId, setActiveHotelId] = useState<string | null>(null);
  const [showAlert, setShowAlert] = useState(true);

  const [queueSearch, setQueueSearch] = useState('');
  const [hotelSearch, setHotelSearch] = useState('');
  const [filterNation, setFilterNation] = useState('');
  const [filterDiscipline, setFilterDiscipline] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const [filterStatus, setFilterStatus] = useState<QueueStatus>('pending');
  const [filterRoomCategory, setFilterRoomCategory] = useState<RoomCategoryFilter>('');
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
      const rows = await api.getOfficialQuotaUsage({
        nationCode: filterNation || undefined,
        discipline: filterDiscipline || undefined,
        gender: filterGender || undefined,
      });
      setQuotaUsage(rows);
    } catch (err) {
      console.error(err);
    }
  };

  const allUnits = planning?.units.unassigned ?? [];
  const assignedUnits = planning?.units.assigned ?? [];
  const allUnitsCombined = [...allUnits, ...assignedUnits];
  const allHotels = planning?.hotels ?? [];
  const validationByUnit = planning?.validationByUnit ?? {};

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
      const haystack = `${unit.nationCode} ${unit.roomTypeLabel} ${unit.occupants.map((o) => `${o.firstname} ${o.lastname}`).join(' ')}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesNation && matchesDiscipline && matchesGender && matchesRoomCategory && matchesSearch;
    });
  }, [allUnits, allUnitsCombined, assignedUnits, filterDiscipline, filterGender, filterNation, filterRoomCategory, filterStatus, queueSearch]);

  const filteredHotels = useMemo(() => {
    const query = hotelSearch.trim().toLowerCase();
    return allHotels.filter((hotel) => {
      const matchesRegion = !regionFilter || hotel.region === regionFilter;
      const haystack = `${hotel.hotelName} ${hotel.location || ''}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesRegion && matchesSearch;
    });
  }, [allHotels, hotelSearch, regionFilter]);

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
      setSaving(true);
      setError(null);
      await api.assignRoomBookingUnit({
        unitId,
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
      setSaving(false);
    }
  };

  const handleUnassignBooking = async (bookingId: string) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    try {
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
      setSaving(false);
    }
  };

  const handleUnassignOccupant = async (bookingId: string, athleteId: string) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    try {
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
      setSaving(false);
    }
  };

  const handleMarkBookingAsSingle = async (bookingId: string, countsAsSingle: boolean) => {
    if (!permissions.canManageAssignments) {
      setError('Nur für Benutzer mit Bearbeitungsrechten verfügbar.');
      return;
    }
    try {
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
      setSaving(true);
      setError(null);
      await api.assignRoomBookingUnit({
        unitId,
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
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([
      refreshPlanningData({ silent: false }),
      loadQuotaUsage(),
    ]);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-106px)] w-full items-center justify-center overflow-hidden px-1 py-2">
      <div className="flex h-full w-full max-w-[1980px] flex-col overflow-hidden rounded-[28px] border border-[#49617d] bg-[#20324a] text-slate-100 shadow-[0_18px_60px_rgba(10,20,35,0.24)]">
        <TopBar
          view={view}
          onViewChange={setView}
          progress={queueProgress}
          violations={quotaViolations.length}
          saving={saving}
          onRefresh={handleRefresh}
        />

        {showAlert && quotaViolations.length > 0 && (
          <AlertBanner row={quotaViolations[0]} onClose={() => setShowAlert(false)} onGoQuotas={() => setView('quotas')} />
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[336px_minmax(0,1fr)_332px] border-t border-[#49617d]">
          <aside className="min-h-0 border-r border-[#49617d] bg-[#263a54]">
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
                setSelected({ type: 'unit', id: unitId });
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
            />
          </aside>

          <main className="min-h-0 overflow-hidden bg-[#2b405d]">
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
                />
              ) : (
                <EmptyCenter text="Keine Hotels für die aktuelle Auswahl gefunden." />
              )
            )}

            {view === 'athletes' && (
              <AthletesPanel
                athletes={athletes}
                selectedAthleteId={selected?.type === 'unit' ? unitById.get(selected.id)?.occupants[0]?.athleteId ?? null : null}
                onSelectAthlete={(athleteId) => {
                  const matchingUnit = allUnitsCombined.find((unit) => unit.occupants.some((occ) => occ.athleteId === athleteId));
                  if (matchingUnit) setSelected({ type: 'unit', id: matchingUnit.unitId });
                }}
              />
            )}

            {view === 'quotas' && (
              <QuotasPanel rows={quotaUsage} />
            )}
          </main>

          <aside className="min-h-0 border-l border-[#49617d] bg-[#314763]">
            <DetailPanel
              selectedUnit={selectedUnit}
              selectedBookingContext={selectedBookingContext}
              selectedAssignedUnit={selectedAssignedUnit}
              onUnassignBooking={handleUnassignBooking}
              onUnassignOccupant={handleUnassignOccupant}
              onMarkBookingAsSingle={handleMarkBookingAsSingle}
            />
          </aside>
        </div>

        {error && (
          <div className="border-t border-red-800/40 bg-red-950/40 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({
  view,
  onViewChange,
  progress,
  violations,
  saving,
  onRefresh,
}: {
  view: AppView;
  onViewChange: (view: AppView) => void;
  progress: { done: number; total: number; percent: number };
  violations: number;
  saving: boolean;
  onRefresh: () => void;
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
            { id: 'athletes', label: 'Athleten' },
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
    ? `${row.nationCode} überschreitet die Offiziellen-Quote (${row.assignedOfficials}/${row.officialQuota})`
    : '';
  const singleText = row.singleRoomsUsed > row.singleRoomsAllowed
    ? `Einzelzimmer-Quote (${row.singleRoomsUsed}/${row.singleRoomsAllowed})`
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
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[#49617d] px-4 py-3">
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

        <div className="mt-4 space-y-2">
          <DarkSelect value={filterNation} onChange={onFilterNation} options={nationOptions} placeholder="Alle Nationen" />
          <DarkSelect value={filterDiscipline} onChange={onFilterDiscipline} options={disciplineOptions} placeholder="Alle Disziplinen" />
          <DarkSelect value={filterGender} onChange={onFilterGender} options={genderOptions} placeholder="Alle Gender" labelMap={{ M: 'Männlich', F: 'Weiblich' }} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
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
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#20324a] text-slate-300 hover:bg-[#2a3d58] hover:text-white'
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
                  ? 'bg-violet-500 text-white'
                  : 'bg-[#20324a] text-slate-300 hover:bg-[#2a3d58] hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shareRequests.length > 0 && (
          <div className="border-b border-[#49617d] px-3 py-2">
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

      <div className="border-t border-[#49617d] px-4 py-3">
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
}) {
  const primaryOccupant = unit.occupants[0];
  const partnerOccupant = unit.occupants[1] ?? null;
  const hasPairWarning = !sameGender(unit) || !sameNation(unit);
  const roomCategory = getUnitRoomCategory(unit).toUpperCase();
  const cardBase = highlighted
    ? 'border-violet-700/40 bg-[#22324a] hover:border-violet-400/60 hover:bg-[#2a3d58]'
    : selected
      ? 'border-blue-400/60 bg-[#244064]'
      : 'border-[#39506f] bg-[#1b2c43] hover:border-[#4b6587] hover:bg-[#213652]';

  return (
    <div
      onClick={onSelect}
      className={`w-full cursor-pointer rounded-2xl border px-3 py-3 text-left transition-all ${cardBase} ${dragging ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-white">
            {primaryOccupant ? `${primaryOccupant.firstname} ${primaryOccupant.lastname}` : '—'}
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Zimmerpartner: {partnerOccupant ? `${partnerOccupant.firstname} ${partnerOccupant.lastname}` : 'Zimmerpartner offen'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
            <span>{unit.nationCode || '—'}</span>
            <span>·</span>
            <span>{roomCategory}</span>
            <span>·</span>
            <span>{formatShortDate(unit.checkInDate)} → {formatShortDate(unit.checkOutDate)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-semibold ${hasPairWarning ? 'text-amber-300' : 'text-emerald-300'}`}>
            {hasPairWarning ? 'Warnung' : 'ok'}
          </span>
          <span className="text-[10px] text-slate-400">
            {unit.isFullyAssigned ? 'erledigt' : unit.hasAnyAssigned ? 'teilweise' : 'offen'}
          </span>
        </div>
      </div>

      {hasPairWarning && (
        <div className="mt-2 rounded-xl border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          Gemischtes Paar erkannt — Zuweisung ist erlaubt, bitte kurz prüfen.
        </div>
      )}

      <div className="mt-3 grid gap-2">
        <QueueOccupantActionRow
          title="Athlet"
          occupant={primaryOccupant}
          isDragging={dragging && draggingAthleteIds.length === 1 && draggingAthleteIds[0] === primaryOccupant?.athleteId}
          canEditAssignments={canEditAssignments}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onQuickAssign={onQuickAssign}
          unitId={unit.unitId}
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
        />
        {unit.occupants.length >= 2 && (
          <button
            draggable={canEditAssignments}
            title={!canEditAssignments ? 'Nur für Benutzer mit Bearbeitungsrechten verfügbar.' : undefined}
            onDragStart={() => onDragStart(unit.unitId, unit.occupants.map((occupant) => occupant.athleteId), 'Beide zusammen')}
            onDragEnd={onDragEnd}
            onClick={(event) => {
              event.stopPropagation();
              onQuickAssign(unit.unitId, unit.occupants.map((occupant) => occupant.athleteId));
            }}
            className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-400"
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
}) {
  if (!occupant) {
    return (
      <div className="rounded-xl border border-dashed border-[#556d8b] px-3 py-2 text-[11px] text-slate-400">
        {title}: {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border px-3 py-2 ${occupant.isAssigned ? 'border-emerald-700/40 bg-emerald-500/10' : 'border-[#4f6786] bg-[#243651]'} ${isDragging ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{title}</div>
          <div className="text-sm font-semibold text-white">{occupant.firstname} {occupant.lastname}</div>
        </div>
        <span className={`text-[10px] font-semibold ${occupant.isAssigned ? 'text-emerald-300' : 'text-slate-300'}`}>
          {occupant.isAssigned ? 'zugewiesen' : 'offen'}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          draggable={canEditAssignments}
          title={!canEditAssignments ? 'Nur für Benutzer mit Bearbeitungsrechten verfügbar.' : undefined}
          onDragStart={() => onDragStart(unitId, [occupant.athleteId], occupant.firstname)}
          onDragEnd={onDragEnd}
          onClick={(event) => {
            event.stopPropagation();
            onQuickAssign(unitId, [occupant.athleteId]);
          }}
          className="flex-1 rounded-lg border border-[#5e7aa0] bg-[#314763] px-2.5 py-1.5 text-[11px] font-semibold text-slate-100 transition-colors hover:bg-[#395274]"
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
}) {
  return (
    <div className={`grid h-full min-h-0 ${activeHotel ? 'grid-rows-[310px_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'}`}>
      <div className={activeHotel ? 'border-b border-[#49617d]' : ''}>
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
        />
      </div>
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

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
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
}) {
  const totals = summarizeHotel(hotel);
  const regionColor = REGION_COLORS[hotel.region || ''] || '#4F8EF7';

  return (
    <div
      onClick={onSelect}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border transition-all ${
        dragOver
          ? canDrop
            ? 'scale-[1.02] border-blue-400/60 bg-blue-500/15'
            : 'border-red-400/50 bg-red-500/10'
          : active
            ? 'border-blue-400/60 bg-[#395274]'
            : 'border-[#506987] bg-[#314763] hover:border-[#6580a1] hover:bg-[#395274]'
      }`}
    >
      <div className="h-[3px] w-full" style={{ backgroundColor: regionColor }} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-white">{hotel.hotelName}</div>
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              <span className="text-slate-400">{hotel.location || '—'}</span>
              <span className="text-slate-600">·</span>
              <span className="font-semibold" style={{ color: regionColor }}>{hotel.region}</span>
            </div>
          </div>
          <div className="rounded-md bg-[#4a6382] px-2 py-0.5 text-[10px] font-bold text-slate-100">
            {totals.days}d
          </div>
        </div>

          <div className="rounded-xl bg-[#2a3d58] p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300">{totals.usedBeds} / {totals.totalBeds} Betten</span>
            <span className={`font-mono text-sm font-bold ${totals.percent >= 75 ? 'text-amber-300' : totals.percent > 0 ? 'text-blue-200' : 'text-slate-500'}`}>
              {totals.percent}%
            </span>
          </div>
          <CapacityBar pct={totals.percent} />
        </div>

        <div className="space-y-2">
          {totals.roomTypes.map((row) => (
            <div key={row.roomTypeId}>
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="font-mono text-slate-300">{row.roomTypeName}</span>
                <span className="font-mono text-slate-400">{row.usedBeds}/{row.totalBeds}</span>
              </div>
              <CapacityBar pct={row.totalBeds > 0 ? Math.round((row.usedBeds / row.totalBeds) * 100) : 0} className="h-1.5" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[#49617d]/60 px-4 pb-3 pt-1">
        <span className="text-[10px] font-mono text-slate-400">{totals.totalRooms} Zimmer · {totals.days}d</span>
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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#49617d] bg-[#314763] px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded-lg border border-[#5d7695] bg-[#3b5576] px-3 py-1.5 text-xs text-slate-100 transition-colors hover:bg-[#496688]"
            >
              <ChevronLeft className="mr-1 inline h-3.5 w-3.5" />
            Alle Hotels
          </button>
          <div className="flex-1">
            <h2 className="truncate text-lg font-bold text-slate-100">{hotel.hotelName}</h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <span>{hotel.location || '—'}</span>
              <span>·</span>
              <span style={{ color: REGION_COLORS[hotel.region || ''] || '#4F8EF7' }}>{hotel.region}</span>
              <span>·</span>
              <span className="font-mono">{totals.days} nights</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-xl font-bold text-slate-100">
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

      <div className="flex-1 overflow-y-auto bg-[#2b405d] p-4">
        <div className="space-y-3">
          {grouped.map((group) => {
            const summary = summarizeRoomType(group.slots);
            const roomTypeKey = `${hotel.hotelId}_${group.roomTypeId}`;
            const isOpen = openRoomTypes[group.roomTypeId] ?? true;
            const canDrop = !!draggingUnitId && hasSlotForRoomType(group.slots);

            return (
              <div key={group.roomTypeId} className="overflow-hidden rounded-2xl border border-[#506987]">
                <button
                  onClick={() => setOpenRoomTypes((current) => ({ ...current, [group.roomTypeId]: !isOpen }))}
                  className="flex w-full items-center gap-3 bg-[#395274] px-4 py-3 text-left hover:bg-[#45607f]"
                >
                  <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{group.roomTypeName}</span>
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
                  <div className="space-y-2 bg-[#314763] p-3">
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
                          onDropBooking(entry.booking);
                        }}
                        onDragOver={(event) => {
                          if (!canAddPartner) return;
                          event.preventDefault();
                          event.stopPropagation();
                          onDragOverBooking(entry.booking.bookingId);
                        }}
                        onDragLeave={onDragLeaveBooking}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all ${
                          selectedBookingId === entry.booking.bookingId
                            ? 'border-blue-400/60 bg-[#45607f]'
                            : isBookingDropTarget && canAddPartner
                              ? 'border-violet-400/70 bg-violet-500/15'
                              : 'border-[#506987] bg-[#395274] hover:border-[#6580a1]'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="w-5 flex-shrink-0 text-[10px] font-mono text-slate-600">#{index + 1}</span>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-slate-200">
                              {entry.booking.occupants.map((occ) => occ.name).join(' · ')}
                            </div>
                            <div className="mt-1 text-[10px] font-mono text-slate-500">
                              {entry.booking.checkInDate || '—'} → {entry.booking.checkOutDate || '—'}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px]">
                              <span className={`rounded-md px-1.5 py-0.5 font-semibold ${entry.booking.countsAsSingle ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-500/10 text-slate-300'}`}>
                                {entry.booking.countsAsSingle ? 'EZ' : entry.booking.occupants.length < (entry.booking.capacity || 0) ? 'DZ offen' : 'DZ'}
                              </span>
                              {canAddPartner && (
                                <span className={`${isBookingDropTarget ? 'text-violet-200' : 'text-violet-300'}`}>
                                  Partner hinzufügen
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {entry.slot.roomNumber || `Slot ${String(entry.slot.slotIndex).padStart(2, '0')}`}
                        </div>
                      </button>
                        );
                      })()
                    ))}

                    {summary.remainingRooms > 0 ? (
                      <div
                        onDrop={(event) => {
                          event.preventDefault();
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

function QuotasPanel({ rows }: { rows: OfficialQuotaUsage[] }) {
  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-3">
        {rows.map((row) => {
          const offOver = row.assignedOfficials > row.officialQuota;
          const singleOver = row.singleRoomsUsed > row.singleRoomsAllowed;
          const total = row.athletesEntered || 0;
          const donePct = total > 0 ? Math.round((Math.min(row.assignedOfficials, total) / total) * 100) : 0;

          return (
            <div key={`${row.nationCode}-${row.discipline}-${row.gender}`} className="rounded-2xl border border-[#2D4260] bg-[#1C2B42] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-100">{row.nationCode}</div>
                  <div className="mt-0.5 text-[10px] font-mono text-slate-500">
                    {row.discipline || '—'} · {row.gender}
                  </div>
                </div>
                <div className="flex gap-2">
                  {offOver && <StatusTag tone="red" label="Officials over" />}
                  {singleOver && <StatusTag tone="red" label="Singles over" />}
                  {!offOver && !singleOver && <StatusTag tone="green" label="OK" />}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-5">
                <QuotaMetric label="Athletes" current={row.athletesEntered} max={row.athletesEntered} />
                <QuotaMetric label="Officials" current={row.assignedOfficials} max={row.officialQuota} tone={offOver ? 'red' : 'blue'} />
                <QuotaMetric label="Singles" current={row.singleRoomsUsed} max={row.singleRoomsAllowed} tone={singleOver ? 'red' : 'blue'} />
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span>Dispatch progress</span>
                  <span className="font-mono">{donePct}%</span>
                </div>
                <CapacityBar pct={donePct} />
              </div>
            </div>
          );
        })}

        {!rows.length && (
          <div className="py-16 text-center text-sm text-slate-500">Keine Quotenzeilen verfügbar</div>
        )}
      </div>
    </div>
  );
}

function DetailPanel({
  selectedUnit,
  selectedBookingContext,
  selectedAssignedUnit,
  onUnassignBooking,
  onUnassignOccupant,
  onMarkBookingAsSingle,
}: {
  selectedUnit: RoomBookingUnit | null;
  selectedBookingContext: { booking: AssignmentGridBooking; slot: AssignmentSlot; hotel: AssignmentGridHotel } | null;
  selectedAssignedUnit: RoomBookingUnit | null;
  onUnassignBooking: (bookingId: string) => void;
  onUnassignOccupant: (bookingId: string, athleteId: string) => void;
  onMarkBookingAsSingle: (bookingId: string, countsAsSingle: boolean) => void;
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
      <div className="flex h-full flex-col overflow-y-auto">
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
                  </div>
                  {booking.occupants.length > 1 && (
                    <button
                      onClick={() => onUnassignOccupant(booking.bookingId, occupant.athleteId)}
                      className="rounded-lg border border-amber-700/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20"
                    >
                      Nur diese Person
                    </button>
                  )}
                </div>
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
          {((booking.capacity || 0) > 1 && booking.occupants.length === 1) && (
            <button
              onClick={() => onMarkBookingAsSingle(booking.bookingId, !booking.countsAsSingle)}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold transition-colors ${
                booking.countsAsSingle
                  ? 'border-amber-700/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                  : 'border-[#5e7aa0] bg-[#314763] text-slate-100 hover:bg-[#395274]'
              }`}
            >
              <Bed className="h-3.5 w-3.5" />
              {booking.countsAsSingle ? 'EZ-Markierung entfernen' : 'Als EZ werten'}
            </button>
          )}
          <button
            onClick={() => onUnassignBooking(booking.bookingId)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-800/50 bg-red-950/30 py-2.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-950/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Zuweisung entfernen
          </button>
        </div>
      </div>
    );
  }

  if (!selectedUnit) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
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
                </div>
                <span className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${occupant.isAssigned ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-500/10 text-slate-300'}`}>
                  {occupant.isAssigned ? 'zugewiesen' : 'offen'}
                </span>
              </div>
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
            Noch nicht zugewiesen — auf einen Zimmerbereich ziehen
          </div>
        )}
      </div>
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
  const color = pct >= 95 ? '#F87171' : pct >= 75 ? '#FBBF24' : pct > 0 ? '#4F8EF7' : '#2D4260';
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

  for (const slot of hotel.slots) {
    const key = `${slot.roomTypeId}|${slot.roomTypeName}`;
    const slotUsedBeds = slot.bookings.reduce((sum, booking) => sum + booking.occupants.length, 0);
    usedBeds += slotUsedBeds;
    totalBeds += slot.capacity;

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
