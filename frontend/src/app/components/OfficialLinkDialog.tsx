import {useState} from 'react';
import {EnterpriseDialog,OpsButton} from '../design-system';
export interface OfficialLinkProposal {
 token:string;sessionId:string;candidates:Array<{key:string;name:string;identities:Array<{family:string;staffId:string;function:string;row:number;sourceVersionId?:number}>}>;
}
export function OfficialLinkDialog({proposal,onClose,onConfirm}:{proposal:OfficialLinkProposal;onClose:()=>void;onConfirm:(keys:string[])=>Promise<void>}) {
 const [selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <EnterpriseDialog open title="Officials einmalig zuordnen" size="medium" busy={busy} onClose={onClose} actions={<><OpsButton disabled={busy} onClick={onClose}>Abbrechen</OpsButton><OpsButton disabled={busy||!selected.length} onClick={async()=>{setBusy(true);setError('');try{await onConfirm(selected);}catch(e){setError(e instanceof Error?e.message:'Zuordnung fehlgeschlagen');}finally{setBusy(false);}}}>Geprüfte Zuordnungen bestätigen</OpsButton></>}>
  <p className="text-sm">Die Staff-IDs unterscheiden sich. Prüfen Sie jede Person anhand der Quellen und bestätigen Sie nur nachweislich identische Officials. Die Zuordnung gilt ausschließlich für diese Nation und diesen Event.</p>
  <p className="mt-2 text-sm">Damit werden keine Unterkunftsangaben, getrennten Aufenthalte, Tarife oder Quoten genehmigt. Widersprüchliche Angaben bleiben gesperrt.</p>
  {error&&<p role="alert" className="mt-3">{error}</p>}
  <OfficialLinkChoices candidates={proposal.candidates} selected={selected} busy={busy} onToggle={(key,checked)=>setSelected(keys=>checked?[...keys,key]:keys.filter(k=>k!==key))}/>
 </EnterpriseDialog>;
}

export function OfficialLinkChoices({candidates,selected,busy,onToggle}:{candidates:OfficialLinkProposal['candidates'];selected:string[];busy:boolean;onToggle:(key:string,checked:boolean)=>void}) {
 return (<div className="mt-4 space-y-3">{candidates.map(person=><label key={person.key} className="block rounded border border-[var(--ops-border)] p-3 text-sm">
   <span className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={selected.includes(person.key)} onChange={e=>onToggle(person.key,e.target.checked)}/><strong>{person.name} · dieselbe Person bestätigt</strong></span>
   {person.identities.map(i=><span key={i.family} className="mt-1 block break-words">{i.family==='Freestyle'?'Freestyle/Freeski':i.family} · Staff-ID {i.staffId} · {i.function} · Zeile {i.row}{i.sourceVersionId?` · Quellversion ${i.sourceVersionId}`:''}</span>)}
  </label>)}</div>);
}
