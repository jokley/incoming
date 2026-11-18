import {useEffect,useRef,useState} from 'react';
import {Alert,Dialog,DialogTitle,DialogContent,DialogActions,TextField} from '@mui/material';
import {Crown} from 'lucide-react';
import {api} from '../services/api';
import type {ArrivalPlanningOverview,ArrivalPlanningRow} from '../types';
import {usePermissions} from '../auth/AuthProvider';
import {OpsButton} from '../design-system';
import {sportAreaLabel} from '../services/competitionPresentation';

/** Pure display of the exclusive backend read model; no quota or demand arithmetic. */
export function ArrivalPlanning({nation,revision,onPerson}:{nation:string;revision:unknown;onPerson:(id:string)=>void}) {
 const permissions=usePermissions();
 const [overview,setOverview]=useState<ArrivalPlanningOverview|null>(null);
 const [error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
 const [reload,setReload]=useState(0),[editing,setEditing]=useState<ArrivalPlanningRow|null>(null);
 const [form,setForm]=useState({total:'',start:'',end:'',note:''});
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState<string|null>(null);
 const request=useRef(0);
 useEffect(()=>{
  const current=++request.current;setLoading(true);setError(null);
  void api.getArrivalPlanning(nation||undefined).then(value=>{if(current===request.current)setOverview(value);}).catch(()=>{if(current===request.current)setError('Anreiseplanung konnte nicht geladen werden.');}).finally(()=>{if(current===request.current)setLoading(false);});
  return ()=>{request.current++;};
 },[nation,revision,reload]);
 useEffect(()=>{setEditing(null);},[nation]);
 const ready=!loading&&!error&&overview?.nationCode===(nation||null);
 const open=(row:ArrivalPlanningRow)=>{setEditing(row);setSaveError(null);setForm({total:row.expectedTotal===null?'':String(row.expectedTotal),start:row.checkInDate||'',end:row.checkOutDate||'',note:row.note||''});};
 const save=async()=>{
  if(!editing)return;
  if(form.total!==''&&(!/^\d+$/.test(form.total)||Number(form.total)>2147483647)){setSaveError('Erwartete Gesamtzahl muss eine nichtnegative ganze Zahl sein.');return;}
  setSaving(true);setSaveError(null);
  try {
   await api.saveArrivalForecast(editing.areaId,{baseToken:editing.baseToken,expectedTotal:form.total===''?null:Number(form.total),checkInDate:form.start||null,checkOutDate:form.end||null,note:form.note||null});
   setEditing(null);setReload(value=>value+1);
  }catch(error){setSaveError(error instanceof Error?error.message:'Prognose konnte nicht gespeichert werden.');}
  finally{setSaving(false);}
 };
 return <details className="shrink-0 border-b border-[var(--ops-divider)] p-3 text-sm" aria-label="Athleten-Anreiseplanung">
  <summary className="cursor-pointer font-semibold">Athleten-Anreiseplanung · {nation||'Alle Nationen'} {ready&&overview?`· ${overview.reportedCount} gemeldet · ${overview.namedExpectedCount} namentlich erwartet`:''}</summary>
  <p className="my-2 text-xs text-[var(--ops-text-muted)]">Operative Gesamtprognose inklusive zusätzlich erwarteter Weltmeister. Keine Startquote, keine Reservierung. Nationenfilter gilt; Suche und weitere Personenfilter ändern diese Zahlen nicht. Officials werden weiterhin namentlich geplant.</p>
  {(loading||error)&&<p role="status">{loading?'Planung wird aktualisiert …':error}</p>}
  {error&&<OpsButton onClick={()=>setReload(value=>value+1)}>Erneut laden</OpsButton>}
  {ready&&overview&&<div className="overflow-x-auto"><table className="w-full text-left text-xs" aria-label="Athletenprognosen">
   <thead><tr>{['Planungsbereich','Gemeldet','Erwartet gesamt','Namentlich','Anonym','Ungeklärt','Planung'].map(label=><th key={label} className="px-2 py-1">{label}</th>)}</tr></thead>
   <tbody>{overview.rows.map(row=><tr key={row.areaId} className="border-t border-[var(--ops-divider)]">
    <td className="p-2"><b>{row.nationCode} · {row.discipline||'Gemeinsam / Zuordnung klären'} · {row.personalGender==='M'?'Herren':row.personalGender==='W'?'Damen':'Personennachweise prüfen'}</b><span className="block">{row.sportFamilies.map(sportAreaLabel).join(' / ')}</span>{row.checkInDate&&<span>{row.checkInDate}–{row.checkOutDate} (Check-out)</span>}{row.worldChampionCount>0&&<p title="Vorhandene Kennzeichnung oder anwendbare Titelreferenz; zusätzliche Startrechte bewusst in die Gesamtzahl einplanen. Keine automatische Anreise oder EZ-Ausnahme."><Crown className="mr-1 inline h-3.5 w-3.5 text-amber-500 fill-amber-200"/>{row.worldChampionCount} Weltmeister / Titelreferenz</p>}</td>
    <td className="p-2">{row.reportedCount}</td><td className="p-2">{row.expectedTotal??'Nicht gepflegt'}</td><td className="p-2">{row.namedExpectedCount}</td><td className="p-2">{row.conflict?'Klärung':row.anonymousRemaining??'—'}</td><td className="p-2">{row.undecidedCount}</td>
    <td className="p-2">{row.conflict?<p className="text-[var(--ops-warning)]">Planungskonflikt: {row.reasons.join(' ')}</p>:<span>{row.status==='NOT_SET'?'Prognose nicht gepflegt':!row.checkInDate?'Zeitraum noch offen':'Geplant'}</span>}
     <details><summary className="cursor-pointer">Personen / Nachweise</summary><ul>{row.people.map(person=><li key={person.personId} className="my-1"><button type="button" className="text-[var(--ops-primary)] underline" onClick={()=>onPerson(person.personId)}>{person.name}</button> · {person.arrivalStatus==='EXPECTED'||person.arrivalStatus==='CONFIRMED'?'Namentlich erwartet/bestätigt':person.arrivalStatus==='NOT_TRAVELLING'?'Nicht anreisend':'Anreise ungeklärt'} · {person.personalGender||'Gender offen'}{(person.worldChampionMarked||person.titleReferences.length>0)&&<Crown aria-label="Weltmeisterkennzeichnung oder Titelreferenz" className="mx-1 inline h-3.5 w-3.5 text-amber-500 fill-amber-200"/>}<span className="block">{person.disciplines.join(' / ')} {person.reasons.join(' ')}</span>{person.titleReferences.map(title=><span key={title.id} className="block">{title.championship} {title.championshipYear} · {title.discipline}</span>)}</li>)}</ul></details>
     {row.editable&&<OpsButton disabled={!permissions.canEdit||saving} onClick={()=>open(row)}>Prognose bearbeiten</OpsButton>}
     {row.updatedBy&&<p className="mt-1 text-[var(--ops-text-muted)]">{row.updatedBy} · {row.updatedAt}</p>}
    </td>
   </tr>)}</tbody>
  </table>{!overview.rows.length&&<p>Keine gemeldeten Athleten oder gespeicherten Prognosen in dieser Nation.</p>}</div>}
  <Dialog open={Boolean(editing)} onClose={()=>{if(!saving)setEditing(null);}} fullWidth maxWidth="sm">
   <DialogTitle>Erwartete Athleten · {editing?.nationCode} · {editing?.discipline} · {editing?.personalGender}</DialogTitle>
   <DialogContent><p className="mb-3 text-sm">Gesamtzahl einschließlich zusätzlich erwarteter Weltmeister. Leer bedeutet nicht gepflegt; 0 ist eine ausdrückliche Nullprognose. Anreise und EZ-Regeln werden nicht automatisch geändert.</p>
    <div className="grid gap-3 py-2"><TextField label="Erwartete Gesamtzahl" value={form.total} type="number" slotProps={{htmlInput:{min:0,step:1}}} disabled={saving} onChange={event=>setForm(current=>({...current,total:event.target.value}))}/>
    <TextField type="date" label="Geplanter Check-in" slotProps={{inputLabel:{shrink:true}}} value={form.start} disabled={saving} onChange={event=>setForm(current=>({...current,start:event.target.value}))}/><TextField type="date" label="Geplanter Check-out" slotProps={{inputLabel:{shrink:true}}} value={form.end} disabled={saving} onChange={event=>setForm(current=>({...current,end:event.target.value}))}/><TextField label="Interner Planungshinweis" multiline value={form.note} disabled={saving} slotProps={{htmlInput:{maxLength:2000}}} onChange={event=>setForm(current=>({...current,note:event.target.value}))}/></div>
    {saveError&&<Alert severity="error">{saveError}<OpsButton disabled={saving} onClick={()=>{setEditing(null);setReload(value=>value+1);}}>Aktuellen Stand laden</OpsButton></Alert>}
   </DialogContent><DialogActions><OpsButton disabled={saving} onClick={()=>setEditing(null)}>Abbrechen</OpsButton><OpsButton disabled={saving||!permissions.canEdit} onClick={()=>void save()}>Speichern</OpsButton></DialogActions>
  </Dialog>
 </details>;
}
