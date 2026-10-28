import {stayWindowText,stayWindowDetails} from '../services/stayWindow';
import {Fragment,useEffect,useRef,type ReactNode} from 'react';
import {sportClarifications} from '../services/importHints';
import type {QuotaPeopleFilter} from '../services/importHints';
import type {FisImportPreview,FisImportPreviewPerson,ImportControl} from '../types';
import type {ImportSession} from '../data/importSessions';
import {ContentCard,EnterpriseDialog,OpsButton,SectionHeader,StatusChip} from '../design-system';
import {disciplineDisplayName} from '../services/competitionPresentation';
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
  <details className="text-xs text-[var(--ops-text-muted)]"><summary className="cursor-pointer font-bold">Technische Details und Quellen</summary><p className="mt-2">Entry List · Zeile {person.rowNumber} · For_gender: {value(person.forGender)}</p><p>Quotenkontexte: {row?.quotaContexts.map(c=>`${c.group} · ${c.gender}`).join('; ')||'Nicht hinterlegt'}</p><p>Unterkunft: {value(person.accommodationRequirementSource)} · Tarif: {value(person.accommodationRateSource)}</p>{rooms.map((r,i)=><p key={i}>Room List · Zeile {r.rowNumber}: {r.roomType} · {value(r.checkInDate)} – {value(r.checkOutDate)} · Partnerangabe: {value(r.sharedWithRawName)}</p>)}</details>
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
 const competitions=control.competitions.filter(c=>people.some(p=>p.competitions.some(m=>m.id===c.id)));
 if(!competitions.length)return null;
 const reviewIds=new Set(sportClarifications(control,nation).map(row=>row.id));
 const groups=[...new Set(competitions.map(c=>c.group))];
 const counts=(ids:Set<string>)=>{
  const members=people.filter(p=>p.competitions.some(c=>ids.has(c.id)));
  const personKeys=new Set(members.map(p=>p.personKey));
  const list=athletes.filter(p=>personKeys.has(p.matchKey));
  return [list.filter(p=>p.gender==='M').length,list.filter(p=>p.gender==='F'||p.gender==='W').length,list.length];
 };
 const cells=(ids:Set<string>,sport=false)=>counts(ids).map((n,i)=>{
  const competition=sport&&i<2?competitions.find(c=>ids.has(c.id)&&(i===0?c.gender==='M':['F','W'].includes(c.gender??''))):undefined;
  const entry=competition?.sportEntries?.find(row=>row.nation===nation&&row.reported===n);
  const tone=entry?.unverifiedAdditional?'warning':'success';
  const text=entry?(entry.aboveRegular>0?(entry.unverifiedAdditional>0?`${entry.reported} / ${entry.regularMax} · Zusatzrecht prüfen`:`${entry.reported} inkl. WM`):`${entry.reported} / ${entry.regularMax} · OK`):null;
  const shortText=entry?(entry.aboveRegular>0?(entry.unverifiedAdditional>0?`${entry.reported}/${entry.regularMax} · prüfen`:`${entry.reported} WM`):`${entry.reported}/${entry.regularMax}`):null;
  const chip=<StatusChip tone={tone}><span className="sm:hidden">{shortText}</span><span className="hidden sm:inline">{text}</span></StatusChip>;
  const hint=entry?`Numerische Plausibilität; endgültige FIS-Zuteilung nicht bestätigt.${entry.sharedPoolReported!==null?` Gemeinsamer Slopestyle-/Big-Air-Pool: ${entry.sharedPoolReported} eindeutige ${i===0?'Männer':'Frauen'}.`:''}${entry.champions.length?` Titelquelle: ${entry.champions.map(c=>c.source).join(', ')}`:''}`:undefined;
  return <td key={i} className="px-1 py-1 text-right tabular-nums sm:px-2 [&_[data-tone]]:px-1 sm:[&_[data-tone]]:px-2">
   {entry&&text?<span title={hint}>{onPeople&&nation?<button type="button" className="text-right" aria-label={`${competition?.name}: ${entry.reported} Athleten anzeigen`} onClick={()=>onPeople({nation,role:'athletes',personKeys:entry.personKeys,competition:competition?.name})}>{chip}</button>:chip}</span>:n}
  </td>;
 });
 return <div ref={tableRef} className="min-w-0 overflow-x-auto" role="region" tabIndex={0} aria-label="Wettbewerbsteilnehmer – Tabelle horizontal scrollbar">
  <table className="w-full text-xs sm:text-sm"><caption className="pb-2 text-left text-xs text-[var(--ops-text-muted)]">Sportliche Meldungen · FIS-Zuteilung nicht bestätigt</caption>
   <thead><tr>{['Disziplin / Wettbewerb','Männer','Frauen','Gesamt'].map((label,i)=><th key={label} scope="col" className={`ops-table-wrap px-1 py-2 sm:px-2 ${i?'text-right':'text-left'}`}>{label}</th>)}</tr></thead>
   <tbody>{groups.map(group=>{
    const list=competitions.filter(c=>c.group===group);
    const names=[...new Set(list.map(c=>disciplineDisplayName(c.name)))];
    return <Fragment key={group??'unknown'}>
     <tr className="border-t border-[var(--ops-divider)] font-bold"><th scope="row" className="ops-table-wrap px-1 py-2 text-left sm:px-2">{group||'Nicht zugeordnet'}</th>{cells(new Set(list.map(c=>c.id)))}</tr>
     {names.map(name=><tr key={name} data-sport-review={list.some(c=>disciplineDisplayName(c.name)===name&&reviewIds.has(c.id))} className={focusSport&&list.some(c=>disciplineDisplayName(c.name)===name&&reviewIds.has(c.id))?'bg-[var(--ops-tone-warning-surface)]':undefined}><th scope="row" className="ops-table-wrap py-1 pl-3 pr-1 text-left font-normal sm:pl-5 sm:pr-2">{name}</th>{cells(new Set(list.filter(c=>disciplineDisplayName(c.name)===name).map(c=>c.id)),true)}</tr>)}
    </Fragment>;
   })}</tbody>
  </table>
  <p className="mt-2 text-xs text-[var(--ops-text-muted)]">Numerische Plausibilität, keine Startfreigabe · Eindeutige Athleten je Zeile · Wettbewerbe nicht addieren.</p>
 </div>;
}
