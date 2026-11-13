import { sportAreaLabel } from '../services/competitionPresentation';
import {Fragment} from 'react';
import {CompetitionDistribution} from './ImportControl';
import type {ImportControl,FisImportPreview,QuotaOverview} from '../types';
import {singleRoomSummary} from '../services/importHints';
import type {QuotaPeopleFilter} from '../services/importHints';
import {EmptyState,EnterpriseDialog,OpsButton,StatusChip} from '../design-system';

type Nation=QuotaOverview['nations'][number];
type Family=Nation['athleteFamilies'][number];
type Navigate=(filter:QuotaPeopleFilter)=>void;
const numberCell='px-1 py-2 text-right tabular-nums sm:px-3';
const genderName=(value:string)=>value==='M'?'Männer':['W','F'].includes(value)?'Frauen':`Unbekannt (${value||'—'})`;

function PeopleCount({count,filter,onPeople,label}:{count:number;filter:QuotaPeopleFilter;onPeople?:Navigate;label:string}) {
 return onPeople?<button type="button" onClick={()=>onPeople(filter)} aria-label={label} style={{fontSize:'inherit'}} className="font-bold text-[var(--ops-primary)] underline decoration-dotted underline-offset-4">{count}</button>:<strong>{count}</strong>;
}
function AthleteState({row,incomplete}:{row:Family;incomplete:boolean}) {
 if(incomplete||row.athleteQuotaStatus==='INCOMPLETE')return <StatusChip tone="warning">Fachlich prüfen</StatusChip>;
 if(row.decisionStatus==='PENDING'||Object.values(row.uncoveredExtent??{}).some(n=>n>0))return <StatusChip tone="warning">Entscheidung offen</StatusChip>;
 if(row.decisionStatus==='APPROVED')return <StatusChip tone="info">Überschreitung genehmigt</StatusChip>;
 if(row.athleteQuotaStatus==='EXCEEDED')return <StatusChip tone="warning">Fachlich prüfen</StatusChip>;
 return <StatusChip tone="success">Innerhalb der Quote</StatusChip>;
}
function AthleteOverview({nation,fixed,control,preview,onPeople,focusSport}:{nation:Nation;fixed:boolean;control?:ImportControl;preview?:FisImportPreview;onPeople?:Navigate;focusSport?:boolean}) {
 const incomplete=nation.incomplete||!fixed;
 return <div className="space-y-3">
  <CompetitionDistribution control={control} preview={preview} nation={nation.nationCode} onPeople={onPeople} focusSport={focusSport}/>
  <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Athletenquoten – gemeldet, erlaubt und Abweichung"><table className="w-full text-xs sm:text-sm">
   <caption className="sr-only">Autoritative Athletenquoten: Gemeldet / erlaubt</caption>
   <thead><tr>{['Familienquote · gemeldet / erlaubt','Männer','Frauen','Gesamt'].map((label,i)=><th scope="col" key={label} className={`ops-table-wrap px-1 py-2 sm:px-3 ${i?'text-right':'text-left'}`}>{label}</th>)}</tr></thead>
   <tbody>{nation.athleteFamilies.map(row=><tr key={row.topLevelDiscipline} className="border-t border-[var(--ops-divider)]">
    <th scope="row" className="ops-table-wrap px-1 py-2 text-left sm:px-3"><span className="block">{sportAreaLabel(row.topLevelDiscipline)}</span><AthleteState row={row} incomplete={incomplete}/></th>
    {(['M','F','total'] as const).map(key=>{
     const used=key==='total'?row.athleteQuotaUsed:row.athleteGenderUsed[key];
     const limit=key==='total'?row.athleteQuotaLimit:row.athleteGenderLimit;
     const excess=row.requiredExtent?.[key]??Math.max(0,used-limit);
     const approved=row.approvedExtent?.[key]??0,open=row.uncoveredExtent?.[key];
     const unknown=incomplete||row.athleteQuotaStatus==='INCOMPLETE';
     return <td key={key} className={`${numberCell} align-top ${excess>0&&!unknown?((open??0)>0?'bg-[var(--ops-tone-warning-surface)]':'bg-[var(--ops-tone-info-surface)]'):''}`}>
      <span className="whitespace-nowrap"><PeopleCount count={used} filter={{nation:nation.nationCode,role:'athletes',family:row.topLevelDiscipline,...(key==='total'?{}:{gender:key})}} onPeople={onPeople} label={`${sportAreaLabel(row.topLevelDiscipline)}: ${key==='total'?'alle Athleten':genderName(key)} anzeigen`}/> / {limit}</span>
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
function OfficialsOverview({nation,fixed,onPeople,preview,control}:{nation:Nation;fixed:boolean;onPeople?:Navigate;preview?:FisImportPreview;control?:ImportControl}) {
 const incomplete=nation.incomplete||!fixed;

 const ez=preview?singleRoomSummary(preview,nation.nationCode):null;
 const breakdown=(summary:ReturnType<typeof singleRoomSummary>|null,scope?:string)=>{
  if(!summary?.available)return <StatusChip tone="neutral">EZ-Bewertung unvollständig</StatusChip>;
  if(summary.requested===0)return <span className="text-xs text-[var(--ops-text-muted)]">Keine EZ angefordert</span>;
  const ready=summary.complete&&Boolean(ez?.complete)&&!incomplete&&summary.exemptions.UNKNOWN.count===0;
  const open=summary.counts.PENDING>0;
  const parts=[
   {count:summary.counts.COVERED,keys:summary.personKeys.COVERED,label:'regulär',action:'regulär gedeckt'},
   {count:summary.counts.APPROVED_EXTRA,keys:summary.personKeys.APPROVED_EXTRA,label:'zusätzlich genehmigt',action:'zusätzliche EZ genehmigt'},
   {count:summary.exemptions.WORLD_CHAMPION.count,keys:summary.exemptions.WORLD_CHAMPION.personKeys,label:'WM-Ausnahme',action:'WM-EZ-Ausnahme'},
   {count:summary.exemptions.OTHER.count,keys:summary.exemptions.OTHER.personKeys,label:'allgemeine Ausnahme',action:'Allgemeine EZ-Ausnahme'},
   {count:summary.exemptions.UNKNOWN.count,keys:summary.exemptions.UNKNOWN.personKeys,label:'Ausnahme (Grund unklar)',action:'EZ-Ausnahme mit unklarem Grund'},
  ].filter(part=>part.count>0);
  return <StatusChip tone={open?'warning':ready?'success':'neutral'}><span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
   {!scope&&<>{ready&&!open?'Alle ':''}<PeopleCount count={summary.requested} filter={{nation:nation.nationCode,role:'people',personKeys:summary.allPersonKeys}} onPeople={onPeople} label="Angeforderte EZ-Personen anzeigen"/> EZ{ready&&!open?' gedeckt':''}: </>}
   {parts.map((part,i)=><Fragment key={part.action}>{i>0?' + ':''}<PeopleCount count={part.count} filter={{nation:nation.nationCode,role:'people',personKeys:part.keys}} onPeople={onPeople} label={`${part.action}: Personen anzeigen${scope?` · ${scope}`:''}`}/> {part.label}</Fragment>)}
   {open&&<>{parts.length?', ':''}<PeopleCount count={summary.counts.PENDING} filter={{nation:nation.nationCode,role:'people',personKeys:summary.personKeys.PENDING}} onPeople={onPeople} label={`EZ offen: Personen anzeigen${scope?` · ${scope}`:''}`}/> noch offen</>}
   {!ready&&<span className="block">Zuordnung oder Evidenz unvollständig</span>}
  </span></StatusChip>;
 };
 const withoutContext=preview?.people.filter(p=>p.nationCode===nation.nationCode&&p.function?.trim().toLowerCase()!=='athlete'&&control?.people.some(row=>row.personKey===p.matchKey&&row.quotaContexts?.length===0)).map(p=>p.matchKey!)??[];
 return <div className="space-y-3">
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Officials-Gesamtergebnis">
   <span><PeopleCount count={nation.officials} filter={{nation:nation.nationCode,role:'officials'}} onPeople={onPeople} label={`Alle Officials ${nation.nationCode} anzeigen`}/> eindeutige Officials</span>

  </div>
  <div className="text-sm" aria-label="EZ-Gesamtbewertung">{breakdown(ez)}</div>
  {nation.otherPeople>0&&<p className="text-xs">{nation.otherPeople} weitere / unzugeordnete Personen</p>}
  <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Officials und EZ je Event Group"><table className="w-full table-fixed text-[11px] sm:table-auto sm:text-sm">
   <caption className="sr-only">Eindeutige Officials und bestehende EZ-Bewertung</caption>
   <thead><tr>{['Event Group','Officials¹','EZ-Anfragen','EZ-Status'].map((label,i)=><th key={label} scope="col" title={i===1?'Eindeutige Personen je Event Group; nicht über Gruppen addieren.':undefined} className={`ops-table-wrap px-1 py-2 sm:px-3 ${i>0&&i<3?'w-[18%] text-right':i===0?'w-[32%] text-left':'text-left'}`}>{label}</th>)}</tr></thead>
   <tbody>{nation.groups.map(group=>{
    const totals=group.totals;
    const assigned=preview?singleRoomSummary({...preview,people:preview.people.filter(p=>p.singleRoomAllocation?.context?.[1]===group.name),rooms:[]},nation.nationCode):null;
    const consistent=assigned&&assigned.requested===totals.singleRoomsRequested&&assigned.counts.PENDING===totals.singleRoomsPending&&assigned.counts.APPROVED_EXTRA===totals.singleRoomsApproved&&assigned.counts.EXEMPT===totals.quotaExemptSingleRooms;
    return <Fragment key={group.name}>
     <tr className={`border-t border-[var(--ops-divider)] ${totals.singleRoomsPending?'border-l-2 border-l-[var(--ops-warning)]':''}`}>
      <th scope="row" className="ops-table-wrap px-1 py-2 sm:px-3 text-left">{group.name}</th>
      <td className={numberCell}><PeopleCount count={group.officials} filter={{nation:nation.nationCode,role:'officials',group:group.name}} onPeople={onPeople} label={`Officials ${group.name} anzeigen`}/></td>
      <td className={numberCell}>{totals.singleRoomsRequested}</td>
      <td className="ops-table-wrap px-1 py-2 sm:px-3 [&_svg]:hidden sm:[&_svg]:block">{breakdown(consistent?assigned:null,group.name)}{!consistent&&totals.singleRoomsPending>0&&<span className="block text-xs">{totals.singleRoomsPending} EZ offen</span>}</td>
     </tr>
     <tr><td colSpan={4} className="ops-table-wrap px-1 pb-2 sm:px-3"><details className="text-xs"><summary className="cursor-pointer text-[var(--ops-text-muted)]">{group.name} · Geschlechteraufteilung</summary>
      <div className="w-0 min-w-full overflow-x-auto"><table className="mt-2 w-full text-xs"><caption className="sr-only">Quotenkontexte für {group.name}</caption><thead><tr>{['Geschlecht','Athleten','Berechnungsbasis EZ','EZ-Anspruch','Angefordert','Genehmigt','Offen','Ausnahmen'].map((label,i)=><th scope="col" key={label} className={`px-2 py-1 ${i?'text-right':'text-left'}`}>{label}</th>)}</tr></thead><tbody>
       {group.contexts.map(row=><tr key={row.gender}><th scope="row" className="px-2 py-1 text-left font-normal">{genderName(row.gender)}</th>{[row.athletes,row.officialQuota,row.singleRoomsAllowed,row.singleRoomsRequested,row.singleRoomsApproved,row.singleRoomsPending,row.quotaExemptSingleRooms].map((value,i)=><td key={i} className="px-2 py-1 text-right tabular-nums">{value}</td>)}</tr>)}
       <tr className="font-bold"><th scope="row" className="px-2 py-1 text-left">Σ M/W</th>{[group.athletes,totals.officialQuota,totals.singleRoomsAllowed,totals.singleRoomsRequested,totals.singleRoomsApproved,totals.singleRoomsPending,totals.quotaExemptSingleRooms].map((value,i)=><td key={i} className="px-2 py-1 text-right tabular-nums">{value}</td>)}</tr>
      </tbody></table></div>
     </details></td></tr>
    </Fragment>;
   })}</tbody>
  </table></div>

  <details className="text-xs text-[var(--ops-text-muted)]"><summary className="cursor-pointer">Zuordnungen und Bewertungsgrundlage</summary><div className="mt-2 space-y-1">
   <p>¹ Eindeutige Officials je Event Group; Gruppenwerte nicht addieren. EZ-Anspruch in den Details: Summe der M/W-Kontexte, kein übertragbares Kontingent.</p>
   {nation.officialsInMultipleGroups>0&&(onPeople?<button type="button" onClick={()=>onPeople({nation:nation.nationCode,role:'officials',multipleGroups:true})} className="text-[var(--ops-primary)] underline">{nation.officialsInMultipleGroups} Mehrfachzugehörigkeiten · Personen anzeigen</button>:<p>{nation.officialsInMultipleGroups} Mehrfachzugehörigkeiten</p>)}
   <p>{nation.ezDecisionsOpen} {nation.ezDecisionsOpen===1?'offener EZ-Kontext':'offene EZ-Kontexte'} · Kontexte sind keine Personenzahl.</p>
   {nation.coverageReviewRequired&&<p>Officials-Abdeckung nicht abschließend bewertet; keine bestätigte Quotenverletzung.</p>}
  </div></details>

  {nation.officialsWithoutContext>0&&<p className="text-xs text-[var(--ops-warning)]"><PeopleCount count={nation.officialsWithoutContext} filter={{nation:nation.nationCode,role:'people',personKeys:withoutContext}} onPeople={control?onPeople:undefined} label="Officials ohne Quotenkontext anzeigen"/> Officials ohne eindeutigen Quotenkontext</p>}
 </div>;
}
export function QuotaOverviewContent({overview,kind,control,preview,onPeople,focusSport}:{overview:QuotaOverview;kind:'athlete'|'officials';control?:ImportControl;preview?:FisImportPreview;onPeople?:Navigate;focusSport?:boolean}) {
 return <div className="space-y-4"><div className="flex flex-wrap gap-2 text-xs"><span>{overview.event.isWorldChampionship?'WM-Quotenregel':'Event-Quotenregel (Nicht-WM)'} · Revision {overview.event.rulesRevision} · {overview.event.rulesFixed?'fixiert':'Entwurf'}</span></div>
  {overview.nations.map(nation=><section key={nation.nationCode} className="space-y-2" aria-label={`Nation ${nation.nationCode}`}><h3 className="text-sm font-extrabold">Nation {nation.nationCode||'unbekannt'}</h3>{kind==='athlete'?<AthleteOverview nation={nation} fixed={overview.event.rulesFixed} control={control} preview={preview} onPeople={onPeople} focusSport={focusSport}/>:<OfficialsOverview nation={nation} fixed={overview.event.rulesFixed} onPeople={onPeople} preview={preview} control={control}/>}</section>)}
 </div>;
}
export function QuotaOverviewDialog({preview,kind,onClose,control,onPeople,focusSport}:{preview:FisImportPreview|null;kind:'athlete'|'officials';onClose:()=>void;control?:ImportControl;onPeople?:Navigate;focusSport?:boolean}) {
 const overview=preview?.quotaOverview;
 return <EnterpriseDialog open title={kind==='athlete'?'Athleten-/Disziplinquote':'Officials & EZ-Quote'} description={overview?.event.name||'Gespeicherter Prüfstand'} size="large" onClose={onClose} actions={<OpsButton onClick={onClose}>Schließen</OpsButton>}>
  {overview?<QuotaOverviewContent overview={overview} kind={kind} control={control} preview={preview??undefined} onPeople={preview?onPeople:undefined} focusSport={focusSport}/>:<EmptyState title="Keine vollständigen Anzeigeaggregate gespeichert" description="Für diesen Prüfstand ist keine Quotenübersicht verfügbar."/>}
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
  return <StatusChip tone="success">Familienquote OK</StatusChip>;
}
