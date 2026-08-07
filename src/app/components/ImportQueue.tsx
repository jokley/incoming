import { useState } from 'react';
import { AlertCircle, Clock3, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { ContentCard, EmptyState, SectionHeader, StatusChip } from '../design-system';
import { ImportSession, ImportSessionStatus, mockImportSessions } from '../data/importSessions';

const statusTone: Record<ImportSessionStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  UPLOAD: 'neutral', PREVIEW: 'primary', PRÜFUNG: 'info', 'RÜCKSPRACHE NATION': 'warning', 'IMPORT BEREIT': 'warning', IMPORTIERT: 'success', ERSETZT: 'neutral', ABGEBROCHEN: 'neutral', FEHLER: 'error',
};

export function ImportQueue({ selectedId, onSelect }: { selectedId: string | null; onSelect: (session: ImportSession) => void }) {
  const [search, setSearch] = useState('');
  const filtered = mockImportSessions.filter(session => `${session.id} ${session.nation} ${session.discipline} ${session.uploadedBy}`.toLowerCase().includes(search.toLowerCase()));
  return <ContentCard surface="raised" className="flex min-h-0 flex-col overflow-hidden xl:w-[23rem] xl:shrink-0">
    <div className="shrink-0 border-b border-[var(--ops-divider)] p-4">
      <SectionHeader title={`Import Queue (${mockImportSessions.length})`} subtitle="Session auswählen und rechts bearbeiten" />
      <label className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2">
        <Search className="h-4 w-4 text-[var(--ops-text-subtle)]" />
        <input value={search} onChange={event => setSearch(event.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--ops-text-subtle)]" placeholder="Session, Nation oder Benutzer" aria-label="Import Queue durchsuchen" />
      </label>
    </div>
    <div className="space-y-2 overflow-y-auto p-3 xl:min-h-0 xl:flex-1">
      {filtered.map(session => <button key={session.id} type="button" onClick={() => onSelect(session)} className={clsx('w-full rounded-xl border p-3 text-left transition-colors hover:bg-[var(--ops-surface-elevated)]', selectedId === session.id ? 'border-[var(--ops-primary)] bg-[var(--ops-surface-overlay)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]')}>
        <div className="flex items-start justify-between gap-2"><div><div className="font-extrabold">{session.nation} · {session.discipline}</div><div className="mt-0.5 font-mono text-[11px] text-[var(--ops-text-subtle)]">{session.id} · v{session.version}</div></div><StatusChip tone={statusTone[session.status]}>{session.status}</StatusChip></div>
        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2 text-xs text-[var(--ops-text-muted)]"><div className="space-y-1"><div className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{session.uploadedAt}</div><div>von {session.uploadedBy}</div></div><div className="flex gap-1.5"><StatusChip tone="warning">{session.warnings} W</StatusChip><StatusChip tone={session.errors ? 'error' : 'neutral'}>{session.errors} F</StatusChip></div></div>
      </button>)}
      {!filtered.length && <EmptyState title="Keine Import Sessions gefunden" />}
    </div>
    <div className="flex shrink-0 items-center gap-2 border-t border-[var(--ops-divider)] px-4 py-3 text-xs text-[var(--ops-text-muted)]"><AlertCircle className="h-3.5 w-3.5" />Mock-Daten · keine produktiven Änderungen</div>
  </ContentCard>;
}
