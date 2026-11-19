import {useEffect} from 'react';
import {Crown} from 'lucide-react';
import type {ImportNNPlanning,NNPlanningChoice,OperationalQuotaRow} from '../types';
import {OpsButton} from '../design-system';

export function checkedNNChoices(choices:NNPlanningChoice[]) {
 if(choices.some(choice=>choice.expectedTotal!==null&&(!Number.isInteger(choice.expectedTotal)||choice.expectedTotal<0||choice.expectedTotal>2147483647)))throw new Error('NN-Gesamtzahl muss eine nichtnegative ganze Zahl sein.');
 return choices;
}
export interface NNPlanningControls {focusArea?:string;planning:ImportNNPlanning;choices:NNPlanningChoice[];onChange:(choices:NNPlanningChoice[])=>void;disabled:boolean;onApply?:()=>void;busy?:boolean;error?:string|null}

/** Shared read-only values for both existing quota views; never calculates quotas. */
export function OperationalQuotaValues({quota}:{quota:OperationalQuotaRow}) {return <>
     {quota.nnForecastBlocked&&<p className="mb-2 text-xs font-bold text-[var(--ops-warning)]">NN-Prognose blockiert: Quotenbasis ist der aktuelle gemeldete Athletenbestand. Die blockierte Prognose wird nicht übernommen.</p>}
     <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">{[['Für Unterkunft erwartet',quota.expectedAthletes],['Operative Officials-Obergrenze',quota.officialQuota],['Tatsächlich erfasste Officials',quota.registeredOfficials],['EZ-Berechnungsbasis',quota.singleRoomOfficialBasis],['Regulärer EZ-Anspruch',quota.singleRoomsAllowed],['EZ-Anfragen / bestehende Nutzung',quota.singleRoomsRequested],['Zusätzliche EZ genehmigt',quota.approvedExtraSingleRooms],['EZ offen',quota.singleRoomsPending]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl>
     <p className="mt-2 text-xs text-[var(--ops-text-muted)]">Offizielle FIS-Basis: {quota.athletesEntered} Athleten · Officials-Limit {quota.fisOfficialQuota} · bisheriger EZ-Anspruch {quota.fisSingleRoomsAllowed}. Operative Werte sind keine neue Genehmigung.</p>
     {(quota.officialsExceeded||quota.singleRoomsPending>0||quota.coverageChanged)&&<p className="mt-1 text-xs font-bold text-[var(--ops-warning)]">Operativer Klärungsbedarf{quota.officialsExceeded?' · Officials über Obergrenze':''}{quota.singleRoomsPending>0?` · ${quota.singleRoomsPending} ungedeckte EZ`:''}{quota.coverageChanged?' · EZ-Deckung gegenüber FIS-Basis geändert':''}. Vorhandene Genehmigungen und Buchungen bleiben erhalten.</p>}
 </>;}

