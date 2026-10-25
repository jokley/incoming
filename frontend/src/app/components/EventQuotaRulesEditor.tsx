import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { EventQuotaRules, QuotaRuleConfig, QuotaRevisionProposal, QuotaRevisionSnapshot } from '../types';
import { ConfirmDialog, ContentCard, OpsButton, SectionHeader, StatusChip } from '../design-system';
import { useAuth } from '../auth/AuthProvider';
import { useActiveEventBlocker } from '../events/ActiveEventProvider';

export function EventQuotaRulesEditor({eventId,isWorldChampionship=false}:{eventId:string;isWorldChampionship?:boolean}) {
  const [record,setRecord]=useState<EventQuotaRules|null>(null),[config,setConfig]=useState<QuotaRuleConfig|null>(null);
  const [savedWorld,setSavedWorld]=useState(isWorldChampionship);
  const [world,setWorld]=useState(isWorldChampionship),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
  const [revising,setRevising]=useState(false),[reason,setReason]=useState(''),[proposal,setProposal]=useState<QuotaRevisionProposal|null>(null),[history,setHistory]=useState<QuotaRevisionSnapshot[]>([]);
  const {user}=useAuth(); const writable=Boolean(user?.isSuperadmin || user?.permissions.includes('*') || user?.permissions.includes('admin.reset'));
  const canAdmin=writable && Boolean(user?.isSuperadmin || user?.permissions.includes('*') || user?.permissions.includes('admin.reset'));
  const fixed=record?.status==='FIXED'; const locked=(fixed&&!revising)||!canAdmin;
  useEffect(()=>{setProposal(null)},[config,world,reason]);
  useEffect(()=>{void api.getQuotaRevisions(eventId).then(setHistory).catch(()=>{});},[eventId,record?.revision]);
  const revisionData=()=>({config,isWorldChampionship:world,reason,expectedDigest:record?.digest,expectedRevision:record?.revision});

  const dirty=Boolean(record && (JSON.stringify(config)!==JSON.stringify(record.config) || world!==savedWorld));
  useActiveEventBlocker(dirty||busy,'Bitte Quotenregelentwurf speichern oder die Ansicht bewusst verlassen.');
  useEffect(()=>{let live=true;void api.getEventQuotaRules(eventId).then(r=>{if(live){setRecord(r);setConfig(r.config);setWorld(r.isWorldChampionship??false);setSavedWorld(r.isWorldChampionship??false);}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[eventId]);
  const save=async()=>{setBusy(true);setError('');try {const r=await api.saveEventQuotaRules(eventId,{config,expectedDigest:record?.digest,isWorldChampionship:world});setRecord(r);setConfig(r.config);setSavedWorld(world);}catch(e){setError(e instanceof Error?e.message:'Speichern fehlgeschlagen');}finally{setBusy(false)}};
  const number=(label:string,value:number,onChange:(v:number)=>void)=><label className="block text-sm">{label}<input type="number" min={0} max={10000} step={1} disabled={locked||busy} value={value} onChange={e=>onChange(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--ops-border)] bg-[var(--ops-surface)] p-2 text-[var(--ops-text)]"/></label>;
  return <ContentCard className="m-5 space-y-4 p-4"><SectionHeader title="Eventbezogene Quotenregeln" subtitle="Gültige Regeln und nachvollziehbare administrative Revisionen."/>
    <StatusChip tone={fixed?'success':'warning'}>{fixed?`Fixiert · Revision ${record.revision}`:'Entwurf · noch nicht operativ verwendbar'}</StatusChip>
    {error&&<p role="alert">{error}</p>}
    <label className="block"><input type="checkbox" checked={world} disabled={locked||busy} onChange={e=>setWorld(e.target.checked)}/> Weltmeisterschaft</label>
    {!fixed&&record&&<OpsButton disabled={busy} onClick={()=>setConfig(structuredClone(record.standardProposal!))}>FIS-Standardwerte als Entwurf übernehmen</OpsButton>}
    {config&&<fieldset disabled={locked||busy} className="space-y-4"><legend className="font-bold">Athleten-/Disziplinquoten</legend>
      {(['Snowboard','Freestyle'] as const).map(family=>{const rule=config.athletes[family];const change=(patch:Partial<typeof rule>)=>setConfig({...config,athletes:{...config.athletes,[family]:{...rule,...patch}}});return <div key={family} className="grid gap-3 rounded border border-[var(--ops-border)] p-3 sm:grid-cols-3"><label><input type="checkbox" checked={rule.enabled} onChange={e=>change({enabled:e.target.checked})}/> {family==='Freestyle'?'Freestyle / Freeski':family}</label>{number('Gesamtlimit',rule.totalLimit,totalLimit=>change({totalLimit}))}{number('Limit je Geschlecht',rule.genderLimit,genderLimit=>change({genderLimit}))}</div>})}
      <h4 className="font-bold">Officials- und EZ-Quote</h4>
      {number('Officials-Basis = Athleten + Zuschlag (bei 0 Athleten: 0)',config.officials.allowance,allowance=>setConfig({...config,officials:{...config.officials,allowance}}))}
      {config.singleRooms.map((tier,index)=><div key={index} className="grid gap-3 sm:grid-cols-3">{tier.upTo===null?<span>Ab letzter Schwelle · offene Endstufe</span>:number('Officials bis einschließlich',tier.upTo,upTo=>setConfig({...config,singleRooms:config.singleRooms.map((v,i)=>i===index?{...v,upTo}:v)}))}{number('EZ-Anspruch',tier.rooms,rooms=>setConfig({...config,singleRooms:config.singleRooms.map((v,i)=>i===index?{...v,rooms}:v)}))}{!locked&&tier.upTo!==null&&<OpsButton onClick={()=>setConfig({...config,singleRooms:config.singleRooms.filter((_,i)=>i!==index)})}>Stufe entfernen</OpsButton>}</div>)}
      {!locked&&<OpsButton onClick={()=>setConfig({...config,singleRooms:[...config.singleRooms.slice(0,-1),{upTo:0,rooms:0},config.singleRooms.at(-1)!]})}>EZ-Stufe ergänzen</OpsButton>}
    </fieldset>}
    {record?.examples&&<div className="rounded border border-[var(--ops-border)] p-3"><strong>{fixed?'Gültige Eventregeln':'Vorschau des gespeicherten Entwurfs'}</strong><p>{record.examples.athletes} Athleten → {record.examples.officials} Officials-Basis → {record.examples.singleRooms} EZ</p>{record.examples.scale.map(line=><p key={line}>{line}</p>)}</div>}
    {record?.preflight&&<div className="text-xs text-[var(--ops-text-muted)]">Bestandsprüfung: {Object.entries(record.preflight.counts).map(([k,v])=>`${k}: ${v}`).join(' · ')}{record.preflight.blockers.map(reason=><p key={reason} role="alert">{reason}</p>)}</div>}
    {!fixed&&canAdmin&&<div className="flex flex-wrap gap-2"><OpsButton disabled={!config||busy} onClick={()=>void save()}>Entwurf validieren und speichern</OpsButton><OpsButton disabled={!record?.config||dirty||busy||Boolean(record.preflight?.blockers.length)} onClick={()=>setConfirm(true)}>Quotenregeln verbindlich festlegen</OpsButton></div>}
    {fixed&&<p className="text-xs">Festgelegt durch {record.fixedBy} · {record.fixedAt?new Date(record.fixedAt).toLocaleDateString('de-AT'):'—'}. Historische Revisionen bleiben unverändert.</p>}
    {fixed&&canAdmin&&!revising&&<OpsButton onClick={()=>{setRevising(true);setConfig(structuredClone(record.config));setReason('');}}>Neue Revision erstellen</OpsButton>}
    {revising&&<div className="space-y-3"><label className="block">Änderungsbegründung<textarea className="block w-full rounded border bg-[var(--ops-surface)] p-2" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
      <OpsButton disabled={busy||!reason.trim()} onClick={async()=>{setBusy(true);setError('');try{setProposal(await api.previewQuotaRevision(eventId,revisionData()));}catch(e){setError(String(e));}finally{setBusy(false);}}}>Vorher / Nachher prüfen</OpsButton>
      <OpsButton disabled={busy} onClick={()=>{setRevising(false);setProposal(null);setConfig(record!.config);setWorld(savedWorld);}}>Revision verwerfen</OpsButton>
      {proposal&&<div><h4 className="font-bold">Revision {record!.revision} → {record!.revision+1}</h4><div className="grid gap-2 sm:grid-cols-2">{(['before','after'] as const).map(side=><div key={side} className="rounded border p-3"><strong>{side==='before'?'Bisher':'Neuer Entwurf'}</strong><p>WM: {proposal[side].isWorldChampionship?'Ja':'Nein'}</p>{Object.entries(proposal[side].config.athletes).map(([family,r])=><p key={family}>{family}: {r.enabled?`${r.totalLimit} gesamt / ${r.genderLimit} je Geschlecht`:'Deaktiviert'}</p>)}<p>Officials-Zuschlag: {proposal[side].config.officials.allowance}</p><p>EZ-Staffel: {proposal[side].config.singleRooms.map(t=>`${t.upTo??'offen'}: ${t.rooms}`).join(' · ')}</p></div>)}</div>
      <p className="my-2 text-sm">Aktuelle Anzeigen werden neu bewertet. Genehmigungen und importierte Personen bleiben unverändert. Offene Reviews müssen erneut geprüft werden.</p>
      <OpsButton disabled={busy} onClick={()=>setConfirm(true)}>Neue Revision ausdrücklich aktivieren</OpsButton></div>}
    </div>}
    {history.length>0&&<details><summary>Regelhistorie ({history.length})</summary>{history.map(r=><p key={r.revision}>Revision {r.revision} · {r.activatedBy??'historisch nicht aufgezeichnet'} · {r.activatedAt} · {r.reason} · Digest {r.digest}</p>)}</details>}
    <ConfirmDialog open={confirm} title={revising?"Neue Quotenrevision aktivieren?":"Quotenregeln verbindlich festlegen?"} description="Die gespeicherten Regeln gelten für alle folgenden operativen Prüfungen. Spätere Änderungen benötigen eine neue ausdrückliche Revision. Bestehende Prüfversionen müssen erneut geprüft werden." confirmLabel="Verbindlich festlegen" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={async()=>{setBusy(true);setError('');try {if(revising){await api.activateQuotaRevision(eventId,{...revisionData(),confirmationDigest:proposal?.confirmationDigest,confirm:true});setRevising(false);}else await api.fixEventQuotaRules(eventId,{confirm:true,expectedDigest:record?.digest,preflightFingerprint:record?.preflight?.fingerprint});const r=await api.getEventQuotaRules(eventId);setRecord(r);setConfig(r.config);setWorld(r.isWorldChampionship??world);setSavedWorld(r.isWorldChampionship??world);setConfirm(false);}catch(e){setError(e instanceof Error?e.message:'Fixierung fehlgeschlagen');setConfirm(false)}finally{setBusy(false)}}}/>
  </ContentCard>;
}
