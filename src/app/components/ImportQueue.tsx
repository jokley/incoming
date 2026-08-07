import type { ReactNode } from 'react';
import { Archive, Eye, MoreHorizontal } from 'lucide-react';
import { ContentCard, OpsButton, SectionHeader, StatusChip } from '../design-system';
import { ImportSessionStatus, mockImportSessions } from '../data/importSessions';

const statusTone: Record<ImportSessionStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  UPLOAD: 'neutral', PREVIEW: 'primary', PRÜFUNG: 'info', 'RÜCKSPRACHE NATION': 'warning', 'IMPORT BEREIT': 'warning', IMPORTIERT: 'success', ERSETZT: 'neutral', ABGEBROCHEN: 'neutral', FEHLER: 'error',
};

export function ImportQueue() {
  return <ContentCard className="overflow-hidden" surface="raised">
    <div className="flex flex-col gap-4 border-b border-[var(--ops-divider)] p-5 md:flex-row md:items-center md:justify-between"><SectionHeader title="Import Queue" subtitle="Alle Import Sessions im Staging – parallel, versioniert und unabhängig voneinander." /><div className="flex items-center gap-2 text-xs text-[var(--ops-text-muted)]"><span className="h-2 w-2 rounded-full bg-[var(--ops-success)]" />Mock-Daten · keine produktiven Änderungen</div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead className="bg-[var(--ops-surface-elevated)] text-left text-xs font-bold uppercase tracking-wide text-[var(--ops-text-subtle)]"><tr>{['Nation', 'Disziplin', 'Uploadzeit', 'Benutzer', 'Status', 'Warnungen', 'Fehler', 'Version', 'Aktionen'].map(header => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead>
      <tbody>{mockImportSessions.map(session => <tr key={session.id} className="border-t border-[var(--ops-divider)] transition-colors hover:bg-[var(--ops-surface-elevated)]">
        <td className="px-4 py-3"><div className="font-extrabold text-[var(--ops-text)]">{session.nation}</div><div className="font-mono text-[11px] text-[var(--ops-text-subtle)]">{session.id}</div></td><td className="px-4 py-3">{session.discipline}</td><td className="whitespace-nowrap px-4 py-3 text-[var(--ops-text-muted)]">{session.uploadedAt}</td><td className="px-4 py-3 text-[var(--ops-text-muted)]">{session.uploadedBy}</td><td className="px-4 py-3"><SessionStatusChip status={session.status} /></td><td className="px-4 py-3"><Count value={session.warnings} tone="warning" /></td><td className="px-4 py-3"><Count value={session.errors} tone="error" /></td><td className="px-4 py-3 font-mono text-[var(--ops-text-muted)]">v{session.version}</td><td className="px-4 py-3"><div className="flex gap-1"><IconAction label={`${session.id} öffnen`}><Eye className="h-4 w-4" /></IconAction><IconAction label={`${session.id} archivieren`}><Archive className="h-4 w-4" /></IconAction><IconAction label={`Weitere Aktionen für ${session.id}`}><MoreHorizontal className="h-4 w-4" /></IconAction></div></td>
      </tr>)}</tbody></table></div><div className="border-t border-[var(--ops-divider)] px-5 py-3 text-xs text-[var(--ops-text-muted)]">6 Import Sessions · zuletzt aktualisiert: gerade eben</div>
  </ContentCard>;
}

function Count({ value, tone }: { value: number; tone: 'warning' | 'error' }) { return value ? <StatusChip tone={tone}>{value}</StatusChip> : <span className="text-[var(--ops-text-subtle)]">0</span>; }
function SessionStatusChip({ status }: { status: ImportSessionStatus }) {
  if (status === 'IMPORT BEREIT') return <span className="inline-flex rounded-[var(--ops-radius-sm)] border border-[rgba(240,136,62,.55)] bg-[rgba(240,136,62,.18)] px-2 py-0.5 text-[11px] font-bold text-[#FFD8B5]">{status}</span>;
  return <StatusChip tone={statusTone[status]}>{status}</StatusChip>;
}
function IconAction({ label, children }: { label: string; children: ReactNode }) { return <OpsButton type="button" aria-label={label} title={`${label} (Platzhalter)`} className="!p-2">{children}</OpsButton>; }