/** Embedded only in the existing athlete quota check. All dependent numbers are backend projections. */
export function ArrivalPlanning({planning,choices,onChange,disabled,onApply,busy,error,focusArea}:NNPlanningControls) {
 useEffect(()=>{if(focusArea)document.getElementById(`nn-area-${focusArea}`)?.scrollIntoView({block:'center'});},[focusArea]);
 const update=(row:ImportNNPlanning['rows'][number],mode:string,total?:number)=>{
  const prior=choices.find(choice=>choice.areaId===row.areaId);
  const other=choices.filter(choice=>choice.areaId!==row.areaId);
  onChange(mode==='KEEP'?other:[...other,{areaId:row.areaId,baseToken:prior?.baseToken??row.baseToken,expectedTotal:mode==='NORMAL'?null:total??row.expectedTotal??row.reportedCount}]);
 };
 return <section aria-label="Operative Unterkunftsplanung" className="space-y-3 border-t border-[var(--ops-divider)] pt-3 text-sm">
  <h4 className="font-bold">Unterkunftsbedarf und operative Officials-/EZ-Quote</h4>
  <p className="text-xs text-[var(--ops-text-muted)]">Die offizielle FIS-Meldung bleibt unverändert. Ohne Eingabe normale Personendisposition. Abweichende Mengen einschließlich Weltmeister oder Trainingspersonen bewusst planen; keine automatische EZ-Genehmigung oder Reservierung.</p>
  <p className="text-xs">{planning.mode==='LIVE'?'Änderungen erst mit „NN-Entscheidung übernehmen“ speichern. Kein Datei-Reimport.':'Vorschau ohne Speicherung. Die ausdrückliche Entscheidung wird erst mit Freigabe und erfolgreichem Import übernommen.'}</p>
  {error&&<p role="alert" className="text-[var(--ops-error)]">{error}</p>}
  {planning.operationalQuota?.conflict&&<p className="text-[var(--ops-warning)]">Klärungsbedarf: {planning.operationalQuota.reasons.join(' ')}</p>}
  {planning.rows.map(row=>{
   const choice=choices.find(choice=>choice.areaId===row.areaId);
   const mode=!choice?'KEEP':choice.expectedTotal===null?'NORMAL':'NN';
   const quota=planning.operationalQuota?.rows.find(q=>q.nationCode===row.nationCode&&q.discipline===row.discipline&&q.gender===row.personalGender);
   return <div id={`nn-area-${row.areaId}`} key={row.areaId} className="rounded border border-[var(--ops-border)] p-3" aria-label={`Unterkunftsbereich ${row.discipline??'Klärung'} ${row.personalGender??''}`}>
    <strong>{row.nationCode} · {row.discipline??'Zuordnung klären'} · {row.personalGender==='M'?'Herren':row.personalGender==='W'?'Damen':'Gender klären'}</strong>
    <p className="my-1 text-xs">FIS gemeldet: {row.reportedCount}{row.quotaHints?.map((hint,i)=><span key={i}> · {hint.name}: reguläre Startquote {hint.regularMax??'zu prüfen'}</span>)}</p>
    {row.worldChampionCount>0&&<p className="text-xs"><Crown className="mr-1 inline h-3.5 w-3.5 text-amber-500 fill-amber-200"/>{row.worldChampionCount} Weltmeister / Titelreferenz</p>}
    <div className="my-2 flex flex-wrap items-center gap-2"><select aria-label={`NN-Entscheidung ${row.discipline??'Klärung'} ${row.personalGender??''}`} value={mode} disabled={disabled||!row.editable} onChange={event=>update(row,event.target.value)} className="rounded border border-[var(--ops-border)] bg-[var(--ops-surface)] p-1"><option value="KEEP">Keine Änderung</option><option value="NORMAL">Normal namentlich (NN aufheben)</option><option value="NN">NN-Anzahl festlegen</option></select>
    {mode==='NN'&&<label>Erwarteter Unterkunftsbedarf <input aria-label={`NN-Anzahl ${row.discipline} ${row.personalGender}`} type="number" min={0} step={1} value={Number.isNaN(choice!.expectedTotal)?'':choice!.expectedTotal??''} disabled={disabled} onChange={event=>update(row,'NN',event.target.value===''?NaN:Number(event.target.value))} className="w-20 rounded border border-[var(--ops-border)] bg-[var(--ops-surface)] p-1"/></label>}</div>
    {row.conflict&&<p className="text-[var(--ops-warning)]">{row.reasons.join(' ')}</p>}
    {busy?<p role="status">Operative Vorschau wird berechnet …</p>:error?null:quota?<>
     <OperationalQuotaValues quota={quota}/>
    </>:<p className="text-xs">Kein gültiger Quotenkontext; Zuordnung klären.</p>}
    {!busy&&!error&&row.virtualPlaces>0&&<p aria-label="NN-Plätze" className="mt-2 text-xs font-semibold">{row.virtualPlaces<=10?Array.from({length:row.virtualPlaces},(_,i)=>`NN ${i+1}`).join(' · '):`NN 1–${row.virtualPlaces}`} · Noch nicht disponierbar</p>}
   </div>;
  })}
  {planning.mode==='LIVE'&&onApply&&<OpsButton disabled={disabled||busy||Boolean(error)||!choices.length} onClick={onApply}>NN-Entscheidung übernehmen</OpsButton>}
 </section>;
}
