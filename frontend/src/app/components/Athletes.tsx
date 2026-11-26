import { FisDeviationBadge } from './AccommodationRequirementField';
import { requiresAccommodation } from '../services/accommodationRequirement.ts';
import {stayWindowText,stayWindowDetails} from '../services/stayWindow';
import type { AccommodationRequirement } from '../types';
import { AccommodationRateChip, AccommodationRateField } from './AccommodationRate';
import type { AccommodationRateCategory } from '../types';
import { personAccommodation } from '../services/personAccommodation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Building2, Crown, CalendarDays, Check, ChevronRight, ClipboardList, FilterX, LockKeyhole, MessageSquareText, Search, ShieldCheck, UserRound } from 'lucide-react';
import { clsx } from 'clsx';

import { usePermissions } from '../auth/AuthProvider';
import { ContentCard, EmptyState, InfoPanel, InlineActionLink, OpsButton, PageHeader, SplitPageLayout, SectionHeader, StatusChip } from '../design-system';
import { semanticToneClasses } from '../design-system/components/primitives';
import { api } from '../services/api';
import { assignmentWorkspaceHref } from '../services/auditActivity';
import { competitionFilterGroups, competitionGroupSelected, toggleCompetitionGroup, matchesCompetitionSelection, sportAreaOptions, type CompetitionFilterGroup } from '../services/athleteCompetitionFilters';
import { competitionDisplayList, competitionMembershipList, previewEventGroupLabel, competitionDisplayName, sportAreaValue } from '../services/competitionPresentation';
import { accommodationSurcharge } from '../services/accommodationSurcharge';
import { athleteWorkCategory, WORK_CATEGORY_LABELS } from '../services/workflowStatus';
import { ImportConflictNotice } from './ImportConflictNotice';
import { SingleRoomAssignmentBadges } from './SingleRoomStatusBadge';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import { ActivityInfoBlock } from './activity';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { OperationsLocationState } from '../operationsContext';
import type { Athlete } from '../types';
import { personFunctionOptions, matchesPersonFunction } from '../services/personFunctions';

type FilterKey = 'nation' | 'sport' | 'gender' | 'function' | 'status' | 'notes' | 'rate';
type Filters = Record<FilterKey, string> & { competitions: string[] };
type CountItem = { value: string; label: string; count: number };

