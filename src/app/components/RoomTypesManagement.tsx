import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { BedDouble, Building2, CalendarRange, DoorOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import type { Hotel, HotelRoomInventory, RoomType } from '../types';
import { ImportConflictNotice } from './ImportConflictNotice';
import type { OperationsLocationState } from '../operationsContext';
import { ContentCard, CrudDialog, EmptyState, InfoPanel, OpsButton, PageHeader, PageLayout, SectionHeader, StatusChip, Toolbar } from '../design-system';
import { READ_ONLY_TOOLTIP } from './PageLayout';
import { ActivitySummaryCard } from './activity';

type RoomTypeForm = { name: string; maxPersons: number };
type Usage = { hotel: Hotel; inventory: HotelRoomInventory };
const EMPTY_FORM: RoomTypeForm = { name: '', maxPersons: 2 };
const date = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="rounded-[var(--ops-radius-lg)] bg-[var(--ops-surface-elevated)] p-4"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">{icon}{label}</div><div className="mt-2 text-2xl font-extrabold">{value}</div></div>;
}

function RoomTypeDialog({ open, roomType, onClose, onSave }: { open: boolean; roomType: RoomType | null; onClose: () => void; onSave: (value: RoomTypeForm) => Promise<void> }) {
  const initial = roomType ? { name: roomType.name, maxPersons: roomType.maxPersons } : EMPTY_FORM;
  const [form, setForm] = useState<RoomTypeForm>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(initial); }, [open, roomType?.id]);
  return <CrudDialog open={open} title={roomType ? 'Zimmertyp bearbeiten' : 'Zimmertyp hinzufügen'} dirty={JSON.stringify(form) !== JSON.stringify(initial)} saving={saving} saveDisabled={!form.name.trim() || form.maxPersons < 1 || form.maxPersons > 10} onClose={onClose} onSave={async () => { setSaving(true); try { await onSave(form); onClose(); } finally { setSaving(false); } }}>
    <Stack spacing={2.25} sx={{ pt: 1 }}><TextField required label="Bezeichnung" placeholder="z. B. DZ / DU" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /><TextField required type="number" label="Maximale Personen" value={form.maxPersons || ''} inputProps={{ min: 1, max: 10, step: 1 }} helperText="Zulässige Belegung dieses Zimmertyps" onChange={event => setForm({ ...form, maxPersons: Number(event.target.value) })} />{roomType && <ActivitySummaryCard entityType="room-types" entityId={roomType.id} />}</Stack>
  </CrudDialog>;
}

