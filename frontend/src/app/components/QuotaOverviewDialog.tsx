import {Fragment} from 'react';
import {CompetitionDistribution} from './ImportControl';
import type {ImportControl,FisImportPreview,QuotaOverview} from '../types';
import type {QuotaPeopleFilter} from '../services/importHints';
import {EmptyState,EnterpriseDialog,OpsButton,StatusChip} from '../design-system';

type Nation=QuotaOverview['nations'][number];
type Family=Nation['athleteFamilies'][number];
type Navigate=(filter:QuotaPeopleFilter)=>void;
const numberCell='px-3 py-2 text-right tabular-nums';
const familyName=(value:string)=>value==='Freestyle'?'Freestyle / Freeski':value;
const genderName=(value:string)=>value==='M'?'Männer':['W','F'].includes(value)?'Frauen':`Unbekannt (${value||'—'})`;

function PeopleCount({count,filter,onPeople,label}:{count:number;filter:QuotaPeopleFilter;onPeople?:Navigate;label:string}) {
 return onPeople?<button type="button" onClick={()=>onPeople(filter)} aria-label={label} className="font-bold text-[var(--ops-primary)] underline decoration-dotted underline-offset-4">{count}</button>:<strong>{count}</strong>;
}
function AthleteState({row,incomplete}:{row:Family;incomplete:boolean}) {
 if(incomplete||row.athleteQuotaStatus==='INCOMPLETE')return <StatusChip tone="warning">Fachlich prüfen</StatusChip>;
 if(row.decisionStatus==='PENDING'||Object.values(row.uncoveredExtent??{}).some(n=>n>0))return <StatusChip tone="warning">Entscheidung offen</StatusChip>;
 if(row.decisionStatus==='APPROVED')return <StatusChip tone="info">Überschreitung genehmigt</StatusChip>;
 if(row.athleteQuotaStatus==='EXCEEDED')return <StatusChip tone="warning">Fachlich prüfen</StatusChip>;
 return <StatusChip tone="success">Innerhalb der Quote</StatusChip>;
}
function AthleteOverview({nation,fixed,control,preview,onPeople}:{nation:Nation;fixed:boolean;control?:ImportControl;preview?:FisImportPreview;onPeople?:Navigate}) {
 const incomplete=nation.incomplete||!fixed;
 return <div className="space-y-3">
  <CompetitionDistribution control={control} preview={preview} nation={nation.nationCode}/>
  <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Athletenquoten – gemeldet, erlaubt und Abweichung"><table className="w-full text-sm">
   <caption className="sr-only">Autoritative Athletenquoten: Gemeldet / erlaubt</caption>
   <thead><tr>{['Athletenquote · gemeldet / erlaubt','Männer','Frauen','Gesamt'].map((label,i)=><th scope="col" key={label} className={`px-3 py-2 ${i?'text-right':'text-left'}`}>{label}</th>)}</tr></thead>
   <tbody>{nation.athleteFamilies.map(row=><tr key={row.topLevelDiscipline} className="border-t border-[var(--ops-divider)]">
    <th scope="row" className="ops-table-wrap px-3 py-2 text-left"><span className="block">{familyName(row.topLevelDiscipline)}</span><AthleteState row={row} incomplete={incomplete}/></th>
    {(['M','F','total'] as const).map(key=>{
     const used=key==='total'?row.athleteQuotaUsed:row.athleteGenderUsed[key];
     const limit=key==='total'?row.athleteQuotaLimit:row.athleteGenderLimit;
     const excess=row.requiredExtent?.[key]??Math.max(0,used-limit);
     const approved=row.approvedExtent?.[key]??0,open=row.uncoveredExtent?.[key];
     const unknown=incomplete||row.athleteQuotaStatus==='INCOMPLETE';
     return <td key={key} className={`${numberCell} align-top ${excess>0&&!unknown?((open??0)>0?'bg-[var(--ops-tone-warning-surface)]':'bg-[var(--ops-tone-info-surface)]'):''}`}>
      <span className="whitespace-nowrap"><PeopleCount count={used} filter={{nation:nation.nationCode,role:'athletes',family:row.topLevelDiscipline,...(key==='total'?{}:{gender:key})}} onPeople={onPeople} label={`${familyName(row.topLevelDiscipline)}: ${key==='total'?'alle Athleten':genderName(key)} anzeigen`}/> / {limit}</span>
      <span className={`block text-xs font-semibold ${unknown||open?'text-[var(--ops-warning)]':excess?'text-[var(--ops-info)]':'text-[var(--ops-success)]'}`}>
       {unknown?'Fachlich prüfen':excess?`+${excess}`:'OK'}
      </span>
      {approved>0&&<span className="block text-xs">{approved} genehmigt</span>}
      {(open??0)>0&&<span className="block text-xs font-bold text-[var(--ops-warning)]">{open} offen</span>}
      {!unknown&&excess>0&&open===undefined&&<span className="block text-xs">{row.decisionStatus==='APPROVED'?'Genehmigt':'Fachlich prüfen'}</span>}
     </td>;
    })}
   </tr>)}</tbody>
  </table></div>
  {!nation.athleteFamilies.length&&<p className="text-sm">Keine aktive Athletenquote · Fachlich prüfen</p>}
 </div>;
}
function OfficialsOverview({nation,fixed,control,preview,onPeople}:{nation:Nation;fixed:boolean;control?:ImportControl;preview?:FisImportPreview;onPeople?:Navigate}) {
 const incomplete=nation.incomplete||!fixed;
 return <div className="space-y-3">
  <p className="text-sm">{nation.peopleTotal} Personen · {nation.athletes} Athleten · <PeopleCount count={nation.officials} filter={{nation:nation.nationCode,role:'officials'}} onPeople={onPeople} label={`Alle Officials ${nation.nationCode} anzeigen`}/> eindeutige Officials{nation.otherPeople>0?` · ${nation.otherPeople} weitere / unzugeordnete Personen`:''}</p>
  <CompetitionDistribution control={control} preview={preview} nation={nation.nationCode}/>
  <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Officials und EZ je Event Group"><table className="w-full text-sm">
   <caption className="sr-only">Eindeutige Officials und bestehende EZ-Bewertung</caption>
   <thead><tr>{['Event Group','Officials','EZ-Anspruch Σ M/W','EZ angefordert','Bewertung'].map((label,i)=><th key={label} scope="col" className={`px-3 py-2 ${i>0&&i<4?'text-right':'text-left'}`}>{label}</th>)}</tr></thead>
   <tbody>{nation.groups.map(group=>{
    const review=incomplete||group.coverageReviewRequired;
    const totals=group.totals;
    return <Fragment key={group.name}>
     <tr className="border-t border-[var(--ops-divider)]">
      <th scope="row" className="ops-table-wrap px-3 py-2 text-left">{group.name}</th>
      <td className={numberCell}><PeopleCount count={group.officials} filter={{nation:nation.nationCode,role:'officials',group:group.name}} onPeople={onPeople} label={`Officials ${group.name} anzeigen`}/></td>
      <td className={numberCell} title="Summe der bestehenden Geschlechterkontexte; kein übertragbares Kontingent">{totals.singleRoomsAllowed}</td><td className={numberCell}>{totals.singleRoomsRequested}</td>
      <td className="ops-table-wrap px-3 py-2"><StatusChip tone={review||totals.singleRoomsPending?'warning':'success'}>{review?'Fachlich prüfen':totals.singleRoomsPending?'EZ-Entscheidung offen':'OK'}</StatusChip>
       <span className="block text-xs">{totals.singleRoomsPending?`${totals.singleRoomsPending} EZ offen`:'Keine offenen EZ-Entscheidungen'}</span>
       {totals.singleRoomsApproved>0&&<span className="block text-xs">{totals.singleRoomsApproved} zusätzliche EZ genehmigt</span>}
       {totals.quotaExemptSingleRooms>0&&<span className="block text-xs">{totals.quotaExemptSingleRooms} EZ-Ausnahmen</span>}
      </td>
     </tr>
     <tr><td colSpan={5} className="px-3 pb-2"><details className="text-xs"><summary className="cursor-pointer text-[var(--ops-text-muted)]">{group.name} · Geschlechteraufteilung</summary>
      <table className="mt-2 w-full"><caption className="sr-only">Quotenkontexte für {group.name}</caption><thead><tr>{['Geschlecht','Athleten','Officials-Basis','EZ-Anspruch','Angefordert','Genehmigt','Offen','Ausnahmen'].map((label,i)=><th scope="col" key={label} className={`px-2 py-1 ${i?'text-right':'text-left'}`}>{label}</th>)}</tr></thead><tbody>
       {group.contexts.map(row=><tr key={row.gender}><th scope="row" className="px-2 py-1 text-left font-normal">{genderName(row.gender)}</th>{[row.athletes,row.officialQuota,row.singleRoomsAllowed,row.singleRoomsRequested,row.singleRoomsApproved,row.singleRoomsPending,row.quotaExemptSingleRooms].map((value,i)=><td key={i} className="px-2 py-1 text-right tabular-nums">{value}</td>)}</tr>)}
       <tr className="font-bold"><th scope="row" className="px-2 py-1 text-left">Σ M/W</th>{[group.athletes,totals.officialQuota,totals.singleRoomsAllowed,totals.singleRoomsRequested,totals.singleRoomsApproved,totals.singleRoomsPending,totals.quotaExemptSingleRooms].map((value,i)=><td key={i} className="px-2 py-1 text-right tabular-nums">{value}</td>)}</tr>
      </tbody></table>
     </details></td></tr>
    </Fragment>;
   })}</tbody>
  </table></div>
  {nation.officialsInMultipleGroups>0&&(onPeople?<button type="button" onClick={()=>onPeople({nation:nation.nationCode,role:'officials',multipleGroups:true})} className="text-left text-sm text-[var(--ops-primary)] underline">{nation.officialsInMultipleGroups} Officials in mehreren Event Groups → Personen anzeigen</button>:<p className="text-sm">{nation.officialsInMultipleGroups} Officials in mehreren Event Groups</p>)}
  {nation.officialsWithoutContext>0&&<p className="text-xs text-[var(--ops-warning)]">{nation.officialsWithoutContext} Officials ohne eindeutigen Quotenkontext</p>}
 </div>;
}
export function QuotaOverviewContent({overview,kind,control,preview,onPeople}:{overview:QuotaOverview;kind:'athlete'|'officials';control?:ImportControl;preview?:FisImportPreview;onPeople?:Navigate}) {
 return <div className="space-y-4"><div className="flex flex-wrap gap-2 text-xs"><span>{overview.event.isWorldChampionship?'WM-Quotenregel':'Event-Quotenregel (Nicht-WM)'} · Revision {overview.event.rulesRevision} · {overview.event.rulesFixed?'fixiert':'Entwurf'}</span></div>
  {overview.nations.map(nation=><section key={nation.nationCode} className="space-y-2" aria-label={`Nation ${nation.nationCode}`}><h3 className="text-sm font-extrabold">Nation {nation.nationCode||'unbekannt'}</h3>{kind==='athlete'?<AthleteOverview nation={nation} fixed={overview.event.rulesFixed} control={control} preview={preview} onPeople={onPeople}/>:<OfficialsOverview nation={nation} fixed={overview.event.rulesFixed} control={control} preview={preview} onPeople={onPeople}/>}</section>)}
 </div>;
}
export function QuotaOverviewDialog({preview,kind,onClose,control,onPeople}:{preview:FisImportPreview|null;kind:'athlete'|'officials';onClose:()=>void;control?:ImportControl;onPeople?:Navigate}) {
 const overview=preview?.quotaOverview;
 return <EnterpriseDialog open title={kind==='athlete'?'Athleten-/Disziplinquote':'Officials & EZ-Quote'} description={overview?.event.name||'Gespeicherter Prüfstand'} size="large" onClose={onClose} actions={<OpsButton onClick={onClose}>Schließen</OpsButton>}>
  {overview?<QuotaOverviewContent overview={overview} kind={kind} control={control} preview={preview??undefined} onPeople={preview?onPeople:undefined}/>:<EmptyState title="Keine vollständigen Anzeigeaggregate gespeichert" description="Für diesen Prüfstand ist keine Quotenübersicht verfügbar."/>}
 </EnterpriseDialog>;
}

