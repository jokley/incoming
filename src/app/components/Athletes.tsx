import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Building2, CalendarDays, Check, ChevronRight, ClipboardList, FilterX, History, LockKeyhole, Plus, Search, ShieldCheck, UserRound, Users } from 'lucide-react';
import { clsx } from 'clsx';

import { usePermissions } from '../auth/AuthProvider';
import { ContentCard, EmptyState, InfoPanel, OpsButton, PageHeader, PageLayout, SectionHeader, StatusChip } from '../design-system';
import { api } from '../services/api';
import type { Athlete } from '../types';
import { READ_ONLY_TOOLTIP } from './PageLayout';

type FilterKey = 'nation' | 'discipline' | 'gender' | 'function' | 'status';
type Filters = Record<FilterKey, string>;
type CountItem = { value: string; label: string; count: number };

const emptyFilters: Filters = { nation: '', discipline: '', gender: '', function: '', status: '' };
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const genderLabel = (value?: string) => {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'W' || normalized === 'F' || normalized === 'FEMALE') return 'Damen';
  if (normalized === 'M' || normalized === 'MALE') return 'Herren';
  if (normalized === 'A' || normalized === 'X' || normalized === 'MIXED') return 'Mixed';
  return value || 'Nicht angegeben';
};
const assignmentLabel = (athlete: Athlete) => athlete.assignment?.hasAssignment ? 'Zugewiesen' : 'Nicht zugewiesen';
const importLabel = (athlete: Athlete) => athlete.hasPendingRoomlistReview ? 'Import geändert' : 'Aktuell';

