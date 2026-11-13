import { sportAreaLabel } from '../services/competitionPresentation';
import { useState } from 'react';
import type { ImportSession, NationClarification } from '../data/importSessions';
import { EnterpriseDialog, OpsButton } from '../design-system';

type Target = 'PEOPLE'|'FINDING'|'SPORT'|'NATION';
export interface ClarificationDraft {
  clarificationAction:'OPEN'|'NOTE'|'REPLY'|'RESOLVE'; versionId:string;
  targetType:Target; selectionDigest?:string; personKeys:string[]; groupKey:string; sport:string;
  questionId?:string; subjectDigest?:string; comment:string; required:boolean;
  contactMethod:string; contactDate:string; result:string;
}

export const suggestedPeople = (keys:readonly string[], people:readonly {personKey:string}[]) =>
  people.filter(p=>keys.includes(p.personKey)).map(p=>p.personKey);

export function NationClarificationDialog({session,action,item,onSave,onClose,onBusy}:{
  session:ImportSession;action:'OPEN'|'REPLY'|'RESOLVE';item?:NationClarification;
  onSave:(data:ClarificationDraft)=>Promise<void>;onClose:()=>void;onBusy:(busy:boolean)=>void;
}) {
  const [draft,setDraft]=useState<ClarificationDraft>(()=>({clarificationAction:action,versionId:session.currentVersionId??'',
    targetType:'PEOPLE',selectionDigest:session.nationClarifications?.selectionDigest,personKeys:[],groupKey:'',sport:'',
    questionId:item?.id,subjectDigest:item?.subject.digest,comment:'',required:false,
    contactMethod:'EMAIL',contactDate:new Date().toLocaleDateString('sv-SE'),result:'CLARIFIED'}));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
  const patch=(value:Partial<ClarificationDraft>)=>setDraft(previous=>({...previous,...value}));
  const note=draft.clarificationAction==='NOTE', creating=action==='OPEN';
  const people=session.nationClarifications?.people??[],groups=session.nationClarifications?.groups??[];
  const group=groups.find(g=>g.key===draft.groupKey);
  const sports=[...new Set(people.flatMap(p=>[...p.families,...p.disciplines]))].filter(s=>s!=='*').sort();
  const selected=people.filter(p=>draft.personKeys.includes(p.personKey));
  const families=draft.targetType==='NATION'?['Gesamte Nation']:draft.targetType==='SPORT'?
    [...new Set(people.filter(p=>[...p.families,...p.disciplines].includes(draft.sport)).flatMap(p=>p.families))]:
    [...new Set(selected.flatMap(p=>p.families))];
  const valid=draft.comment.trim()&&(!creating||note||(
    (draft.targetType==='NATION'||draft.targetType==='SPORT'&&draft.sport||draft.personKeys.length>0||draft.targetType==='FINDING'&&group&&!group.personKeys.length)&&
    (draft.targetType!=='FINDING'||group)));
  const input='block w-full rounded border bg-[var(--ops-surface)] p-2';
  const save=async()=>{
    setBusy(true);onBusy(true);setError('');
    try { await onSave({...draft,groupKey:['PEOPLE','FINDING'].includes(draft.targetType)?draft.groupKey:'',required:note?false:draft.required});onClose(); }
    catch(e){setError(e instanceof Error?e.message:'Dokumentation fehlgeschlagen');}
    finally {setBusy(false);onBusy(false);}
  };
  return <EnterpriseDialog open title={creating?'Abklärung dokumentieren':action==='REPLY'?'Rückmeldung dokumentieren':'Rückfrage erledigen'} size="medium" busy={busy}
    onClose={()=>{if(!busy)onClose();}} actions={<><OpsButton disabled={busy} onClick={onClose}>Abbrechen</OpsButton><OpsButton disabled={busy||!valid} onClick={()=>void save()}>Speichern</OpsButton></>}>
    <div className="space-y-3 text-sm">
      {error&&<p role="alert">{error}</p>}
      {creating?<>
        <fieldset disabled={busy} className="flex gap-4"><legend className="sr-only">Eintragsart</legend>
          <label><input type="radio" name="entry-kind" checked={!note} onChange={()=>patch({clarificationAction:'OPEN'})}/> Rückfrage</label>
          <label><input type="radio" name="entry-kind" checked={note} onChange={()=>patch({clarificationAction:'NOTE'})}/> Allgemeine Notiz</label>
        </fieldset>
        {!note&&<>
          <label className="block">Bezug<select aria-label="Bezug" className={input} value={draft.targetType} disabled={busy}
            onChange={e=>patch({targetType:e.target.value as Target})}>
            <option value="PEOPLE">Eine oder mehrere Personen</option><option value="FINDING">Konkreter Sachverhalt / Problemgruppe</option>
            <option value="SPORT">Sportbereich / Disziplin</option><option value="NATION">Gesamte Nation</option>
          </select></label>
          {draft.targetType==='SPORT'&&<label className="block">Sportbereich / Disziplin<select aria-label="Sportbereich / Disziplin" className={input} value={draft.sport} disabled={busy} onChange={e=>patch({sport:e.target.value})}>
            <option value="">Bitte auswählen</option>{sports.map(s=><option key={s} value={s}>{sportAreaLabel(s)}</option>)}
          </select></label>}
          {['PEOPLE','FINDING'].includes(draft.targetType)&&<>
            <label className="block">Problemgruppe<select aria-label="Problemgruppe" className={input} value={draft.groupKey} disabled={busy} onChange={e=>patch({groupKey:e.target.value})}>
              <option value="">Freie Rückfrage ohne Importhinweis</option>{groups.map(g=><option key={g.key} value={g.key}>{g.label}{g.families?.length?` · ${g.families.map(f=>f==='*'?'Nation':sportAreaLabel(f)).join(' / ')}`:''} · {g.personKeys.length} Personen</option>)}
            </select></label>
            {group&&<div className="rounded border border-[var(--ops-border)] p-2">
              <p>{suggestedPeople(group.personKeys,people).length} passende Personen vorgeschlagen</p>
              <OpsButton disabled={busy} onClick={()=>patch({personKeys:suggestedPeople(group.personKeys,people)})}>Vorschlag übernehmen</OpsButton>
              <p className="text-xs text-[var(--ops-text-muted)]">Die Auswahl bleibt bestehen, bis Sie sie ändern.</p>
            </div>}
            <label className="block">Personen suchen<input aria-label="Personen suchen" className={input} value={search} disabled={busy} onChange={e=>setSearch(e.target.value)}/></label>
            <fieldset disabled={busy} className="max-h-48 space-y-1 overflow-y-auto rounded border border-[var(--ops-border)] p-2">
              <legend>{draft.personKeys.length} Personen ausgewählt</legend>
              {people.filter(p=>p.name.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de'))).map(p=><label key={p.personKey} className="flex items-start gap-2 py-1">
                <input type="checkbox" className="mt-1" checked={draft.personKeys.includes(p.personKey)} onChange={e=>patch({personKeys:e.target.checked?[...draft.personKeys,p.personKey]:draft.personKeys.filter(k=>k!==p.personKey)})}/>
                <span>{p.name}</span>
              </label>)}
            </fieldset>
          </>}
          <p className="text-xs">Betroffener Importumfang: {families.map(f=>f==='*'?'Nationsmeldung':sportAreaLabel(f)).join(' / ')||'Bitte Bezug auswählen'}</p>
          <label className="block"><input type="checkbox" disabled={busy} checked={draft.required} onChange={e=>patch({required:e.target.checked})}/> Vor Freigabe klären</label>
          <details><summary>Kontakt · {draft.contactMethod==='EMAIL'?'E-Mail':draft.contactMethod==='PHONE'?'Telefon':'Sonstiges'} · {draft.contactDate}</summary>
            <div className="mt-2 flex flex-wrap gap-3"><label>Kontaktweg<select aria-label="Kontaktweg" className={input} disabled={busy} value={draft.contactMethod} onChange={e=>patch({contactMethod:e.target.value})}><option value="EMAIL">E-Mail</option><option value="PHONE">Telefon</option><option value="OTHER">Sonstiges</option></select></label>
              <label>Kontaktdatum<input aria-label="Kontaktdatum" className={input} disabled={busy} type="date" value={draft.contactDate} onChange={e=>patch({contactDate:e.target.value})}/></label></div>
          </details>
        </>}
      </>:<>
        <strong>{item?.subject.label}</strong><p>{item?.subject.people.join(' · ')}</p>
        {action==='RESOLVE'&&<label className="block">Ergebnis<select aria-label="Ergebnis" className={input} disabled={busy} value={draft.result} onChange={e=>patch({result:e.target.value})}><option value="CLARIFIED">Mit Nation geklärt</option><option value="IRRELEVANT">Nicht mehr relevant</option></select></label>}
      </>}
      <label className="block">Kommentar<textarea aria-label="Kommentar zur Abklärung" className={`${input} min-h-24`} disabled={busy} value={draft.comment} maxLength={4000} onChange={e=>patch({comment:e.target.value})}/></label>
      <p className="text-xs text-[var(--ops-text-muted)]">{note?'Notizen dokumentieren das Gespräch und erzeugen keine offenen Aufgaben.':'Dokumentation ändert keine Unterkunftsdaten oder Genehmigungen. Antworten erledigen die Rückfrage nicht.'}</p>
    </div>
  </EnterpriseDialog>;
}
