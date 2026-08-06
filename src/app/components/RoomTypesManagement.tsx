import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { BedDouble, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { usePermissions } from '../auth/AuthProvider';
import { api } from '../services/api';
import type { RoomType } from '../types';
import { ContentCard, CrudDialog, EmptyState, InfoPanel, OpsButton, PageHeader, PageLayout, SectionHeader, StatusChip, Toolbar } from '../design-system';
import { READ_ONLY_TOOLTIP } from './PageLayout';

type RoomTypeForm = { name: string; maxPersons: number };
const EMPTY_FORM: RoomTypeForm = { name: '', maxPersons: 2 };

function RoomTypeDialog({ open, roomType, onClose, onSave }: { open: boolean; roomType: RoomType | null; onClose: () => void; onSave: (value: RoomTypeForm) => Promise<void> }) {
  const initial = roomType ? { name: roomType.name, maxPersons: roomType.maxPersons } : EMPTY_FORM;
  const [form, setForm] = useState<RoomTypeForm>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(initial); }, [open, roomType?.id]);

  return <CrudDialog
    open={open}
    title={roomType ? 'Zimmertyp bearbeiten' : 'Zimmertyp hinzufügen'}
    dirty={JSON.stringify(form) !== JSON.stringify(initial)}
    saving={saving}
    saveDisabled={!form.name.trim() || form.maxPersons < 1 || form.maxPersons > 10}
    onClose={onClose}
    onSave={async () => { setSaving(true); try { await onSave(form); onClose(); } finally { setSaving(false); } }}
  >
    <Stack spacing={2.25} sx={{ pt: 1 }}>
      <TextField required label="Bezeichnung" placeholder="z. B. DZ / DU" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
      <TextField required type="number" label="Maximale Personen" value={form.maxPersons || ''} inputProps={{ min: 1, max: 10, step: 1 }} helperText="Zulässige Belegung dieses Zimmertyps" onChange={event => setForm({ ...form, maxPersons: Number(event.target.value) })} />
    </Stack>
  </CrudDialog>;
}

