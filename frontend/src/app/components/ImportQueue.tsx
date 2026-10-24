import { useEffect, useState } from 'react';
import { Popover } from '@mui/material';
import { api } from '../services/api';
import { importHintCategories } from '../services/importHints';
import { AlertCircle, Clock3, Plus, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { ContentCard, EmptyState, SectionHeader, StatusChip } from '../design-system';
import { competitionDisplayName } from '../services/competitionPresentation';
import { completedImportStatuses, IMPORT_SESSION_STATUS, ImportSession, ImportSessionStatus } from '../data/importSessions';

const statusTone: Record<ImportSessionStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  EXCEPTION_APPROVED:'success', CANCELLED:'neutral', DRAFT:'neutral', TECHNICALLY_REVIEWED:'primary', PROFESSIONALLY_REVIEWED:'info', WAITING_FOR_NATION:'warning', NEW_LIST_RECEIVED:'primary', RECHECK_REQUIRED:'warning', PREVIEW_CREATED:'primary', READY_FOR_IMPORT:'info', NATION_CLARIFICATION:'warning', APPROVED:'success', IMPORTED:'success', REPLACED:'neutral', ARCHIVED:'neutral', ERROR:'error',
};

export function ImportQueue({ sessions, selectedId, isCreating, onCreate, onSelect }: { sessions: ImportSession[]; selectedId: string | null; isCreating: boolean; onCreate: () => void; onSelect: (session: ImportSession) => void }) {
  const [search, setSearch] = useState('');
  const filtered = sessions.filter(session => `${session.id} ${session.nation} ${session.discipline} ${session.uploadedBy}`.toLowerCase().includes(search.toLowerCase()));
  const openSessions = filtered.filter(session => !completedImportStatuses.has(session.status));
  const completedSessions = filtered.filter(session => completedImportStatuses.has(session.status));
  return <ContentCard surface="raised" className="flex shrink-0 flex-col overflow-hidden xl:min-h-0 xl:w-[23rem]">
    <div className="shrink-0 border-b border-[var(--ops-divider)] p-4">
      <SectionHeader title={`Importwarteschlange (${sessions.length})`} subtitle="Offene Arbeit zuerst · Sitzung auswählen" />
      <label className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2">
        <Search className="h-4 w-4 text-[var(--ops-text-subtle)]" />
        <input value={search} onChange={event => setSearch(event.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--ops-text-subtle)]" placeholder="Importsession, Nation oder Benutzer" aria-label="Importwarteschlange durchsuchen" />
      </label>
      <button type="button" onClick={onCreate} className={clsx('mt-3 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-[var(--ops-tone-primary-surface)]', isCreating ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-[var(--ops-tone-primary-border)] bg-[var(--ops-surface)]')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary-emphasis)]"><Plus className="h-5 w-5" /></span>
        <span><span className="block font-extrabold">Neue Importsession</span><span className="block text-xs text-[var(--ops-text-muted)]">FIS-Dateien hochladen</span></span>
      </button>
    </div>
    <div className="max-h-64 overflow-y-auto p-3 xl:max-h-none xl:min-h-0 xl:flex-1">
      <SessionGroup title="Offene Importsessions" sessions={openSessions} selectedId={selectedId} onSelect={onSelect} />
      <SessionGroup title="Abgeschlossene Importsessions" sessions={completedSessions} selectedId={selectedId} onSelect={onSelect} className="mt-5" />
      {!filtered.length && <EmptyState title="Keine Importsessions gefunden" />}
    </div>
    <div className="flex shrink-0 items-center gap-2 border-t border-[var(--ops-divider)] px-4 py-3 text-xs text-[var(--ops-text-muted)]"><AlertCircle className="h-3.5 w-3.5" />Staging · produktive Daten bleiben bis zur Freigabe unverändert</div>
  </ContentCard>;
}

function SessionGroup({ title, sessions, selectedId, onSelect, className = '' }: { title: string; sessions: ImportSession[]; selectedId: string | null; onSelect: (session: ImportSession) => void; className?: string }) {
  return <section className={className}>
    <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ops-text-subtle)]"><span>{title}</span><span>{sessions.length}</span></div>
    <div className="space-y-2">
      {sessions.map(session => { const needsAction = session.errors > 0 || session.approvals.some(approval => approval.decision === 'PENDING'); return <div key={session.id} className="relative"><button type="button" onClick={() => onSelect(session)} className={clsx('w-full rounded-xl border p-3 text-left transition-colors hover:bg-[var(--ops-surface-elevated)]', selectedId === session.id ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)] ring-1 ring-[var(--ops-primary)]' : needsAction ? 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-surface)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}>
        <div className="flex items-start justify-between gap-2"><div><div className="font-extrabold">{session.nation} · {competitionDisplayName(session.discipline) || '—'}</div><div className="mt-0.5 font-mono text-[11px] text-[var(--ops-text-subtle)]">IS-{session.id} · v{session.currentVersion?.version ?? 0}</div></div><StatusChip tone={statusTone[session.status]}>{IMPORT_SESSION_STATUS[session.status]}</StatusChip></div>
        <div className="mt-3 flex flex-col gap-2 text-xs text-[var(--ops-text-muted)]"><div className="space-y-1"><div className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{session.uploadedAt}</div><div>von {session.uploadedBy}</div></div><div className="flex flex-wrap gap-1.5 pr-5"><StatusChip tone="info">{session.warnings} Hinweise</StatusChip><StatusChip tone={session.approvals.some(a => a.decision === 'PENDING') ? 'warning' : 'neutral'}>{session.approvals.filter(a => a.decision === 'PENDING').length} offen</StatusChip><StatusChip tone={session.errors ? 'error' : 'neutral'}>{session.errors} Fehler</StatusChip></div></div>
      </button><QueueHintDetails session={session}/></div>})}
    </div>
  </section>;
}


