import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { EventQuotaRules, QuotaRuleConfig, QuotaRevisionProposal, QuotaRevisionSnapshot, SportEntryRules } from '../types';
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
  useEffect(()=>{let live=true;setHistory([]);void api.getQuotaRevisions(eventId).then(rows=>{if(live)setHistory(rows)}).catch(()=>{});return()=>{live=false}},[eventId,record?.revision]);
  const revisionData=()=>({config,isWorldChampionship:world,reason,expectedDigest:record?.digest,expectedRevision:record?.revision});

  const dirty=Boolean(record && (JSON.stringify(config)!==JSON.stringify(record.config) || world!==savedWorld));
  useActiveEventBlocker(dirty||busy,'Bitte Quotenregelentwurf speichern oder die Ansicht bewusst verlassen.');
  useEffect(()=>{let live=true;setRecord(null);setConfig(null);setRevising(false);setProposal(null);setError('');void api.getEventQuotaRules(eventId).then(r=>{if(live){setRecord(r);setConfig(r.config);setWorld(r.isWorldChampionship??false);setSavedWorld(r.isWorldChampionship??false);}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[eventId]);
  const save=async()=>{setBusy(true);setError('');try {const r=await api.saveEventQuotaRules(eventId,{config,expectedDigest:record?.digest,isWorldChampionship:world});setRecord(r);setConfig(r.config);setSavedWorld(world);}catch(e){setError(e instanceof Error?e.message:'Speichern fehlgeschlagen');}finally{setBusy(false)}};
  const number=(label:string,value:number,onChange:(v:number)=>void)=><label className="block text-sm">{label}<input type="number" min={0} max={10000} step={1} disabled={locked||busy} value={value} onChange={e=>onChange(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--ops-border)] bg-[var(--ops-surface)] p-2 text-[var(--ops-text)]"/></label>;
  const emptySport=():SportEntryRules=>({schemaVersion:1,enabled:false,titleEdition:null,competitions:[],pools:[]});
  const setSport=(sportEntryRules:SportEntryRules)=>setConfig(current=>current?{...current,sportEntryRules}:current);
  const options=record?.sportRuleOptions;
  const sportOnly=Boolean(proposal&&proposal.before.isWorldChampionship===proposal.after.isWorldChampionship&&
    JSON.stringify([proposal.before.config.athletes,proposal.before.config.officials,proposal.before.config.singleRooms])===JSON.stringify([proposal.after.config.athletes,proposal.after.config.officials,proposal.after.config.singleRooms]));
  const sportTable=(rules:SportEntryRules|undefined,editable:boolean)=>{
    const sport=rules??emptySport();
    const change=(id:string,patch:Partial<SportEntryRules['competitions'][number]>)=>{
      const existing=sport.competitions.find(r=>r.competitionId===id);
      const row={competitionId:id,enabled:false,regularLimit:null,titleReferences:[],poolId:null,...existing,...patch};
      setSport({...sport,competitions:existing?sport.competitions.map(r=>r.competitionId===id?row:r):[...sport.competitions,row]});
    };
    const known=options?.competitions??[];
    const ids=editable?[...new Set([...known.map(c=>c.id),...sport.competitions.map(r=>r.competitionId)])]:sport.competitions.map(r=>r.competitionId);
    return <div className="min-w-0 space-y-2 text-sm">
      <label><input type="checkbox" disabled={!editable} checked={sport.enabled} onChange={e=>setSport({...sport,enabled:e.target.checked})}/> Sportregeln für dieses Event aktivieren</label>
      <label className="block">Titelgrundlage <select aria-label="Sport-Titelgrundlage" disabled={!editable} className="max-w-full rounded border bg-[var(--ops-surface)] p-1" value={sport.titleEdition?JSON.stringify([sport.titleEdition.championship,sport.titleEdition.year]):''} onChange={e=>{
        const [championship,year]=e.target.value?JSON.parse(e.target.value):[];
        setSport({...sport,titleEdition:e.target.value?{championship,year}:null,competitions:sport.competitions.map(r=>({...r,titleReferences:[]}))});
      }}><option value="">Kein Titel-Zusatzrecht</option>{sport.titleEdition&&<option value={JSON.stringify([sport.titleEdition.championship,sport.titleEdition.year])}>{sport.titleEdition.championship} {sport.titleEdition.year}</option>}{[...new Map((options?.titles??[]).map(t=>[JSON.stringify([t.championship,t.championshipYear]),t])).entries()].filter(([key])=>key!==JSON.stringify([sport.titleEdition?.championship,sport.titleEdition?.year])).map(([key,t])=><option key={key} value={key}>{t.championship} {t.championshipYear}</option>)}</select></label>
      {!ids.length?<p>Nicht konfiguriert</p>:<div role="region" tabIndex={0} aria-label="Sportregeln – Tabelle horizontal scrollbar" className="max-w-full overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Wettbewerb','Geschlecht','Reguläres Limit','Titelrecht','Pool','Aktiv'].map(h=><th key={h} className="p-1 text-left">{h}</th>)}</tr></thead><tbody>{ids.map(id=>{
        const comp=known.find(c=>c.id===id);const row=sport.competitions.find(r=>r.competitionId===id);
        const label=`${comp?.displayName??`Competition ${id}`} · ${comp?.gender??'?'}`;
        const refs=row?.titleReferences??[];
        const titles=(options?.titles??[]).filter(t=>t.championship===sport.titleEdition?.championship&&t.championshipYear===sport.titleEdition?.year&&t.discipline===comp?.titleDiscipline&&t.gender===comp?.gender&&t.eventGroup===comp?.quotaDiscipline);
        return <tr key={id} className="border-t border-[var(--ops-divider)]"><td className="p-1">{comp?.displayName??`Competition ${id}`}<span className="block text-[var(--ops-text-muted)]">{comp?.sport??'Mapping fehlt'}</span></td><td className="p-1">{comp?.gender??'—'}</td>{comp?.teamCompetition?<td colSpan={4} className="p-1">Team-Startrecht nicht geprüft</td>:<>
          <td className="p-1"><input aria-label={`Starterlimit ${label}`} type="number" min={0} max={10000} step={1} disabled={!editable} value={row?.regularLimit??''} onChange={e=>change(id,{regularLimit:e.target.value===''?null:Number(e.target.value)})} className="w-20 rounded border bg-[var(--ops-surface)] p-1"/></td>
          <td className="p-1"><details><summary>{refs.length?`${refs.length} Einzeltitel`:'Kein Zusatzrecht'}</summary>
            {editable?titles.map(t=><label key={t.id} className="block"><input type="checkbox" aria-label={`Titel ${t.name} für ${label}`} checked={refs.some(r=>r.id===t.id)} onChange={e=>{
              const {name,...reference}=t;void name;
              change(id,{titleReferences:e.target.checked?[...refs,{...reference,sourceVerified:false}]:refs.filter(r=>r.id!==t.id)});
            }}/>{t.name} · {t.discipline} <a className="underline" href={t.source} target="_blank" rel="noreferrer">Quelle</a></label>):refs.map(t=><p key={t.id}>{t.fisCode} · {t.nation} · {t.discipline} · {t.championshipYear} · <a href={t.source} target="_blank" rel="noreferrer" className="underline">Quelle</a></p>)}
            {editable&&refs.length>0&&<label className="block"><input aria-label={`Titelquellen geprüft ${label}`} type="checkbox" checked={refs.every(t=>t.sourceVerified)} onChange={e=>change(id,{titleReferences:refs.map(t=>({...t,sourceVerified:e.target.checked}))})}/> Quellen geprüft</label>}
            {editable&&!titles.length&&<span>Keine passende Titelreferenz</span>}
          </details></td>
          <td className="p-1"><select aria-label={`Zuteilungspool ${label}`} disabled={!editable} value={row?.poolId??''} onChange={e=>change(id,{poolId:e.target.value||null})} className="max-w-40 rounded border bg-[var(--ops-surface)] p-1"><option value="">Keiner</option>{sport.pools.filter(p=>p.id).map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></td>
          <td className="p-1"><input aria-label={`Sportprüfung ${label}`} type="checkbox" disabled={!editable} checked={row?.enabled??false} onChange={e=>change(id,{enabled:e.target.checked})}/>{editable&&row&&<button type="button" aria-label={`Sportregel entfernen ${label}`} className="ml-2 underline" onClick={()=>setSport({...sport,competitions:sport.competitions.filter(r=>r.competitionId!==id)})}>Entfernen</button>}</td>
        </>}</tr>;
      })}</tbody></table></div>}
      <strong className="block">Zuteilungspools</strong>{sport.pools.map((pool,index)=><div key={index} className="flex flex-wrap items-center gap-2">
        <input aria-label={`Poolbezeichnung ${index+1}`} disabled={!editable} value={pool.id} onChange={e=>setSport({...sport,pools:sport.pools.map((p,i)=>i===index?{...p,id:e.target.value}:p),competitions:sport.competitions.map(r=>r.poolId===pool.id?{...r,poolId:e.target.value}:r)})} className="max-w-52 rounded border bg-[var(--ops-surface)] p-1"/>
        <label>Reguläres Poollimit <input aria-label={`Poollimit ${index+1}`} type="number" min={0} max={10000} step={1} disabled={!editable} value={pool.regularLimit} onChange={e=>setSport({...sport,pools:sport.pools.map((p,i)=>i===index?{...p,regularLimit:Number(e.target.value)}:p)})} className="w-20 rounded border bg-[var(--ops-surface)] p-1"/></label>
        {editable&&<button type="button" className="underline" onClick={()=>setSport({...sport,pools:sport.pools.filter((_,i)=>i!==index),competitions:sport.competitions.map(r=>r.poolId===pool.id?{...r,poolId:null}:r)})}>Pool entfernen</button>}
      </div>)}{editable&&<OpsButton onClick={()=>setSport({...sport,pools:[...sport.pools,{id:'',regularLimit:0}]})}>Pool ergänzen</OpsButton>}
    </div>;
  };
  return <ContentCard className="m-5 min-w-0 space-y-4 p-4 [overflow-wrap:anywhere]"><SectionHeader title="Eventbezogene Quotenregeln" subtitle="Gültige Regeln und nachvollziehbare administrative Revisionen."/>
    <StatusChip tone={fixed?'success':'warning'}>{fixed?`Fixiert · Revision ${record.revision}`:'Entwurf · noch nicht operativ verwendbar'}</StatusChip>
    {error&&<p role="alert">{error}</p>}
    <label className="block"><input type="checkbox" checked={world} disabled={locked||busy} onChange={e=>setWorld(e.target.checked)}/> Weltmeisterschaft</label>
    {!fixed&&record&&<OpsButton disabled={busy} onClick={()=>setConfig(current=>({...structuredClone(record.standardProposal!),...(current?.sportEntryRules?{sportEntryRules:current.sportEntryRules}:{})}))}>FIS-Standardwerte als Entwurf übernehmen</OpsButton>}
    {config&&<fieldset disabled={locked||busy} className="space-y-4"><legend className="font-bold">Athleten-/Disziplinquoten</legend>
      {(['Snowboard','Freestyle'] as const).map(family=>{const rule=config.athletes[family];const change=(patch:Partial<typeof rule>)=>setConfig({...config,athletes:{...config.athletes,[family]:{...rule,...patch}}});return <div key={family} className="grid gap-3 rounded border border-[var(--ops-border)] p-3 sm:grid-cols-3"><label><input type="checkbox" checked={rule.enabled} onChange={e=>change({enabled:e.target.checked})}/> {family==='Freestyle'?'Freestyle / Freeski':family}</label>{number('Gesamtlimit',rule.totalLimit,totalLimit=>change({totalLimit}))}{number('Limit je Geschlecht',rule.genderLimit,genderLimit=>change({genderLimit}))}</div>})}
      <h4 className="font-bold">Officials- und EZ-Quote</h4>
      {number('Officials-Basis = Athleten + Zuschlag (bei 0 Athleten: 0)',config.officials.allowance,allowance=>setConfig({...config,officials:{...config.officials,allowance}}))}
      {config.singleRooms.map((tier,index)=><div key={index} className="grid gap-3 sm:grid-cols-3">{tier.upTo===null?<span>Ab letzter Schwelle · offene Endstufe</span>:number('Officials bis einschließlich',tier.upTo,upTo=>setConfig({...config,singleRooms:config.singleRooms.map((v,i)=>i===index?{...v,upTo}:v)}))}{number('EZ-Anspruch',tier.rooms,rooms=>setConfig({...config,singleRooms:config.singleRooms.map((v,i)=>i===index?{...v,rooms}:v)}))}{!locked&&tier.upTo!==null&&<OpsButton onClick={()=>setConfig({...config,singleRooms:config.singleRooms.filter((_,i)=>i!==index)})}>Stufe entfernen</OpsButton>}</div>)}
      {!locked&&<OpsButton onClick={()=>setConfig({...config,singleRooms:[...config.singleRooms.slice(0,-1),{upTo:0,rooms:0},config.singleRooms.at(-1)!]})}>EZ-Stufe ergänzen</OpsButton>}
    </fieldset>}
    {config&&<fieldset disabled={locked||busy} className="min-w-0 space-y-2"><legend className="font-bold">Sportliche Startplätze</legend><p className="text-xs text-[var(--ops-text-muted)]">Noch nicht operativ: Auch gespeicherte oder fixierte Sportregeln wirken bis PR 3 nicht auf die Import-Plausibilitätsprüfung.</p>{sportTable(config.sportEntryRules,!locked&&!busy)}</fieldset>}
    {record?.examples&&<div className="rounded border border-[var(--ops-border)] p-3"><strong>{fixed?'Gültige Eventregeln':'Vorschau des gespeicherten Entwurfs'}</strong><p>{record.examples.athletes} Athleten → {record.examples.officials} Officials-Basis → {record.examples.singleRooms} EZ</p>{record.examples.scale.map(line=><p key={line}>{line}</p>)}</div>}
    {record?.preflight&&<div className="text-xs text-[var(--ops-text-muted)]">Bestandsprüfung: {Object.entries(record.preflight.counts).map(([k,v])=>`${k}: ${v}`).join(' · ')}{record.preflight.blockers.map(reason=><p key={reason} role="alert">{reason}</p>)}</div>}
    {!fixed&&canAdmin&&<div className="flex flex-wrap gap-2"><OpsButton disabled={!config||busy} onClick={()=>void save()}>Entwurf validieren und speichern</OpsButton><OpsButton disabled={!record?.config||dirty||busy||Boolean(record.preflight?.blockers.length)} onClick={()=>setConfirm(true)}>Quotenregeln verbindlich festlegen</OpsButton></div>}
    {fixed&&<p className="text-xs">Festgelegt durch {record.fixedBy} · {record.fixedAt?new Date(record.fixedAt).toLocaleDateString('de-AT'):'—'}. Historische Revisionen bleiben unverändert.</p>}
    {fixed&&canAdmin&&!revising&&<OpsButton onClick={()=>{setRevising(true);setConfig(structuredClone(record.config));setReason('');}}>Neue Revision erstellen</OpsButton>}
    {revising&&<div className="space-y-3"><label className="block">Änderungsbegründung<textarea className="block w-full rounded border bg-[var(--ops-surface)] p-2" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
      <OpsButton disabled={busy||!reason.trim()} onClick={async()=>{setBusy(true);setError('');try{setProposal(await api.previewQuotaRevision(eventId,revisionData()));}catch(e){setError(String(e));}finally{setBusy(false);}}}>Vorher / Nachher prüfen</OpsButton>
      <OpsButton disabled={busy} onClick={()=>{setRevising(false);setProposal(null);setConfig(record!.config);setWorld(savedWorld);}}>Revision verwerfen</OpsButton>
      {proposal&&<div><h4 className="font-bold">Revision {record!.revision} → {record!.revision+1}</h4><div className="grid gap-2 sm:grid-cols-2">{(['before','after'] as const).map(side=><div key={side} className="rounded border p-3"><strong>{side==='before'?'Bisher':'Neuer Entwurf'}</strong><p>WM: {proposal[side].isWorldChampionship?'Ja':'Nein'}</p>{Object.entries(proposal[side].config.athletes).map(([family,r])=><p key={family}>{family}: {r.enabled?`${r.totalLimit} gesamt / ${r.genderLimit} je Geschlecht`:'Deaktiviert'}</p>)}<p>Officials-Zuschlag: {proposal[side].config.officials.allowance}</p><p>EZ-Staffel: {proposal[side].config.singleRooms.map(t=>`${t.upTo??'offen'}: ${t.rooms}`).join(' · ')}</p><h5 className="mt-2 font-bold">Sportliche Startplätze</h5>{sportTable(proposal[side].config.sportEntryRules,false)}</div>)}</div>
      <p className="my-2 text-sm">{sportOnly?'Unterkunftsprüfstände bleiben unverändert. Die Sportauswertung wird noch nicht umgestellt.':'Aktuelle Unterkunftsanzeigen werden neu bewertet. Genehmigungen und importierte Personen bleiben unverändert. Offene Reviews müssen erneut geprüft werden.'}</p>
      <OpsButton disabled={busy} onClick={()=>setConfirm(true)}>Neue Revision ausdrücklich aktivieren</OpsButton></div>}
    </div>}
    {history.length>0&&<details><summary>Regelhistorie ({history.length})</summary>{history.map(r=><p key={r.revision}>Revision {r.revision} · {r.activatedBy??'historisch nicht aufgezeichnet'} · {r.activatedAt} · {r.reason} · Digest {r.digest}</p>)}</details>}
    <ConfirmDialog open={confirm} title={revising?"Neue Quotenrevision aktivieren?":"Quotenregeln verbindlich festlegen?"} description={sportOnly?'Sportkonfiguration verbindlich speichern? Unterkunftsprüfstände und bisherige Sportauswertung bleiben unverändert.':'Die gespeicherten Unterkunftsregeln gelten für alle folgenden operativen Prüfungen. Spätere Änderungen benötigen eine neue ausdrückliche Revision. Bestehende Prüfversionen müssen erneut geprüft werden.'} confirmLabel="Verbindlich festlegen" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={async()=>{setBusy(true);setError('');try {if(revising){await api.activateQuotaRevision(eventId,{...revisionData(),confirmationDigest:proposal?.confirmationDigest,confirm:true});setRevising(false);}else await api.fixEventQuotaRules(eventId,{confirm:true,expectedDigest:record?.digest,preflightFingerprint:record?.preflight?.fingerprint});const r=await api.getEventQuotaRules(eventId);setRecord(r);setConfig(r.config);setWorld(r.isWorldChampionship??world);setSavedWorld(r.isWorldChampionship??world);setConfirm(false);}catch(e){setError(e instanceof Error?e.message:'Fixierung fehlgeschlagen');setConfirm(false)}finally{setBusy(false)}}}/>
  </ContentCard>;
}