export function RoomTypesManagement() {
  const location = useLocation(), navigate = useNavigate();
  const operations = (location.state as OperationsLocationState | null)?.operationsContext;
  const requestedRoomTypeId = new URLSearchParams(location.search).get('roomTypeId') || operations?.roomTypeId;
  const detailScrollRef = useRef<HTMLDivElement>(null), permissions = usePermissions();
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]), [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null), [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; roomType: RoomType | null }>({ open: false, roomType: null });
  const [deleting, setDeleting] = useState<RoomType | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const load = async () => { try { setLoading(true); const [types, hotelData] = await Promise.all([api.getRoomTypes(), api.getHotels()]); setRoomTypes(types); setHotels(hotelData); setSelectedId(current => requestedRoomTypeId && types.some(item => item.id === requestedRoomTypeId) ? requestedRoomTypeId : current && types.some(item => item.id === current) ? current : types[0]?.id || null); setError(null); } catch { setError('Zimmertypen konnten nicht geladen werden.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { detailScrollRef.current?.scrollTo({ top: 0 }); }, [selectedId]);
  const selected = roomTypes.find(item => item.id === selectedId) || null;
  const usageByType = useMemo(() => new Map(roomTypes.map(type => [type.id, hotels.flatMap(hotel => (hotel.roomInventories || []).filter(inventory => inventory.roomType.id === type.id).map(inventory => ({ hotel, inventory })))])), [hotels, roomTypes]);
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = roomTypes.filter(item => !normalizedSearch || `${item.name} ${item.maxPersons} ${item.maxPersons} personen person`.toLowerCase().includes(normalizedSearch));
  const usage = selected ? usageByType.get(selected.id) || [] : [];
  const hotelCount = new Set(usage.map(item => item.hotel.id)).size, rooms = usage.reduce((sum, item) => sum + item.inventory.roomCount, 0), beds = rooms * (selected?.maxPersons || 0);
  const openInventory = (inventoryId: string, hotelId: string) => navigate(`/hotels?hotelId=${hotelId}&inventoryId=${inventoryId}`);
  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500">Zimmertypen werden geladen …</div>;
  return <PageLayout className="[--ops-background:#111d2e] [--ops-surface:#1a2a40] [--ops-surface-raised:#21334c] [--ops-surface-elevated:#2a3e59] [--ops-surface-overlay:#344b67] [--ops-border:#4b6380] [--ops-divider:#405773] [--ops-text-muted:#b7c4d4] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:gap-5 xl:space-y-0">
    <ImportConflictNotice /><PageHeader eyebrow="Operations Center" title="Zimmertypen" subtitle="Zimmerkategorien, Kapazitäten und ihre Verwendung im operativen Überblick." meta={<><StatusChip tone="primary">{roomTypes.length} Zimmertypen</StatusChip><StatusChip tone="info">{hotels.reduce((sum, hotel) => sum + (hotel.roomInventories?.length || 0), 0)} Kontingente</StatusChip></>} actions={<OpsButton onClick={() => setDialog({ open: true, roomType: null })} disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined}><Plus className="mr-2 inline h-4 w-4" />Zimmertyp hinzufügen</OpsButton>} />
    {error && <InfoPanel tone="error" title="Fehler">{error}</InfoPanel>}
    <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row"><ContentCard surface="raised" className="flex flex-col overflow-hidden xl:min-h-0 xl:w-[22rem] xl:shrink-0"><div className="shrink-0 border-b border-[var(--ops-divider)] p-4"><SectionHeader title={`Zimmertypen (${filtered.length})`} /><Toolbar className="mt-3"><Search className="h-4 w-4 text-[var(--ops-text-muted)]" /><input aria-label="Zimmertypen suchen" className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Typ oder Personen suchen" value={search} onChange={event => setSearch(event.target.value)} /></Toolbar></div><div className="space-y-2 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">{filtered.map(item => { const count = usageByType.get(item.id)?.length || 0; return <button key={item.id} onClick={() => setSelectedId(item.id)} className={clsx('w-full rounded-xl border p-3 text-left transition hover:bg-[var(--ops-surface-elevated)]', selectedId === item.id ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="block truncate">{item.name}</b><div className="mt-1 text-xs text-[var(--ops-text-muted)]">Max. {item.maxPersons} {item.maxPersons === 1 ? 'Person' : 'Personen'}</div><div className="mt-2 text-xs font-bold">{count} {count === 1 ? 'Kontingent' : 'Kontingente'}</div></div><StatusChip tone={count ? 'info' : 'neutral'}>{new Set((usageByType.get(item.id) || []).map(entry => entry.hotel.id)).size} Hotels</StatusChip></div></button>; })}{!filtered.length && <EmptyState title="Keine Zimmertypen gefunden" description="Suchen Sie nach Bezeichnung oder Personenzahl." />}</div></ContentCard>
      <ContentCard surface="raised" className="overflow-hidden xl:min-h-0 xl:flex-1"><div ref={detailScrollRef} className="xl:h-full xl:overflow-y-auto">{selected ? <><div className="flex items-start justify-between gap-4 border-b border-[var(--ops-divider)] p-5"><div><SectionHeader title="Zimmertypinformationen" /><h2 className="mt-3 text-2xl font-extrabold">{selected.name}</h2><p className="mt-1 text-sm text-[var(--ops-text-muted)]">Maximal {selected.maxPersons} {selected.maxPersons === 1 ? 'Person' : 'Personen'} pro Zimmer</p></div><div className="flex gap-2"><OpsButton disabled={!permissions.canEdit} onClick={() => setDialog({ open: true, roomType: selected })}><Pencil className="mr-2 inline h-4 w-4" />Bearbeiten</OpsButton><OpsButton className="text-[var(--ops-error)]" disabled={!permissions.canDelete} onClick={() => setDeleting(selected)}><Trash2 className="mr-2 inline h-4 w-4" />Löschen</OpsButton></div></div>
        <div className="space-y-6 p-5"><SectionHeader title="Stammdaten" /><div className="grid overflow-hidden rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] sm:grid-cols-2 sm:divide-x sm:divide-[var(--ops-divider)]"><div className="p-4"><span className="text-[11px] font-bold uppercase text-[var(--ops-text-subtle)]">Bezeichnung</span><b className="mt-1 block">{selected.name}</b></div><div className="p-4"><span className="text-[11px] font-bold uppercase text-[var(--ops-text-subtle)]">Maximale Personen</span><b className="mt-1 block">{selected.maxPersons}</b></div></div>
          <SectionHeader title="Verwendung" subtitle="Aus allen vorhandenen Zimmerkontingenten berechnet" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Kontingente" value={usage.length} icon={<CalendarRange size={15} />} /><Metric label="Hotels" value={hotelCount} icon={<Building2 size={15} />} /><Metric label="Zimmer gesamt" value={rooms} icon={<DoorOpen size={15} />} /><Metric label="Betten gesamt" value={beds} icon={<BedDouble size={15} />} /></div>
          <SectionHeader title="Verwendende Hotels" subtitle="Klick öffnet das zugehörige Zimmerkontingent" /><div className="space-y-2">{usage.map(({ hotel, inventory }) => <ContentCard key={inventory.id} interactive className="cursor-pointer p-4" onClick={() => openInventory(inventory.id, hotel.id)}><div className="flex items-start justify-between gap-3"><div><h3 className="font-extrabold">{hotel.name}</h3><p className="mt-1 text-xs text-[var(--ops-text-muted)]">{date(inventory.availableFrom)} – {date(inventory.availableUntil)}</p></div><div className="text-right"><b>{inventory.roomCount} Zimmer</b><p className="text-xs text-[var(--ops-text-muted)]">{inventory.roomCount * selected.maxPersons} Betten</p></div></div></ContentCard>)}{!usage.length && <EmptyState title="Noch nicht verwendet" description="Für diesen Zimmertyp bestehen keine Zimmerkontingente." />}</div>
        </div></> : <div className="p-12"><EmptyState title="Kein Zimmertyp ausgewählt" description="Wählen Sie links einen Zimmertyp aus." /></div>}</div></ContentCard></div>
    <RoomTypeDialog open={dialog.open} roomType={dialog.roomType} onClose={() => setDialog({ open: false, roomType: null })} onSave={async value => { dialog.roomType ? await api.updateRoomType(dialog.roomType.id, value) : await api.createRoomType(value); await load(); }} />
    <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}><DialogTitle>{usage.length ? 'Zimmertyp kann nicht gelöscht werden' : 'Zimmertyp löschen?'}</DialogTitle><DialogContent>{usage.length ? <p>Dieser Zimmertyp wird aktuell in <b>{usage.length} Zimmerkontingenten</b> in {hotelCount} {hotelCount === 1 ? 'Hotel' : 'Hotels'} verwendet.<br /><br />Löschen ist deshalb nicht möglich.</p> : <p>Der Zimmertyp <b>{deleting?.name}</b> wird dauerhaft entfernt.</p>}</DialogContent><DialogActions><Button onClick={() => setDeleting(null)}>{usage.length ? 'Schließen' : 'Abbrechen'}</Button>{!usage.length && <Button color="error" variant="contained" onClick={async () => { if (!deleting) return; try { await api.deleteRoomType(deleting.id); setDeleting(null); await load(); } catch { setError('Zimmertyp konnte nicht gelöscht werden.'); setDeleting(null); } }}>Löschen</Button>}</DialogActions></Dialog>
  </PageLayout>;
}
