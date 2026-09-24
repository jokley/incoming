import { useEffect, useMemo, useState } from 'react';
import { Checkbox, FormControlLabel, MenuItem, Stack, Tab, Tabs, TextField } from '@mui/material';
import { CalendarDays, Copy, Pencil, Plus } from 'lucide-react';
import { api } from '../services/api';
import type { ChampionshipEvent, Competition, EventCompetitionMapping } from '../types';
import { ContentCard, CrudDialog, EmptyState, OpsButton, SectionHeader, StatusChip } from '../design-system';

const EMPTY_EVENT = { name: '', year: new Date().getFullYear(), active: true };
type EventDraft = Partial<ChampionshipEvent>;
type MappingDraft = Pick<EventCompetitionMapping, 'officialName'|'fisCodex'|'importCode'|'active'>;

export function AdministrationEvents() {
  const [events, setEvents] = useState<ChampionshipEvent[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<ChampionshipEvent | null>(null);
  const [tab, setTab] = useState(0);
  const [eventDialog, setEventDialog] = useState<{open:boolean; value:ChampionshipEvent|null}>({open:false,value:null});
  const [mappingDialog, setMappingDialog] = useState<EventCompetitionMapping|null>(null);
  const [addId, setAddId] = useState('');
  const [copyId, setCopyId] = useState('');

  const loadList = async (preferredId?: string) => {
    const rows = await api.getAdminEvents();
    setEvents(rows);
    setSelectedId(current => preferredId ?? current ?? rows[0]?.id ?? '');
  };
  const loadSelected = async (id=selectedId) => {
    if (id) setSelected(await api.getAdminEvent(id)); else setSelected(null);
  };
  useEffect(() => { void Promise.all([loadList(), api.getCompetitions().then(setCompetitions)]); }, []);
  useEffect(() => { void loadSelected(); }, [selectedId]);
  const reload = async () => { await loadList(); await loadSelected(); };
  const availableCompetitions = useMemo(() => competitions.filter(
    competition => !selected?.competitionMappings?.some(mapping => mapping.competitionId === competition.id)
  ), [competitions, selected]);

  const saveEvent = async (draft: EventDraft) => {
    if (eventDialog.value) await api.updateChampionshipEvent(eventDialog.value.id, draft);
    else { const created = await api.createChampionshipEvent(draft); setSelectedId(created.id); }
    await loadList(); await loadSelected(eventDialog.value?.id);
  };
  const saveMapping = async (draft: MappingDraft) => {
    if (!mappingDialog || !selected) return;
    await api.updateEventCompetition(selected.id, mappingDialog.id, draft);
    await reload();
  };

  return <div className="grid min-h-[38rem] gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
    <ContentCard surface="raised" className="overflow-hidden">
      <div className="border-b border-[var(--ops-divider)] p-4">
        <SectionHeader title="Events" subtitle={`${events.length} Veranstaltung${events.length===1?'':'en'}`} />
        <OpsButton className="mt-3 w-full" onClick={() => setEventDialog({open:true,value:null})}><Plus className="mr-2 inline h-4 w-4"/>Event anlegen</OpsButton>
      </div>
      <nav className="space-y-1.5 p-2" aria-label="Events">
        {events.map(event => <button key={event.id} onClick={() => setSelectedId(event.id)} className={`w-full rounded-xl border px-3 py-3 text-left transition ${event.id===selectedId?'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]':'border-transparent hover:border-[var(--ops-border)] hover:bg-[var(--ops-surface-elevated)]'}`}>
          <div className="truncate text-sm font-extrabold">{event.name}</div>
          <div className="mt-1"><StatusChip tone={event.active?'success':'neutral'}>{event.active?'Aktiv':'Inaktiv'}</StatusChip></div>
        </button>)}
        {!events.length && <EmptyState title="Noch keine Events" />}
      </nav>
    </ContentCard>

    <ContentCard surface="raised" className="min-w-0 overflow-hidden">
      {selected ? <>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ops-divider)] p-5">
          <div><div className="flex items-center gap-2"><CalendarDays size={18}/><h3 className="text-xl font-extrabold">{selected.name}</h3></div><p className="mt-1 text-sm text-[var(--ops-text-muted)]">{selected.year || 'Jahr nicht gesetzt'} · {selected.competitionMappings?.length ?? 0} Competition Mappings</p></div>
          <OpsButton onClick={() => setEventDialog({open:true,value:selected})}><Pencil className="mr-2 inline h-4 w-4"/>Event bearbeiten</OpsButton>
        </div>
        <Tabs value={tab} onChange={(_,value)=>setTab(value)} sx={{px:2,borderBottom:'1px solid var(--ops-divider)'}}><Tab label="Allgemein"/><Tab label="Competition Mapping"/></Tabs>
        {tab===0 ? <GeneralEvent event={selected}/> : <div className="p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><SectionHeader title="Competition Mapping" subtitle="Globale Competition-Stammdaten und eventbezogene FIS-Werte."/><div className="flex flex-wrap gap-2">
            <TextField select size="small" label="Competition" value={addId} onChange={e=>setAddId(e.target.value)} sx={{minWidth:230}}>{availableCompetitions.map(c=><MenuItem key={c.id} value={c.id}>{c.displayName} · {c.gender}</MenuItem>)}</TextField>
            <OpsButton disabled={!addId} onClick={async()=>{const c=competitions.find(x=>x.id===addId);if(!c)return;await api.addEventCompetition(selected.id,{competitionId:c.id,officialName:c.name,fisCodex:c.code,importCode:c.importCode,active:true});setAddId('');await reload();}}><Plus className="mr-2 inline h-4 w-4"/>Hinzufügen</OpsButton>
            <TextField select size="small" label="Mappings kopieren aus" value={copyId} onChange={e=>setCopyId(e.target.value)} sx={{minWidth:220}}>{events.filter(e=>e.id!==selected.id).map(e=><MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}</TextField>
            <OpsButton disabled={!copyId} onClick={async()=>{await api.copyEventMappings(selected.id,copyId);setCopyId('');await reload();}}><Copy className="mr-2 inline h-4 w-4"/>Kopieren</OpsButton>
          </div></div>
          <MappingTable mappings={selected.competitionMappings ?? []} onEdit={setMappingDialog}/>
        </div>}
      </> : <div className="p-10"><EmptyState title="Event auswählen" /></div>}
    </ContentCard>

    <EventEditor open={eventDialog.open} event={eventDialog.value} onClose={()=>setEventDialog({open:false,value:null})} onSave={saveEvent}/>
    <MappingEditor mapping={mappingDialog} onClose={()=>setMappingDialog(null)} onSave={saveMapping}/>
  </div>;
}