const emptyFilters: Filters = { nation: '', sport: '', competitions: [], gender: '', function: '', status: '', notes: '', rate: '' };
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const genderLabel = (value?: string) => {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'W' || normalized === 'F' || normalized === 'FEMALE') return 'Damen';
  if (normalized === 'M' || normalized === 'MALE') return 'Herren';
  if (normalized === 'A' || normalized === 'X' || normalized === 'MIXED') return 'Mixed';
  return value || 'Nicht angegeben';
};
const assignmentLabel = (athlete: Athlete) => personAccommodation(athlete).label;
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
  return athlete.importChangeTypes?.length ? ({ ROOM_DEMAND_CHANGED: 'Zimmerbedarf geändert', EVENT_CHANGED: 'Event geändert', NATION_CHANGED: 'Nation geändert', NEW_ATHLETE: 'Neu', DATE_CHANGED: 'Aufenthalt geändert', ROOMMATE_CHANGED: 'Zimmerpartner geändert' }[athlete.importChangeTypes[0]]) : null;
};
const roomTypeLabel = (athlete: Athlete) => {
  const roomType = personAccommodation(athlete).roomLabel;
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

function CompetitionFilter({ items, selected, onToggle }: { items: CompetitionFilterGroup[]; selected: string[]; onToggle: (group: CompetitionFilterGroup) => void }) {
  return <section><h3 className="mb-2 px-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--ops-text-subtle)]">Wettbewerbe</h3><div className="space-y-1">{items.map(item => {
    const active = competitionGroupSelected(item, selected);
    return <button key={item.value} type="button" aria-pressed={active} onClick={() => onToggle(item)} className={clsx('flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm', active ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-transparent hover:bg-[var(--ops-surface-elevated)]')}><span className="min-w-0 flex-1 truncate font-semibold">{item.label}</span><span className="text-xs">{item.count}</span>{active && <Check className="h-3.5 w-3.5" />}</button>;
  })}</div></section>;
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

function AthleteNoteBadge({ label, note, athlete, onOpen }: { label: 'Intern' | 'Extern'; note?: string | null; athlete: Athlete; onOpen: (athlete: Athlete) => void }) {
  if (!note?.trim()) return null;
  return <Tooltip><TooltipTrigger asChild><button type="button" onClick={event => { event.stopPropagation(); onOpen(athlete); }} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.info}`}><MessageSquareText className="h-3 w-3" aria-hidden="true" />{label}</button></TooltipTrigger><TooltipContent side="top" sideOffset={5} className="max-w-80 whitespace-pre-wrap break-words bg-[var(--ops-text)] text-left text-xs leading-relaxed text-[var(--ops-surface)]">{note}</TooltipContent></Tooltip>;
}

function AthleteDialog({ athlete, open, onClose, onShowDecision, onUpdate, onNext, position, people }: {
  onUpdate: (athlete: Athlete) => void; onNext: (athlete: Athlete) => void; athlete: Athlete | null;
  open: boolean; onClose: () => void; onShowDecision: (id: string) => void;
  position?: string; people: Athlete[];
}) {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [stay, setStay] = useState({ arrivalDate: '', departureDate: '', note: '', exemptReason: '', rate: 'STANDARD' as AccommodationRateCategory, requirement: 'REQUIRED' as AccommodationRequirement, requirementTouched:false, releaseRequirement:false, roomType:'', partner:'' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setStay({
      arrivalDate: athlete?.arrivalDate || '',
      departureDate: athlete?.departureDate || '',
      note: athlete?.internalNote || '',
      requirement: athlete?.accommodationRequirement || 'REQUIRED', requirementTouched:false, releaseRequirement:false,
      rate: athlete?.accommodationRateCategory || 'STANDARD',
      exemptReason: athlete?.singleRoomQuotaExemptReason || '',
      roomType: athlete?.roomType?.toLowerCase() === 'no room' ? '' : athlete?.roomType || '', partner: athlete?.sharedWithName || '',
    });
    setSaveError(null);
  }, [athlete]);

  const [reportedRequests, setReportedRequests] = useState<Athlete['reportedAccommodationRequests']>();
  const athleteId = athlete?.id;
  useEffect(() => {
    setReportedRequests(undefined);
    if (!open || !athleteId) return;
    let active = true;
    void api.getAthlete(athleteId).then(person => {
      if (active) setReportedRequests(person.reportedAccommodationRequests);
    }).catch(() => { if (active) setReportedRequests(undefined); });
    return () => { active = false; };
  }, [open, athleteId]);

  const booked = Boolean(athlete?.accommodationCoverage?.segments.length || athlete?.assignment?.hasAssignment);
  const roomTypeOptions = [...new Set(['Single', 'Double', 'Double shared', 'Double single', 'Apartment', stay.roomType].filter(Boolean))];
  const editableWish = permissions.canEdit && !saving && !booked && stay.requirement === 'REQUIRED' && !stay.releaseRequirement;
  const shared = /shared/i.test(stay.roomType);
  const roomChanged = stay.roomType !== (athlete?.roomType?.toLowerCase() === 'no room' ? '' : athlete?.roomType || '') || stay.partner !== (athlete?.sharedWithName || '');
  const dirty = stay.requirementTouched || roomChanged || stay.arrivalDate !== (athlete?.arrivalDate || '')
    || stay.departureDate !== (athlete?.departureDate || '') || stay.note !== (athlete?.internalNote || '')
    || stay.rate !== (athlete?.accommodationRateCategory || 'STANDARD');
  const close = () => { if (!saving && (!dirty || window.confirm('Ungespeicherte Änderungen verwerfen?'))) onClose(); };
  const wishKey = (request: NonNullable<Athlete['reportedAccommodationRequests']>[number]) =>
    [request.roomType?.trim().toLowerCase() || '', request.partner?.trim().toLowerCase() || ''].join('|');
  const canReturnToFis = !!reportedRequests?.length && reportedRequests.every(request => request.roomType)
    && new Set(reportedRequests.map(wishKey)).size === 1;
  const personName = (value: string) => value.toLocaleLowerCase('de').replace(/[,\s]+/g, ' ').trim();
  const partnerCandidates = people.filter(p => p.id !== athlete?.id && p.nationCode === athlete?.nationCode
    && [personName(p.firstname + ' ' + p.lastname), personName(p.lastname + ' ' + p.firstname)].includes(personName(stay.partner)));
  const partnerOpen = partnerCandidates.length === 1 && partnerCandidates[0].accommodationRequirement === 'UNRESOLVED';
  const save = async (advance = false) => {
    if (!athlete || (stay.requirementTouched && stay.requirement === 'UNRESOLVED' && !stay.releaseRequirement)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.updateAthlete(athlete.id, {
        ...(stay.arrivalDate !== (athlete.arrivalDate || '') ? {arrivalDate: stay.arrivalDate || null} : {}),
        ...(stay.departureDate !== (athlete.departureDate || '') ? {departureDate: stay.departureDate || null} : {}),
        ...(stay.note !== (athlete.internalNote || '') ? {internalNote: stay.note || null} : {}),
        ...(stay.releaseRequirement ? {returnToFis: true} : stay.requirementTouched || roomChanged ? {accommodationRequirement: stay.requirement} : {}),
        ...(!stay.releaseRequirement && editableWish && roomChanged ? {roomType: stay.roomType || null, sharedWithName: shared ? stay.partner || null : null} : {}),
        ...(stay.rate !== (athlete.accommodationRateCategory || 'STANDARD') ? {accommodationRateCategory: stay.rate} : {}),
      });
      onUpdate(updated);
      if (advance) onNext(updated);
      else onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Änderungen konnten nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const assignmentStatus = athlete ? assignmentLabel(athlete) : '—';

  return <Dialog
    open={open}
    aria-labelledby="athlete-dialog-title"
    onClose={close}
    fullWidth
    maxWidth="md"
    slotProps={{ paper: { sx: { maxHeight: '92vh' } } }}
  >
    <DialogTitle sx={{ px: { xs: 2.5, sm: 3 }, py: 2.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, letterSpacing: '0.14em' }}>Athletenverwaltung</Typography>
          <Typography id="athlete-dialog-title" variant="h3" component="h2" sx={{ mt: -0.25 }}>Athlet bearbeiten</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {athlete ? `${athlete.firstname} ${athlete.lastname} · ${athlete.nationCode}` : 'Athletendetails'}{position && ` · ${position}`}
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 12, fontWeight: 700 }}>
          <ShieldCheck size={17} /> FIS-geführt
        </Box>
      </Stack>
    </DialogTitle>
    <DialogContent dividers sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
      <Stack spacing={2.5}>
        <DialogSection icon={<Building2 size={18} />} title="Unterkunft" subtitle="Zimmerzuweisungen werden in der Disposition bearbeitet.">
          {reportedRequests?.length ? <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2">FIS-Unterkunftsmeldungen</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5, mt: 1 }}>
              {reportedRequests.map(request => {
                const noRoom = request.roomType?.trim().toLowerCase() === 'no room';
                return <Box key={`${request.version}-${request.entryRow}`} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Typography variant="subtitle2">{request.family === 'Freestyle' ? 'Freestyle / Freeski' : request.family === 'Snowboard' ? 'Snowboard' : 'Meldung'}</Typography>
                  <Typography variant="body2">{request.roomType || 'Kein Zimmerwunsch gemeldet'}{request.partner && ` · ${request.partner}`}</Typography>
                  <Typography variant="body2" color="text.secondary">{date(request.arrivalDate)} – {date(request.departureDate)}</Typography>
                  {request.matchesDecision !== undefined && <Typography variant="caption" color={request.matchesDecision ? 'text.secondary' : 'warning.main'} display="block">
                    {request.matchesDecision ? 'Entspricht der gespeicherten Entscheidung' : 'Weicht von der gespeicherten Entscheidung ab'}
                  </Typography>}
                  <Typography variant="caption" color="text.secondary" display="block">
                    Version {request.version}, Entry List Zeile {request.entryRow ?? '—'}
                    {request.roomRows.length > 0 && ` · Room List Zeile ${request.roomRows.join(', ')}`}
                  </Typography>
                  {permissions.canEdit && <Button variant="outlined" size="small" sx={{ mt: 1 }} disabled={saving || booked || !request.roomType}
                    onClick={() => setStay(current => ({...current, requirement: noRoom ? 'NO_ROOM' : 'REQUIRED',
                      roomType: noRoom ? '' : request.roomType || '', partner: noRoom ? '' : request.partner || '',
                      requirementTouched: true, releaseRequirement: false}))}>Zimmerwunsch übernehmen</Button>}
                </Box>;
              })}
            </Box>
          </Box> : null}
          <Typography variant="subtitle2">Operative Entscheidung</Typography>
          {athlete?.accommodationDecisionLabel && <StatusChip tone={athlete.accommodationDecisionLabel === 'Abweichung FIS' || athlete.accommodationRequirement === 'UNRESOLVED' ? 'warning' : 'neutral'}>{athlete.accommodationDecisionLabel}</StatusChip>}
          {athlete && <FisDeviationBadge person={athlete} expanded/>}
          {stay.requirement === 'UNRESOLVED' && <Alert severity="warning" sx={{ my: 1 }}>Unterkunftsbedarf offen. Bitte eine Entscheidung treffen. Bis dahin bleibt die Person von der Disposition ausgeschlossen.</Alert>}
          <FormControlLabel label="Nicht disponieren (No Dispo)" control={<Checkbox checked={stay.requirement === 'NO_DISPO'} disabled={!permissions.canEdit || saving || stay.requirement === 'UNRESOLVED'}
            onChange={event => setStay(current => ({...current, requirementTouched: true, releaseRequirement: false,
              requirement: event.target.checked ? 'NO_DISPO' : 'REQUIRED'}))} />} />
          {stay.requirement === 'NO_DISPO' && booked && <Typography variant="body2" color="warning.main">Bestehende Buchung bleibt erhalten.</Typography>}
          <FieldGrid>
            <TextField id="athlete-accommodation-requirement" select size="small" label="Unterkunftsbedarf" slotProps={{select: {SelectDisplayProps: {'aria-label': 'Unterkunftsbedarf'}}}} value={stay.requirement === 'NO_DISPO' ? 'NO_DISPO' : stay.requirement}
              disabled={!permissions.canEdit || saving || stay.requirement === 'NO_DISPO' || stay.releaseRequirement}
              onChange={event => setStay(current => ({...current, requirement: event.target.value as AccommodationRequirement, requirementTouched: true, releaseRequirement: false}))}>
              <MenuItem value="UNRESOLVED" disabled>Unterkunftsbedarf offen</MenuItem>
              {stay.requirement === 'NO_DISPO' && <MenuItem value="NO_DISPO">Nicht disponieren</MenuItem>}
              <MenuItem value="REQUIRED">Unterkunft benötigt</MenuItem>
              <MenuItem value="NO_ROOM" disabled={booked}>Kein Zimmer benötigt</MenuItem>
            </TextField>
            <TextField id="athlete-accommodation-room-type" select size="small" label="Gewünschter Zimmertyp" slotProps={{select: {SelectDisplayProps: {'aria-label': 'Gewünschter Zimmertyp'}}}} value={stay.requirement === 'REQUIRED' ? stay.roomType : ''} disabled={!editableWish}
              onChange={event => setStay(current => ({...current, roomType: event.target.value,
                partner: /shared/i.test(event.target.value) ? current.partner : '', requirementTouched: true}))}>
              <MenuItem value="">Keine Angabe</MenuItem>
              {roomTypeOptions.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Gewünschter Zimmerpartner" value={stay.requirement === 'REQUIRED' && shared ? stay.partner : ''} disabled={!editableWish || !shared}
              onChange={event => setStay(current => ({...current, partner: event.target.value, requirementTouched: true}))}
              helperText={stay.requirement === 'REQUIRED' && shared && partnerOpen ? 'Unterkunftsbedarf dieser Person ist noch offen. Eine gemeinsame Buchung ist derzeit gesperrt.' : undefined}
              slotProps={{htmlInput: {maxLength: 200}}} />
            {stay.requirement === 'REQUIRED' && <AccommodationRateField compact value={stay.rate} disabled={!permissions.canEdit || saving}
              onChange={rate=>setStay(current=>({...current,rate}))}/>}
          </FieldGrid>
          {permissions.canEdit && athlete?.accommodationRequirementSource === 'MANUAL' && canReturnToFis &&
            <Button variant="outlined" size="small" sx={{ mt: 1 }} disabled={saving || booked || stay.releaseRequirement}
              onClick={() => setStay(current => ({...current, requirementTouched: true, releaseRequirement: true}))}>Zur FIS-Meldung zurückkehren</Button>}
          {stay.releaseRequirement && <Typography variant="body2" sx={{ mt: 1 }}>Die eindeutige FIS-Meldung wird beim Speichern übernommen.</Typography>}
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Tatsächliche Buchung</Typography>
          <FieldGrid>
            <ReadonlyField label="Hotel" value={athlete ? personAccommodation(athlete).hotelLabel : undefined} />
            <ReadonlyField label="Buchungsstatus" value={booked ? assignmentStatus : 'Keine Buchung'} />
            {booked && <ReadonlyField label="Gebuchter Zimmertyp" value={athlete ? personAccommodation(athlete).roomLabel : undefined} />}
            <ReadonlyField label="Mehrpreis" value={accommodationSurcharge(athlete).applicable
              ? (accommodationSurcharge(athlete).hasAccommodationSurcharge ? 'Ja' : 'Nein') : undefined} />
          </FieldGrid>
          {athlete?.assignment?.hasAssignment && <Box sx={{ mt: 1.25 }}>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                if (saving || (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?'))) return;
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
          <Box sx={{ mt: 1.25 }}>
            {athlete?.function?.toLowerCase() === 'athlete' && <OpsButton aria-label="Weltmeisterstatus ändern" aria-pressed={athlete.singleRoomQuotaExemptReason === 'WORLD_CHAMPION'} disabled={!permissions.canEdit || saving || athlete.singleRoomQuotaExemptReason === 'OTHER'} onClick={async () => {
              setSaving(true); setSaveError(null);
              try { const updated = await api.updateAthlete(athlete.id, { singleRoomQuotaExemptReason: athlete.singleRoomQuotaExemptReason === 'WORLD_CHAMPION' ? null : 'WORLD_CHAMPION' }); onUpdate(updated); }
              catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
              finally { setSaving(false); }
            }}><Crown className={`mr-2 inline h-5 w-5 ${athlete.singleRoomQuotaExemptReason === 'WORLD_CHAMPION' ? 'text-amber-500 fill-amber-200' : ''}`}/>{athlete.singleRoomQuotaExemptReason === 'WORLD_CHAMPION' ? 'Weltmeister' : 'Weltmeister bestätigen'}</OpsButton>}
          </Box>
        </DialogSection>

        <DialogSection icon={<UserRound size={18} />} title="Stammdaten (FIS)" subtitle="Synchronisiert über den FIS-Import und nicht manuell editierbar." badge={<><LockKeyhole size={13} /> Schreibgeschützt</>}>
          <FieldGrid>
            <ReadonlyField label="Vorname" value={athlete?.firstname} />
            <ReadonlyField label="Nachname" value={athlete?.lastname} />
            <ReadonlyField label="Nation" value={athlete?.nationCode} />
            <ReadonlyField label="Wettbewerbe" value={competitionDisplayList(athlete?.disciplines, athlete?.discipline)} />
            <ReadonlyField label="Aufenthalte" value={athlete?.stays?.map(stay => `${date(stay.arrivalDate)} – ${date(stay.departureDate)}${stay.discipline ? ` (${competitionDisplayName(stay.discipline)})` : ''}`).join(', ')} />
            <ReadonlyField label="Gender" value={genderLabel(athlete?.gender)} />
            <ReadonlyField label="Funktion" value={athlete?.function || 'Athlet'} />
            <ReadonlyField label="FIS-ID" value={athlete?.fisCode} emptyValue="Keine FIS-ID" />
            <Box sx={{ gridColumn: '1 / -1' }}><ReadonlyField label="Bemerkung Athlet" value={athlete?.additionalItems} emptyValue="Keine FIS-Bemerkung" /></Box>
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<CalendarDays size={18} />} title="Aufenthalt" subtitle={permissions.canEdit ? 'Operative Aufenthaltsdaten können bearbeitet werden.' : 'Für Ihre Rolle nur zur Ansicht verfügbar.'} emphasis>
          <FieldGrid>
            <TextField fullWidth type="date" label="Anreise" value={stay.arrivalDate} onChange={event => setStay(current => ({ ...current, arrivalDate: event.target.value }))} disabled={!permissions.canEdit} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="date" label="Abreise" value={stay.departureDate} onChange={event => setStay(current => ({ ...current, departureDate: event.target.value }))} disabled={!permissions.canEdit} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth multiline minRows={3} label="Bemerkung Intern" value={stay.note} onChange={event => setStay(current => ({ ...current, note: event.target.value }))} disabled={!permissions.canEdit} placeholder={permissions.canEdit ? 'Interne Hinweise für das Unterkunftsteam' : undefined} sx={{ gridColumn: '1 / -1' }} />
          </FieldGrid>
        </DialogSection>

        <DialogSection icon={<ClipboardList size={18} />} title="Import" subtitle="Vorbereitet für die zukünftige Änderungsverfolgung.">
          <FieldGrid>
            <ReadonlyField label="Importdatum" value={date(athlete?.athletesLastSeenAt)} />
            <ReadonlyField label="Importstatus" value={athlete ? importLabel(athlete) : undefined} />
            <ReadonlyField label="Quelle" value="FIS-Import" />
            <Box><Typography variant="caption" color="text.secondary">Einzelzimmerstatus</Typography><Box sx={{ mt: 0.75 }}><SingleRoomAssignmentBadges status={athlete?.single_room_status} countsAsSingle={athlete?.assignment?.countsAsSingle} exemptReason={athlete?.singleRoomQuotaExemptReason} /></Box></Box>
            {athlete?.single_room_decision_id && <Box sx={{ display: 'flex', alignItems: 'end' }}><Button size="small" variant="text" onClick={() => { onClose(); onShowDecision(String(athlete.single_room_decision_id)); }}>Entscheidung anzeigen</Button></Box>}
          </FieldGrid>
        </DialogSection>

        <ActivityInfoBlock entityType="athletes" entityId={athlete?.id} createdAt={athlete?.entryDate} updatedAt={athlete?.lastUpdate} />
      </Stack>
    </DialogContent>
    {saveError && <Alert severity="error" sx={{ mx: 3, mt: 2 }}>{saveError}</Alert>}
    <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 2, flexWrap: 'wrap' }}>
      <Button onClick={close} disabled={saving}>Abbrechen</Button>
      {permissions.canEdit && <Button variant={position ? 'outlined' : 'contained'} onClick={() => void save()}
        disabled={saving || (stay.requirementTouched && stay.requirement === 'UNRESOLVED' && !stay.releaseRequirement)}>{saving ? 'Speichern…' : 'Speichern'}</Button>}
      {permissions.canEdit && position && <Button variant="contained" onClick={() => void save(true)}
        disabled={saving || (stay.requirement === 'UNRESOLVED' && !stay.releaseRequirement)}>Speichern &amp; weiter</Button>}
    </DialogActions>
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
  const requestedStatus = query.get('status') || '';
  const requestedMovement = query.get('movement') || '';
  const requestedDate = query.get('date') || '';
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, nation: requestedNation, competitions: requestedDiscipline ? [requestedDiscipline] : [], status: requestedStatus });
  const [search, setSearch] = useState('');
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [guidedDone, setGuidedDone] = useState(0);
  const [clarificationMessage, setClarificationMessage] = useState('');
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
    competitions: competitionFilterGroups(athletes),
    gender: countValues(athletes, athlete => genderLabel(athlete.gender)),
    function: personFunctionOptions(athletes),
    status: [
      { value: '', label: 'Alle', count: athletes.length },
      { value: 'open', label: 'Offen', count: athletes.filter(athlete => requiresAccommodation(athlete) && personAccommodation(athlete).status!=='FULLY_ASSIGNED').length },
      { value: 'no-room', label: 'Kein Zimmer benötigt', count: athletes.filter(athlete=>athlete.accommodationRequirement==='NO_ROOM').length },
      { value: 'new', label: 'Neu', count: athletes.filter(athlete => athleteWorkCategory(athlete) === 'new').length },
      { value: 'review', label: 'Disposition prüfen', count: athletes.filter(athlete => athleteWorkCategory(athlete) === 'review').length },
      { value: 'accommodation-clarification', label: 'Unterkunft klären', count: athletes.filter(a => a.accommodationRequirement === 'UNRESOLVED').length },
      { value: 'conflict', label: 'Stammdaten prüfen', count: athletes.filter(athlete => athleteWorkCategory(athlete) === 'conflict').length },
    ],
    notes: [{ value: 'present', label: 'Mit Hinweisen', count: athletes.filter(athlete => Boolean(athlete.additionalItems?.trim() || athlete.internalNote?.trim())).length }],
  }), [athletes]);

  const areaCandidates = useMemo(() => athletes.filter(athlete => {
    const term = search.trim().toLocaleLowerCase('de');
    const searchable = `${athlete.firstname} ${athlete.lastname} ${athlete.nationCode} ${athlete.disciplines?.join(' ') || athlete.discipline || ''} ${athlete.function || ''} ${personAccommodation(athlete).hotelLabel} ${personAccommodation(athlete).details} ${athlete.additionalItems || ''} ${athlete.internalNote || ''}`.toLocaleLowerCase('de');
    const singleRoomMatches = !requestedSingleRoomStatus || (athlete.single_room_status === requestedSingleRoomStatus && (requestedSingleRoomStatus!=='PENDING_APPROVAL' || requiresAccommodation(athlete)));
    const reviewMatches = requestedReview !== 'invalid' || athleteWorkCategory(athlete) === 'conflict';
    const movementMatches = !requestedMovement || !requestedDate
      || (requestedMovement === 'arrival' ? athlete.arrivalDate === requestedDate : athlete.departureDate === requestedDate);
    return (!term || searchable.includes(term))
      && (!filters.nation || athlete.nationCode === filters.nation)
      && matchesCompetitionSelection(athlete, filters.competitions)
      && (!filters.gender || genderLabel(athlete.gender) === filters.gender)
      && (!filters.rate || (athlete.accommodationRateCategory || 'STANDARD')===filters.rate)
      && matchesPersonFunction(athlete, filters.function)
      && (!filters.notes || Boolean(athlete.additionalItems?.trim() || athlete.internalNote?.trim()))
      && singleRoomMatches
      && reviewMatches
      && movementMatches;
  }), [athletes, filters, requestedDate, requestedMovement, requestedReview, requestedSingleRoomStatus, search]);

  const statusCandidates = areaCandidates.filter(athlete => !filters.status ||
    (filters.status === 'open' ? requiresAccommodation(athlete) && personAccommodation(athlete).status !== 'FULLY_ASSIGNED'
      : filters.status === 'fis-deviation' ? athlete.hasFisAccommodationDeviation
      : filters.status === athleteWorkCategory(athlete)));
  const areaOptions = sportAreaOptions(statusCandidates, filters.competitions);
  const matchesSport = (athlete: Athlete) => matchesCompetitionSelection(athlete, filters.competitions, filters.sport);
  const filtered = statusCandidates.filter(matchesSport);
  const fisDeviationCount = areaCandidates.filter(athlete => athlete.hasFisAccommodationDeviation && matchesSport(athlete)).length;
  const pendingClarifications = filtered.filter(person => person.nationCode === selectedAthlete?.nationCode && person.accommodationRequirement === 'UNRESOLVED');
  const isGuided = selectedAthlete?.accommodationRequirement === 'UNRESOLVED' || guidedDone > 0;
  const openPerson = (person: Athlete) => {
    setGuidedDone(0);
    setClarificationMessage('');
    setSelectedAthlete(person);
  };


  const activeFilterCount = Object.entries(filters).filter(([, value]) => Array.isArray(value) ? value.length : Boolean(value)).length;
  const setFilter = (key: FilterKey, value: string) => setFilters(current => ({ ...current, [key]: value }));

  if (loading) return <div className="flex h-64 items-center justify-center"><CircularProgress /></div>;

  return <SplitPageLayout>
    <ImportConflictNotice />
    <PageHeader eyebrow="Operations Center" title="Athleten" subtitle="Zentrale Suche, Filterung und Verwaltung aller Athleten und Teammitglieder." meta={<><StatusChip tone="primary">{athletes.length} Personen</StatusChip><StatusChip tone="success">{athletes.filter(athlete => personAccommodation(athlete).status==='FULLY_ASSIGNED').length} zugewiesen</StatusChip><StatusChip tone="neutral">{athletes.filter(athlete => personAccommodation(athlete).status!=='FULLY_ASSIGNED').length} offen</StatusChip></>} />
    {error && <InfoPanel tone="error" title="Fehler">{error}</InfoPanel>}

    <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
      <ContentCard surface="raised" className="flex flex-col overflow-hidden xl:min-h-0 xl:w-[20rem] xl:shrink-0">
        <div className="shrink-0 border-b border-[var(--ops-divider)] p-4">
          <SectionHeader title="Filter" subtitle="Alle Filter werden kombiniert" actions={activeFilterCount > 0 ? <button type="button" onClick={() => setFilters(emptyFilters)} className="flex items-center gap-1 text-xs font-bold text-[var(--ops-primary)]"><FilterX className="h-3.5 w-3.5" />Zurücksetzen</button> : undefined} />
        </div>
        <nav aria-label="Athletenfilter" className="space-y-5 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <FilterGroup title="Nationen" filterKey="nation" items={groups.nation} selected={filters.nation} onSelect={setFilter} />
          <FilterGroup title="Bereich" filterKey="sport" items={areaOptions} selected={filters.sport} onSelect={setFilter} />
          <CompetitionFilter items={groups.competitions.filter(item => !filters.sport || item.sports.some(sport => sportAreaValue(sport) === filters.sport))} selected={filters.competitions} onToggle={group => setFilters(current => ({ ...current, competitions: toggleCompetitionGroup(group, current.competitions) }))} />
          <FilterGroup title="Gender" filterKey="gender" items={groups.gender} selected={filters.gender} onSelect={setFilter} />
          <FilterGroup title="Unterkunftstarif" filterKey="rate" items={[{value:"STANDARD",label:"Standard",count:athletes.filter(p=>p.accommodationRateCategory!=="SPECIAL").length},{value:"SPECIAL",label:"Sondertarif",count:athletes.filter(p=>p.accommodationRateCategory==="SPECIAL").length}]} selected={filters.rate} onSelect={setFilter}/>
          <FilterGroup title="Funktion" filterKey="function" items={groups.function} selected={filters.function} onSelect={setFilter} />
          <FilterGroup title="Status" filterKey="status" items={[...groups.status, {value:'fis-deviation', label:'Abweichung FIS', count:fisDeviationCount}]} selected={filters.status} onSelect={setFilter} />
          <FilterGroup title="Hinweise" filterKey="notes" items={groups.notes} selected={filters.notes} onSelect={setFilter} />
        </nav>
      </ContentCard>

      <ContentCard surface="raised" className="flex min-w-0 flex-col overflow-hidden xl:min-h-0 xl:flex-1">
        <div className="shrink-0 border-b border-[var(--ops-divider)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><SectionHeader title="Athletenliste" /><div className="mt-1 text-sm text-[var(--ops-text-muted)]"><b className="text-[var(--ops-text)]">{filtered.length}</b> von {athletes.length} Personen</div></div>
            <label className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 lg:w-[27rem]">
              <Search className="h-4 w-4 shrink-0 text-[var(--ops-text-muted)]" />
              <input aria-label="Athleten suchen" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ops-text)] outline-none placeholder:text-[var(--ops-text-muted)]" placeholder="Person, Hotel oder Bemerkung suchen" value={search} onChange={event => setSearch(event.target.value)} />
              {search && <button type="button" onClick={() => setSearch('')} className="text-xs font-bold text-[var(--ops-primary)]">Löschen</button>}
            </label>
          </div>
        </div>
        <div className="min-h-[24rem] overflow-x-auto overflow-y-auto xl:min-h-0 xl:flex-1">
          <table className="w-full min-w-[1150px] table-fixed border-separate border-spacing-0 text-left text-sm">
            <colgroup>{[16,5,6,13,8,8,12,7,9,9,7].map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup>
            <thead className="sticky top-0 z-10 bg-[var(--ops-surface-elevated)] text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--ops-text-subtle)]">
              <tr>{['Name', 'Nation', 'Gender', 'Wettbewerbe', 'Anreise', 'Abreise', 'Hotel', 'Zimmer', 'Hinweise', 'Status', 'Import'].map(label => <th key={label} className="whitespace-nowrap border-b border-[var(--ops-border)] px-2 py-3">{label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(athlete => <tr key={athlete.id} tabIndex={0} onClick={() => openPerson(athlete)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openPerson(athlete); }} className={`group cursor-pointer outline-none transition hover:bg-[var(--ops-surface-elevated)] focus:bg-[var(--ops-tone-primary-surface)] ${athlete.accommodationRequirement === 'NO_DISPO' ? 'bg-[var(--ops-surface-overlay)]' : ''}`}>
                <Cell><div><b className={`block whitespace-nowrap text-[15px] font-extrabold leading-5 ${athlete.accommodationRequirement === 'NO_DISPO' ? 'text-[var(--ops-text-muted)]' : 'text-[var(--ops-text)]'}`}>{athlete.firstname} {athlete.lastname}</b><div className="mt-1.5 flex flex-wrap gap-1"><AccommodationRateChip category={athlete.accommodationRateCategory}/><SingleRoomAssignmentBadges status={athlete.single_room_status} countsAsSingle={athlete.assignment?.countsAsSingle} exemptReason={athlete.singleRoomQuotaExemptReason} /></div></div></Cell>
                <Cell><b>{athlete.nationCode}</b></Cell><Cell>{genderLabel(athlete.gender)}</Cell>
                <Cell><div className="min-w-0"><b className="ops-table-wrap block font-bold text-[var(--ops-text)]" title={previewEventGroupLabel(athlete.quotaDisciplines)}>{previewEventGroupLabel(athlete.quotaDisciplines)}</b><span className="ops-table-wrap block text-xs text-[var(--ops-text-muted)]">{competitionMembershipList(athlete.competitions)}</span><span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--ops-text-subtle)]" title={athlete.function || 'Athlet'}>{athlete.function || 'Athlet'}</span></div></Cell>
                <Cell>{date(athlete.arrivalDate)}</Cell><Cell>{date(athlete.departureDate)}</Cell>
                <Cell><span className="block truncate" title={personAccommodation(athlete).details || personAccommodation(athlete).hotelLabel}>{personAccommodation(athlete).hotelLabel==='—' ? '—' : <InlineActionLink onClick={event=>{event.stopPropagation();navigate(personAccommodation(athlete).segments.length>1 ? assignmentWorkspaceHref({personId:athlete.id}) : `/hotels?hotelId=${personAccommodation(athlete).segments[0]?.hotelId || athlete.assignment?.hotelId || ''}`);}}>{personAccommodation(athlete).hotelLabel}</InlineActionLink>}</span></Cell>
                <Cell><span title={personAccommodation(athlete).details}><InlineActionLink className="ops-table-wrap text-xs" onClick={event=>{event.stopPropagation();navigate(assignmentWorkspaceHref({personId:athlete.id}));}}>{roomTypeLabel(athlete)}</InlineActionLink></span></Cell>
                <Cell><div className="flex flex-col items-start gap-1"><span className="ops-table-wrap text-xs text-[var(--ops-warning)]" title={stayWindowDetails(athlete.stayWindow)}>{stayWindowText(athlete.stayWindow)}</span><AthleteNoteBadge label="Intern" note={athlete.internalNote} athlete={athlete} onOpen={openPerson}/><AthleteNoteBadge label="Extern" note={athlete.additionalItems} athlete={athlete} onOpen={openPerson}/></div></Cell>
                <Cell><span className="ops-table-wrap"><StatusChip tone={personAccommodation(athlete).tone}>{assignmentLabel(athlete)}</StatusChip></span>
                  <FisDeviationBadge person={athlete}/>{athlete.accommodationDecisionLabel && (athlete.accommodationRequirement !== 'NO_DISPO' || athlete.accommodationDecisionLabel !== assignmentLabel(athlete)) &&
                    <span className="mt-1 block text-xs">{athlete.accommodationDecisionLabel}</span>}{athlete.accommodationRequirement === 'NO_DISPO' && Boolean(athlete.accommodationCoverage?.segments.length || athlete.assignment?.hasAssignment) &&
                  <span className="mt-1 block text-xs text-[var(--ops-warning)]">Bestehende Buchung bleibt erhalten.</span>}</Cell>
                <Cell>{athleteWorkCategory(athlete) === 'review' ? <button type="button" className="text-left" onClick={event => { event.stopPropagation(); navigate(`${assignmentWorkspaceHref({ bookingId: athlete.assignment?.bookingId, hotelId: athlete.assignment?.hotelId, personId: athlete.id })}&workflow=review`); }}><StatusChip tone="warning">Disposition prüfen</StatusChip>{reviewHint(athlete) && <span className="mt-1 block whitespace-nowrap text-[10px] font-medium text-[var(--ops-text-subtle)]">{reviewHint(athlete)}</span>}</button> : <StatusChip tone={athleteWorkCategory(athlete) === 'conflict' ? 'warning' : athleteWorkCategory(athlete) === 'new' ? 'primary' : 'neutral'}>{importLabel(athlete)}</StatusChip>}</Cell>
              </tr>)}
            </tbody>
          </table>
          {!filtered.length && <div className="p-8"><EmptyState title="Keine Athleten gefunden" description="Passen Sie die Suche oder die kombinierten Filter an." action={<OpsButton onClick={() => { setFilters(emptyFilters); setSearch(''); }}>Alle Filter zurücksetzen</OpsButton>} /></div>}
        </div>
      </ContentCard>
    </div>
    {clarificationMessage && <Alert severity="success" role="status">{clarificationMessage}</Alert>}
    <AthleteDialog
      people={athletes}
      position={isGuided && selectedAthlete ? `${guidedDone + 1} von ${guidedDone + Math.max(1, pendingClarifications.length)}` : undefined}
      onUpdate={updated => {
        setSelectedAthlete(current => current ? {...current, ...updated} : updated);
        setAthletes(current => current.map(person => person.id === updated.id ? {...person, ...updated} : person));
      }}
      onNext={updated => {
        if (updated.accommodationRequirement === 'UNRESOLVED') return;
        const index = pendingClarifications.findIndex(person => person.id === updated.id);
        const next = pendingClarifications[index + 1] || pendingClarifications.find(person => person.id !== updated.id);
        if (next) {
          setGuidedDone(done => done + 1);
          setSelectedAthlete(next);
        } else {
          setSelectedAthlete(null);
          setGuidedDone(0);
          setClarificationMessage('Für diese Nation sind in der aktuellen Auswahl alle Unterkunftsklärungen abgeschlossen.');
        }
      }}
      athlete={selectedAthlete} open={Boolean(selectedAthlete)}
      onClose={() => { setSelectedAthlete(null); setGuidedDone(0); }} onShowDecision={setDecisionId} />
    <ImportDecisionDialog decisionId={decisionId} onClose={() => setDecisionId(null)} onOpenSession={sessionId => void navigate(`/import?sessionId=${sessionId}`)} />
  </SplitPageLayout>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="min-w-0 border-b border-[var(--ops-divider)] px-2 py-3 align-middle text-[var(--ops-text-muted)]">{children}</td>;
}
