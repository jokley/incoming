import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
import { Building2, CalendarDays, Check, ChevronRight, ClipboardList, FilterX, LockKeyhole, Search, ShieldCheck, UserRound } from 'lucide-react';
import { clsx } from 'clsx';

import { usePermissions } from '../auth/AuthProvider';
import { ContentCard, EmptyState, InfoPanel, InlineActionLink, OpsButton, PageHeader, SplitPageLayout, SectionHeader, StatusChip } from '../design-system';
import { api } from '../services/api';
import { assignmentWorkspaceHref } from '../services/auditActivity';
import { athleteWorkCategory, WORK_CATEGORY_LABELS } from '../services/workflowStatus';
import { ImportConflictNotice } from './ImportConflictNotice';
import { SingleRoomStatusBadge } from './SingleRoomStatusBadge';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import { ActivityInfoBlock } from './activity';
import type { OperationsLocationState } from '../operationsContext';
import type { Athlete } from '../types';

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
const importLabel = (athlete: Athlete) => WORK_CATEGORY_LABELS[athleteWorkCategory(athlete)];
const shortDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }) : '—';
const reviewHint = (athlete: Athlete) => {
  const details = athlete.importChangeDetails || [];
  const arrival = details.find(change => change.field === 'arrivalDate');
  const departure = details.find(change => change.field === 'departureDate');
  const dateChange = arrival || departure;
  if (dateChange) return `${shortDate(dateChange.old)} → ${shortDate(dateChange.new)}`;
  if (details.some(change => change.type === 'ROOMMATE_CHANGED')) return 'Zimmerpartner geändert';
  if (details.some(change => change.type === 'HOTEL_CHANGED')) return 'Hotel geändert';
  return athlete.importChangeTypes?.length ? ({ ROOM_DEMAND_CHANGED: 'Zimmerbedarf geändert', EVENT_CHANGED: 'Event geändert', NATION_CHANGED: 'Nation geändert', NEW_ATHLETE: 'Neu importiert', DATE_CHANGED: 'Aufenthalt geändert', ROOMMATE_CHANGED: 'Zimmerpartner geändert' }[athlete.importChangeTypes[0]]) : null;
};
const roomTypeLabel = (athlete: Athlete) => {
  const roomType = athlete.assignment?.roomTypeName || athlete.roomType;
  if (!roomType) return '—';

  const abbreviation = roomType.toUpperCase().match(/(?:^|\s|\/)(3BZ|4BZ|EZ|DZ|APP)(?=\s|\/|:|$)/)?.[1];
  return abbreviation || roomType;
};

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

function AthleteDialog({ athlete, open, onClose, onShowDecision }: { athlete: Athlete | null; open: boolean; onClose: () => void; onShowDecision: (id: string) => void }) {
  const permissions = usePermissions();
  const navigate = useNavigate();
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
            <ReadonlyField label="Disziplinen" value={athlete?.disciplines?.join(', ') || athlete?.discipline} />
            <ReadonlyField label="Aufenthalte" value={athlete?.stays?.map(stay => `${date(stay.arrivalDate)} – ${date(stay.departureDate)}${stay.discipline ? ` (${stay.discipline})` : ''}`).join(', ')} />
            <ReadonlyField label="Gender" value={genderLabel(athlete?.gender || athlete?.forGender)} />
            <ReadonlyField label="Funktion" value={athlete?.function || 'Athlet'} />
            <ReadonlyField label="FIS-ID" value={athlete?.fisCode} emptyValue="Keine FIS-ID" />
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<CalendarDays size={18} />} title="Aufenthalt" subtitle={permissions.canEdit ? 'Operative Aufenthaltsdaten können bearbeitet werden.' : 'Für Ihre Rolle nur zur Ansicht verfügbar.'} emphasis>
          <FieldGrid>
            <TextField fullWidth type="date" label="Anreise" value={stay.arrivalDate} onChange={event => setStay(current => ({ ...current, arrivalDate: event.target.value }))} disabled={!permissions.canEdit} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="date" label="Abreise" value={stay.departureDate} onChange={event => setStay(current => ({ ...current, departureDate: event.target.value }))} disabled={!permissions.canEdit} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth multiline minRows={3} label="Athletenbemerkung" value={stay.note} onChange={event => setStay(current => ({ ...current, note: event.target.value }))} disabled={!permissions.canEdit} placeholder={permissions.canEdit ? 'Interne Hinweise zum Aufenthalt' : undefined} sx={{ gridColumn: '1 / -1' }} />
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<Building2 size={18} />} title="Unterkunft" subtitle="Nur Information – Zuweisungen erfolgen ausschließlich im Assignment-Modul.">
          <FieldGrid>
            <ReadonlyField label="Hotel" value={athlete?.assignments?.map(item => item.hotelName).filter(Boolean).join(', ') || athlete?.assignment?.hotelName} />
            <ReadonlyField label="Zimmertyp" value={athlete?.assignment?.roomTypeName || athlete?.roomType} />
            <ReadonlyField label="Zimmerpartner" value={athlete?.sharedWithName} />
            <ReadonlyField label="Assignment-Status" value={assignmentStatus} />
          </FieldGrid>
          {athlete?.assignment?.hasAssignment && <Box sx={{ mt: 1.25 }}>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                onClose();
                navigate(assignmentWorkspaceHref({
                  bookingId: athlete.assignment?.bookingId,
                  hotelId: athlete.assignment?.hotelId,
                  personId: athlete.id,
                }));
              }}
            >
              Zuweisung öffnen →
            </Button>
          </Box>}
        </DialogSection>

        <DialogSection icon={<ClipboardList size={18} />} title="Import" subtitle="Vorbereitet für die zukünftige Änderungsverfolgung.">
          <FieldGrid>
            <ReadonlyField label="Importdatum" value={date(athlete?.athletesLastSeenAt)} />
            <ReadonlyField label="Importstatus" value={athlete ? importLabel(athlete) : undefined} />
            <ReadonlyField label="Quelle" value="FIS-Import" />
            <Box><Typography variant="caption" color="text.secondary">Einzelzimmerstatus</Typography><Box sx={{ mt: 0.75 }}><SingleRoomStatusBadge status={athlete?.single_room_status} /></Box></Box>
            {athlete?.single_room_decision_id && <Box sx={{ display: 'flex', alignItems: 'end' }}><Button size="small" variant="text" onClick={() => { onClose(); onShowDecision(String(athlete.single_room_decision_id)); }}>Entscheidung anzeigen</Button></Box>}
          </FieldGrid>
        </DialogSection>

        <ActivityInfoBlock entityType="athletes" entityId={athlete?.id} createdAt={athlete?.entryDate} updatedAt={athlete?.lastUpdate} />
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

