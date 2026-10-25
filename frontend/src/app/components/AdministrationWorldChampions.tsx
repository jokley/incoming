import { useEffect, useState } from 'react';
import { Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material';
import { Crown, Pencil, Plus } from 'lucide-react';
import { api } from '../services/api';
import { championDraft, championEditions, championEditionKey, championsForEdition, championSourceUrl, championDisciplines, emptyChampionFilters, scopedChampionFilters, filterChampions, newChampionEdition } from '../services/worldChampionAdministration';
import type { ChampionshipEvent, WorldChampion } from '../types';
import { ContentCard, CrudDialog, EmptyState, InfoPanel, OpsButton, SectionHeader, StatusChip } from '../design-system';

export function AdministrationWorldChampions() {
  const [rows, setRows] = useState<WorldChampion[]>([]);
  const [events, setEvents] = useState<ChampionshipEvent[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filters, setFilters] = useState(emptyChampionFilters());
  const [editionDraft, setEditionDraft] = useState<{championship:string;year:number} | null>(null);
  const [initialDraft, setInitialDraft] = useState<Partial<WorldChampion> | null>(null);
  const [draft, setDraft] = useState<Partial<WorldChampion> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = async () => setRows(await api.getChampionTitles());
  useEffect(() => { void Promise.all([load(), api.getAdminEvents().then(setEvents), api.getCompetitions().then(values => setGroups([...new Set(values.map(c => c.quotaDiscipline))].filter(Boolean)))]).catch(e => setError(String(e))); }, []);
  const editions = championEditions(rows);
  const selected = editions.find(edition => edition.key === selectedId) ?? editions[0];
  const editionRows = selected ? championsForEdition(rows, selected.key) : [];
  const currentFilters = scopedChampionFilters(filters, selected?.key ?? '');
  const visibleRows = filterChampions(editionRows, currentFilters);
  const disciplines = championDisciplines(editionRows);
  const updateFilters = (values: Partial<typeof filters>) => setFilters({...currentFilters,...values});
  const proposedEdition = editionDraft ? newChampionEdition(editionDraft.championship, editionDraft.year) : null;
  const editionExists = editions.some(edition => edition.key === proposedEdition?.key);
  const edit = (value?: WorldChampion, edition = selected) => {
    setError('');
    const initial = championDraft(value, edition, events[0]?.id ?? '');
    setInitialDraft(initial); setDraft({...initial});
  };
  const save = async (value: Partial<WorldChampion>, closeDialog = false) => {
    setSaving(true); setError('');
    try { const row = await api.saveWorldChampion(value); await load(); setSelectedId(championEditionKey(row)); if (closeDialog) setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return <>
    {error && <InfoPanel tone="error" title="Speichern / Laden fehlgeschlagen">{error}</InfoPanel>}
    <div className="grid min-h-[38rem] gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <ContentCard surface="raised" className="overflow-hidden"><div className="border-b border-[var(--ops-divider)] p-4"><SectionHeader title="Championships" subtitle={`${editions.length} Editionen · ${rows.length} Titelreferenzen`}/><OpsButton className="mt-3 w-full" disabled={saving} onClick={() => {setError('');setEditionDraft({championship:'',year:new Date().getFullYear()});}}><Plus className="mr-2 inline h-4 w-4"/>WM-Liste anlegen</OpsButton></div>
        <nav aria-label="Championship-Editionen" className="space-y-1.5 p-2">{editions.map(edition => <button type="button" key={edition.key} aria-pressed={edition.key === selected?.key} onClick={() => {setSelectedId(edition.key);setFilters(emptyChampionFilters(edition.key));}} className={`w-full rounded-xl border px-3 py-3 text-left transition ${edition.key === selected?.key ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-transparent hover:border-[var(--ops-border)] hover:bg-[var(--ops-surface-elevated)]'}`}><strong className="block text-sm">{edition.label}</strong><span className="mt-1 block text-xs text-[var(--ops-text-muted)]">{edition.count} Titelreferenzen</span></button>)}{!editions.length && <EmptyState title="Noch keine Titelreferenzen" description="Nur Titel mit belegtem FIS-Code anlegen."/>}</nav>
      </ContentCard>
      <ContentCard surface="raised" className="min-w-0 overflow-hidden">{selected ? <>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ops-divider)] p-5"><div><h3 className="text-xl font-extrabold"><Crown className="mr-2 inline h-5 w-5"/>{selected.label}</h3><p className="mt-1 text-sm text-[var(--ops-text-muted)]">{visibleRows.length} von {editionRows.length} Titelreferenzen · Event Group, Disziplin, Gender, Name</p></div><OpsButton disabled={saving} onClick={() => edit()}><Plus className="mr-2 inline h-4 w-4"/>Weltmeister hinzufügen</OpsButton></div>
        <div className="flex flex-wrap gap-3 border-b border-[var(--ops-divider)] p-3"><TextField select size="small" label="Gender" value={currentFilters.gender} onChange={event=>updateFilters({gender:event.target.value})} sx={{minWidth:100}}>{['','M','W'].map(value=><MenuItem key={value} value={value}>{value || 'Alle'}</MenuItem>)}</TextField><TextField select size="small" label="Disziplin" value={currentFilters.discipline} onChange={event=>updateFilters({discipline:event.target.value})} sx={{minWidth:180,maxWidth:280}}><MenuItem value="">Alle</MenuItem>{disciplines.map(option=><MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</TextField><TextField size="small" label="Name / Nation suchen" value={currentFilters.search} onChange={event=>updateFilters({search:event.target.value})} sx={{minWidth:180,flex:1}}/></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Name','Nation','Gender','Disziplin','Titel','Status','Aktionen'].map(label=><th key={label} className="border-b border-[var(--ops-divider)] px-3 py-2 text-left text-xs font-bold text-[var(--ops-text-subtle)]">{label}</th>)}</tr></thead><tbody>{visibleRows.map(row => {
          const sourceUrl = championSourceUrl(row.source);
          return <tr key={row.id} className="border-b border-[var(--ops-divider)] align-top">
            <td className="px-3 py-3"><strong className="break-words">{row.name}</strong><span className="mt-1 block text-xs text-[var(--ops-text-muted)]">{events.find(event=>event.id===row.eventId)?.name ?? `Event ${row.eventId}`}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--ops-primary)] underline" aria-label={`Quelle für ${row.name}`}>Quelle ↗</a>}</td>
            <td className="px-3 py-3">{row.nation}</td><td className="px-3 py-3">{row.gender}</td><td className="px-3 py-3"><span className="break-words">{row.discipline}</span><span className="mt-1 block text-xs text-[var(--ops-text-muted)]">{row.eventGroup}</span></td>
            <td className="px-3 py-3">{row.titleType === 'TEAM' ? 'Team' : 'Individual'}</td><td className="px-3 py-3"><StatusChip tone={row.active ? 'success' : 'neutral'}>{row.active ? 'Aktiv' : 'Inaktiv'}</StatusChip></td>
            <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><OpsButton disabled={saving} aria-label={`Bearbeiten: ${row.name}`} onClick={()=>edit(row)} className="px-2 py-1 text-xs"><Pencil className="mr-1 inline h-3 w-3"/>Bearbeiten</OpsButton><OpsButton disabled={saving} aria-label={`${row.active ? 'Deaktivieren' : 'Aktivieren'}: ${row.name}`} onClick={()=>void save({...row,active:!row.active})} className="px-2 py-1 text-xs">{row.active ? 'Deaktivieren' : 'Aktivieren'}</OpsButton></div></td>
          </tr>;
        })}</tbody></table></div>{!visibleRows.length && <div className="p-5"><EmptyState title="Keine passenden Weltmeister" description="Filter oder Suche anpassen."/></div>}
      </> : <div className="p-10"><EmptyState title="Noch keine Championship-Edition" description="Mit WM-Liste anlegen eine Edition und ihre erste Titelreferenz anlegen."/></div>}</ContentCard>
    </div>
    <CrudDialog open={Boolean(editionDraft)} title="WM-Liste anlegen" description="Championship und Jahr festlegen. Die Liste wird zusammen mit ihrem ersten Weltmeister gespeichert." saveLabel="Weiter: Weltmeister hinzufügen" dirty={Boolean(editionDraft?.championship)} saveDisabled={!editionDraft?.championship.trim() || !Number.isInteger(editionDraft?.year) || editionExists} onClose={()=>setEditionDraft(null)} onSave={()=>{if(proposedEdition){setEditionDraft(null);edit(undefined,proposedEdition);}}}>
      {editionDraft && <div className="grid gap-3 pt-1"><TextField required size="small" label="Championship" placeholder="z. B. Engadin" value={editionDraft.championship} onChange={event=>setEditionDraft({...editionDraft,championship:event.target.value})}/><TextField required size="small" type="number" label="Championship Jahr" value={editionDraft.year} onChange={event=>setEditionDraft({...editionDraft,year:Number(event.target.value)})}/>{editionExists && <InfoPanel tone="info" title="WM-Liste bereits vorhanden">Diese Edition links auswählen und Weltmeister hinzufügen.</InfoPanel>}</div>}
    </CrudDialog>
    <CrudDialog open={Boolean(draft)} title={draft?.id ? 'Weltmeister bearbeiten' : 'Weltmeister hinzufügen'} size="medium" dirty={JSON.stringify(draft) !== JSON.stringify(initialDraft)} saving={saving} saveDisabled={!draft?.fisCode || !draft.name || !draft.source || !draft.eventId || !draft.discipline || !draft.eventGroup || !draft.nation || !draft.championship?.trim() || !Number.isInteger(draft.championshipYear)} onClose={() => setDraft(null)} onSave={() => draft ? save(draft, true) : Promise.resolve()}>
      {draft && <div className="grid gap-3 pt-1 sm:grid-cols-2">
        {error && <InfoPanel tone="error" title="Speichern fehlgeschlagen">{error}</InfoPanel>}
        <TextField select size="small" label="Ursprung / Anlagekontext" value={draft.eventId ?? ''} onChange={e => setDraft({...draft, eventId:e.target.value})}>{events.map(e => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}</TextField>
        {(['fisCode','name','nation','discipline','championship','source'] as const).map((field, index) => <TextField key={field} required size="small" label={['FIS-Code','Name','Nation','Disziplin','Championship','Quelle / URL'][index]} value={draft[field] ?? ''} onChange={e => setDraft({...draft,[field]:e.target.value})}/>)}
        <TextField size="small" type="number" label="Championship Jahr" value={draft.championshipYear ?? ''} onChange={e => setDraft({...draft,championshipYear:Number(e.target.value)})}/>
        <TextField size="small" select label="Gender" value={draft.gender ?? 'M'} onChange={e => setDraft({...draft,gender:e.target.value})}>{['M','W','A'].map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}</TextField>
        <TextField size="small" select label="Event Group" value={draft.eventGroup ?? ''} onChange={e => setDraft({...draft,eventGroup:e.target.value})}>{groups.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}</TextField>
        <TextField size="small" select label="Titeltyp" value={draft.titleType} onChange={e => setDraft({...draft,titleType:e.target.value as WorldChampion['titleType'],entitlementEnabled:e.target.value === 'INDIVIDUAL'})}><MenuItem value="INDIVIDUAL">Individual</MenuItem><MenuItem value="TEAM">Team</MenuItem></TextField>
        <FormControlLabel label="EZ-Anspruch aktiviert" control={<Checkbox checked={draft.entitlementEnabled ?? false} disabled={draft.titleType === 'TEAM'} onChange={e => setDraft({...draft,entitlementEnabled:e.target.checked})}/>}/>
        <FormControlLabel label="Aktiv" control={<Checkbox checked={draft.active ?? true} onChange={e => setDraft({...draft,active:e.target.checked})}/>}/>
      </div>}
    </CrudDialog>
  </>;
}
