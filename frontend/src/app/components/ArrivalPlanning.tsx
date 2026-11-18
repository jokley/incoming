import {Crown} from 'lucide-react';
import type {ImportNNPlanning,NNPlanningChoice} from '../types';
import {OpsButton} from '../design-system';

export function checkedNNChoices(choices:NNPlanningChoice[]) {
 if(choices.some(choice=>choice.expectedTotal!==null&&(!Number.isInteger(choice.expectedTotal)||choice.expectedTotal<0||choice.expectedTotal>2147483647)))throw new Error('NN-Gesamtzahl muss eine nichtnegative ganze Zahl sein.');
 return choices;
}

/** Import-owned, controlled draft: no API call or operational write on input. */
export function ArrivalPlanning({planning,choices,onChange,disabled,onApply}:{planning:ImportNNPlanning;choices:NNPlanningChoice[];onChange:(choices:NNPlanningChoice[])=>void;disabled:boolean;onApply?:()=>void}) {
 const update=(row:ImportNNPlanning['rows'][number],mode:string,total?:number)=>{
  const prior=choices.find(choice=>choice.areaId===row.areaId);
  const other=choices.filter(choice=>choice.areaId!==row.areaId);
  onChange(mode==='KEEP'?other:[...other,{areaId:row.areaId,baseToken:prior?.baseToken??row.baseToken,expectedTotal:mode==='NORMAL'?null:total??row.expectedTotal??row.reportedCount}]);
 };
 return <details className="rounded-lg border border-[var(--ops-border)] p-3 text-sm" aria-label="NN-Unterkunftsplanung">
  <summary className="cursor-pointer font-bold">NN-Unterkunftsplanung · {planning.nationCode}</summary>
  <p className="my-2 text-xs text-[var(--ops-text-muted)]">Normalfall: alle Personen namentlich disponieren. Nur abweichenden Unterkunftsbedarf ausdrücklich planen, inklusive zusätzlich erwarteter Weltmeister oder Trainingspersonen. Keine Startfreigabe, keine automatische EZ-Genehmigung, keine Reservierung.</p>
  <p className="mb-2 text-xs">{planning.mode==='LIVE'?'Übernommener Bestand: Änderungen werden erst mit „NN-Entscheidung übernehmen“ gespeichert.':'Diese Eingaben werden erst nach Freigabe zusammen mit dem erfolgreichen Import übernommen. Vorschau oder Abbruch ändern keine operative Prognose.'}</p>
  <div className="overflow-x-auto"><table className="w-full text-left text-xs" aria-label="NN-Planungsbereiche"><thead><tr>{['Bereich / persönliches Gender','Gemeldet','Reguläre Startquote (Hinweis)','Bestehender Bedarf','Entscheidung'].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{planning.rows.map(row=>{
   const choice=choices.find(choice=>choice.areaId===row.areaId);
   const mode=!choice?'KEEP':choice.expectedTotal===null?'NORMAL':'NN';
   return <tr key={row.areaId} className="border-t border-[var(--ops-divider)]"><td className="p-2"><strong>{row.nationCode} · {row.discipline??'Zuordnung klären'} · {row.personalGender==='M'?'Herren':row.personalGender==='W'?'Damen':'Gender klären'}</strong>{row.worldChampionCount>0&&<p><Crown className="mr-1 inline h-3.5 w-3.5 text-amber-500 fill-amber-200"/>{row.worldChampionCount} Weltmeister / Titelreferenz</p>}{row.conflict&&<p className="text-[var(--ops-warning)]">{row.reasons.join(' ')}</p>}</td>
    <td className="p-2">{row.reportedCount}</td><td className="p-2">{row.quotaHints?.length?row.quotaHints.map((hint,index)=><p key={index}>{hint.name}: {hint.regularMax??'nicht abschließend belegt'}</p>):'Siehe bestehende Quotenprüfung; keine pauschale Vierergrenze'}</td>
    <td className="p-2">{row.expectedTotal===null?'Normal namentlich':row.expectedTotal}</td>
    <td className="p-2"><select aria-label={`NN-Entscheidung ${row.discipline??'Klärung'} ${row.personalGender??''}`} value={mode} disabled={disabled||!row.editable} onChange={event=>update(row,event.target.value)} className="rounded border border-[var(--ops-border)] bg-[var(--ops-surface)] p-1"><option value="KEEP">Keine Änderung</option><option value="NORMAL">Normal namentlich (NN aufheben)</option><option value="NN">NN-Anzahl festlegen</option></select>
     {mode==='NN'&&<label className="mt-1 block">Erwarteter Unterkunftsbedarf <input aria-label={`NN-Anzahl ${row.discipline} ${row.personalGender}`} type="number" min={0} step={1} value={Number.isNaN(choice!.expectedTotal)?'':choice!.expectedTotal??''} disabled={disabled} onChange={event=>update(row,'NN',event.target.value===''?NaN:Number(event.target.value))} className="w-20 rounded border border-[var(--ops-border)] bg-[var(--ops-surface)] p-1"/></label>}
    </td></tr>;
  })}</tbody></table></div>
  {!planning.rows.length&&<p>Keine eindeutig gemeldeten Athletenbereiche vorhanden.</p>}
  {planning.mode==='LIVE'&&onApply&&<OpsButton className="mt-2" disabled={disabled||!choices.length} onClick={onApply}>NN-Entscheidung übernehmen</OpsButton>}
 </details>;
}