export function RoomTypesManagement() {
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const permissions = usePermissions();
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; roomType: RoomType | null }>({ open: false, roomType: null });
  const [deleting, setDeleting] = useState<RoomType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.getRoomTypes();
      setRoomTypes(data);
      setSelectedId(current => current && data.some(item => item.id === current) ? current : data[0]?.id || null);
      setError(null);
    } catch {
      setError('Zimmertypen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { detailScrollRef.current?.scrollTo({ top: 0 }); }, [selectedId]);

  const selected = roomTypes.find(item => item.id === selectedId) || null;
  const filtered = useMemo(() => roomTypes.filter(item => !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase())), [roomTypes, search]);

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500">Zimmertypen werden geladen …</div>;

  return <PageLayout className="[--ops-background:#111d2e] [--ops-surface:#1a2a40] [--ops-surface-raised:#21334c] [--ops-surface-elevated:#2a3e59] [--ops-surface-overlay:#344b67] [--ops-border:#4b6380] [--ops-divider:#405773] [--ops-text-muted:#b7c4d4] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:gap-4 xl:space-y-0">
    <PageHeader eyebrow="Operations Center" title="Zimmertypen" subtitle="Zimmerkategorien und maximale Belegung zentral verwalten." meta={<><StatusChip tone="primary">{roomTypes.length} Zimmertypen</StatusChip><StatusChip tone="info">bis zu {Math.max(0, ...roomTypes.map(item => item.maxPersons))} Personen</StatusChip></>} actions={<OpsButton onClick={() => setDialog({ open: true, roomType: null })} disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined}><Plus className="mr-2 inline h-4 w-4" />Zimmertyp hinzufügen</OpsButton>} />
    {error && <InfoPanel tone="error" title="Fehler">{error}</InfoPanel>}
    <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
      <ContentCard surface="raised" className="flex flex-col overflow-hidden xl:min-h-0 xl:w-[22rem] xl:shrink-0">
        <div className="shrink-0 border-b border-[var(--ops-divider)] p-4"><SectionHeader title={`Zimmertypen (${filtered.length})`} /><Toolbar className="mt-3"><Search className="h-4 w-4 text-[var(--ops-text-muted)]" /><input aria-label="Zimmertypen suchen" className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Bezeichnung suchen" value={search} onChange={event => setSearch(event.target.value)} /></Toolbar></div>
        <div className="space-y-2 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">{filtered.map(item => <button key={item.id} onClick={() => setSelectedId(item.id)} className={clsx('w-full rounded-xl border p-3 text-left transition hover:bg-[var(--ops-surface-elevated)]', selectedId === item.id ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="block truncate">{item.name}</b><div className="mt-1 text-xs text-[var(--ops-text-muted)]">Maximal {item.maxPersons} {item.maxPersons === 1 ? 'Person' : 'Personen'}</div></div><StatusChip tone="info">{item.maxPersons} Pers.</StatusChip></div></button>)}{!filtered.length && <EmptyState title="Keine Zimmertypen gefunden" description="Passen Sie die Suche an oder legen Sie einen neuen Zimmertyp an." />}</div>
      </ContentCard>
      <ContentCard surface="raised" className="overflow-hidden xl:min-h-0 xl:flex-1"><div ref={detailScrollRef} className="xl:h-full xl:overflow-y-auto">{selected ? <><div className="flex items-start justify-between gap-4 border-b border-[var(--ops-divider)] p-5"><div><SectionHeader title="Stammdaten" /><h2 className="mt-3 text-2xl font-extrabold">{selected.name}</h2><p className="mt-1 text-sm text-[var(--ops-text-muted)]">Zimmertyp und Belegungsgrenze</p></div><div className="flex gap-2"><OpsButton disabled={!permissions.canEdit} title={!permissions.canEdit ? READ_ONLY_TOOLTIP : undefined} onClick={() => setDialog({ open: true, roomType: selected })}><Pencil className="mr-2 inline h-4 w-4" />Bearbeiten</OpsButton><OpsButton className="text-[var(--ops-error)]" disabled={!permissions.canDelete} title={!permissions.canDelete ? READ_ONLY_TOOLTIP : undefined} onClick={() => setDeleting(selected)}><Trash2 className="mr-2 inline h-4 w-4" />Löschen</OpsButton></div></div><div className="grid gap-4 p-5 md:grid-cols-2"><ContentCard className="p-5"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]"><BedDouble size={16} />Bezeichnung</div><div className="mt-3 text-xl font-extrabold">{selected.name}</div></ContentCard><ContentCard className="p-5"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]"><Users size={16} />Maximale Personen</div><div className="mt-3 text-xl font-extrabold">{selected.maxPersons}</div></ContentCard></div></> : <div className="p-12"><EmptyState title="Kein Zimmertyp ausgewählt" description="Wählen Sie links einen Zimmertyp aus." /></div>}</div></ContentCard>
    </div>
    <RoomTypeDialog open={dialog.open} roomType={dialog.roomType} onClose={() => setDialog({ open: false, roomType: null })} onSave={async value => { dialog.roomType ? await api.updateRoomType(dialog.roomType.id, value) : await api.createRoomType(value); await load(); }} />
    <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}><DialogTitle>Zimmertyp löschen?</DialogTitle><DialogContent>Der Zimmertyp <b>{deleting?.name}</b> wird dauerhaft entfernt.</DialogContent><DialogActions><Button onClick={() => setDeleting(null)}>Abbrechen</Button><Button color="error" variant="contained" onClick={async () => { if (!deleting) return; try { await api.deleteRoomType(deleting.id); setDeleting(null); await load(); } catch { setError('Zimmertyp konnte nicht gelöscht werden.'); setDeleting(null); } }}>Löschen</Button></DialogActions></Dialog>
  </PageLayout>;
}
