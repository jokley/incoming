import { useEffect, useMemo, useState } from 'react';
import { MenuItem, TextField } from '@mui/material';
import { api } from '../services/api';
import type { EventAccessLevel, KnownUser, UserAccessOverview } from '../types';
import { useActiveEventBlocker } from '../events/ActiveEventProvider';
import { ContentCard, OpsButton, StatusChip } from '../design-system';

const labels: Record<EventAccessLevel,string> = {NONE:'Kein Zugriff', READ:'Lesen', WRITE:'Bearbeiten'};

export function UserAccessEditor({ user, events, onSaved }: {
  user: KnownUser; events: UserAccessOverview['events']; onSaved: () => Promise<void>;
}) {
  const [draft,setDraft] = useState<Record<string,EventAccessLevel>>(user.grants);
  const [saving,setSaving] = useState(false); const [message,setMessage] = useState(''); const [error,setError] = useState('');
  useEffect(() => {setDraft(user.grants);}, [user.revision]);
  const dirty = events.some(e => (draft[e.id] ?? 'NONE') !== (user.grants[e.id] ?? 'NONE'));
  useActiveEventBlocker(dirty || saving, 'Bitte die offenen Benutzerberechtigungen speichern oder verwerfen.');
  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      await api.saveUserGrants(user.username, user.revision, Object.fromEntries(events.map(e => [e.id,draft[e.id] ?? 'NONE'])));
      await onSaved(); setMessage('Berechtigungen gespeichert.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.'); }
    finally { setSaving(false); }
  };
  return <form data-event-dirty={dirty ? 'true':'false'} onSubmit={e => {e.preventDefault(); void save();}} className="space-y-4">
    <div><h3 className="font-bold">{user.displayName || user.username}</h3><p className="text-sm text-[var(--ops-text-muted)]">{user.username}</p></div>
    <p className="text-xs text-[var(--ops-text-muted)]">Funktionsgruppen: {user.groups?.join(', ') || 'Noch nicht authentifiziert beobachtet'}. Gruppen werden ausschließlich von Authelia übernommen.</p>
    {user.isSuperadmin && <p className="text-sm"><StatusChip tone="primary">Superadmin</StatusChip> Zugriff über Serverkonfiguration; hier nicht entziehbar.</p>}
    <div className="space-y-2">{events.map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ops-divider)] pb-2">
      <label htmlFor={`grant-${event.id}`} className="min-w-0 flex-1 text-sm break-words">{event.name}{!event.active && <span className="ml-2 text-xs text-[var(--ops-text-muted)]">Inaktiv · kein operativer Zugriff</span>}</label>
      <TextField id={`grant-${event.id}`} select size="small" value={user.isSuperadmin ? 'WRITE' : draft[event.id] ?? 'NONE'} disabled={user.isSuperadmin || saving}
        slotProps={{htmlInput:{'aria-label':`Eventberechtigung ${event.name}`}}} sx={{minWidth:150}}
        onChange={e => {setMessage(''); setDraft({...draft,[event.id]:e.target.value as EventAccessLevel});}}>
        {Object.entries(labels).map(([value,label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>
    </div>)}</div>
    <p className="text-xs text-[var(--ops-text-muted)]">Bearbeiten benötigt zusätzlich passende Funktionsrechte. Neue Events erhalten keine automatische Freigabe für normale Benutzer.</p>
    {error && <p role="alert" className="text-sm text-[var(--ops-tone-danger-text)]">{error} Bei einem Revisionskonflikt bitte verwerfen und neu laden.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {!user.isSuperadmin && <div className="flex flex-wrap gap-2"><OpsButton type="submit" disabled={!dirty || saving}>{saving ? 'Speichert …':'Änderungen speichern'}</OpsButton>
      <OpsButton type="button" disabled={saving} onClick={() => {setDraft(user.grants); setError(''); setMessage(''); void onSaved().catch(cause => setError(String(cause)));}}>Verwerfen / neu laden</OpsButton></div>}
  </form>;
}

export function AdministrationUsers() {
  const [data,setData] = useState<UserAccessOverview|null>(null); const [selected,setSelected] = useState('');
  const [search,setSearch] = useState(''); const [filter,setFilter] = useState('ALL'); const [error,setError] = useState('');
  const [username,setUsername] = useState(''); const [displayName,setDisplayName] = useState(''); const [adding,setAdding] = useState(false);
  const reload = async () => { const next = await api.getUserAccess(); setData(next); };
  useEffect(() => {void reload().catch(e => setError(e.message));}, []);
  const users = useMemo(() => data?.users.filter(u => `${u.username} ${u.displayName} ${u.groups?.join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
    (filter==='ALL' || filter==='SUPERADMIN' && u.isSuperadmin || filter==='GRANTED' && Object.keys(u.grants).length>0)) ?? [],[data,search,filter]);
  const user = data?.users.find(u => u.username===selected);
  const choose = (name:string) => {
    if (document.querySelector('[data-user-editor] form[data-event-dirty="true"]') && !window.confirm('Ungespeicherte Berechtigungen verwerfen?')) return;
    setSelected(name);
  };
  const create = async () => {
    setAdding(true); setError('');
    try { const next = await api.createUserReference(username,displayName); setData(next); setUsername(''); setDisplayName(''); }
    catch(cause) {setError(cause instanceof Error ? cause.message : 'Anlegen fehlgeschlagen.');}
    finally {setAdding(false);}
  };
  return <div className="space-y-4"><p className="text-sm text-[var(--ops-text-muted)]">Benutzerreferenzen und Eventfreigaben. Anmeldung und Funktionsgruppen bleiben in Authelia.</p>
    {error && <p role="alert">{error}</p>}
    <div className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
      <ContentCard className="space-y-3 p-3"><TextField label="Benutzer suchen" size="small" fullWidth value={search} onChange={e=>setSearch(e.target.value)}/>
        <TextField label="Filter" select size="small" fullWidth value={filter} onChange={e=>setFilter(e.target.value)}><MenuItem value="ALL">Alle</MenuItem><MenuItem value="SUPERADMIN">Superadmin</MenuItem><MenuItem value="GRANTED">Mit Eventfreigaben</MenuItem></TextField>
        <nav aria-label="Bekannte Benutzer" className="max-h-80 space-y-1 overflow-y-auto">{users.map(u=><button key={u.username} className={`w-full rounded border p-2 text-left text-sm break-words ${selected===u.username?'border-[var(--ops-primary)]':'border-[var(--ops-border)]'}`} onClick={()=>choose(u.username)}><strong>{u.displayName || u.username}</strong><div>{u.username}{u.isSuperadmin?' · Superadmin':''}</div></button>)}</nav>
        {!data && <p role="status">Benutzer werden geladen …</p>}
      </ContentCard>
      <ContentCard className="min-w-0 p-4" data-user-editor>{user && data ? <UserAccessEditor key={user.username} user={user} events={data.events} onSaved={reload}/> : <p>Benutzer auswählen.</p>}</ContentCard>
    </div>
    <ContentCard className="p-4"><h3 className="font-bold">Benutzerreferenz ergänzen</h3><p className="mb-3 text-xs text-[var(--ops-text-muted)]">Exakter Authelia-Benutzername. Das Anlegen vergibt keine Rechte und erstellt kein Login.</p>
      <form onSubmit={e=>{e.preventDefault(); void create();}} className="flex flex-wrap items-end gap-2"><TextField label="Benutzername" size="small" value={username} onChange={e=>setUsername(e.target.value)} required/><TextField label="Anzeigename (optional)" size="small" value={displayName} onChange={e=>setDisplayName(e.target.value)}/><OpsButton type="submit" disabled={adding || !username.trim()}>Referenz anlegen</OpsButton></form>
    </ContentCard>
    <details><summary className="cursor-pointer text-sm font-bold">Letzte Berechtigungsänderungen</summary><ul className="mt-2 space-y-2 text-xs">{data?.history.map(h=><li key={h.id}>{h.createdAt} · {h.username} · {h.entityLabel} · {Array.isArray(h.details) ? h.details.filter(d => typeof d === 'string').join(' · ') : ''}</li>)}</ul></details>
  </div>;
}
