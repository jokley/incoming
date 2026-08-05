import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Plus, Pencil, Trash2, Loader2, Building2, Calendar, X, BedDouble,
  DoorOpen, Users, AlertTriangle, Euro, ArrowRight, MapPin, Clock
} from 'lucide-react';
import { clsx } from 'clsx';
import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import type { Hotel, HotelRoomInventory, RoomBooking, RoomType } from '../types';
import { READ_ONLY_TOOLTIP } from './PageLayout';
import {
  ContentCard,
  EmptyState,
  InfoPanel,
  OpsButton,
  PageHeader,
  PageLayout,
  SectionHeader,
  StatusChip,
} from '../design-system';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

type HotelStats = {
  inventoryCount: number;
  totalRooms: number;
  occupiedRooms: number;
  freeRooms: number;
  totalBeds: number;
  occupiedBeds: number;
  freeBeds: number;
  occupancy: number;
  hasSurcharge: boolean;
  dateRange: string;
  statusLabel: string;
  statusTone: Tone;
  statusIcon: string;
};

const formatNumber = (value: number) => new Intl.NumberFormat('de-DE').format(value);
const formatPercent = (value: number) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)}%`;
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'offen';
const assignmentHref = (hotelId: string) => `/assignments?hotelId=${encodeURIComponent(hotelId)}`;

function getHotelDateRange(hotel: Hotel) {
  const dates = (hotel.roomInventories || []).flatMap((inventory) => [inventory.availableFrom, inventory.availableUntil]).filter(Boolean);
  if (dates.length === 0) return 'Kein Zeitraum';
  const timestamps = dates.map((date) => new Date(date).getTime()).filter((time) => !Number.isNaN(time));
  if (timestamps.length === 0) return 'Kein Zeitraum';
  return `${formatDate(new Date(Math.min(...timestamps)).toISOString())} – ${formatDate(new Date(Math.max(...timestamps)).toISOString())}`;
}

function getHotelStats(hotel: Hotel, bookings: RoomBooking[]): HotelStats {
  const inventories = hotel.roomInventories || [];
  const totalRooms = inventories.reduce((sum, inventory) => sum + inventory.roomCount, 0);
  const totalBeds = inventories.reduce((sum, inventory) => sum + inventory.roomCount * inventory.roomType.maxPersons, 0);
  const hotelBookings = bookings.filter((booking) => booking.hotel.id === hotel.id);
  const occupiedRooms = hotelBookings.length;
  const occupiedBeds = hotelBookings.reduce((sum, booking) => sum + Math.max(booking.occupants.length, booking.countsAsSingle ? 1 : 0), 0);
  const occupancy = totalRooms > 0 ? Math.min(100, (occupiedRooms / totalRooms) * 100) : 0;
  const hasSurcharge = inventories.some((inventory) => inventory.hasHalfBoard || inventory.hasSR);
  const freeRooms = Math.max(totalRooms - occupiedRooms, 0);
  const freeBeds = Math.max(totalBeds - occupiedBeds, 0);

  if (hasSurcharge) {
    return { inventoryCount: inventories.length, totalRooms, occupiedRooms, freeRooms, totalBeds, occupiedBeds, freeBeds, occupancy, hasSurcharge, dateRange: getHotelDateRange(hotel), statusLabel: 'Aufpreis', statusTone: 'info', statusIcon: '🟣' };
  }
  if (freeRooms <= 0 && totalRooms > 0) {
    return { inventoryCount: inventories.length, totalRooms, occupiedRooms, freeRooms, totalBeds, occupiedBeds, freeBeds, occupancy, hasSurcharge, dateRange: getHotelDateRange(hotel), statusLabel: 'Ausgebucht', statusTone: 'error', statusIcon: '🔴' };
  }
  if (occupancy >= 85) {
    return { inventoryCount: inventories.length, totalRooms, occupiedRooms, freeRooms, totalBeds, occupiedBeds, freeBeds, occupancy, hasSurcharge, dateRange: getHotelDateRange(hotel), statusLabel: 'Fast voll', statusTone: 'warning', statusIcon: '🟡' };
  }
  return { inventoryCount: inventories.length, totalRooms, occupiedRooms, freeRooms, totalBeds, occupiedBeds, freeBeds, occupancy, hasSurcharge, dateRange: getHotelDateRange(hotel), statusLabel: 'Verfügbar', statusTone: 'success', statusIcon: '🟢' };
}

function getInventoryStats(inventory: HotelRoomInventory, bookings: RoomBooking[]) {
  const totalRooms = inventory.roomCount;
  const totalBeds = inventory.roomCount * inventory.roomType.maxPersons;
  const matchingBookings = bookings.filter((booking) => booking.roomType.id === inventory.roomType.id);
  const occupiedRooms = matchingBookings.length;
  const occupiedBeds = matchingBookings.reduce((sum, booking) => sum + Math.max(booking.occupants.length, booking.countsAsSingle ? 1 : 0), 0);
  const freeRooms = Math.max(totalRooms - occupiedRooms, 0);
  const freeBeds = Math.max(totalBeds - occupiedBeds, 0);
  const occupancy = totalRooms > 0 ? Math.min(100, (occupiedRooms / totalRooms) * 100) : 0;
  const tone: Tone = freeRooms <= 0 && totalRooms > 0 ? 'error' : occupancy >= 85 ? 'warning' : 'success';
  return { totalRooms, totalBeds, occupiedRooms, occupiedBeds, freeRooms, freeBeds, occupancy, tone };
}

function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: Tone }) {
  const color = tone === 'error' ? 'bg-[var(--ops-error)]' : tone === 'warning' ? 'bg-[var(--ops-warning)]' : tone === 'success' ? 'bg-[var(--ops-success)]' : 'bg-[var(--ops-primary)]';
  return <div className="h-2 overflow-hidden rounded-full bg-[var(--ops-background)]"><div className={clsx('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function StatPill({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return <div className="rounded-[var(--ops-radius-lg)] bg-[var(--ops-surface-raised)] p-3"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--ops-text-subtle)]">{icon}{label}</div><div className="mt-2 text-xl font-extrabold text-[var(--ops-text)]">{value}</div></div>;
}

export function HotelsManagement() {
  const permissions = usePermissions();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [bookings, setBookings] = useState<RoomBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', location: '', region: '' });
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [inventoryForm, setInventoryForm] = useState({ roomTypeId: '', availableFrom: '', availableUntil: '', roomCount: 0, hasHalfBoard: false, hasSR: false });

  useEffect(() => { void loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [hotelsData, roomTypesData, bookingsData] = await Promise.all([api.getHotels(), api.getRoomTypes(), api.getRoomAssignments()]);
      setHotels(hotelsData);
      setRoomTypes(roomTypesData);
      setBookings(bookingsData);
      setSelectedHotelId((current) => current || hotelsData[0]?.id || null);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  const selectedHotel = hotels.find((hotel) => hotel.id === selectedHotelId) ?? null;
  const selectedStats = selectedHotel ? getHotelStats(selectedHotel, bookings) : null;
  const fleetStats = useMemo(() => hotels.reduce((acc, hotel) => {
    const stats = getHotelStats(hotel, bookings);
    acc.rooms += stats.totalRooms; acc.freeRooms += stats.freeRooms; acc.beds += stats.totalBeds; acc.freeBeds += stats.freeBeds;
    if (stats.statusLabel === 'Ausgebucht') acc.soldOut += 1;
    if (stats.hasSurcharge) acc.surcharge += 1;
    return acc;
  }, { rooms: 0, freeRooms: 0, beds: 0, freeBeds: 0, soldOut: 0, surcharge: 0 }), [hotels, bookings]);

  const handleSubmit = async (e: React.FormEvent) => {
    if (!permissions.canEdit) return;
    e.preventDefault();
    try {
      if (editingId) await api.updateHotel(editingId, formData);
      else await api.createHotel(formData);
      await loadData();
      setFormData({ name: '', location: '', region: '' });
      setIsAdding(false);
      setEditingId(null);
    } catch { setError('Fehler beim Speichern'); }
  };

  const handleEdit = (hotel: Hotel) => { setFormData({ name: hotel.name, location: hotel.location || '', region: hotel.region || '' }); setEditingId(hotel.id); setIsAdding(true); };
  const handleDelete = async (id: string) => { if (!permissions.canDelete || !confirm('Hotel wirklich löschen? Alle Inventories werden ebenfalls gelöscht.')) return; try { await api.deleteHotel(id); await loadData(); if (selectedHotelId === id) setSelectedHotelId(null); } catch { setError('Fehler beim Löschen'); } };
  const handleAddInventory = async (e: React.FormEvent) => { if (!permissions.canCreate || !selectedHotel) return; e.preventDefault(); try { await api.addHotelInventory(selectedHotel.id, inventoryForm); await loadData(); setShowInventoryForm(false); setInventoryForm({ roomTypeId: '', availableFrom: '', availableUntil: '', roomCount: 0, hasHalfBoard: false, hasSR: false }); } catch { setError('Fehler beim Hinzufügen des Inventorys'); } };
  const handleDeleteInventory = async (hotelId: string, inventoryId: string) => { if (!permissions.canDelete || !confirm('Inventory wirklich löschen?')) return; try { await api.deleteHotelInventory(hotelId, inventoryId); await loadData(); } catch { setError('Fehler beim Löschen'); } };
  const handleCancel = () => { setFormData({ name: '', location: '', region: '' }); setIsAdding(false); setEditingId(null); };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--ops-primary)]" /></div>;

  return <PageLayout>
    <PageHeader
      eyebrow="Operations Center"
      title="Hotels & Zimmerkontingente"
      subtitle="Zentrale Statusübersicht aller WM-Hotels, freier Kapazitäten, Aufpreise und kritischer Kontingente."
      meta={<><StatusChip tone="success">{formatNumber(fleetStats.freeRooms)} freie Zimmer</StatusChip><StatusChip tone="primary">{formatNumber(fleetStats.freeBeds)} freie Betten</StatusChip><StatusChip tone={fleetStats.soldOut ? 'error' : 'neutral'}>{fleetStats.soldOut} ausgebucht</StatusChip><StatusChip tone={fleetStats.surcharge ? 'info' : 'neutral'}>{fleetStats.surcharge} mit Aufpreis</StatusChip></>}
      actions={!isAdding && <OpsButton onClick={() => permissions.canCreate && setIsAdding(true)} disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined}><Plus className="mr-2 inline h-4 w-4" />Hotel hinzufügen</OpsButton>}
    />

    {error && <InfoPanel tone="error" title="Fehler" action={<button onClick={() => setError(null)} className="font-bold underline">Schließen</button>}>{error}</InfoPanel>}

    {isAdding && <ContentCard className="p-5" surface="raised"><SectionHeader title={editingId ? 'Hotel bearbeiten' : 'Neues Hotel'} /><form onSubmit={handleSubmit} className="mt-4 space-y-4"><div className="grid grid-cols-1 gap-4 md:grid-cols-3">{(['name','location','region'] as const).map((field) => <label key={field} className="text-sm font-semibold text-[var(--ops-text-muted)]">{field === 'name' ? 'Hotel Name *' : field === 'location' ? 'Ort' : 'Region'}<input type="text" value={formData[field]} onChange={(e) => setFormData({ ...formData, [field]: e.target.value })} required={field === 'name'} className="mt-2 w-full rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 text-[var(--ops-text)] outline-none focus:shadow-[var(--ops-focus-ring)]" /></label>)}</div><div className="flex gap-2"><OpsButton type="submit">{editingId ? 'Aktualisieren' : 'Erstellen'}</OpsButton><OpsButton type="button" onClick={handleCancel}>Abbrechen</OpsButton></div></form></ContentCard>}

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(26rem,0.95fr)_minmax(0,1.35fr)]">
      <ContentCard className="overflow-hidden" surface="raised">
        <div className="border-b border-[var(--ops-divider)] p-4"><SectionHeader title={`Hotelliste (${hotels.length})`} subtitle="Klickbare Kapazitätskarten mit Live-Status" /></div>
        <div className="max-h-[52rem] space-y-3 overflow-y-auto p-4">
          {hotels.map((hotel) => {
            const stats = getHotelStats(hotel, bookings);
            const active = selectedHotelId === hotel.id;
            return <button key={hotel.id} onClick={() => setSelectedHotelId(hotel.id)} className={clsx('w-full rounded-[var(--ops-radius-xl)] border p-4 text-left transition-all hover:bg-[var(--ops-surface-elevated)]', active ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-elevated)] shadow-[var(--ops-shadow-sm)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-[var(--ops-primary)]" /><h3 className="truncate text-lg font-extrabold text-[var(--ops-text)]">{hotel.name}</h3></div><p className="mt-1 flex items-center gap-1 text-sm text-[var(--ops-text-muted)]"><MapPin className="h-3.5 w-3.5" />{hotel.location && hotel.region ? `${hotel.location}, ${hotel.region}` : hotel.location || hotel.region || 'Keine Ortsinformation'}</p><p className="mt-1 flex items-center gap-1 text-xs text-[var(--ops-text-subtle)]"><Clock className="h-3.5 w-3.5" />{stats.dateRange}</p></div><StatusChip tone={stats.statusTone}>{stats.statusIcon} {stats.statusLabel}</StatusChip></div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4"><StatPill label="Kontingente" value={stats.inventoryCount} icon={<Calendar className="h-3.5 w-3.5" />} /><StatPill label="Zimmer frei" value={stats.freeRooms} icon={<DoorOpen className="h-3.5 w-3.5" />} /><StatPill label="Zimmer belegt" value={stats.occupiedRooms} icon={<Building2 className="h-3.5 w-3.5" />} /><StatPill label="Betten frei" value={stats.freeBeds} icon={<BedDouble className="h-3.5 w-3.5" />} /></div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-[var(--ops-text-muted)]"><span>Belegte Betten: <b className="text-[var(--ops-text)]">{stats.occupiedBeds}</b></span><span>Auslastung: <b className="text-[var(--ops-text)]">{formatPercent(stats.occupancy)}</b></span><span>Aufpreis: <b className="text-[var(--ops-text)]">{stats.hasSurcharge ? 'Ja' : 'Nein'}</b></span></div><div className="mt-3"><ProgressBar value={stats.occupancy} tone={stats.statusTone} /></div>
            </button>;
          })}
          {hotels.length === 0 && <EmptyState title="Keine Hotels vorhanden" description="Fügen Sie das erste Hotel hinzu, um Kontingente zu planen." />}
        </div>
      </ContentCard>

      <ContentCard className="overflow-hidden" surface="raised">
        <div className="border-b border-[var(--ops-divider)] p-4"><SectionHeader title={selectedHotel ? selectedHotel.name : 'Hotel auswählen'} subtitle={selectedHotel ? 'KPI, Kontingente und operative Aktionen' : 'Wählen Sie links ein Hotel aus.'} actions={selectedHotel && <div className="flex flex-wrap gap-2"><Link to={assignmentHref(selectedHotel.id)} className="rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-tone-primary-surface)] px-3 py-2 text-sm font-bold text-[var(--ops-tone-primary-text)]">Zimmerbelegung öffnen <ArrowRight className="inline h-4 w-4" /></Link><OpsButton onClick={() => handleEdit(selectedHotel)} disabled={!permissions.canEdit} title={!permissions.canEdit ? READ_ONLY_TOOLTIP : undefined}><Pencil className="mr-2 inline h-4 w-4" />Hotel bearbeiten</OpsButton><OpsButton onClick={() => setShowInventoryForm(true)} disabled={!permissions.canCreate}><Plus className="mr-2 inline h-4 w-4" />Kontingent</OpsButton></div>} /></div>
        {selectedHotel && selectedStats ? <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><StatPill label="Freie Zimmer" value={selectedStats.freeRooms} icon={<DoorOpen className="h-3.5 w-3.5" />} /><StatPill label="Belegte Zimmer" value={selectedStats.occupiedRooms} icon={<Building2 className="h-3.5 w-3.5" />} /><StatPill label="Freie Betten" value={selectedStats.freeBeds} icon={<BedDouble className="h-3.5 w-3.5" />} /><StatPill label="Belegte Betten" value={selectedStats.occupiedBeds} icon={<Users className="h-3.5 w-3.5" />} /><StatPill label="Auslastung" value={formatPercent(selectedStats.occupancy)} icon={<AlertTriangle className="h-3.5 w-3.5" />} /><StatPill label="Aufpreis" value={selectedStats.hasSurcharge ? 'Ja' : 'Nein'} icon={<Euro className="h-3.5 w-3.5" />} /></div>
          {showInventoryForm && <ContentCard className="p-4" surface="elevated"><div className="flex items-center justify-between"><SectionHeader title="Neues Zimmerkontingent" /><button onClick={() => setShowInventoryForm(false)}><X className="h-5 w-5" /></button></div><form onSubmit={handleAddInventory} className="mt-4 space-y-3"><div className="grid grid-cols-2 gap-3"><select value={inventoryForm.roomTypeId} onChange={(e) => setInventoryForm({ ...inventoryForm, roomTypeId: e.target.value })} required className="rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm"><option value="">Zimmertyp wählen</option>{roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}</select><input type="number" value={inventoryForm.roomCount || ''} onChange={(e) => setInventoryForm({ ...inventoryForm, roomCount: parseInt(e.target.value) || 0 })} min="1" required placeholder="Anzahl Zimmer" className="rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm" /><input type="date" value={inventoryForm.availableFrom} onChange={(e) => setInventoryForm({ ...inventoryForm, availableFrom: e.target.value })} required className="rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm" /><input type="date" value={inventoryForm.availableUntil} onChange={(e) => setInventoryForm({ ...inventoryForm, availableUntil: e.target.value })} required className="rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm" /></div><div className="flex gap-4 text-sm text-[var(--ops-text-muted)]"><label><input type="checkbox" checked={inventoryForm.hasHalfBoard} onChange={(e) => setInventoryForm({ ...inventoryForm, hasHalfBoard: e.target.checked })} className="mr-2" />Halbpension (HP)</label><label><input type="checkbox" checked={inventoryForm.hasSR} onChange={(e) => setInventoryForm({ ...inventoryForm, hasSR: e.target.checked })} className="mr-2" />SR</label></div><OpsButton type="submit">Hinzufügen</OpsButton></form></ContentCard>}
          <SectionHeader title="Kontingente" subtitle="Klickbare Cards statt Tabellen; Zimmerbelegung bleibt im Assignment-Modul." />
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">{(selectedHotel.roomInventories || []).map((inventory) => { const stats = getInventoryStats(inventory, bookings.filter((booking) => booking.hotel.id === selectedHotel.id)); return <Link key={inventory.id} to={assignmentHref(selectedHotel.id)} className="rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4 transition-colors hover:bg-[var(--ops-surface-elevated)]"><div className="flex items-start justify-between"><div><h4 className="text-lg font-extrabold text-[var(--ops-text)]">{inventory.roomType.name}</h4><p className="mt-1 text-sm text-[var(--ops-text-muted)]">{formatDate(inventory.availableFrom)} – {formatDate(inventory.availableUntil)}</p></div><StatusChip tone={stats.tone}>{stats.freeRooms <= 0 ? 'Ausgebucht' : stats.occupancy >= 85 ? 'Fast voll' : 'Verfügbar'}</StatusChip></div><div className="mt-4 grid grid-cols-3 gap-2"><StatPill label="Zimmer gesamt" value={stats.totalRooms} icon={<Building2 className="h-3.5 w-3.5" />} /><StatPill label="Zimmer frei" value={stats.freeRooms} icon={<DoorOpen className="h-3.5 w-3.5" />} /><StatPill label="Zimmer belegt" value={stats.occupiedRooms} icon={<Users className="h-3.5 w-3.5" />} /><StatPill label="Betten gesamt" value={stats.totalBeds} icon={<BedDouble className="h-3.5 w-3.5" />} /><StatPill label="Betten frei" value={stats.freeBeds} icon={<BedDouble className="h-3.5 w-3.5" />} /><StatPill label="Auslastung" value={formatPercent(stats.occupancy)} icon={<AlertTriangle className="h-3.5 w-3.5" />} /></div><div className="mt-3"><ProgressBar value={stats.occupancy} tone={stats.tone} /></div><div className="mt-3 flex items-center justify-between"><div className="flex gap-2">{inventory.hasHalfBoard && <StatusChip tone="info">HP Aufpreis</StatusChip>}{inventory.hasSR && <StatusChip tone="info">SR Aufpreis</StatusChip>}</div><button onClick={(e) => { e.preventDefault(); handleDeleteInventory(selectedHotel.id, inventory.id); }} className="text-[var(--ops-error)] hover:opacity-80"><Trash2 className="h-4 w-4" /></button></div></Link>; })}</div>
          {(selectedHotel.roomInventories || []).length === 0 && <EmptyState title="Keine Zimmerkontingente" description="Für dieses Hotel sind noch keine Verfügbarkeiten hinterlegt." />}
        </div> : <div className="p-12"><EmptyState title="Hotel auswählen" description="Wählen Sie links ein Hotel aus, um Kontingente und Status zu sehen." /></div>}
      </ContentCard>
    </div>

    {hotels.some((hotel) => (hotel.roomInventories || []).length > 0) && <ContentCard className="p-5" surface="raised"><SectionHeader title="Timeline" subtitle="Modernisierte Verfügbarkeitsansicht mit Zeitraum und Auslastung." /><div className="mt-5 space-y-3 overflow-x-auto">{hotels.filter((hotel) => (hotel.roomInventories || []).length > 0).map((hotel) => { const stats = getHotelStats(hotel, bookings); return <button key={hotel.id} onClick={() => setSelectedHotelId(hotel.id)} className="w-full rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4 text-left hover:bg-[var(--ops-surface-elevated)]"><div className="grid gap-4 lg:grid-cols-[16rem_1fr_8rem]"><div><div className="font-extrabold text-[var(--ops-text)]">{hotel.name}</div><div className="text-sm text-[var(--ops-text-muted)]">{hotel.location || hotel.region || 'Ohne Ort'}</div></div><div className="space-y-2">{(hotel.roomInventories || []).map((inventory) => { const invStats = getInventoryStats(inventory, bookings.filter((booking) => booking.hotel.id === hotel.id)); return <div key={inventory.id} className="rounded-[var(--ops-radius-lg)] bg-[var(--ops-surface-raised)] p-3"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold text-[var(--ops-text)]">{inventory.roomType.name} · {inventory.roomCount} Zimmer verfügbar</span><span className="text-[var(--ops-text-muted)]">{formatDate(inventory.availableFrom)} – {formatDate(inventory.availableUntil)} · {formatPercent(invStats.occupancy)}</span></div><ProgressBar value={invStats.occupancy} tone={invStats.tone} /></div>; })}</div><StatusChip tone={stats.statusTone}>{stats.statusIcon} {formatPercent(stats.occupancy)}</StatusChip></div></button>; })}</div></ContentCard>}
  </PageLayout>;
}
