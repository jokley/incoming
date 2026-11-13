import {stayWindowText,stayWindowDetails} from '../services/stayWindow';
import {Fragment,useEffect,useRef,type ReactNode} from 'react';
import {sportClarifications} from '../services/importHints';
import type {QuotaPeopleFilter} from '../services/importHints';
import type {FisImportPreview,FisImportPreviewPerson,ImportControl} from '../types';
import type {ImportSession} from '../data/importSessions';
import {ContentCard,EnterpriseDialog,OpsButton,SectionHeader,StatusChip} from '../design-system';
import {disciplineDisplayName,sportAreaLabel} from '../services/competitionPresentation';
import {stayWindowNights} from '../services/stayWindow';

export const visibleControlIssues=(control:ImportControl)=>control.issues.filter(issue=>issue.code!=='MULTIPLE_MEMBERSHIPS');
const value=(text?:string|null)=>text||'Nicht angegeben';
const entitlement=(status?:string|null)=>({IN_QUOTA:'Regulär abgedeckt',APPROVED_EXTRA:'Zusätzliches EZ genehmigt',APPROVAL_REQUIRED:'EZ-Genehmigung offen',QUOTA_EXEMPT:'EZ-Quoten-Ausnahme'}[status??''] ?? 'Keine EZ-Bewertung hinterlegt');
function Fact({label,children}:{label:string;children:ReactNode}) {return <div className="min-w-0"><dt className="text-xs text-[var(--ops-text-muted)]">{label}</dt><dd className="break-words text-sm">{children}</dd></div>;}
export function PersonControlDetails({person,preview,control}:{person:FisImportPreviewPerson;preview:FisImportPreview;control?:ImportControl}) {
 const row=control?.people.find(r=>r.personKey===person.matchKey);
 const rooms=preview.rooms.filter(r=>r.person1Key===person.matchKey||r.person2Key===person.matchKey);
 const partners=rooms.map(r=>{const key=r.person1Key===person.matchKey?r.person2Key:r.person1Key;const mate=preview.people.find(p=>p.matchKey===key);return mate?`${mate.firstname} ${mate.lastname}`:r.sharedWithRawName?`${r.sharedWithRawName} (nicht zugeordnet)`:null;}).filter(Boolean);
 const issues=control?visibleControlIssues(control).filter(i=>i.kind!=='info'&&i.personKeys.includes(person.matchKey)):[];
 return <div className="space-y-3 [overflow-wrap:anywhere] [&_h2]:text-sm [&_h2]:tracking-normal">
  {stayWindowText(row?.stayWindow)&&<p className="text-sm text-[var(--ops-warning)]" title={stayWindowDetails(row?.stayWindow)}>{stayWindowText(row?.stayWindow)}<span className="block text-xs">{stayWindowNights(row?.stayWindow)}</span></p>}
  {issues.map((issue,index)=><p key={index} className="text-sm text-[var(--ops-warning)]">{issue.message}<span className="block text-xs text-[var(--ops-text-muted)]">{issue.source}{issue.row?` · Zeile ${issue.row}`:''}</span></p>)}
  <ContentCard className="space-y-2 p-3"><SectionHeader title="Person"/><dl className="grid gap-2 sm:grid-cols-2"><Fact label="Funktion">{value(person.function)}</Fact><Fact label="Geschlecht">{value(person.gender)}</Fact></dl><h4 className="text-sm font-bold">Wettbewerbe</h4><ul className="text-sm">{row?.competitions.map(c=><li key={c.id}>{c.name}</li>)}</ul></ContentCard>
  <ContentCard className="space-y-2 p-3"><SectionHeader title="Unterkunft"/><dl className="grid gap-2 sm:grid-cols-2">
   <Fact label="Unterkunftsbedarf">{person.accommodationRequirement==='NO_ROOM'?'No Room':'Unterkunft benötigt'}</Fact><Fact label="Zimmerwunsch">{value(person.roomType)}</Fact>
   <Fact label="Zimmerpartner">{partners.length?[...new Set(partners)].join('; '):person.sharedWithName||(/^double/i.test(person.roomType??'')?'Zimmerpartner fehlt':'Nicht angegeben')}</Fact>
   <Fact label="Aufenthalt">{value(person.arrivalDate)} – {value(person.departureDate)}</Fact><Fact label="Unterkunftstarif">{person.accommodationRateCategory==='SPECIAL'?'Sondertarif':'Standard'}</Fact><Fact label="EZ-Status">{entitlement(person.singleRoomEntitlement)}{person.singleRoomQuotaExemptReason?` · ${person.singleRoomQuotaExemptReason==='WORLD_CHAMPION'?'Weltmeister-EZ-Ausnahme':'EZ-Ausnahme'}`:''}</Fact>
   {row?.stayWindow?.eventStart&&<Fact label="Eventzeitraum / zulässige An- und Abreise">{row.stayWindow.eventStart} – {row.stayWindow.eventEnd}<br/>{row.stayWindow.allowedStart} – {row.stayWindow.allowedEnd}</Fact>}
  </dl></ContentCard>
  <details className="text-xs text-[var(--ops-text-muted)]"><summary className="cursor-pointer font-bold">Technische Details und Quellen</summary><p className="mt-2">{person.sourceRows?.map(s=>`Version ${s.version} · Zeile ${s.row??'–'}`).join('; ') || `Entry List · Zeile ${person.rowNumber}`} · For_gender: {value(person.forGender)}</p>{person.sourceIdentities?.map((i,index)=><p key={index}>{sportAreaLabel(i.family)} · Staff-ID {i.staffId} · {i.function} · Quellzeile {i.row??'—'}</p>)}<p>Quotenkontexte: {row?.quotaContexts.map(c=>`${c.group} · ${c.gender}`).join('; ')||'Nicht hinterlegt'}</p><p>Unterkunft: {value(person.accommodationRequirementSource)} · Tarif: {value(person.accommodationRateSource)}</p>{rooms.map((r,i)=><p key={i}>Room List · {r.sourceRows?.map(s=>`Version ${s.version} · Zeile ${s.row??'–'}`).join('; ') || `Zeile ${r.rowNumber}`}: {r.roomType} · {value(r.checkInDate)} – {value(r.checkOutDate)} · Partnerangabe: {value(r.sharedWithRawName)}</p>)}</details>
 </div>;
}
export function ImportPersonDialog({person,preview,session,onClose}:{person:FisImportPreviewPerson;preview:FisImportPreview;session:ImportSession|null;onClose:()=>void}) {
 return <EnterpriseDialog open title={`${person.firstname} ${person.lastname}`} size="large" onClose={onClose} actions={<OpsButton onClick={onClose}>Schließen</OpsButton>}><PersonControlDetails person={person} preview={preview} control={session?.importControl}/></EnterpriseDialog>;
}
export function CompetitionDistribution({control,preview,nation,onPeople,focusSport}:{control?:ImportControl;preview?:FisImportPreview;nation?:string;onPeople?:(filter:QuotaPeopleFilter)=>void;focusSport?:boolean}) {
 const tableRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(focusSport)tableRef.current?.querySelector('[data-sport-review="true"]')?.scrollIntoView({block:'center'});},[focusSport,control,nation]);
 if(!control||!preview)return null;
 const athletes=preview.people.filter(p=>p.function?.toLowerCase()==='athlete'&&(!nation||p.nationCode===nation));
 const keys=new Set(athletes.map(p=>p.matchKey));
 const people=control.people.filter(p=>keys.has(p.personKey));
 const participating=control.competitions.filter(c=>people.some(p=>p.competitions.some(m=>m.id===c.id)));
 // Pair display rows only; rule values and assessments remain server-owned.
 const competitions=control.competitions.filter(c=>participating.some(p=>p.group===c.group&&disciplineDisplayName(p.name)===disciplineDisplayName(c.name)));
 if(!competitions.length)return null;
 const reviewIds=new Set(sportClarifications(control,nation).map(row=>row.id));
 const groups=[...new Set(competitions.map(c=>c.group))];
 const counts=(ids:Set<string>)=>{
  const members=people.filter(p=>p.competitions.some(c=>ids.has(c.id)));
  const personKeys=new Set(members.map(p=>p.personKey));
  const list=athletes.filter(p=>personKeys.has(p.matchKey));
  return [list.filter(p=>p.gender==='M').length,list.filter(p=>p.gender==='F'||p.gender==='W').length,list.length];
 };
 const entries=(ids:Set<string>)=>[0,1].map(i=>{
  const competition=competitions.find(c=>ids.has(c.id)&&(i===0?c.gender==='M':['F','W'].includes(c.gender??'')));
  const entry=competition?.sportEntries?.find(row=>row.nation===nation);
  return {competition,reported:entry?.reported??counts(ids)[i],entry};
 });
 const cells=(ids:Set<string>)=>{
  const genders=entries(ids);
  const team=competitions.filter(c=>ids.has(c.id)).flatMap(c=>c.sportEntries??[]).find(row=>row.nation===nation&&row.status==='TEAM_RULE');
  const assessed=genders.filter(row=>row.reported>0);
  const review=assessed.some(({entry})=>entry?.status==='REVIEW_REQUIRED'||(entry?.unverifiedAdditional??0)>0||(entry?.sharedPoolUnverifiedAdditional??0)>0);
  const missing=!assessed.length||assessed.some(({entry})=>!entry?.status||entry.status==='INCOMPLETE'||entry.regularMax==null||(entry.aboveRegular>0&&!entry.unverifiedAdditional&&!entry.champions.length));
  const champion=assessed.some(row=>row.entry?.status==='TITLE_COVERED');
  const hint=[...(team?[team]:[]),...genders.flatMap(row=>row.entry?[row.entry]:[])].map(entry=>`${entry.reason??'Gespeicherte Sportbewertung.'} Endgültige FIS-Zuteilung nicht bestätigt.${entry.sharedPoolReported!==null?` Gemeinsamer Slopestyle-/Big-Air-Pool: ${entry.sharedPoolReported} eindeutige Personen dieses Geschlechts / ${entry.sharedPoolRegularMax??'—'} regulär.`:''}${entry.champions.length?` Titelquelle: ${entry.champions.map(c=>c.source).join(', ')}`:''}`).join(' ')||'Keine eindeutige gespeicherte Wettbewerbsbewertung.';
  const action=(label:string,personKeys:string[],description:string)=>onPeople&&nation&&personKeys.length?<button type="button" className="text-left underline decoration-dotted underline-offset-2" style={{fontSize:'inherit',fontWeight:'inherit'}} aria-label={description} onClick={()=>onPeople({nation,role:'athletes',personKeys})}>{label}</button>:label;
  const explanations=genders.filter(({entry,reported})=>reported>0&&entry&&entry.status!=='INCOMPLETE'&&(entry.unverifiedAdditional>0||(entry.sharedPoolUnverifiedAdditional??0)>0||(entry.aboveRegular>0&&entry.champions.length>0)||entry.status==='REVIEW_REQUIRED'));
  const chip=<StatusChip tone={team||missing?'neutral':review?'warning':'success'}><span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
   {team?'Teamwettbewerb – gesonderte Regel':<>
    {missing&&<span className="block">Bewertung unvollständig</span>}
    {!missing&&!review&&!champion&&'Innerhalb der Grenze'}
    {explanations.map(({entry,competition},i)=>{
     const title=entry.unverifiedAdditional>0?entry.championStarters:entry.aboveRegular;
     const gender=competition?.gender==='M'?'Männer':'Frauen';
     return <span key={i} className="block">{gender}: {title>0&&entry.champions.length>0&&<>{action(`${entry.regularMax} regulär + ${title} WM`,entry.champions.map(c=>c.personKey),`${competition?.name}: verifiziertes Weltmeisterrecht – Personen anzeigen`)}{entry.unverifiedAdditional>0?' · ':''}</>}
      {entry.unverifiedAdditional>0&&action(`${entry.unverifiedAdditional} zusätzliche ${entry.unverifiedAdditional===1?'Meldung':'Meldungen'} klären`,entry.personKeys,`${competition?.name}: zusätzliche Meldungen klären – Personen anzeigen`)}
      {(entry.sharedPoolUnverifiedAdditional??0)>0&&<span className="block">{action(entry.unverifiedAdditional>0?'Gemeinsamen Pool ebenfalls klären':`Gemeinsamer Pool: ${entry.sharedPoolUnverifiedAdditional} zusätzliche ${entry.sharedPoolUnverifiedAdditional===1?'Person':'Personen'} klären`,entry.poolPersonKeys??entry.personKeys,`${competition?.name}: gemeinsamen Pool klären – Personen anzeigen`)}</span>}
      {entry.status==='REVIEW_REQUIRED'&&!entry.unverifiedAdditional&&!entry.sharedPoolUnverifiedAdditional&&'Zusätzliche Meldungen klären'}
     </span>;
    })}
   </>}
  </span></StatusChip>;
  return <>
   {genders.map(({competition,reported,entry},i)=><td key={i} className="whitespace-nowrap px-1 py-1 text-right tabular-nums sm:px-2" title={hint}>
    {onPeople&&nation&&entry?<button type="button" className="font-bold text-[var(--ops-primary)] underline decoration-dotted" style={{fontSize:'inherit'}} aria-label={`${competition?.name}: ${reported} Athleten anzeigen`} onClick={()=>onPeople({nation,role:'athletes',personKeys:entry.personKeys,competition:competition?.name})}>{reported}</button>:reported} / {entry?.regularMax??'—'}
   </td>)}
   <td className="ops-table-wrap px-1 py-1 sm:px-2 [&_svg]:hidden sm:[&_svg]:block" title={hint}>{chip}</td>
  </>;
 };

 return <div ref={tableRef} className="min-w-0 overflow-x-auto" role="region" tabIndex={0} aria-label="Wettbewerbsteilnehmer – Tabelle horizontal scrollbar">
  <table className="w-full table-fixed text-[11px] sm:table-auto sm:text-sm"><caption className="pb-2 text-left text-xs text-[var(--ops-text-muted)]">Sportliche Meldungen · FIS-Zuteilung nicht bestätigt</caption>
   <colgroup><col className="w-[24%] sm:w-auto"/><col className="w-[18%] sm:w-auto"/><col className="w-[18%] sm:w-auto"/><col className="w-[40%] sm:w-auto"/></colgroup>
   <thead><tr><th scope="col" rowSpan={2} className="ops-table-wrap px-1 py-2 text-left sm:px-2">Wettbewerb</th><th scope="colgroup" colSpan={2} className="ops-table-wrap px-1 py-1 text-center font-normal sm:px-2">Gemeldet / regulär</th><th scope="col" rowSpan={2} className="ops-table-wrap px-1 py-2 text-left sm:px-2">Bewertung</th></tr><tr>{['Männer','Frauen'].map(label=><th scope="col" key={label} className="px-1 pb-2 text-right sm:px-2">{label}</th>)}</tr></thead>
   <tbody>{groups.map(group=>{
    const list=competitions.filter(c=>c.group===group);
    const names=[...new Set(list.map(c=>disciplineDisplayName(c.name)))];
    const groupCounts=counts(new Set(list.map(c=>c.id)));
    return <Fragment key={group??'unknown'}>
     <tr className="border-t border-[var(--ops-divider)]"><th scope="rowgroup" colSpan={4} className="ops-table-wrap px-1 py-2 text-left sm:px-2">{group||'Nicht zugeordnet'}<span className="ml-2 text-xs font-normal text-[var(--ops-text-muted)]">{groupCounts[2]} eindeutige Athleten · {groupCounts[0]} Männer · {groupCounts[1]} Frauen</span></th></tr>
     {names.map(name=><tr key={name} data-sport-review={list.some(c=>disciplineDisplayName(c.name)===name&&reviewIds.has(c.id))} className={list.some(c=>disciplineDisplayName(c.name)===name&&reviewIds.has(c.id))?'border-l-2 border-l-[var(--ops-warning)]':undefined}><th scope="row" className="ops-table-wrap py-1 pl-1 pr-1 text-left font-normal sm:pl-5 sm:pr-2">{name}</th>{cells(new Set(list.filter(c=>disciplineDisplayName(c.name)===name).map(c=>c.id)))}</tr>)}
    </Fragment>;
   })}</tbody>
  </table>
  <p className="mt-2 text-xs text-[var(--ops-text-muted)]">Keine FIS-Startfreigabe. Wettbewerbe nicht addieren.</p>
 </div>;
}