function countValues(athletes: Athlete[], getValue: (athlete: Athlete) => string, getLabel: (value: string) => string = value => value): CountItem[] {
  const counts = new Map<string, number>();
  athletes.forEach(athlete => {
    const value = getValue(athlete).trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: getLabel(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

function FilterGroup({ title, filterKey, items, selected, onSelect }: { title: string; filterKey: FilterKey; items: CountItem[]; selected: string; onSelect: (key: FilterKey, value: string) => void }) {
  return <section>
    <h3 className="mb-2 px-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--ops-text-subtle)]">{title}</h3>
    <div className="space-y-1">
      {items.map(item => {
        const active = selected === item.value;
        return <button
          key={item.value || 'all'}
          type="button"
          aria-pressed={active}
          onClick={() => onSelect(filterKey, active ? '' : item.value)}
          className={clsx('group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition', active ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)] text-[var(--ops-tone-primary-text)]' : 'border-transparent text-[var(--ops-text-muted)] hover:border-[var(--ops-border)] hover:bg-[var(--ops-surface-elevated)] hover:text-[var(--ops-text)]')}
        >
          <span className="min-w-0 flex-1 truncate font-semibold">{item.label}</span>
          <span className={clsx('min-w-7 rounded-md border px-1.5 py-0.5 text-center text-[11px] font-bold', active ? 'border-[var(--ops-tone-primary-border)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)] text-[var(--ops-text-subtle)]')}>{item.count}</span>
          {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-70" />}
        </button>;
      })}
    </div>
  </section>;
}

function AthleteDialog({ athlete, open, onClose }: { athlete: Athlete | null; open: boolean; onClose: () => void }) {
  const permissions = usePermissions();
  const [stay, setStay] = useState({ arrivalDate: '', departureDate: '', note: '' });

  useEffect(() => {
    setStay({
      arrivalDate: athlete?.arrivalDate || '',
      departureDate: athlete?.departureDate || '',
      note: athlete?.additionalItems || '',
    });
  }, [athlete]);

  const assignmentStatus = athlete ? assignmentLabel(athlete) : '—';

  return <Dialog
    open={open}
    onClose={onClose}
    fullWidth
    maxWidth="md"
    slotProps={{ paper: { sx: { maxHeight: '92vh' } } }}
  >
    <DialogTitle sx={{ px: { xs: 2.5, sm: 3 }, py: 2.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, letterSpacing: '0.14em' }}>Athletenverwaltung</Typography>
          <Typography variant="h3" component="h2" sx={{ mt: -0.25 }}>Athlet bearbeiten</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {athlete ? `${athlete.firstname} ${athlete.lastname} · ${athlete.nationCode}` : 'Athletendetails'}
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 12, fontWeight: 700 }}>
          <ShieldCheck size={17} /> FIS-geführt
        </Box>
      </Stack>
    </DialogTitle>
    <DialogContent dividers sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
      <Stack spacing={2.5}>
        <DialogSection icon={<UserRound size={18} />} title="Stammdaten (FIS)" subtitle="Synchronisiert über den FIS-Import und nicht manuell editierbar." badge={<><LockKeyhole size={13} /> Schreibgeschützt</>}>
          <FieldGrid>
            <ReadonlyField label="Vorname" value={athlete?.firstname} />
            <ReadonlyField label="Nachname" value={athlete?.lastname} />
            <ReadonlyField label="Nation" value={athlete?.nationCode} />
            <ReadonlyField label="Disziplin" value={athlete?.discipline} />
            <ReadonlyField label="Gender" value={genderLabel(athlete?.gender || athlete?.forGender)} />
            <ReadonlyField label="Funktion" value={athlete?.function || 'Athlet'} />
            <ReadonlyField label="FIS-ID" value={athlete?.fisCode} />
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<CalendarDays size={18} />} title="Aufenthalt" subtitle={permissions.canEdit ? 'Operative Aufenthaltsdaten können bearbeitet werden.' : 'Für Ihre Rolle nur zur Ansicht verfügbar.'} emphasis>
          <FieldGrid>
            <TextField fullWidth type="date" label="Anreise" value={stay.arrivalDate} onChange={event => setStay(current => ({ ...current, arrivalDate: event.target.value }))} disabled={!permissions.canEdit} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="date" label="Abreise" value={stay.departureDate} onChange={event => setStay(current => ({ ...current, departureDate: event.target.value }))} disabled={!permissions.canEdit} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth multiline minRows={3} label="Interne Bemerkung" value={stay.note} onChange={event => setStay(current => ({ ...current, note: event.target.value }))} disabled={!permissions.canEdit} placeholder={permissions.canEdit ? 'Interne Hinweise zum Aufenthalt' : undefined} sx={{ gridColumn: '1 / -1' }} />
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<Building2 size={18} />} title="Unterkunft" subtitle="Nur Information – Zuweisungen erfolgen ausschließlich im Assignment-Modul." actions={<Button variant="outlined" size="small" disabled startIcon={<ChevronRight size={16} />}>Zum Assignment</Button>}>
          <FieldGrid>
            <ReadonlyField label="Hotel" value={athlete?.assignment?.hotelName} />
            <ReadonlyField label="Zimmertyp" value={athlete?.assignment?.roomTypeName || athlete?.roomType} />
            <ReadonlyField label="Zimmerpartner" value={athlete?.sharedWithName} />
            <ReadonlyField label="Assignment-Status" value={assignmentStatus} />
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<ClipboardList size={18} />} title="Import" subtitle="Vorbereitet für die zukünftige Änderungsverfolgung.">
          <FieldGrid>
            <ReadonlyField label="Importdatum" value={date(athlete?.athletesLastSeenAt)} />
            <ReadonlyField label="Importstatus" value={athlete ? importLabel(athlete) : undefined} />
            <ReadonlyField label="Quelle" value="FIS-Import" />
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<History size={18} />} title="Audit" subtitle="Systeminformationen zur Nachvollziehbarkeit.">
          <FieldGrid>
            <ReadonlyField label="Erstellt" value={date(athlete?.entryDate)} />
            <ReadonlyField label="Zuletzt geändert" value={date(athlete?.lastUpdate)} />
            <ReadonlyField label="Zuletzt importiert" value={date(athlete?.athletesLastSeenAt)} />
          </FieldGrid>
        </DialogSection>
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: { xs: 2.5, sm: 3 }, py: 2 }}><Button variant="contained" onClick={onClose}>Schließen</Button></DialogActions>
  </Dialog>;
}

