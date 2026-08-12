import { useEffect, useState } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { loadAllAuditEvents, belongsToEntity } from './activityData';
import { ActivityHistoryDialog } from './ActivityHistoryDialog';

const dateTime = (value?: string) => value ? new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function ActivitySummaryCard({ entityType, entityId, createdAt, updatedAt }: { entityType: string; entityId?: string | null; createdAt?: string | null; updatedAt?: string | null }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [metadata, setMetadata] = useState({ createdAt, createdBy: '—', updatedAt, updatedBy: '—' });
  useEffect(() => {
    if (!entityId) return;
    void loadAllAuditEvents().then(events => {
      const matching = events.filter(event => belongsToEntity(event, entityType, entityId));
      if (!matching.length) return;
      const newest = matching[0], oldest = matching.at(-1)!;
      setMetadata({ createdAt: createdAt || oldest.createdAt, createdBy: oldest.displayName || oldest.username || 'System', updatedAt: updatedAt || newest.createdAt, updatedBy: newest.displayName || newest.username || 'System' });
    }).catch(() => undefined);
  }, [createdAt, entityId, entityType, updatedAt]);
  return <><section className="overflow-hidden rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)]">
    <div className="flex items-center gap-2 border-b border-[var(--ops-divider)] px-4 py-3"><History size={18} className="text-[var(--ops-text-muted)]"/><div><h3 className="font-extrabold">Aktivität</h3><p className="text-xs text-[var(--ops-text-muted)]">Systeminformationen zur Nachvollziehbarkeit</p></div></div>
    <dl className="grid gap-4 p-4 text-sm sm:grid-cols-2"><Fact label="Erstellt am" value={dateTime(metadata.createdAt || undefined)}/><Fact label="Erstellt von" value={metadata.createdBy}/><Fact label="Zuletzt geändert am" value={dateTime(metadata.updatedAt || undefined)}/><Fact label="Zuletzt geändert von" value={metadata.updatedBy}/></dl>
    <button type="button" disabled={!entityId} onClick={() => setHistoryOpen(true)} className="flex w-full items-center justify-between border-t border-[var(--ops-divider)] px-4 py-3 text-sm font-bold text-[var(--ops-primary)] hover:bg-[var(--ops-surface-overlay)] disabled:opacity-50">Änderungsverlauf anzeigen <ArrowRight size={16}/></button>
  </section><ActivityHistoryDialog entityType={historyOpen ? entityType : null} entityId={historyOpen ? entityId || null : null} onClose={() => setHistoryOpen(false)}/></>;
}
/** @deprecated Use the product name ActivitySummaryCard. */
export const ActivityInfoBlock = ActivitySummaryCard;
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-bold text-[var(--ops-text-muted)]">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>; }
