import {Fragment,useState,type ReactNode} from 'react';
import type {FisImportPreview,FisImportPreviewPerson,ImportControl,ImportControlKind} from '../types';
import type {ImportSession} from '../data/importSessions';
import {ContentCard,EnterpriseDialog,InfoPanel,OpsButton,SectionHeader,StatusChip} from '../design-system';
import {disciplineDisplayName} from '../services/competitionPresentation';
import {AccommodationRateProvenance} from './AthleteTariffSelection';

export const visibleControlIssues=(control:ImportControl)=>control.issues.filter(issue=>issue.code!=='MULTIPLE_MEMBERSHIPS');
export const controlLabels={error:'Importfehler',clarification:'Klärungsbedarf',info:'Informationen'} as const;
const sourceLabel=(source?:string|null)=>({MANUAL:'Manuell festgelegt',IMPORT:'Import',DEFAULT:'Standardwert',APPROVAL:'Genehmigung',AUTO_REFERENCE:'Automatische Titelreferenz',MANUAL_SET:'Manuell gesetzt',MANUAL_REMOVE:'Manuell entfernt'}[source??''] ?? source ?? 'Nicht hinterlegt');
const value=(text?:string|null)=>text||'Nicht angegeben';
const entitlement=(status?:string|null)=>({IN_QUOTA:'Regulär abgedeckt',APPROVED_EXTRA:'Zusätzliches EZ genehmigt',APPROVAL_REQUIRED:'EZ-Genehmigung offen',QUOTA_EXEMPT:'EZ-Quoten-Ausnahme'}[status??''] ?? 'Keine EZ-Bewertung hinterlegt');
export function ControlCounters({control,onFilter}:{control:ImportControl;onFilter:(kind:ImportControlKind)=>void}) {
 return <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Importkontrolle"><span className="font-bold">Importkontrolle</span>{(['error','clarification','info'] as const).map(kind=><button key={kind} type="button" onClick={()=>onFilter(kind)} className="rounded-lg border border-[var(--ops-border)] px-2 py-1.5 hover:bg-[var(--ops-surface-overlay)]">{visibleControlIssues(control).filter(i=>i.kind===kind).length} {controlLabels[kind]}</button>)}</div>;
}
export function ControlIssues({control,filter,preview,onPerson}:{control:ImportControl;filter:ImportControlKind|'all';preview:FisImportPreview;onPerson:(key:string)=>void}) {
 const issues=visibleControlIssues(control).filter(i=>filter==='all'||i.kind===filter);const people=new Map(preview.people.map(p=>[p.matchKey,p]));
 return <details key={filter} className="mb-3 rounded-lg border border-[var(--ops-border)] p-3"><summary className="cursor-pointer text-sm font-bold">{issues.length} Kontrollhinweise{filter==='all'?'':` · ${controlLabels[filter]}`}</summary><ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm">{issues.map((issue,index)=><li key={index} className="border-t border-[var(--ops-divider)] py-2"><StatusChip tone={issue.kind==='error'?'error':issue.kind==='clarification'?'warning':'info'}>{controlLabels[issue.kind]}</StatusChip><p className="mt-1">{issue.message}</p><p className="text-xs text-[var(--ops-text-muted)]">{issue.source}{issue.row?` · Zeile ${issue.row}`:''}{issue.kind!=='error'?' · Keine zusätzliche Importsperre':''}</p>{issue.personKeys.map(key=><button type="button" key={key} onClick={()=>onPerson(key)} className="mr-3 text-xs font-bold text-[var(--ops-primary)]">{people.get(key)?.firstname} {people.get(key)?.lastname} → Details</button>)}</li>)}</ul></details>;
}
function Fact({label,children}:{label:string;children:ReactNode}) {return <div className="min-w-0"><dt className="text-xs text-[var(--ops-text-muted)]">{label}</dt><dd className="break-words text-sm">{children}</dd></div>;}
export function PersonControlDetails({person,preview,control}:{person:FisImportPreviewPerson;preview:FisImportPreview;control?:ImportControl}) {
 const row=control?.people.find(r=>r.personKey===person.matchKey);
 const rooms=preview.rooms.filter(r=>r.person1Key===person.matchKey||r.person2Key===person.matchKey);
 const partners=rooms.map(r=>{const key=r.person1Key===person.matchKey?r.person2Key:r.person1Key;const mate=preview.people.find(p=>p.matchKey===key);return mate?`${mate.firstname} ${mate.lastname}`:r.sharedWithRawName;}).filter(Boolean);
 const issues=control?visibleControlIssues(control).filter(i=>i.kind!=='info'&&i.personKeys.includes(person.matchKey)):[];
 return <div className="space-y-4 [overflow-wrap:anywhere] [&_h2]:text-sm sm:[&_h2]:text-base [&_h2]:tracking-normal">
  {issues.map((issue,index)=><p key={index} className="text-sm text-[var(--ops-warning)]">{issue.message}</p>)}
  <ContentCard className="space-y-3 p-4"><SectionHeader title="Person und Wettbewerbe"/><dl className="grid gap-3 sm:grid-cols-2"><Fact label="Funktion">{value(person.function)}</Fact><Fact label="Persönliches Geschlecht">{value(person.gender)}</Fact></dl><details><summary className="cursor-pointer text-sm font-bold">Quotenkontexte und Quellen</summary><dl className="mt-2 grid gap-3 sm:grid-cols-2"><Fact label="Entry List">Zeile {person.rowNumber}</Fact><Fact label="For_gender · Entry-Quellangabe">{value(person.forGender)}</Fact><Fact label="Tatsächlich berücksichtigte Quotenkontexte">{row?.quotaContexts.length?row.quotaContexts.map(c=>`${c.group} · ${c.gender}`).join('; '):'Keine eindeutige Zuordnung hinterlegt'}</Fact></dl></details>
  <h4 className="text-sm font-bold">Wettbewerbe</h4><ul className="space-y-1 text-sm">{row?.competitions.map(c=><li key={c.id}>{c.name} <span className="text-[var(--ops-text-muted)]">· {c.group}</span></li>)}</ul>{!row?.competitions.length&&<p className="text-sm">Keine aufgelösten Wettbewerbsdetails hinterlegt.</p>}
  {(person.function||'').toLowerCase()==='athlete'&&<details><summary className="cursor-pointer text-sm font-bold">Athletenquoten nachvollziehen</summary><div className="text-sm">{preview.athleteQuotaChecks?.filter(q=>person.athleteQuotaFamilies?.includes(q.topLevelDiscipline)).map(q=><p key={q.topLevelDiscipline}>{q.topLevelDiscipline==='Freestyle'?'Freestyle / Freeski':q.topLevelDiscipline}: Person zählt einmal. Nation: {q.athleteQuotaUsed} / {q.athleteQuotaLimit}; Männer {q.athleteGenderUsed.M}, Frauen {q.athleteGenderUsed.F} / jeweils {q.athleteGenderLimit}.</p>)}<p className="mt-1 text-xs text-[var(--ops-text-muted)]">Eine Mengenüberschreitung allein bestimmt keine kostenpflichtige Person. Es gelten die vorhandenen expliziten Genehmigungen.</p></div></details>}
  </ContentCard>
  <ContentCard className="space-y-3 p-4"><SectionHeader title="Unterkunft und Tarif"/><dl className="grid gap-3 sm:grid-cols-2"><Fact label="Effektiver Unterkunftsbedarf">{person.accommodationRequirement==='NO_ROOM'?'Kein Zimmer benötigt':'Unterkunft benötigt'}</Fact><Fact label="Unterkunftstarif">{person.accommodationRateCategory==='SPECIAL'?'Sondertarif':'Standard'}</Fact><Fact label="Zimmerwunsch">{value(person.roomType)}</Fact><Fact label="Partner">{partners.length?[...new Set(partners)].join('; '):value(person.sharedWithName)}</Fact><Fact label="Aufenthalt">{value(person.arrivalDate)} – {value(person.departureDate)}</Fact><Fact label="EZ-Bewertung">{entitlement(person.singleRoomEntitlement)}</Fact></dl>
  <details><summary className="cursor-pointer text-sm font-bold">Unterkunftsquellen und Room List</summary><p className="mt-2 text-xs">EZ-Kontext: {person.singleRoomAllocation?.context?.join(' / ')||'Nicht hinterlegt'} · Unterkunft: {sourceLabel(person.accommodationRequirementSource)} · Tarif: {sourceLabel(person.accommodationRateSource)}</p><AccommodationRateProvenance person={person}/>
  {rooms.map((r,index)=>{const partner=r.person1Key===person.matchKey?r.person2Key:r.person1Key;const mate=preview.people.find(p=>p.matchKey===partner);return <div key={index} className="rounded-lg border border-[var(--ops-border)] p-3 text-sm"><strong>Room List · Zeile {r.rowNumber} · Hauptperson: {r.person1Name}</strong><p>Zimmerwunsch: {value(r.roomType)} · {value(r.checkInDate)} – {value(r.checkOutDate)}</p><p>Originale Partnerangabe: {value(r.sharedWithRawName)}</p><p>Zuordnung: {partner?mate?`${mate.firstname} ${mate.lastname} · eindeutig zugeordnet`:'Personenschlüssel zugeordnet; Details fehlen':r.sharedWithRawName?'Angegeben, nicht eindeutig zugeordnet':'Kein Partner zugeordnet'}</p></div>;})}
  {!rooms.length&&<p className="text-sm">{preview.warnings.some(w=>w.code==='ROOM_LIST_NO_DATA')?'Room List enthält keine Unterkunftsdaten.':'Keine zugeordnete Room-List-Zeile vorhanden.'} Daraus allein wird kein No room abgeleitet.</p>}
  </details></ContentCard>
  {(person.singleRoomQuotaExemptReason||person.worldChampionReferences?.length)&&<ContentCard className="space-y-3 p-4"><SectionHeader title="EZ-Ausnahme"/><p className="text-sm">{person.singleRoomQuotaExemptReason==='WORLD_CHAMPION'?`Weltmeister-EZ-Ausnahme · ${sourceLabel(person.singleRoomExemptionSource)}`:person.singleRoomQuotaExemptReason==='OTHER'?'Historische EZ-Ausnahme':'Titelreferenz vorhanden'}</p>{person.worldChampionReferences?.map((r,index)=><p key={index} className="text-sm">Titelreferenz: {r.discipline||'Disziplin nicht hinterlegt'} · {r.championship} {r.championshipYear} · Quelle: {r.source||'Nicht hinterlegt'}</p>)}{person.singleRoomQuotaExemptReason==='WORLD_CHAMPION'&&!person.worldChampionReferences?.length&&<p className="text-sm">Keine eindeutige Titel-/Disziplinreferenz hinterlegt. Manuelle oder historische Ausnahme gesondert nachvollziehen.</p>}<details><summary className="cursor-pointer text-sm font-bold">Titelreferenz und Geltungsbereich</summary><InfoPanel tone="info" title="Kein Nachweis eines sportlichen Startrechts">Die hier angezeigte Weltmeister-Ausnahme betrifft die Unterkunfts-/EZ-Bewertung. Sportliche Startrechte und disziplinspezifische Athleten-Ausnahmen werden hier nicht geprüft.</InfoPanel></details></ContentCard>}
  {row?.internalNote&&<InfoPanel tone="info" title="Vorhandene interne Personennotiz"><p className="whitespace-pre-wrap">{row.internalNote}</p></InfoPanel>}
 </div>;
}
export function ImportPersonDialog({person,preview,session,onClose,onNote}:{person:FisImportPreviewPerson;preview:FisImportPreview;session:ImportSession|null;onClose:()=>void;onNote:(description:string)=>Promise<void>}) {
 const [text,setText]=useState(''),[prefix,setPrefix]=useState('Rückfrage erforderlich'),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const save=async()=>{setBusy(true);setError(null);try{await onNote(`${prefix} · ${person.firstname} ${person.lastname} · Referenz ${person.matchKey}\n${text}`);setText('');}catch(e){setError(e instanceof Error?e.message:'Notiz konnte nicht gespeichert werden.');}finally{setBusy(false);}};
 return <EnterpriseDialog open title={`${person.firstname} ${person.lastname}`} description="Importkontrolle" size="large" onClose={()=>{if(!busy)onClose();}} actions={<OpsButton disabled={busy} onClick={onClose}>Schließen</OpsButton>}>
  <PersonControlDetails person={person} preview={preview} control={session?.importControl}/>
  <section className="mt-4 space-y-3 [overflow-wrap:anywhere] [&_h2]:text-sm sm:[&_h2]:text-base [&_h2]:tracking-normal"><SectionHeader title="Interne Rückfrage zur Meldung"/>{error&&<InfoPanel tone="error" title="Notiz nicht gespeichert">{error}</InfoPanel>}<label className="block text-sm">Notizvorlage<select value={prefix} onChange={e=>setPrefix(e.target.value)} className="mt-1 block w-full rounded border border-[var(--ops-border)] bg-[var(--ops-background)] p-2">{['Rückfrage erforderlich','Rückfrage erfolgt','Sachverhalt geklärt'].map(s=><option key={s}>{s}</option>)}</select></label><label className="block text-sm">Rückfragenotiz<textarea value={text} onChange={e=>setText(e.target.value)} className="mt-1 block w-full rounded border border-[var(--ops-border)] bg-[var(--ops-background)] p-2" rows={3}/></label><OpsButton disabled={busy||!text.trim()||!session} onClick={()=>void save()}>{busy?'Wird gespeichert …':'Notiz speichern'}</OpsButton><details><summary className="cursor-pointer text-sm font-bold">Notizen zur gesamten Meldung · Versionshistorie</summary>{session?.history.filter(e=>e.type==='NOTE').map(e=><div key={e.id} className="mt-2 border-t border-[var(--ops-divider)] pt-2 text-xs"><p>{e.user} · {e.timestamp}</p><p className="whitespace-pre-wrap">{e.description}</p></div>)}<p className="mt-2 text-xs text-[var(--ops-text-muted)]">Ältere Notizen bleiben erhalten und werden nicht automatisch einer neuen Person zugeordnet. Eine Notiz verändert weder Quelldaten noch bestehende Prüfhinweise.</p></details></section>
 </EnterpriseDialog>;
}
export function CompetitionDistribution({control,preview,nation}:{control?:ImportControl;preview?:FisImportPreview;nation?:string}) {
 if(!control||!preview)return null;
 const athletes=preview.people.filter(p=>p.function?.toLowerCase()==='athlete'&&(!nation||p.nationCode===nation));
 const keys=new Set(athletes.map(p=>p.matchKey));
 const people=control.people.filter(p=>keys.has(p.personKey));
 const competitions=control.competitions.filter(c=>people.some(p=>p.competitions.some(m=>m.id===c.id)));
 if(!competitions.length)return null;
 const groups=[...new Set(competitions.map(c=>c.group))];
 const counts=(ids:Set<string>)=>{
  const members=people.filter(p=>p.competitions.some(c=>ids.has(c.id)));
  const personKeys=new Set(members.map(p=>p.personKey));
  const list=athletes.filter(p=>personKeys.has(p.matchKey));
  return [list.filter(p=>p.gender==='M').length,list.filter(p=>p.gender==='F'||p.gender==='W').length,list.length];
 };
 const cells=(ids:Set<string>)=>counts(ids).map((n,i)=><td key={i} className="px-2 py-1 text-right tabular-nums">{n}</td>);
 return <div className="min-w-0 overflow-x-auto" role="region" tabIndex={0} aria-label="Wettbewerbsteilnehmer – Tabelle horizontal scrollbar">
  <table className="w-full text-sm"><caption className="sr-only">Wettbewerbsteilnehmer nach Geschlecht</caption>
   <thead><tr>{['Disziplin / Wettbewerb','Männer','Frauen','Gesamt'].map((label,i)=><th key={label} scope="col" className={`px-2 py-2 ${i?'text-right':'text-left'}`}>{label}</th>)}</tr></thead>
   <tbody>{groups.map(group=>{
    const list=competitions.filter(c=>c.group===group);
    const names=[...new Set(list.map(c=>disciplineDisplayName(c.name)))];
    return <Fragment key={group??'unknown'}>
     <tr className="border-t border-[var(--ops-divider)] font-bold"><th scope="row" className="px-2 py-2 text-left">{group||'Nicht zugeordnet'}</th>{cells(new Set(list.map(c=>c.id)))}</tr>
     {names.map(name=><tr key={name}><th scope="row" className="py-1 pl-5 pr-2 text-left font-normal">{name}</th>{cells(new Set(list.filter(c=>disciplineDisplayName(c.name)===name).map(c=>c.id)))}</tr>)}
    </Fragment>;
   })}</tbody>
  </table>
  <p className="mt-2 text-xs text-[var(--ops-text-muted)]">Eindeutige Athleten je Zeile. Mehrfachstarts zählen je Wettbewerb; Unterzeilen sind nicht addierbar. Keine sportliche Startrechtsprüfung.</p>
 </div>;
}
