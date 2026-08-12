import { ArrowUpRight, CircleUserRound, Clock3 } from 'lucide-react';
import type { AuditEvent } from '../../types';
import type { AuditActivity } from '../../services/auditActivity';

export interface ActivityItem {
  event: AuditEvent;
  description: AuditActivity;
}

const dateTime = (value: string) => new Date(value).toLocaleString('de-DE', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna',
});

export function ActivityTimeline({ items, emptyMessage = 'Für dieses Objekt sind noch keine Aktivitäten vorhanden.', onOpen }: {
  items: ActivityItem[];
  emptyMessage?: string;
  onOpen?: (item: ActivityItem) => void;
}) {
  if (!items.length) return <div className="rounded-xl border border-dashed border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-5 py-12 text-center text-sm text-[var(--ops-text-muted)]">{emptyMessage}</div>;

  return <ol className="relative ml-2 border-l border-[var(--ops-divider)]" aria-label="Aktivitätsverlauf">
    {items.map(item => <li key={item.event.id} className="relative pb-7 pl-7 last:pb-1">
      <span className="absolute -left-[6px] top-1.5 h-3 w-3 rounded-full border-2 border-[var(--ops-surface)] bg-[var(--ops-primary)] ring-2 ring-[var(--ops-primary)]/15" aria-hidden="true" />
      <article className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="font-extrabold text-[var(--ops-text)]">{item.description.activity}</h3><p className="mt-1 text-sm font-semibold text-[var(--ops-text-subtle)]">{item.description.entity}</p></div>
          <span className="rounded-full bg-[var(--ops-tone-primary-surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--ops-tone-primary-text)]">{item.description.category}</span>
        </div>
        {item.description.details.length > 0 && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{item.description.details.map(detail => {
          const [label, ...rest] = detail.split(':'); const hasLabel = rest.length > 0;
          return <div key={detail}><dt className="text-xs font-bold text-[var(--ops-text-muted)]">{hasLabel ? label : 'Information'}</dt><dd className="font-medium text-[var(--ops-text)]">{hasLabel ? rest.join(':').trim() : detail}</dd></div>;
        })}</dl>}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--ops-divider)] pt-3 text-xs text-[var(--ops-text-muted)]">
          <time dateTime={item.event.createdAt} className="inline-flex items-center gap-1.5"><Clock3 size={14}/>{dateTime(item.event.createdAt)}</time>
          <span className="inline-flex items-center gap-1.5"><CircleUserRound size={14}/>{item.event.displayName || item.event.username || 'System'}</span>
          {onOpen && item.description.href && <button type="button" onClick={() => onOpen(item)} className="ml-auto inline-flex items-center gap-1 font-bold text-[var(--ops-primary)] hover:underline">{item.description.openLabel || 'Objekt öffnen'} <ArrowUpRight size={14}/></button>}
        </div>
      </article>
    </li>)}
  </ol>;
}
