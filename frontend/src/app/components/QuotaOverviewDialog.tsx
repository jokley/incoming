import {CompetitionDistribution} from './ImportControl';
import type {ImportControl} from '../types';
import type { ReactNode } from 'react';
import { ContentCard, EmptyState, EnterpriseDialog, InfoPanel, OpsButton, SectionHeader, StatusChip } from '../design-system';
import type { FisImportPreview, QuotaExtent, QuotaOverview } from '../types';

type Nation = QuotaOverview['nations'][number];
type Family = Nation['athleteFamilies'][number];
const numberCell = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';
const familyName = (value:string) => value === 'Freestyle' ? 'Freestyle / Freeski' : value;
const genderName = (value:string) => value === 'M' ? 'Männer' : ['W','F'].includes(value) ? 'Frauen' : `Unbekannt (${value || '—'})`;

function Metrics({items}:{items:Array<{label:string;value:ReactNode;hint?:string}>}) {
  return <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{items.map(item=><div key={item.label} className="min-w-0 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-overlay)] px-3 py-2"><dt className="text-xs font-semibold text-[var(--ops-text-muted)]">{item.label}</dt><dd className="mt-1 text-lg font-extrabold tabular-nums">{item.value}</dd>{item.hint&&<p className="text-xs text-[var(--ops-text-muted)]">{item.hint}</p>}</div>)}</dl>;
}
function Extent({title,value}:{title:string;value?:QuotaExtent}) {
  return <div><h4 className="text-xs font-bold text-[var(--ops-text-muted)]">{title}</h4><dl className="mt-1 grid grid-cols-3 gap-2 text-sm">{(['total','M','F'] as const).map(key=><div key={key}><dt className="text-xs text-[var(--ops-text-muted)]">{key==='total'?'Gesamtgrenze':key==='M'?'Männergrenze':'Frauengrenze'}</dt><dd className="font-bold tabular-nums">{value?.[key] ?? '—'}</dd></div>)}</dl></div>;
}
function AthleteState({row,incomplete}:{row:Family;incomplete:boolean}) {
  if(incomplete || row.athleteQuotaStatus==='INCOMPLETE') return <StatusChip tone="warning">Quotendaten prüfen</StatusChip>;
  if(row.decisionStatus==='PENDING' || Object.values(row.uncoveredExtent??{}).some(n=>n>0)) return <StatusChip tone="warning">1 Entscheidung erforderlich</StatusChip>;
  if(row.decisionStatus==='APPROVED') return <StatusChip tone="info">Bereits genehmigt</StatusChip>;
  if(row.athleteQuotaStatus==='EXCEEDED') return <StatusChip tone="warning">Quotenbewertung prüfen</StatusChip>;
  return <StatusChip tone="success">Innerhalb der Quote</StatusChip>;
}
function AthleteOverview({nation,fixed}:{nation:Nation;fixed:boolean}) {
  const incomplete=nation.incomplete || !fixed;
  return <div className="space-y-4"><Metrics items={[
    {label:'Athleten gemeldet',value:nation.athletes,hint:'Eindeutige Personen, nicht Familienzeilen'},
    {label:'Reguläres Athletenlimit',value:nation.athleteFamilies.length===1?nation.athleteFamilies[0].athleteQuotaLimit:'Je Quotenfamilie',hint:'Keine Addition zu einem gemeinsamen Pool'},
    {label:'Zusätzlich genehmigte Athleten',value:nation.athletesApprovedDistinct ?? 'Umfang je Grenze',hint:nation.athletesApprovedDistinct===null?'Mengenfreigaben ergeben keine eindeutige Personenzahl.':undefined},
    {label:'Offene Entscheidungen',value:nation.athleteDecisionsOpen,hint:'Entscheidungsfälle der Athletenquote'},
  ]}/>
  {incomplete&&<InfoPanel tone="warning" title="Quotendaten prüfen">Unvollständige Zuordnungen oder noch nicht fixierte Regeln erlauben keinen grünen Gesamtstatus.</InfoPanel>}
  {nation.athleteFamilies.map(row=><ContentCard key={row.topLevelDiscipline} className="space-y-3 p-4"><SectionHeader title={familyName(row.topLevelDiscipline)} actions={<AthleteState row={row} incomplete={incomplete}/>}/>
    <p className="text-sm"><strong>{row.athleteQuotaUsed} Athleten gemeldet</strong> · Reguläres Limit: <strong>{row.athleteQuotaLimit}</strong></p>
    <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-[var(--ops-text-muted)]">Männer</dt><dd className="font-bold tabular-nums">{row.athleteGenderUsed.M} von {row.athleteGenderLimit}</dd></div><div><dt className="text-[var(--ops-text-muted)]">Frauen</dt><dd className="font-bold tabular-nums">{row.athleteGenderUsed.F} von {row.athleteGenderLimit}</dd></div></dl>
    <div className="grid gap-3 border-t border-[var(--ops-divider)] pt-3 md:grid-cols-2"><Extent title="Zusätzlich genehmigt" value={row.approvedExtent}/><Extent title="Noch ungedeckt" value={row.uncoveredExtent}/></div>
  </ContentCard>)}
  {!nation.athleteFamilies.length&&<InfoPanel tone="info" title="Keine aktive Athleten-/Disziplinquote">Für diese Meldung liegt kein berechneter Familienprüfstand vor. Ungeklärte Zuordnungen müssen separat geprüft werden.</InfoPanel>}
  <p className="text-xs text-[var(--ops-text-muted)]">Genehmigungen sind bereits in den gemeldeten Personen enthalten. Gesamt- und Geschlechtergrenzen können sich überschneiden; genehmigte Umfänge werden nicht zu einer Personenzahl addiert.</p></div>;
}
function OfficialsOverview({nation,fixed}:{nation:Nation;fixed:boolean}) {
  const review=nation.coverageReviewRequired || nation.incomplete || !fixed;
  return <div className="space-y-4"><Metrics items={[
    {label:'Athleten gesamt',value:nation.athletes},
    {label:'Officials gesamt',value:nation.officials,hint:'Eindeutige Personen in den Event Groups'},
    {label:nation.otherPeople?'Athleten + Officials':'Personen gesamt',value:nation.peopleInQuotaGroups,hint:'Personen nur einmal gezählt'},
    {label:'Offene Entscheidungen',value:nation.athleteDecisionsOpen+nation.ezDecisionsOpen,hint:`${nation.athleteDecisionsOpen} Athletenquote · ${nation.ezDecisionsOpen} EZ`},
  ]}/>
  {nation.otherPeople>0&&<InfoPanel tone="info" title={`Vollständige Meldung: ${nation.peopleTotal} Personen`}>{nation.otherPeople} weitere oder unzugeordnete Personen sind nicht in der Summe Athleten + Officials enthalten.</InfoPanel>}
  {review?<InfoPanel tone="warning" title="Quotenabdeckung fachlich zu prüfen">Eine rechnerische Abweichung ist kein Mehrpreisfall. Gruppenübergreifende Anrechnung wird hier nicht als genehmigt vorausgesetzt. Eine eindeutige Zahl „Officials ohne reguläre Abdeckung“ ist deshalb nicht ausgewiesen.</InfoPanel>:<InfoPanel tone={nation.ezDecisionsOpen?'warning':'success'} title={nation.ezDecisionsOpen?'EZ-Entscheidung erforderlich':'Keine offenen EZ-Entscheidungen'}>Die vorhandenen Quotenprüfungen ergeben {nation.ezDecisionsOpen?'offene EZ-Fälle.':'keinen Handlungsbedarf in diesen Kontexten.'}</InfoPanel>}
  {nation.groups.map(group=><ContentCard key={group.name} className="space-y-3 p-4"><SectionHeader title={group.name} actions={group.coverageReviewRequired?<StatusChip tone="warning">Quotenabdeckung prüfen</StatusChip>:undefined}/>
    <p className="text-sm"><strong>Officials gemeldet: {group.officials} eindeutige Personen</strong></p>
    <div className="overflow-x-auto" role="region" tabIndex={0} aria-label={`${group.name}: Männer, Frauen und Gesamt – horizontal scrollbar`}><table className="w-full min-w-[520px] text-sm"><caption className="sr-only">Quotenkontexte für {group.name}</caption><thead><tr>{['Geschlecht','Athleten','Officials-Basis','EZ-Anspruch','EZ angefordert'].map((label,index)=><th key={label} scope="col" className={`border-b border-[var(--ops-divider)] px-3 py-2 text-xs text-[var(--ops-text-muted)] ${index?'text-right':'text-left'}`}>{label}</th>)}</tr></thead><tbody>
    {group.contexts.map(row=><tr key={row.gender} className="border-b border-[var(--ops-divider)]"><th scope="row" className="px-3 py-2 text-left font-normal">{genderName(row.gender)}</th>{[row.athletes,row.officialQuota,row.singleRoomsAllowed,row.singleRoomsRequested].map((value,index)=><td key={index} className={numberCell}>{value}</td>)}</tr>)}
    <tr className="font-bold"><th scope="row" className="px-3 py-2 text-left">Gesamt</th>{[group.athletes,group.totals.officialQuota,group.totals.singleRoomsAllowed,group.totals.singleRoomsRequested].map((value,index)=><td key={index} className={numberCell}>{value}</td>)}</tr></tbody></table></div>
    <p className="text-xs text-[var(--ops-text-muted)]">Basis und EZ-Anspruch in „Gesamt“ sind rechnerische Summen der Gender-Kontexte, keine übertragbaren Kontingente.</p>
    <div className="flex flex-wrap gap-2 text-sm"><StatusChip tone={group.totals.singleRoomsPending?'warning':'info'}>{group.totals.singleRoomsPending?`${group.totals.singleRoomsPending} Personen mit offener EZ-Genehmigung`:'Keine offenen EZ-Entscheidungen'}</StatusChip><span>Genehmigte zusätzliche EZ: {group.totals.singleRoomsApproved}</span><span>EZ-Ausnahmen: {group.totals.quotaExemptSingleRooms}</span></div>
    <details className="text-xs text-[var(--ops-text-muted)]"><summary className="cursor-pointer font-semibold">Bewertung und Anfragen nachvollziehen</summary><p className="mt-2">EZ-Werte folgen der bestehenden Anfrage-/Belegungsprojektion einschließlich countsAsSingle, genehmigter zusätzlicher EZ und Weltmeisterausnahmen. Die Zimmerart wird nicht verändert. Officials werden in den aktiven Gender-Kontexten berücksichtigt, nicht zusätzlich als neue Personen angelegt.</p></details>
  </ContentCard>)}
  {nation.officialsInMultipleGroups>0&&<InfoPanel tone="info" title="Mehrfachzugehörigkeiten">{nation.officialsInMultipleGroups} Officials sind in {nation.groups.length===2?'beiden':'mehreren'} Event Groups gemeldet. Insgesamt wurden {nation.officials} unterschiedliche Officials erfasst.</InfoPanel>}
  {nation.officialsWithoutContext>0&&<InfoPanel tone="warning" title="Zuordnungen prüfen">{nation.officialsWithoutContext} Personen ohne gültigen Athleten-Quotenkontext. Daraus wird keine neue Genehmigung oder Gebührenregel abgeleitet.</InfoPanel>}
  </div>;
}
export function QuotaOverviewContent({overview,kind}:{overview:QuotaOverview;kind:'athlete'|'officials'}) {
  return <div className="space-y-6"><div className="flex flex-wrap gap-2"><StatusChip tone="neutral">{overview.event.isWorldChampionship?'WM-Quotenregel':'Event-Quotenregel (Nicht-WM)'}</StatusChip><StatusChip tone={overview.event.rulesFixed?'info':'warning'}>Revision {overview.event.rulesRevision} · {overview.event.rulesFixed?'fixiert':'Entwurf'}</StatusChip></div>
  {overview.nations.map(nation=><section key={nation.nationCode} className="space-y-3" aria-label={`Nation ${nation.nationCode}`}><h3 className="text-sm font-extrabold">Nation {nation.nationCode || 'unbekannt'}</h3>{kind==='athlete'?<AthleteOverview nation={nation} fixed={overview.event.rulesFixed}/>:<OfficialsOverview nation={nation} fixed={overview.event.rulesFixed}/>}</section>)}</div>;
}
export function QuotaOverviewDialog({preview,kind,onClose,control}:{preview:FisImportPreview|null;kind:'athlete'|'officials';onClose:()=>void;control?:ImportControl}) {
  const overview=preview?.quotaOverview;
  return <EnterpriseDialog open title={kind==='athlete'?'Athleten-/Disziplinquote':'Officials & EZ-Quote'} description={overview?`${overview.event.name} · Gemeldete Personen, reguläre Grenzen und bestehende Entscheidungen`:'Gespeicherter Prüfstand'} size="large" onClose={onClose} actions={<OpsButton onClick={onClose}>Schließen</OpsButton>}>
    {kind==='athlete'&&<CompetitionDistribution control={control}/>}
    {overview?<QuotaOverviewContent overview={overview} kind={kind}/>:<EmptyState title="Keine vollständigen Anzeigeaggregate gespeichert" description="Für diesen historischen Prüfstand liegt noch keine eindeutige Personenübersicht vor. Eine aktuelle Importprüfung ergänzt sie, ohne historische Genehmigungen umzuschreiben."/>}
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
