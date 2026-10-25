import {useEffect,useState} from 'react';
import {api} from '../services/api';
import {OpsButton} from '../design-system';
import {useAuth} from '../auth/AuthProvider';
export function EventWorldChampions({eventId}:{eventId:string}) {
 const [lists,setLists]=useState<{id:string;championship:string;year:number;titleCount:number;eligibleCount:number}[]>([]);
 const [selection,setSelection]=useState<{listId:string|null;digest:string;partial:boolean;inferred:boolean}|null>(null);
 const [chosen,setChosen]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const {user}=useAuth();const editable=Boolean(user?.isSuperadmin||user?.permissions.includes('*')||user?.permissions.includes('events.manage'));
 useEffect(()=>{let current=true;setSelection(null);setError('');void Promise.all([api.getChampionLists(),api.getChampionList(eventId)]).then(([rows,assigned])=>{if(current){setLists(rows);setSelection(assigned);setChosen(assigned.listId??'');}}).catch(e=>{if(current)setError(String(e));});return()=>{current=false;};},[eventId]);
 return <section className="space-y-3 p-5"><h3 className="font-bold">Weltmeisterliste für dieses Event</h3><p className="text-sm">Die Titel bleiben zentrale Referenzen. Nur aktive, berechtigte Einzeltitel können bei einer Weltmeisterschaft automatisch berücksichtigt werden. Gespeicherte Ausnahmen und Genehmigungen bleiben unverändert.</p>
 {selection?.partial&&<p role="status">Bisherige Einzelzuordnung ist unvollständig oder umfasst mehrere Listen. Eine vollständige WM-Liste ausdrücklich auswählen.</p>}
 {selection?.inferred&&<p role="status">Vollständige bestehende Anerkennungen erkannt; keine zusätzlichen Titel automatisch aktiviert.</p>}
 {error&&<p role="alert">{error}</p>}
 <label className="block text-sm">WM-Liste<select aria-label="WM-Liste" className="ml-2 max-w-full rounded border bg-[var(--ops-surface)] p-2" value={chosen} disabled={!selection||busy||!editable} onChange={e=>setChosen(e.target.value)}><option value="">Keine WM-Liste</option>{lists.map(list=><option key={list.id} value={list.id}>{list.championship} {list.year} – {list.titleCount} Titelreferenzen</option>)}</select></label>
 <OpsButton disabled={!selection||busy||!editable} onClick={async()=>{if(!selection||!window.confirm('WM-Liste für dieses Event verbindlich zuordnen? Bestehende Personen und Genehmigungen bleiben unverändert.'))return;setBusy(true);setError('');try{setSelection(await api.setChampionList(eventId,chosen||null,selection.digest));}catch(e){setError(String(e));}finally{setBusy(false);}}}>WM-Liste zuordnen</OpsButton></section>;
}
