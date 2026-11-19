import {useState} from 'react';
import {Check,Pencil,RotateCcw,X} from 'lucide-react';
import {Tooltip} from '@mui/material';
import type {ImportNNPlanning,NNPlanningChoice,OperationalQuotaRow} from '../types';


export function checkedNNChoices(choices:NNPlanningChoice[]) {
 if(choices.some(choice=>choice.expectedTotal!==null&&(!Number.isInteger(choice.expectedTotal)||choice.expectedTotal<0||choice.expectedTotal>2147483647)))throw new Error('NN-Gesamtzahl muss eine nichtnegative ganze Zahl sein.');
 return choices;
}
export interface NNPlanningControls {planning:ImportNNPlanning;choices:NNPlanningChoice[];onChange:(choices:NNPlanningChoice[])=>void;disabled:boolean;onApply?:()=>void;busy?:boolean;error?:string|null}

/** Shared read-only values for both existing quota views; never calculates quotas. */
export function OperationalQuotaValues({quota}:{quota:OperationalQuotaRow}) {return <>
     {quota.nnForecastBlocked&&<p className="mb-2 text-xs font-bold text-[var(--ops-warning)]">NN-Prognose blockiert: Quotenbasis ist der aktuelle gemeldete Athletenbestand. Die blockierte Prognose wird nicht übernommen.</p>}
     <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">{[['Für Unterkunft erwartet',quota.expectedAthletes],['Operative Officials-Obergrenze',quota.officialQuota],['Tatsächlich erfasste Officials',quota.registeredOfficials],['EZ-Berechnungsbasis',quota.singleRoomOfficialBasis],['Regulärer EZ-Anspruch',quota.singleRoomsAllowed],['EZ-Anfragen / bestehende Nutzung',quota.singleRoomsRequested],['Zusätzliche EZ genehmigt',quota.approvedExtraSingleRooms],['EZ offen',quota.singleRoomsPending]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl>
     <p className="mt-2 text-xs text-[var(--ops-text-muted)]">Offizielle FIS-Basis: {quota.athletesEntered} Athleten · Officials-Limit {quota.fisOfficialQuota} · bisheriger EZ-Anspruch {quota.fisSingleRoomsAllowed}. Operative Werte sind keine neue Genehmigung.</p>
     {(quota.officialsExceeded||quota.singleRoomsPending>0||quota.coverageChanged)&&<p className="mt-1 text-xs font-bold text-[var(--ops-warning)]">Operativer Klärungsbedarf{quota.officialsExceeded?' · Officials über Obergrenze':''}{quota.singleRoomsPending>0?` · ${quota.singleRoomsPending} ungedeckte EZ`:''}{quota.coverageChanged?' · EZ-Deckung gegenüber FIS-Basis geändert':''}. Vorhandene Genehmigungen und Buchungen bleiben erhalten.</p>}
 </>;}

/** Each competition is only an entry point to the same backend-owned area. */
export function InlineNNInput({nn,area,eligible,label,reported}:{nn:NNPlanningControls;area:ImportNNPlanning['rows'][number];eligible:boolean;label:string;reported:number}) {
 const [editing,setEditing]=useState(false),[text,setText]=useState(''),[error,setError]=useState('');
 const choice=nn.choices.find(choice=>choice.areaId===area.areaId);
 const total=choice?choice.expectedTotal:area.expectedTotal;
 const maintained=total!==null||area.expectedTotal!==null;
 const title=`Manuell erwartete Athleten für die Unterkunft: ${total??'normale Personendisposition'}. FIS gemeldet: ${reported}. ${area.reportedCount} eindeutige Athleten im Planungsbereich. Gemeinsame Prognose für ${area.nationCode} / ${area.discipline} / ${area.personalGender}: gilt für alle Wettbewerbe dieses Planungsbereichs, keine zusätzlichen Plätze je Wettbewerb.${area.conflict?' Prognose blockiert; normale Athletenbasis gilt.':''}`;
 const apply=(expectedTotal:number|null)=>{
  nn.onChange([...nn.choices.filter(c=>c.areaId!==area.areaId),{areaId:area.areaId,baseToken:choice?.baseToken??area.baseToken,expectedTotal}]);setEditing(false);setError('');
 };
 const confirm=()=>{const value=Number(text);if(!text.trim()||!Number.isInteger(value)||value<0||value>2147483647){setError('Nichtnegative ganze Zahl eingeben.');return;}apply(value);};
 if(!eligible&&!maintained)return null;
 return <span className="ml-1 inline-flex items-center gap-1 text-xs" aria-label={`Unterkunftsprognose ${label}`}>
  {editing?<><input disabled={nn.disabled} autoFocus aria-label={`Erwartete Athleten ${label}`} type="number" min={0} step={1} value={text} className="w-14 rounded border border-[var(--ops-border)] bg-[var(--ops-surface)] p-1" onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();confirm();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setEditing(false);setError('');}}}/><button type="button" disabled={nn.disabled} aria-label={`Erwartung bestätigen ${label}`} onClick={confirm}><Check size={14}/></button><button type="button" aria-label={`Bearbeitung abbrechen ${label}`} onClick={()=>{setEditing(false);setError('');}}><X size={14}/></button></>:<Tooltip title={title}><button type="button" disabled={nn.disabled||!area.editable} aria-label={`Unterkunftserwartung bearbeiten ${label}`} onClick={()=>{setText(String(total??area.reportedCount));setEditing(true);}} className="inline-flex items-center gap-1 text-[var(--ops-warning)] disabled:opacity-60">{total!==null&&<span aria-hidden="true">·</span>}<Pencil size={13}/>{total!==null&&<span>{total} manuell</span>}</button></Tooltip>}
  {!editing&&maintained&&<Tooltip title="Manuelle Prognose zurücksetzen · normale Personendisposition"><button type="button" disabled={nn.disabled||!area.editable} aria-label={`Unterkunftserwartung zurücksetzen ${label}`} onClick={()=>apply(null)}><RotateCcw size={12}/></button></Tooltip>}
  {error&&<span role="alert" className="text-[var(--ops-error)]">{error}</span>}
 </span>;
}