function ReadonlyField({ label, value, emptyValue = '—' }: { label: string; value?: string | null; emptyValue?: string }) {
  return <TextField fullWidth label={label} value={value || emptyValue} slotProps={{ input: { readOnly: true } }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.025)' }, '& .MuiInputBase-input': { color: 'text.secondary' } }} />;
}

export function Athletes() {
  const navigate = useNavigate();
  const location = useLocation(); const operations = (location.state as OperationsLocationState | null)?.operationsContext;
  const query = new URLSearchParams(location.search);
  const requestedAthleteId = query.get('athleteId') || operations?.personId;
  const requestedNation = query.get('nation') || '';
  const requestedDiscipline = query.get('discipline') || '';
  const requestedSingleRoomStatus = query.get('singleRoomStatus') || '';
  const requestedReview = query.get('review') || '';
  const requestedMovement = query.get('movement') || '';
  const requestedDate = query.get('date') || '';
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, nation: requestedNation, discipline: requestedDiscipline });
  const [search, setSearch] = useState('');
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const loaded = await api.getAthletes(); setAthletes(loaded);
        if (requestedAthleteId) setSelectedAthlete(loaded.find(athlete => athlete.id === requestedAthleteId) || null);
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
      { value: 'open', label: 'Zuweisung offen', count: athletes.filter(athlete => ['new', 'open'].includes(athleteWorkCategory(athlete))).length },
      { value: 'new', label: 'Neu importiert', count: athletes.filter(athlete => athleteWorkCategory(athlete) === 'new').length },
      { value: 'review', label: 'Disposition prüfen', count: athletes.filter(athlete => athleteWorkCategory(athlete) === 'review').length },
      { value: 'conflict', label: 'Stammdaten prüfen', count: athletes.filter(athlete => athleteWorkCategory(athlete) === 'conflict').length },
    ],
  }), [athletes]);

  const filtered = useMemo(() => athletes.filter(athlete => {
    const term = search.trim().toLocaleLowerCase('de');
    const searchable = `${athlete.firstname} ${athlete.lastname} ${athlete.nationCode} ${athlete.disciplines?.join(' ') || athlete.discipline || ''} ${athlete.function || ''} ${athlete.assignment?.hotelName || ''} ${athlete.assignment?.roomNumber || ''}`.toLocaleLowerCase('de');
    const category = athleteWorkCategory(athlete);
    const statusMatches = !filters.status || (filters.status === 'open' ? ['new', 'open'].includes(category) : filters.status === category);
    const singleRoomMatches = !requestedSingleRoomStatus || athlete.single_room_status === requestedSingleRoomStatus;
    const reviewMatches = requestedReview !== 'invalid' || category === 'conflict';
    const movementMatches = !requestedMovement || !requestedDate
      || (requestedMovement === 'arrival' ? athlete.arrivalDate === requestedDate : athlete.departureDate === requestedDate);
    return (!term || searchable.includes(term))
      && (!filters.nation || athlete.nationCode === filters.nation)
      && (!filters.discipline || (athlete.disciplines || [athlete.discipline]).includes(filters.discipline))
      && (!filters.gender || genderLabel(athlete.gender || athlete.forGender) === filters.gender)
      && (!filters.function || (athlete.function || 'Athlet') === filters.function)
      && statusMatches
      && singleRoomMatches
      && reviewMatches
      && movementMatches;
  }), [athletes, filters, requestedDate, requestedMovement, requestedReview, requestedSingleRoomStatus, search]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (key: FilterKey, value: string) => setFilters(current => ({ ...current, [key]: value }));

  if (loading) return <div className="flex h-64 items-center justify-center"><CircularProgress /></div>;

  return <SplitPageLayout>
    <ImportConflictNotice />
    <PageHeader eyebrow="Operations Center" title="Athleten" subtitle="Zentrale Suche, Filterung und Verwaltung aller Athleten und Teammitglieder." meta={<><StatusChip tone="primary">{athletes.length} Personen</StatusChip><StatusChip tone="success">{athletes.filter(athlete => athlete.assignment?.hasAssignment).length} zugewiesen</StatusChip><StatusChip tone="neutral">{athletes.filter(athlete => !athlete.assignment?.hasAssignment).length} offen</StatusChip></>} />
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
          <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--ops-surface-elevated)] text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--ops-text-subtle)]">
              <tr>{['Name', 'Nation', 'Disziplin', 'Anreise', 'Abreise', 'Hotel', 'Zimmer', 'Status', 'Import'].map(label => <th key={label} className="border-b border-[var(--ops-border)] px-3 py-3 whitespace-nowrap">{label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(athlete => <tr key={athlete.id} tabIndex={0} onClick={() => setSelectedAthlete(athlete)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelectedAthlete(athlete); }} className="group cursor-pointer outline-none transition hover:bg-[var(--ops-surface-elevated)] focus:bg-[var(--ops-tone-primary-surface)]">
                <Cell><div><b className="block whitespace-nowrap text-[15px] font-extrabold leading-5 text-[var(--ops-text)]">{athlete.firstname} {athlete.lastname}</b><div className="mt-1.5"><SingleRoomStatusBadge status={athlete.single_room_status} /></div></div></Cell>
                <Cell><b>{athlete.nationCode}</b></Cell>
                <Cell><div className="min-w-28"><b className="block font-bold text-[var(--ops-text)]">{athlete.disciplines?.join(', ') || athlete.discipline || '—'}</b><span className="mt-0.5 block text-[11px] font-medium text-[var(--ops-text-subtle)]">{athlete.function || 'Athlet'}</span></div></Cell>
                <Cell>{date(athlete.arrivalDate)}</Cell><Cell>{date(athlete.departureDate)}</Cell>
                <Cell>{athlete.assignment?.hotelName && athlete.assignment.hotelId ? <InlineActionLink onClick={event => { event.stopPropagation(); navigate(`/hotels?hotelId=${athlete.assignment?.hotelId}`); }}>{athlete.assignment.hotelName}</InlineActionLink> : <span className="font-semibold text-[var(--ops-text)]">—</span>}</Cell>
                <Cell>{athlete.assignment?.hasAssignment ? <InlineActionLink onClick={event => { event.stopPropagation(); navigate(assignmentWorkspaceHref({ bookingId: athlete.assignment?.bookingId, hotelId: athlete.assignment?.hotelId, personId: athlete.id })); }}>{roomTypeLabel(athlete)}</InlineActionLink> : <b className="text-[var(--ops-text)]">{roomTypeLabel(athlete)}</b>}</Cell>
                <Cell><StatusChip tone={athlete.assignment?.hasAssignment ? 'success' : 'neutral'}>{assignmentLabel(athlete)}</StatusChip></Cell>
                <Cell>{athleteWorkCategory(athlete) === 'review' ? <button type="button" className="text-left" onClick={event => { event.stopPropagation(); navigate(`${assignmentWorkspaceHref({ bookingId: athlete.assignment?.bookingId, hotelId: athlete.assignment?.hotelId, roomTypeId: athlete.assignment?.roomTypeId, personId: athlete.id })}&workflow=review`); }}><StatusChip tone="warning">Disposition prüfen</StatusChip>{reviewHint(athlete) && <span className="mt-1 block whitespace-nowrap text-[10px] font-medium text-[var(--ops-text-subtle)]">{reviewHint(athlete)}</span>}</button> : <StatusChip tone={athleteWorkCategory(athlete) === 'conflict' ? 'warning' : athleteWorkCategory(athlete) === 'new' ? 'primary' : 'neutral'}>{importLabel(athlete)}</StatusChip>}</Cell>
              </tr>)}
            </tbody>
          </table>
          {!filtered.length && <div className="p-8"><EmptyState title="Keine Athleten gefunden" description="Passen Sie die Suche oder die kombinierten Filter an." action={<OpsButton onClick={() => { setFilters(emptyFilters); setSearch(''); }}>Alle Filter zurücksetzen</OpsButton>} /></div>}
        </div>
      </ContentCard>
    </div>
    <AthleteDialog athlete={selectedAthlete} open={Boolean(selectedAthlete)} onClose={() => setSelectedAthlete(null)} onShowDecision={setDecisionId} />
    <ImportDecisionDialog decisionId={decisionId} onClose={() => setDecisionId(null)} onOpenSession={sessionId => void navigate(`/import?sessionId=${sessionId}`)} />
  </SplitPageLayout>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="border-b border-[var(--ops-divider)] px-3 py-3 align-middle text-[var(--ops-text-muted)]">{children}</td>;
}
