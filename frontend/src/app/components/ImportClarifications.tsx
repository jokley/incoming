import type {FisImportPreview} from '../types';
import type {ImportSession} from '../data/importSessions';
import {familyLabel,findingFamilies,findingNextStep,sourceComparison,type ImportFinding} from '../services/importFindings';
import {ContentCard,OpsButton,SectionHeader,StatusChip} from '../design-system';

export function FindingEvidence({finding,preview,session}:{finding:ImportFinding;preview:FisImportPreview;session?:ImportSession}){
 const comparison=sourceComparison(finding,preview,session);
 return <div className="space-y-2 text-sm">
  {comparison.length>0&&<div className="grid gap-2 sm:grid-cols-2">{comparison.map((s,i)=><div key={i} className="min-w-0 rounded border border-[var(--ops-border)] p-2 [overflow-wrap:anywhere]">
   <strong>{s.family}</strong><p>{s.requirement}</p><p>{s.arrival} – {s.departure}</p><p className="text-xs text-[var(--ops-text-muted)]">Quellzeile {s.row??'—'}</p>
  </div>)}</div>}
  {finding.code==='IMPORT_SHARED_STAY_SECTIONS'&&<p>Das bestehende personenbezogene Bedarfsmodell hat nur ein Aufenthaltsfenster. Getrennte Abschnitte müssen geklärt werden; die Lücke wird nicht automatisch als Aufenthalt übernommen.</p>}
  <p><strong>Nächster Schritt:</strong> {findingNextStep(finding)}</p>
 </div>;
}

export function ImportClarifications({preview,session,findings,canWrite,onPerson,onPeople,onDecision,onQuestion,onExistingQuestion}:{
 preview:FisImportPreview;session:ImportSession;findings:ImportFinding[];canWrite:boolean;
 onPerson:(key:string)=>void;onPeople:(keys:string[])=>void;onDecision:(id:string)=>void;
 onQuestion:(keys:string[])=>void;onExistingQuestion:(id:string)=>void;
}){
 const pending=session.approvals.filter(a=>a.decision==='PENDING');
 const questions=session.nationClarifications?.items.filter(i=>i.state==='OPEN')??[];
 const groups=[['Importfehler',findings.filter(i=>i.kind==='error')],['Klärungsbedarf',findings.filter(i=>i.kind==='clarification')],['Informative Hinweise',findings.filter(i=>i.kind==='info')]] as const;
 return <div role="region" aria-label="Klärungsübersicht"><ContentCard className="space-y-3 p-3">
  <SectionHeader title="Klärungsübersicht" subtitle="Vorhandene Prüfungen und passende nächste Schritte"/>
  <p className="text-sm">{groups[0][1].length} Importfehler · {pending.length} offene Entscheidungen · {questions.length} offene Rückfragen · {groups[2][1].length} informative Hinweise</p>
  {!findings.length&&!pending.length&&!questions.length&&<p className="text-sm text-[var(--ops-success)]">Keine offenen Befunde in diesem Prüfstand.</p>}
  {groups.filter(([,items])=>items.length).map(([title,items])=><details key={title} open={title==='Importfehler'} className="rounded border border-[var(--ops-border)] p-2">
   <summary className="cursor-pointer font-bold">{title} ({items.length})</summary>
   <div className="mt-2 space-y-2">{items.map(f=><details key={f.id} data-finding-code={f.code} data-finding-kind={f.kind} className="rounded border border-[var(--ops-divider)] p-2 text-sm [overflow-wrap:anywhere]">
    <summary className="cursor-pointer"><StatusChip tone={f.kind==='error'?'error':f.kind==='clarification'?'warning':'info'}>{f.kind==='error'?'Blockierend':f.kind==='clarification'?'Klären':'Informativ'}</StatusChip> <strong>{f.message}</strong><span className="mt-1 block">{f.personKeys.length?f.personKeys.map(key=>{const p=preview.people.find(p=>p.matchKey===key);return p?<button key={key} type="button" className="mr-3 text-left font-bold text-[var(--ops-primary)] underline" onClick={e=>{e.preventDefault();e.stopPropagation();onPerson(key);}}>{p.firstname} {p.lastname}</button>:null;}):'Nationsmeldung / Quelldaten'}</span></summary>
    <div className="mt-2 space-y-2">
     <p className="text-xs text-[var(--ops-text-muted)]">{findingFamilies(f,preview,session).join(' / ')||f.source||'Aktueller Prüfstand'}{f.row?` · Zeile ${f.row}`:''} · {f.code}</p>
     <FindingEvidence finding={f} preview={preview} session={session}/>
     <div className="flex flex-wrap gap-2">{f.personKeys.length>0&&<OpsButton onClick={()=>onPeople(f.personKeys)}>Betroffene Personen ({f.personKeys.length})</OpsButton>}{f.kind!=='info'&&<OpsButton disabled={!canWrite} onClick={()=>onQuestion(f.personKeys)}>Rückfrage dokumentieren</OpsButton>}</div>
    </div>
   </details>)}</div>
  </details>)}
  {pending.map(a=>{const keys=(a.quotaDetails?.candidates??a.quotaDetails?.singleRoomCandidates??[]).map(p=>p.personKey);return <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--ops-border)] p-2 text-sm"><span><strong>Entscheidung offen</strong> · {a.description}{a.quotaDetails?.family?` · ${familyLabel(a.quotaDetails.family)}`:''}</span><div className="flex flex-wrap gap-2">{keys.length>0&&<OpsButton onClick={()=>onPeople(keys)}>Betroffene Personen ({keys.length})</OpsButton>}<OpsButton onClick={()=>onDecision(a.id)}>Entscheidung {canWrite?'bearbeiten':'ansehen'}</OpsButton></div></div>;})}
  {questions.map(q=><div key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--ops-border)] p-2 text-sm"><span>{q.required&&q.relevant!==false?'Vor Freigabe klären':'Rückfrage offen'} · {q.subject.label}</span><OpsButton onClick={()=>onExistingQuestion(q.id)}>Rückfrage ansehen</OpsButton></div>)}
 </ContentCard></div>;
}
