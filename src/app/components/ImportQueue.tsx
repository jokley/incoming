import { useState } from 'react';
import { AlertCircle, Clock3, Plus, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { ContentCard, EmptyState, SectionHeader, StatusChip } from '../design-system';
import { completedImportStatuses, IMPORT_SESSION_STATUS, ImportSession, ImportSessionStatus } from '../data/importSessions';

const statusTone: Record<ImportSessionStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  DRAFT:'neutral', PREVIEW_CREATED:'primary', READY_FOR_IMPORT:'info', NATION_CLARIFICATION:'warning', APPROVED:'success', IMPORTED:'success', REPLACED:'neutral', ARCHIVED:'neutral', ERROR:'error',
};

export function ImportQueue({ sessions, selectedId, isCreating, onCreate, onSelect }: { sessions: ImportSession[]; selectedId: string | null; isCreating: boolean; onCreate: () => void; onSelect: (session: ImportSession) => void }) {
  const [search, setSearch] = useState('');
  const filtered = sessions.filter(session => `${session.id} ${session.nation} ${session.discipline} ${session.uploadedBy}`.toLowerCase().includes(search.toLowerCase()));
  const openSessions = filtered.filter(session => !completedImportStatuses.has(session.status));
  const completedSessions = filtered.filter(session => completedImportStatuses.has(session.status));
  return <ContentCard surface="raised" className="flex min-h-0 flex-col overflow-hidden xl:w-[23rem] xl:shrink-0">
    <div className="shrink-0 border-b border-[var(--ops-divider)] p-4">
      <SectionHeader title={`Import Queue (${sessions.length})`} subtitle="Session auswählen und rechts bearbeiten" />
      <label className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2">
        <Search className="h-4 w-4 text-[var(--ops-text-subtle)]" />
        <input value={search} onChange={event => setSearch(event.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--ops-text-subtle)]" placeholder="Session, Nation oder Benutzer" aria-label="Import Queue durchsuchen" />
      </label>
      <button type="button" onClick={onCreate} className={clsx('mt-3 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-[var(--ops-tone-primary-surface)]', isCreating ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-[var(--ops-tone-primary-border)] bg-[var(--ops-surface)]')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary-emphasis)]"><Plus className="h-5 w-5" /></span>
        <span><span className="block font-extrabold">Neue Import Session</span><span className="block text-xs text-[var(--ops-text-muted)]">FIS-Dateien hochladen</span></span>
      </button>
    </div>
    <div className="overflow-y-auto p-3 xl:min-h-0 xl:flex-1">
      <SessionGroup title="Offene Sessions" sessions={openSessions} selectedId={selectedId} onSelect={onSelect} />
      <SessionGroup title="Abgeschlossene Sessions" sessions={completedSessions} selectedId={selectedId} onSelect={onSelect} className="mt-5" />
      {!filtered.length && <EmptyState title="Keine Import Sessions gefunden" />}
    </div>
    <div className="flex shrink-0 items-center gap-2 border-t border-[var(--ops-divider)] px-4 py-3 text-xs text-[var(--ops-text-muted)]"><AlertCircle className="h-3.5 w-3.5" />Staging · produktive Daten bleiben bis zur Freigabe unverändert</div>
  </ContentCard>;
}

function SessionGroup({ title, sessions, selectedId, onSelect, className = '' }: { title: string; sessions: ImportSession[]; selectedId: string | null; onSelect: (session: ImportSession) => void; className?: string }) {
  return <section className={className}>
    <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ops-text-subtle)]"><span>{title}</span><span>{sessions.length}</span></div>
    <div className="space-y-2">
      {sessions.map(session => <button key={session.id} type="button" onClick={() => onSelect(session)} className={clsx('w-full rounded-xl border p-3 text-left transition-colors hover:bg-[var(--ops-surface-elevated)]', selectedId === session.id ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}>
        <div className="flex items-start justify-between gap-2"><div><div className="font-extrabold">{session.nation} · {session.discipline || '—'}</div><div className="mt-0.5 font-mono text-[11px] text-[var(--ops-text-subtle)]">IS-{session.id} · v{session.version}</div></div><StatusChip tone={statusTone[session.status]}>{IMPORT_SESSION_STATUS[session.status]}</StatusChip></div>
        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2 text-xs text-[var(--ops-text-muted)]"><div className="space-y-1"><div className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{session.uploadedAt}</div><div>von {session.uploadedBy}</div></div><div className="flex gap-1.5"><StatusChip tone="warning">{session.warnings} W</StatusChip><StatusChip tone={session.errors ? 'error' : 'neutral'}>{session.errors} F</StatusChip></div></div>
      </button>)}
    </div>
  </section>;
}
