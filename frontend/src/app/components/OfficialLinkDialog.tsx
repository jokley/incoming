import { sportAreaLabel } from '../services/competitionPresentation';
import {useState} from 'react';
import {EnterpriseDialog,OpsButton} from '../design-system';
export interface OfficialLinkProposal {
 token:string;sessionId:string;candidates:Array<{key:string;name:string;identities:Array<{family:string;staffId:string;function:string;row:number;sourceVersionId?:number}>}>;
}
export function OfficialLinkDialog({proposal,onClose,onConfirm}:{proposal:OfficialLinkProposal;onClose:()=>void;onConfirm:(keys:string[])=>Promise<void>}) {
 // The parent keys this dialog by proposal.token: a new proposal starts with
 // its server-proposed candidates; opening or editing never persists a link.
 const [selected,setSelected]=useState<string[]>(()=>proposal.candidates.map(person=>person.key)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <EnterpriseDialog open title="Officials einmalig zuordnen" size="medium" busy={busy} onClose={onClose} actions={<><OpsButton disabled={busy} onClick={onClose}>Abbrechen</OpsButton><OpsButton className="max-w-full whitespace-normal" disabled={busy||!selected.length} onClick={async()=>{setBusy(true);setError('');try{await onConfirm(selected);}catch(e){setError(e instanceof Error?e.message:'Zuordnung fehlgeschlagen');}finally{setBusy(false);}}}>{selected.length} geprüfte Zuordnungen bestätigen</OpsButton></>}>
  <p className="text-sm">Plausible Vorschläge sind vorausgewählt. Prüfen Sie jede Person anhand der Quellen und wählen Sie unklare Zuordnungen ab. Erst die Bestätigung speichert Ihre Auswahl, ausschließlich für diese Nation und diesen Event.</p>
  <p className="mt-2 text-sm">Damit werden keine Unterkunftsangaben, getrennten Aufenthalte, Tarife oder Quoten genehmigt. Widersprüchliche Angaben bleiben gesperrt.</p>
  {error&&<p role="alert" className="mt-3">{error}</p>}
  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
   <p role="status" aria-live="polite">{selected.length} von {proposal.candidates.length} Zuordnungen ausgewählt</p>
   <div className="flex flex-wrap gap-2">
    <OpsButton disabled={busy||selected.length===proposal.candidates.length} onClick={()=>setSelected(proposal.candidates.map(person=>person.key))}>Alle auswählen</OpsButton>
    <OpsButton disabled={busy||!selected.length} onClick={()=>setSelected([])}>Auswahl aufheben</OpsButton>
   </div>
  </div>
  <OfficialLinkChoices candidates={proposal.candidates} selected={selected} busy={busy} onToggle={(key,checked)=>setSelected(keys=>checked?[...keys,key]:keys.filter(k=>k!==key))}/>
 </EnterpriseDialog>;
}

export function OfficialLinkChoices({candidates,selected,busy,onToggle}:{candidates:OfficialLinkProposal['candidates'];selected:string[];busy:boolean;onToggle:(key:string,checked:boolean)=>void}) {
 return (<div className="mt-3 space-y-2">{candidates.map(person=>{
  const differentFunctions=new Set(person.identities.map(i=>i.function.trim().toLowerCase())).size>1;
  return <label key={person.key} className="block min-w-0 rounded border border-[var(--ops-border)] p-2 text-sm [overflow-wrap:anywhere]">
   <span className="flex items-start gap-2"><input className="mt-1 shrink-0" type="checkbox" aria-label={`${person.name} zur Zuordnung auswählen`} disabled={busy} checked={selected.includes(person.key)} onChange={e=>onToggle(person.key,e.target.checked)}/><strong className="min-w-0">{person.name}</strong></span>
   {differentFunctions&&<span className="mt-1 inline-block rounded bg-amber-100 px-2 text-xs font-semibold text-amber-900">Unterschiedliche Funktionen</span>}
   <span className="mt-1 grid min-w-0 gap-1 sm:grid-cols-2">{person.identities.map(i=><span key={i.family} className="min-w-0">
    <span className="block">{sportAreaLabel(i.family)} · Staff-ID {i.staffId}</span>
    <span className={differentFunctions?'block font-semibold':'block'}>{i.function}</span>
    <span className="block text-xs text-[var(--ops-text-muted)]">Zeile {i.row}{i.sourceVersionId?` · Quellversion ${i.sourceVersionId}`:''}</span>
   </span>)}</span>
  </label>;
 })}</div>);
}