function DialogSection({ icon, title, subtitle, badge, actions, emphasis = false, children }: { icon: ReactNode; title: string; subtitle: string; badge?: ReactNode; actions?: ReactNode; emphasis?: boolean; children: ReactNode }) {
  return <Box component="section" sx={{ overflow: 'hidden', border: '1px solid', borderColor: emphasis ? 'primary.main' : 'divider', borderRadius: 2, bgcolor: 'background.paper', boxShadow: emphasis ? '0 0 0 1px rgba(60, 148, 255, 0.12)' : 'none' }}>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, px: 2.25, py: 1.75 }}>
      <Stack direction="row" gap={1.25} alignItems="flex-start">
        <Box sx={{ display: 'flex', color: emphasis ? 'primary.main' : 'text.secondary', mt: 0.25 }}>{icon}</Box>
        <Box><Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{title}</Typography><Typography variant="caption" color="text.secondary">{subtitle}</Typography></Box>
      </Stack>
      {badge && <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.75, color: 'text.secondary', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{badge}</Box>}
      {actions}
    </Box>
    <Divider />
    <Box sx={{ p: 2.25 }}>{children}</Box>
  </Box>;
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>{children}</Box>;
}

function ReadonlyField({ label, value }: { label: string; value?: string | null }) {
  return <TextField fullWidth label={label} value={value || '—'} slotProps={{ input: { readOnly: true } }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.025)' }, '& .MuiInputBase-input': { color: 'text.secondary' } }} />;
}

function NewAthleteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (athlete: Athlete) => void }) {
  const [form, setForm] = useState({ firstname: '', lastname: '', nationCode: '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const created = await api.createAthlete({ ...form, nationCode: form.nationCode.trim().toUpperCase(), function: 'Athlete' });
      onCreated(created);
      setForm({ firstname: '', lastname: '', nationCode: '' });
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle>Athlet hinzufügen</DialogTitle>
    <DialogContent dividers><Stack spacing={2.25} sx={{ pt: 1 }}><TextField required label="Vorname" value={form.firstname} onChange={event => setForm({ ...form, firstname: event.target.value })} /><TextField required label="Nachname" value={form.lastname} onChange={event => setForm({ ...form, lastname: event.target.value })} /><TextField required label="Nation" helperText="Dreistelliger Nationencode, z. B. AUT" value={form.nationCode} onChange={event => setForm({ ...form, nationCode: event.target.value.toUpperCase() })} /></Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>Abbrechen</Button><Button variant="contained" disabled={saving || !form.firstname.trim() || !form.lastname.trim() || !form.nationCode.trim()} onClick={() => void save()}>{saving ? 'Speichern …' : 'Speichern'}</Button></DialogActions>
  </Dialog>;
}

export function Athletes() {
  const permissions = usePermissions();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [search, setSearch] = useState('');
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setAthletes(await api.getAthletes());
        setError(null);
      } catch {
        setError('Athleten konnten nicht geladen werden.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const groups = useMemo(() => ({
    nation: countValues(athletes, athlete => athlete.nationCode),
    discipline: countValues(athletes, athlete => athlete.discipline || ''),
    gender: countValues(athletes, athlete => genderLabel(athlete.gender || athlete.forGender)),
    function: countValues(athletes, athlete => athlete.function || 'Athlet'),
    status: [
      { value: '', label: 'Alle', count: athletes.length },
      { value: 'unassigned', label: 'Nicht zugewiesen', count: athletes.filter(athlete => !athlete.assignment?.hasAssignment).length },
      { value: 'changed', label: 'Import geändert', count: athletes.filter(athlete => athlete.hasPendingRoomlistReview).length },
    ],
  }), [athletes]);

  const filtered = useMemo(() => athletes.filter(athlete => {
    const term = search.trim().toLocaleLowerCase('de');
    const searchable = `${athlete.firstname} ${athlete.lastname} ${athlete.nationCode} ${athlete.discipline || ''} ${athlete.function || ''} ${athlete.assignment?.hotelName || ''} ${athlete.assignment?.roomNumber || ''}`.toLocaleLowerCase('de');
    const statusMatches = !filters.status || (filters.status === 'unassigned' && !athlete.assignment?.hasAssignment) || (filters.status === 'changed' && athlete.hasPendingRoomlistReview);
    return (!term || searchable.includes(term))
      && (!filters.nation || athlete.nationCode === filters.nation)
      && (!filters.discipline || athlete.discipline === filters.discipline)
      && (!filters.gender || genderLabel(athlete.gender || athlete.forGender) === filters.gender)
      && (!filters.function || (athlete.function || 'Athlet') === filters.function)
      && statusMatches;
  }), [athletes, filters, search]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (key: FilterKey, value: string) => setFilters(current => ({ ...current, [key]: value }));

  if (loading) return <div className="flex h-64 items-center justify-center"><CircularProgress /></div>;

  return <PageLayout className="[--ops-background:#111d2e] [--ops-surface:#1a2a40] [--ops-surface-raised:#21334c] [--ops-surface-elevated:#2a3e59] [--ops-surface-overlay:#344b67] [--ops-border:#4b6380] [--ops-divider:#405773] [--ops-text-muted:#b7c4d4] xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:gap-4 xl:space-y-0">
    <PageHeader eyebrow="Operations Center" title="Athleten" subtitle="Zentrale Suche, Filterung und Verwaltung aller Athleten und Teammitglieder." meta={<><StatusChip tone="primary">{athletes.length} Personen</StatusChip><StatusChip tone="success">{athletes.filter(athlete => athlete.assignment?.hasAssignment).length} zugewiesen</StatusChip><StatusChip tone="neutral">{athletes.filter(athlete => !athlete.assignment?.hasAssignment).length} offen</StatusChip></>} actions={<OpsButton onClick={() => setAdding(true)} disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : 'Athlet hinzufügen'}><Plus className="mr-2 inline h-4 w-4" />Athlet hinzufügen</OpsButton>} />
    {error && <InfoPanel tone="error" title="Fehler">{error}</InfoPanel>}

    <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
      <ContentCard surface="raised" className="flex flex-col overflow-hidden xl:min-h-0 xl:w-[20rem] xl:shrink-0">
        <div className="shrink-0 border-b border-[var(--ops-divider)] p-4">
          <SectionHeader title="Filter" subtitle="Alle Filter werden kombiniert" actions={activeFilterCount > 0 ? <button type="button" onClick={() => setFilters(emptyFilters)} className="flex items-center gap-1 text-xs font-bold text-[var(--ops-primary)]"><FilterX className="h-3.5 w-3.5" />Zurücksetzen</button> : undefined} />
        </div>
        <nav aria-label="Athletenfilter" className="space-y-5 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <FilterGroup title="Nationen" filterKey="nation" items={groups.nation} selected={filters.nation} onSelect={setFilter} />
          <FilterGroup title="Disziplinen" filterKey="discipline" items={groups.discipline} selected={filters.discipline} onSelect={setFilter} />
          <FilterGroup title="Gender" filterKey="gender" items={groups.gender} selected={filters.gender} onSelect={setFilter} />
          <FilterGroup title="Funktion" filterKey="function" items={groups.function} selected={filters.function} onSelect={setFilter} />
          <FilterGroup title="Status" filterKey="status" items={groups.status} selected={filters.status} onSelect={setFilter} />
        </nav>
      </ContentCard>

      <ContentCard surface="raised" className="flex min-w-0 flex-col overflow-hidden xl:min-h-0 xl:flex-1">
        <div className="shrink-0 border-b border-[var(--ops-divider)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><SectionHeader title="Athletenliste" /><div className="mt-1 text-sm text-[var(--ops-text-muted)]"><b className="text-[var(--ops-text)]">{filtered.length}</b> von {athletes.length} Personen</div></div>
            <label className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 lg:w-[27rem]">
              <Search className="h-4 w-4 shrink-0 text-[var(--ops-text-muted)]" />
              <input aria-label="Athleten suchen" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ops-text)] outline-none placeholder:text-[var(--ops-text-muted)]" placeholder="Name, Nation, Disziplin, Hotel oder Zimmer" value={search} onChange={event => setSearch(event.target.value)} />
              {search && <button type="button" onClick={() => setSearch('')} className="text-xs font-bold text-[var(--ops-primary)]">Löschen</button>}
            </label>
          </div>
        </div>
        <div className="min-h-[24rem] overflow-auto xl:min-h-0 xl:flex-1">
          <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--ops-surface-elevated)] text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--ops-text-subtle)]">
              <tr>{['Name', 'Nation', 'Disziplin', 'Gender', 'Funktion', 'Anreise', 'Abreise', 'Hotel', 'Zimmer', 'Assignment Status', 'Import Status'].map(label => <th key={label} className="border-b border-[var(--ops-border)] px-3 py-3 whitespace-nowrap">{label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(athlete => <tr key={athlete.id} tabIndex={0} onClick={() => setSelectedAthlete(athlete)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelectedAthlete(athlete); }} className="group cursor-pointer outline-none transition hover:bg-[var(--ops-surface-elevated)] focus:bg-[var(--ops-tone-primary-surface)]">
                <Cell><div className="flex items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]"><Users className="h-4 w-4" /></span><div><b className="block whitespace-nowrap text-[var(--ops-text)]">{athlete.firstname} {athlete.lastname}</b>{athlete.fisCode && <span className="text-[11px] text-[var(--ops-text-subtle)]">FIS {athlete.fisCode}</span>}</div></div></Cell>
                <Cell><b>{athlete.nationCode}</b></Cell><Cell>{athlete.discipline || '—'}</Cell><Cell>{genderLabel(athlete.gender || athlete.forGender)}</Cell><Cell>{athlete.function || 'Athlet'}</Cell><Cell>{date(athlete.arrivalDate)}</Cell><Cell>{date(athlete.departureDate)}</Cell><Cell>{athlete.assignment?.hotelName || '—'}</Cell><Cell>{athlete.assignment?.roomNumber || athlete.assignment?.roomTypeName || '—'}</Cell>
                <Cell><StatusChip tone={athlete.assignment?.hasAssignment ? 'success' : 'neutral'}>{assignmentLabel(athlete)}</StatusChip></Cell>
                <Cell><StatusChip tone={athlete.hasPendingRoomlistReview ? 'warning' : 'neutral'}>{importLabel(athlete)}</StatusChip></Cell>
              </tr>)}
            </tbody>
          </table>
          {!filtered.length && <div className="p-8"><EmptyState title="Keine Athleten gefunden" description="Passen Sie die Suche oder die kombinierten Filter an." action={<OpsButton onClick={() => { setFilters(emptyFilters); setSearch(''); }}>Alle Filter zurücksetzen</OpsButton>} /></div>}
        </div>
      </ContentCard>
    </div>
    <AthleteDialog athlete={selectedAthlete} open={Boolean(selectedAthlete)} onClose={() => setSelectedAthlete(null)} />
    <NewAthleteDialog open={adding} onClose={() => setAdding(false)} onCreated={athlete => setAthletes(current => [...current, athlete])} />
  </PageLayout>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="border-b border-[var(--ops-divider)] px-3 py-3 align-middle text-[var(--ops-text-muted)]">{children}</td>;
}