function GeneralEvent({event}:{event:ChampionshipEvent}) {
  const facts=[['Name',event.name],['Jahr',event.year||'—'],['FIS Event ID',event.fisEventId||'—'],['Sector Code',event.sectorCode||'—']];
  return <div className="max-w-3xl p-5"><SectionHeader title="Allgemein" subtitle="Stammdaten und Status der Veranstaltung."/><dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-[var(--ops-border)] bg-[var(--ops-divider)] sm:grid-cols-2">{facts.map(([label,value])=><div key={label} className="bg-[var(--ops-surface-raised)] p-4"><dt className="text-xs font-bold uppercase tracking-wide text-[var(--ops-text-subtle)]">{label}</dt><dd className="mt-1 font-bold">{value}</dd></div>)}</dl><div className="mt-4"><StatusChip tone={event.active?'success':'neutral'}>{event.active?'Aktiv':'Inaktiv'}</StatusChip></div></div>;
}

function MappingTable({mappings,onEdit}:{mappings:EventCompetitionMapping[];onEdit:(mapping:EventCompetitionMapping)=>void}) {
  if(!mappings.length)return <EmptyState title="Keine Competition Mappings"/>;
  return <div className="overflow-x-auto rounded-xl border border-[var(--ops-border)]"><table className="w-full min-w-[980px] border-collapse text-sm"><thead className="bg-[var(--ops-surface-elevated)] text-xs uppercase tracking-wide text-[var(--ops-text-subtle)]"><tr>{['Competition','Sport','Gender','Quota Discipline','Codex','Import Code','Status','Aktion'].map(label=><th key={label} className="px-3 py-3 text-left font-extrabold">{label}</th>)}</tr></thead><tbody>{mappings.map(mapping=><tr key={mapping.id} className="border-t border-[var(--ops-divider)] hover:bg-[var(--ops-surface-elevated)]"><td className="px-3 py-3"><div className="font-extrabold">{mapping.displayName}</div><div className="max-w-xs truncate text-xs text-[var(--ops-text-muted)]" title={mapping.officialName}>{mapping.officialName}</div></td><td className="px-3 py-3">{mapping.sport}</td><td className="px-3 py-3 font-mono">{mapping.gender}</td><td className="px-3 py-3">{mapping.quotaDiscipline}</td><td className="px-3 py-3 font-mono">{mapping.fisCodex}</td><td className="px-3 py-3 font-mono text-xs">{mapping.importCode}</td><td className="px-3 py-3"><StatusChip tone={mapping.active?'success':'neutral'}>{mapping.active?'Aktiv':'Inaktiv'}</StatusChip></td><td className="px-3 py-3"><OpsButton onClick={()=>onEdit(mapping)}><Pencil className="mr-2 inline h-4 w-4"/>Bearbeiten</OpsButton></td></tr>)}</tbody></table></div>;
}