function QueueHintDetails({session}:{session:ImportSession}) {
  const [anchor,setAnchor] = useState<HTMLButtonElement|null>(null);
  const [loaded,setLoaded] = useState<ImportSession|null>(null);
  const [error,setError] = useState(false);
  useEffect(() => {
    if (!anchor) return;
    let current = true;
    setLoaded(null); setError(false);
    api.getImportSession(session.id).then(result => {if(current) setLoaded(result);}).catch(() => {if(current) setError(true);});
    return () => {current=false;};
  }, [anchor,session]);
  const categories = importHintCategories(loaded?.preview?.warnings ?? []);
  return <>
    <button type="button" aria-label={`Hinweise und Handlungsbedarf für IS-${session.id}`} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} onClick={event=>setAnchor(event.currentTarget)} className="absolute bottom-3 right-3 rounded px-1 text-[var(--ops-info)] focus-visible:outline focus-visible:outline-2" title="Hinweise, offene Entscheidungen und Fehler erklären">ⓘ</button>
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={()=>setAnchor(null)} anchorOrigin={{vertical:'bottom',horizontal:'right'}} transformOrigin={{vertical:'top',horizontal:'right'}}>
      <div role="dialog" aria-label="Hinweise und Handlungsbedarf" className="w-80 max-w-[calc(100vw-32px)] space-y-3 p-4 text-sm">
        <strong>Hinweise und Handlungsbedarf</strong>
        <p>Hinweise sind Meldungen aus der Vorschau. Sie sind keine blockierenden Fehler; offene Entscheidungen werden separat gezählt.</p>
        {!loaded ? <p>{error ? 'Details konnten nicht geladen werden. Bitte erneut öffnen.' : 'Details werden geladen …'}</p> : <>
          <div><strong>{loaded.warnings} Hinweise</strong><ul className="mt-1 space-y-1">{categories.map(category=><li key={category.code}>{category.count} × {category.label}</li>)}</ul>{!categories.length && <p>Keine Hinweise.</p>}</div>
          <p><strong>{loaded.approvals.filter(a=>a.decision==='PENDING').length} offene Entscheidungen</strong><br/>Erfordern eine fachliche Klärung vor der Freigabe.</p>
          <p><strong>{loaded.errors} blockierende Fehler</strong><br/>Müssen vor dem Import korrigiert werden.</p>
        </>}
        <p className="text-xs text-[var(--ops-text-muted)]">Officials über Basis sind informativ und erzeugen allein keinen Handlungsbedarf.</p>
      </div>
    </Popover>
  </>;
}
