import {useEffect,useState} from 'react';
import {api} from '../services/api';
import type {WorldChampion} from '../types';
import {OpsButton,StatusChip} from '../design-system';
import {useAuth} from '../auth/AuthProvider';
import {useActiveEvent} from '../events/ActiveEventProvider';
export function EventWorldChampions({eventId}:{eventId:string}) {
 const [titles,setTitles]=useState<WorldChampion[]>([]),[links,setLinks]=useState<Record<string,boolean>>({}),[search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const {user}=useAuth();const {events}=useActiveEvent();const editable=Boolean(user?.isSuperadmin || ((user?.permissions.includes('*')||user?.permissions.includes('admin.reset'))&&events.find(e=>e.id===eventId)?.canWrite));
 const load=async()=>{const [all,assigned]=await Promise.all([api.getChampionTitles(),api.getChampionRecognitions(eventId)]);setTitles(all);setLinks(Object.fromEntries(assigned.recognitions.map(r=>[r.titleId,r.active])));};
 useEffect(()=>{void load().catch(e=>setError(String(e)));},[eventId]);
 return <section className="space-y-3 p-5"><h3 className="font-bold">Weltmeister · Anerkennung für dieses Event</h3><p className="text-sm">Ursprungstitel bleiben zentral erhalten. Diese Auswahl steuert nur die Anerkennung im gewählten Event; bestehende Ausnahmen werden nicht umgeschrieben.</p>
 <label className="block text-sm">Titel / Name / FIS-Code suchen<input className="ml-2 rounded border bg-[var(--ops-surface)] p-2" value={search} onChange={e=>setSearch(e.target.value)}/></label>
 {error&&<p role="alert">{error}</p>}
 <ul className="space-y-2">{titles.filter(t=>`${t.name} ${t.fisCode} ${t.championship}`.toLowerCase().includes(search.toLowerCase())).map(t=><li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--ops-border)] p-3"><div><strong>{t.name}</strong><p className="text-xs">Ursprungstitel #{t.id}: {t.championship} {t.championshipYear} · {t.eventGroup} · {t.fisCode}</p><StatusChip tone={links[t.id]?'success':'neutral'}>{links[t.id]?'Im Event anerkannt':'Nicht anerkannt'}</StatusChip></div>
 <OpsButton disabled={busy||!editable||(!links[t.id]&&(!t.active||!t.entitlementEnabled))} onClick={async()=>{setBusy(true);setError('');try{await api.setChampionRecognition(eventId,t.id,!links[t.id]);await load();}catch(e){setError(String(e));}finally{setBusy(false);}}}>{links[t.id]?'Anerkennung deaktivieren':'Für dieses Event anerkennen'}</OpsButton></li>)}</ul></section>;
}
