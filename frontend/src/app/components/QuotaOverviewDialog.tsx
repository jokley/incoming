import type {NNPlanningControls} from '../types';
import { sportAreaLabel } from '../services/competitionPresentation';
import {Fragment} from 'react';
import {CompetitionDistribution} from './ImportControl';
import type {ImportControl,FisImportPreview,QuotaOverview} from '../types';
import {groupImportItems,quotaImportPlacement,singleRoomSummary} from '../services/importHints';
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
function AthleteOverview({nn,grouped=false,nation,fixed,control,preview,onPeople,focusSport}:{nn?:NNPlanningControls;grouped?:boolean;nation:Nation;fixed:boolean;control?:ImportControl;preview?:FisImportPreview;onPeople?:Navigate;focusSport?:boolean}) {
 const incomplete=nation.incomplete||!fixed;
 return <div className="space-y-3">
  <CompetitionDistribution nn={nn} grouped={grouped} control={control} preview={preview} nation={nation.nationCode} onPeople={onPeople} focusSport={focusSport}/>
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
  {nn?.planning.operationalQuota?.conflict&&<p className="text-xs text-[var(--ops-warning)]">Personenauswahl klären · {nn.planning.operationalQuota.reasons.join(' ')}</p>}
  {nn?.planning.rows.some(area=>area.legacyForecastInactive)&&<p className="text-xs text-[var(--ops-text-muted)]">Frühere NN-Prognosen bleiben als Nachweis erhalten und sind nicht mehr operativ wirksam.</p>}
  {!nation.athleteFamilies.length&&<p className="text-sm">Keine aktive Athletenquote · Fachlich prüfen</p>}
 </div>;
}
function OfficialsOverview({nn,grouped=false,nation,fixed,onPeople,preview,control}: {nn?:NNPlanningControls;grouped?:boolean;nation:Nation;fixed:boolean;onPeople?:Navigate;preview?:FisImportPreview;control?:ImportControl}) {
 const operative=nn?.planning.operationalQuota;
 if(nn?.busy)return <p role="status">Operative Vorschau wird berechnet …</p>;
 if(nn&&(nn.error||!operative?.overview||!operative.people))return <p role="alert" className="text-[var(--ops-error)]">{nn.error??`Operative Bewertung nicht verfügbar. ${operative?.reasons.join(' ')??'Keine veralteten Quotenwerte.'}`}</p>;
 if(nn){
  const projected=operative!.overview!.nations.find(row=>row.nationCode===nation.nationCode);
  if(!projected)return <p>Keine gültigen operativen Quotenkontexte. Zuordnung klären.</p>;
  nation=projected;
 }
 const summaryPreview=nn?{people:operative!.people!,rooms:[]}:preview;
 const incomplete=nation.incomplete||!fixed;

 const ez=summaryPreview?singleRoomSummary(summaryPreview,nation.nationCode):null;
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
  {nn&&<p className="text-xs text-[var(--ops-text-muted)]">Operative Unterkunftsbewertung · Originalmeldungen bleiben erhalten. Automatische vorläufige Personenauswahl aus der bestätigten Entry List.</p>}
  {nn&&operative?.conflict&&<p className="text-xs text-[var(--ops-warning)]">Personenauswahl klären · normale Athletenbasis. {operative.reasons.join(' ')}</p>}
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Officials-Gesamtergebnis">
   <span><PeopleCount count={nation.officials} filter={{nation:nation.nationCode,role:'officials'}} onPeople={onPeople} label={`Alle Officials ${nation.nationCode} anzeigen`}/> eindeutige Officials</span>

  </div>
  <p className="text-sm" aria-label="EZ-Gesamtbewertung">EZ · Erlaubt: <span title="Reguläre Ansprüche gelten ausschließlich im jeweiligen Event-Group-/Gender-Kontext.">kontextgebunden</span> · Angefragt: {ez?.available?<PeopleCount count={ez.requested} filter={{nation:nation.nationCode,role:'people',personKeys:ez.allPersonKeys}} onPeople={onPeople} label="Angeforderte EZ-Personen anzeigen"/>:'—'} · Abweichung: <strong className={ez?.counts.PENDING?'text-[var(--ops-warning)]':'text-[var(--ops-text)]'}>{ez?.available?(ez.counts.PENDING?`+${ez.counts.PENDING}`:'0'):'—'}</strong>{(!ez?.complete||incomplete)&&<span className="ml-2 text-[var(--ops-warning)]">Zuordnung oder Evidenz unvollständig</span>}</p>
  <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Officials und EZ je Event Group"><table className="w-full text-xs sm:text-sm">
   <caption className="sr-only">Kontextgebundene Officials- und EZ-Bewertung</caption>
   <thead><tr><th rowSpan={2} scope="col" className="p-2 text-left">Event Group / Gender</th><th colSpan={3} scope="colgroup" className="p-2">Officials</th><th colSpan={3} scope="colgroup" className="p-2">Einzelzimmer</th></tr><tr>{['Erlaubt','Vorhanden','Abweichung','Erlaubt','Angefragt','Abweichung'].map((label,index)=><th scope="col" key={index} className="p-2 text-right">{label}</th>)}</tr></thead>
   <tbody>{(grouped?groupImportItems(nation.groups,group=>({area:quotaImportPlacement(group.name,control).area})):[{area:'',items:nation.groups}]).map(section=><Fragment key={section.area}>{grouped&&<tr><th scope="rowgroup" colSpan={7} className="bg-[var(--ops-surface-elevated)] p-2 text-left">{section.area}</th></tr>}{section.items.map(group=><Fragment key={group.name}>
    <tr className="border-t border-[var(--ops-divider)]"><th scope="rowgroup" colSpan={7} className="p-2 text-left">{group.name}<span className="ml-2 text-xs font-normal text-[var(--ops-text-muted)]"><PeopleCount count={group.officials} filter={{nation:nation.nationCode,role:'officials',group:group.name}} onPeople={onPeople} label={`Officials ${group.name} anzeigen`}/> eindeutige Officials</span></th></tr>
    {group.contexts.map(row=><tr key={row.gender}>
     <th scope="row" className="p-2 text-left font-normal" title={`${row.expectedAthletes??row.athletes} für Unterkunft eingeplant; ${row.athletesEntered??row.athletes} FIS-gemeldet`}>{genderName(row.gender)}</th>
     <td className={numberCell}>{row.officialQuota}</td><td className={numberCell}>{row.registeredOfficials??row.officials}</td><td className={`${numberCell} ${row.officialsDeviation?'text-[var(--ops-warning)]':''}`}>{row.officialsDeviation==null?'—':row.officialsDeviation?`+${row.officialsDeviation}`:0}</td>
     <td className={numberCell}>{row.singleRoomsAllowed}</td><td className={numberCell}>{row.singleRoomsRequested}</td><td className={`${numberCell} ${row.singleRoomsPending?'font-bold text-[var(--ops-warning)]':''}`}>{row.singleRoomsPending?`+${row.singleRoomsPending}`:0}</td>
    </tr>)}
    <tr><td colSpan={7} className="px-2 pb-2"><details className="text-xs"><summary className="cursor-pointer text-[var(--ops-text-muted)]">{group.name} · Deckung und Genehmigungen</summary>
     {group.contexts.map(row=><p key={row.gender}>{genderName(row.gender)}: {row.expectedAthletes??row.athletes} für Unterkunft eingeplant · Berechnungsbasis EZ {row.singleRoomOfficialBasis??'—'} · {row.singleRoomsApproved} zusätzlich genehmigt · {row.quotaExemptSingleRooms??0} Ausnahmen{row.nnForecastBlocked?' · Auswahl ungeklärt; normale Basis':''}</p>)}
     {breakdown(summaryPreview?singleRoomSummary({...summaryPreview,people:summaryPreview.people.filter(p=>p.singleRoomAllocation?.context?.[1]===group.name),rooms:[]},nation.nationCode):null,group.name)}
    </details></td></tr>
   </Fragment>)}</Fragment>)}</tbody>
  </table></div>

  <details className="text-xs text-[var(--ops-text-muted)]"><summary className="cursor-pointer">Zuordnungen und Bewertungsgrundlage</summary><div className="mt-2 space-y-1">
   <p>Officials national und je Event Group sind eindeutige Personen. Kontextzahlen nicht als Personen addieren. EZ-Ansprüche sind nicht pauschal zwischen Gruppen oder Gendern übertragbar.</p>
   {breakdown(ez)}
   {(nation.otherPeople??0)>0&&<p>{nation.otherPeople} weitere / unzugeordnete Personen</p>}
   {nation.officialsInMultipleGroups>0&&(onPeople?<button type="button" onClick={()=>onPeople({nation:nation.nationCode,role:'officials',multipleGroups:true})} className="text-[var(--ops-primary)] underline">{nation.officialsInMultipleGroups} Mehrfachzugehörigkeiten · Personen anzeigen</button>:<p>{nation.officialsInMultipleGroups} Mehrfachzugehörigkeiten</p>)}
   <p>{nation.ezDecisionsOpen} {nation.ezDecisionsOpen===1?'offener EZ-Kontext':'offene EZ-Kontexte'} · Kontexte sind keine Personenzahl.</p>
   {nation.coverageReviewRequired&&<p>Officials-Abdeckung nicht abschließend bewertet; keine bestätigte Quotenverletzung.</p>}
  </div></details>

  {nation.officialsWithoutContext>0&&<p className="text-xs text-[var(--ops-warning)]"><PeopleCount count={nation.officialsWithoutContext} filter={{nation:nation.nationCode,role:'people',personKeys:withoutContext}} onPeople={control?onPeople:undefined} label="Officials ohne Quotenkontext anzeigen"/> Officials ohne eindeutigen Quotenkontext</p>}
 </div>;
}
export function QuotaOverviewContent({nn,grouped=false,overview,kind,control,preview,onPeople,focusSport}:{nn?:NNPlanningControls;grouped?:boolean;overview:QuotaOverview;kind:'athlete'|'officials';control?:ImportControl;preview?:FisImportPreview;onPeople?:Navigate;focusSport?:boolean}) {
 const ruleEvent=kind==='officials'?nn?.planning.operationalQuota?.overview?.event??overview.event:overview.event;
 return <div className="space-y-4"><div className="flex flex-wrap gap-2 text-xs"><span>{ruleEvent.isWorldChampionship?'WM-Quotenregel':'Event-Quotenregel (Nicht-WM)'} · Revision {ruleEvent.rulesRevision} · {ruleEvent.rulesFixed?'fixiert':'Entwurf'}</span></div>
  {overview.nations.map(nation=><section key={nation.nationCode} className="space-y-2" aria-label={`Nation ${nation.nationCode}`}><h3 className="text-sm font-extrabold">Nation {nation.nationCode||'unbekannt'}</h3>{kind==='athlete'?<AthleteOverview nn={nn} grouped={grouped} nation={nation} fixed={ruleEvent.rulesFixed} control={control} preview={preview} onPeople={onPeople} focusSport={focusSport}/>:<OfficialsOverview nn={nn} grouped={grouped} nation={nation} fixed={ruleEvent.rulesFixed} onPeople={onPeople} preview={preview} control={control}/>}</section>)}
 </div>;
}
export function QuotaOverviewDialog({nn,grouped=false,preview,kind,onClose,control,onPeople,focusSport}:{nn?:NNPlanningControls;grouped?:boolean;preview:FisImportPreview|null;kind:'athlete'|'officials';onClose:()=>void;control?:ImportControl;onPeople?:Navigate;focusSport?:boolean}) {
 const overview=preview?.quotaOverview;
 return <EnterpriseDialog open title={kind==='athlete'?'Athleten-/Disziplinquote':'Officials & EZ-Quote'} description={overview?.event.name||'Gespeicherter Prüfstand'} size="large" onClose={onClose} actions={<OpsButton onClick={onClose}>Schließen</OpsButton>}>
  {overview?<QuotaOverviewContent nn={nn} grouped={grouped} overview={overview} kind={kind} control={control} preview={preview??undefined} onPeople={preview?onPeople:undefined} focusSport={focusSport}/>:<EmptyState title="Keine vollständigen Anzeigeaggregate gespeichert" description="Für diesen Prüfstand ist keine Quotenübersicht verfügbar."/>}
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