function EventEditor({open,event,onClose,onSave}:{open:boolean;event:ChampionshipEvent|null;onClose:()=>void;onSave:(draft:EventDraft)=>Promise<void>}) {
  const initial:EventDraft=event??EMPTY_EVENT;const [draft,setDraft]=useState<EventDraft>(initial);const [saving,setSaving]=useState(false);
  useEffect(()=>{if(open)setDraft(event??EMPTY_EVENT);},[open,event?.id]);
  return <CrudDialog open={open} title={event?'Event bearbeiten':'Event anlegen'} dirty={JSON.stringify(draft)!==JSON.stringify(initial)} saving={saving} saveDisabled={!draft.name?.trim()} onClose={onClose} onSave={async()=>{setSaving(true);try{await onSave(draft);onClose();}finally{setSaving(false);}}}><Stack spacing={2} sx={{pt:1,maxWidth:520}}><TextField required size="small" label="Name" value={draft.name||''} onChange={e=>setDraft({...draft,name:e.target.value})}/><TextField size="small" type="number" label="Jahr" value={draft.year||''} onChange={e=>setDraft({...draft,year:Number(e.target.value)})}/><TextField size="small" label="FIS Event ID" value={draft.fisEventId||''} onChange={e=>setDraft({...draft,fisEventId:e.target.value})}/><TextField size="small" label="Sector Code" value={draft.sectorCode||''} onChange={e=>setDraft({...draft,sectorCode:e.target.value})}/><FormControlLabel control={<Checkbox checked={draft.active??true} onChange={e=>setDraft({...draft,active:e.target.checked})}/>} label="Aktiv"/></Stack></CrudDialog>;
}

function MappingEditor({mapping,onClose,onSave}:{mapping:EventCompetitionMapping|null;onClose:()=>void;onSave:(draft:MappingDraft)=>Promise<void>}) {
  const [draft,setDraft]=useState<MappingDraft>({officialName:'',fisCodex:'',importCode:'',active:true});const [saving,setSaving]=useState(false);
  useEffect(()=>{if(mapping)setDraft({officialName:mapping.officialName,fisCodex:mapping.fisCodex,importCode:mapping.importCode,active:mapping.active});},[mapping?.id]);
  return <CrudDialog open={Boolean(mapping)} title={`${mapping?.displayName??'Mapping'} bearbeiten`} dirty={Boolean(mapping)&&JSON.stringify(draft)!==JSON.stringify({officialName:mapping?.officialName,fisCodex:mapping?.fisCodex,importCode:mapping?.importCode,active:mapping?.active})} saving={saving} saveDisabled={!draft.officialName.trim()||!draft.fisCodex.trim()||!draft.importCode.trim()} onClose={onClose} onSave={async()=>{setSaving(true);try{await onSave(draft);onClose();}finally{setSaving(false);}}}><Stack spacing={2} sx={{pt:1}}><TextField size="small" required label="Official Name" value={draft.officialName} onChange={e=>setDraft({...draft,officialName:e.target.value})}/><TextField size="small" required label="Codex" value={draft.fisCodex} onChange={e=>setDraft({...draft,fisCodex:e.target.value})}/><TextField size="small" required label="Import Code" value={draft.importCode} onChange={e=>setDraft({...draft,importCode:e.target.value})}/><FormControlLabel control={<Checkbox checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>} label="Aktiv"/></Stack></CrudDialog>;
}
