import { useEffect, useState } from 'react';
import { Checkbox, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';
import { Crown, Pencil, Plus } from 'lucide-react';
import { api } from '../services/api';
import type { ChampionshipEvent, WorldChampion } from '../types';
import { ContentCard, CrudDialog, EmptyState, InfoPanel, OpsButton, SectionHeader, StatusChip } from '../design-system';

export function AdministrationWorldChampions() {
  const [rows, setRows] = useState<WorldChampion[]>([]);
  const [events, setEvents] = useState<ChampionshipEvent[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Partial<WorldChampion> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = async () => setRows(await api.getWorldChampions());
  useEffect(() => { void Promise.all([load(), api.getAdminEvents().then(setEvents), api.getCompetitions().then(values => setGroups([...new Set(values.map(c => c.quotaDiscipline))].filter(Boolean)))]).catch(e => setError(String(e))); }, []);
  const selected = rows.find(row => row.id === selectedId);
  const edit = (value?: WorldChampion) => { setError(''); setDraft(value ?? { eventId: events[0]?.id ?? '', championship: 'Engadin', championshipYear: 2025, titleType: 'INDIVIDUAL', entitlementEnabled: true, active: true, gender: 'M' }); };
  const save = async (value: Partial<WorldChampion>) => {
    setSaving(true); setError('');
    try { const row = await api.saveWorldChampion(value); await load(); setSelectedId(row.id); setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return <>
    {error && <InfoPanel tone="error" title="Speichern / Laden fehlgeschlagen">{error}</InfoPanel>}
    <div className="grid min-h-[38rem] gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <ContentCard surface="raised" className="overflow-hidden"><div className="border-b border-[var(--ops-divider)] p-4"><SectionHeader title="World Champions" subtitle={`${rows.length} Titelreferenzen`}/><OpsButton className="mt-3 w-full" onClick={() => edit()}><Plus className="mr-2 inline h-4 w-4"/>Titel anlegen</OpsButton></div>
        <nav aria-label="World Champions" className="space-y-1.5 p-2">{rows.map(row => <button key={row.id} onClick={() => setSelectedId(row.id)} className={`w-full rounded-xl border px-3 py-3 text-left ${row.id === selectedId ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-transparent hover:bg-[var(--ops-surface-elevated)]'}`}><strong className="block">{row.name}</strong><span className="block text-xs">{row.championship} {row.championshipYear} · {row.discipline}</span><StatusChip tone={row.active ? 'success' : 'neutral'}>{row.active ? 'Aktiv' : 'Inaktiv'}</StatusChip></button>)}{!rows.length && <EmptyState title="Noch keine Titelreferenzen" description="Nur Titel mit belegtem FIS-Code anlegen."/>}</nav>
      </ContentCard>
      <ContentCard surface="raised" className="min-w-0 overflow-hidden">{selected ? <><div className="flex flex-wrap justify-between gap-3 border-b border-[var(--ops-divider)] p-5"><div><h3 className="text-xl font-extrabold"><Crown className="mr-2 inline h-5 w-5"/>{selected.name}</h3><p>{selected.championship} {selected.championshipYear}</p></div><div className="flex gap-2"><OpsButton onClick={() => edit(selected)}><Pencil className="mr-2 inline h-4 w-4"/>Bearbeiten</OpsButton>{selected.active && <OpsButton disabled={saving} onClick={() => void save({ ...selected, active: false })}>Deaktivieren</OpsButton>}</div></div><dl className="grid gap-px bg-[var(--ops-divider)] sm:grid-cols-2">{[
        ['Ziel-Event', events.find(e => e.id === selected.eventId)?.name], ['FIS-Code', selected.fisCode], ['Nation', selected.nation], ['Gender', selected.gender], ['Disziplin', selected.discipline], ['Event Group', selected.eventGroup], ['Titel', selected.titleType === 'TEAM' ? 'Team' : 'Individual'], ['EZ-Anspruch aktiviert', selected.entitlementEnabled ? 'Ja' : 'Nein'], ['Status', selected.active ? 'Aktiv' : 'Inaktiv'], ['Quelle', selected.source],
      ].map(([label, value]) => <div key={label} className="bg-[var(--ops-surface-raised)] p-4"><dt className="text-xs font-bold text-[var(--ops-text-subtle)]">{label}</dt><dd className="mt-1 break-words font-bold">{value || '—'}</dd></div>)}</dl></> : <div className="p-10"><EmptyState title="World Champion auswählen"/></div>}</ContentCard>
    </div>
    <CrudDialog open={Boolean(draft)} title={draft?.id ? 'Titel bearbeiten' : 'Titel anlegen'} dirty={Boolean(draft)} saving={saving} saveDisabled={!draft?.fisCode || !draft.name || !draft.source || !draft.eventId || !draft.discipline || !draft.eventGroup || !draft.nation} onClose={() => setDraft(null)} onSave={() => draft ? save(draft) : Promise.resolve()}>
      {draft && <Stack spacing={2} sx={{pt:1}}>
        {error && <InfoPanel tone="error" title="Speichern fehlgeschlagen">{error}</InfoPanel>}
        <TextField select label="Ziel-Event" value={draft.eventId ?? ''} onChange={e => setDraft({...draft, eventId:e.target.value})}>{events.map(e => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}</TextField>
        {(['fisCode','name','nation','discipline','championship','source'] as const).map((field, index) => <TextField key={field} required size="small" label={['FIS-Code','Name','Nation','Disziplin','Championship','Quelle'][index]} value={draft[field] ?? ''} onChange={e => setDraft({...draft,[field]:e.target.value})}/>)}
        <TextField type="number" label="Championship Jahr" value={draft.championshipYear ?? ''} onChange={e => setDraft({...draft,championshipYear:Number(e.target.value)})}/>
        <TextField select label="Gender" value={draft.gender ?? 'M'} onChange={e => setDraft({...draft,gender:e.target.value})}>{['M','W','A'].map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}</TextField>
        <TextField select label="Event Group" value={draft.eventGroup ?? ''} onChange={e => setDraft({...draft,eventGroup:e.target.value})}>{groups.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}</TextField>
        <TextField select label="Titeltyp" value={draft.titleType} onChange={e => setDraft({...draft,titleType:e.target.value as WorldChampion['titleType'],entitlementEnabled:e.target.value === 'INDIVIDUAL'})}><MenuItem value="INDIVIDUAL">Individual</MenuItem><MenuItem value="TEAM">Team</MenuItem></TextField>
        <FormControlLabel label="EZ-Anspruch aktiviert" control={<Checkbox checked={draft.entitlementEnabled ?? false} disabled={draft.titleType === 'TEAM'} onChange={e => setDraft({...draft,entitlementEnabled:e.target.checked})}/>}/>
        <FormControlLabel label="Aktiv" control={<Checkbox checked={draft.active ?? true} onChange={e => setDraft({...draft,active:e.target.checked})}/>}/>
      </Stack>}
    </CrudDialog>
  </>;
}