export function AthleteQuotaPreviewStatus({preview}:{preview:FisImportPreview}) {
  const rows=preview.athleteQuotaChecks??[];
  if(preview.errors.some(e=>e.code==='ATHLETE_QUOTA_FAMILY_UNKNOWN'||e.code.startsWith('ENTRY_QUOTA_GENDER')))return <StatusChip tone="warning">Quotendaten unvollständig</StatusChip>;
  if(rows.some(q=>q.athleteQuotaStatus==='INCOMPLETE'))return <StatusChip tone="warning">Unvollständige Quotendaten</StatusChip>;
  if(rows.some(q=>q.decisionStatus==='PENDING'))return <StatusChip tone="warning">Genehmigung erforderlich</StatusChip>;
  if(rows.some(q=>q.decisionStatus==='APPROVED'))return <StatusChip tone="info">Überschreitung genehmigt</StatusChip>;
  if(rows.some(q=>q.athleteQuotaStatus==='EXCEEDED'))return <StatusChip tone="warning">Quotenbewertung prüfen</StatusChip>;
  if(!rows.length)return <StatusChip tone="neutral">Keine aktive Athletenquote</StatusChip>;
  if(!preview.quotaOverview?.event.rulesFixed)return <StatusChip tone="neutral">Regelkontext prüfen</StatusChip>;
  return <StatusChip tone="success">Innerhalb der aktiven Athletenlimits</StatusChip>;
}
