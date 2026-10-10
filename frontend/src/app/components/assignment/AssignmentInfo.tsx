import { RefreshCw } from 'lucide-react';
import type { ImportChangeDetail, ImportChangeType } from '../../types';
import { StatusChip } from '../../design-system';

export type AssignmentChangeSubject = {
  athleteId: string;
  firstname: string;
  lastname: string;
  hasPendingReview: boolean;
  importChangeDetails: ImportChangeDetail[];
};

const CHANGE_TITLES: Record<ImportChangeType, string> = {
  NEW_ATHLETE: 'Person', DATE_CHANGED: 'Aufenthalt', ROOMMATE_CHANGED: 'Zimmerpartner',
  ROOM_DEMAND_CHANGED: 'Zimmerart', EVENT_CHANGED: 'Event', NATION_CHANGED: 'Nation', HOTEL_CHANGED: 'Hotel',
};

const formatValue = (value?: string | null, field = '') => {
  if (!value) return '—';
  if (/date|arrival|departure|check.?in|check.?out|from|until/i.test(field)) {
    return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  }
  return value;
};

const partOrder = (field: string) => /arrival|check.?in|from/i.test(field) ? 0 : /departure|check.?out|until|to/i.test(field) ? 1 : 2;

export function groupAssignmentChanges(changes: ImportChangeDetail[]) {
  const groups = new Map<ImportChangeType, ImportChangeDetail[]>();
  changes.forEach(change => groups.set(change.type, [...(groups.get(change.type) || []), change]));
  return [...groups].map(([type, details]) => {
    const ordered = [...details].sort((a, b) => partOrder(a.field) - partOrder(b.field));
    const separator = type === 'DATE_CHANGED' ? ' – ' : type === 'ROOMMATE_CHANGED' ? ' + ' : ' · ';
    return { type, title: CHANGE_TITLES[type], oldValue: ordered.map(item => formatValue(item.old, item.field)).join(separator), newValue: ordered.map(item => formatValue(item.new, item.field)).join(separator) };
  });
}

/** The single old-to-new visual language for import and assignment workspaces. */
export function PendingChanges({ changes, compact = false, className = '' }: { changes: ImportChangeDetail[]; compact?: boolean; className?: string }) {
  const blocks = groupAssignmentChanges(changes);
  if (!blocks.length) return null;
  return <div className={`${compact ? 'space-y-1' : 'space-y-2'} ${className}`}>
    {blocks.map(block => <div key={block.type} className={`rounded-lg border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] ${compact ? 'px-2 py-1.5' : 'p-3'}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--ops-tone-warning-text)]"><RefreshCw className="h-3 w-3" />{block.title} geändert</div>
      <div className={`grid items-center ${compact ? 'grid-cols-[1fr_auto_1fr] gap-1 text-[10px]' : 'grid-cols-[1fr_auto_1fr] gap-3 text-xs'}`}>
        <div className="min-w-0"><span className="block text-[9px] font-bold uppercase text-[var(--ops-text-muted)]">Alt</span><span className="block truncate font-mono text-[var(--ops-text-subtle)]" title={block.oldValue}>{block.oldValue}</span></div>
        <span aria-hidden="true" className="font-bold text-[var(--ops-warning)]">→</span>
        <div className="min-w-0"><span className="block text-[9px] font-bold uppercase text-[var(--ops-tone-warning-text)]">Neu</span><span className="block truncate font-mono font-bold text-[var(--ops-text)]" title={block.newValue}>{block.newValue}</span></div>
      </div>
    </div>)}
  </div>;
}

export function PersonPendingChanges({ occupants, compact = false }: { occupants: AssignmentChangeSubject[]; compact?: boolean }) {
  const affected = occupants.filter(item => item.hasPendingReview && item.importChangeDetails.length);
  return <div className="space-y-2">{affected.map(item => <section key={item.athleteId} aria-label={`Änderungen für ${item.firstname} ${item.lastname}`}>
    {affected.length > 1 && <div className="mb-1 text-[10px] font-extrabold text-[var(--ops-text)]">{item.firstname} {item.lastname}</div>}
    <PendingChanges changes={item.importChangeDetails} compact={compact} />
  </section>)}</div>;
}

export function StaySummary({ arrival, departure, compact = false }: { arrival?: string | null; departure?: string | null; compact?: boolean }) {
  return <div className={`grid grid-cols-2 gap-2 ${compact ? 'text-[10px]' : 'text-xs'}`}>
    <div><span className="block text-[9px] font-bold uppercase tracking-wide text-[var(--ops-text-muted)]">Anreise</span><span className="font-mono font-semibold text-[var(--ops-text)]">{formatValue(arrival, 'arrivalDate')}</span></div>
    <div><span className="block text-[9px] font-bold uppercase tracking-wide text-[var(--ops-text-muted)]">Abreise</span><span className="font-mono font-semibold text-[var(--ops-text)]">{formatValue(departure, 'departureDate')}</span></div>
  </div>;
}

/** Person-level stays used wherever a room can contain different travel dates. */
export function OccupantStays({ occupants, compact = false }: { occupants: Array<{ athleteId: string; firstname: string; lastname: string; arrivalDate?: string | null; departureDate?: string | null }>; compact?: boolean }) {
  return <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
    {occupants.map(occupant => <div key={occupant.athleteId} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 text-[10px]">
      <span className="truncate font-semibold text-[var(--ops-text)]" title={`${occupant.firstname} ${occupant.lastname}`}>{occupant.firstname} {occupant.lastname}</span>
      <span className="whitespace-nowrap font-mono font-semibold text-[var(--ops-text-subtle)]">{formatValue(occupant.arrivalDate, 'arrivalDate')} – {formatValue(occupant.departureDate, 'departureDate')}</span>
    </div>)}
  </div>;
}

export type AssignmentStatus = 'review' | 'import-changed' | 'roommate-changed' | 'stay-changed' | 'hotel-changed' | 'room-type-changed' | 'open' | 'partial' | 'assigned';
const STATUS = {
  review: { label: 'Disposition prüfen', tone: 'warning' },
  'import-changed': { label: 'Import geändert', tone: 'warning' },
  'roommate-changed': { label: 'Zimmerpartner geändert', tone: 'warning' },
  'stay-changed': { label: 'Aufenthalt geändert', tone: 'warning' },
  'hotel-changed': { label: 'Hotel geändert', tone: 'warning' },
  'room-type-changed': { label: 'Zimmerart geändert', tone: 'warning' },
  open: { label: 'Offen', tone: 'warning' },
  partial: { label: 'Teilweise disponiert', tone: 'info' },
  assigned: { label: 'Zugewiesen', tone: 'success' },
} as const;
export function AssignmentStatusChip({ status }: { status: AssignmentStatus }) { const item = STATUS[status]; return <StatusChip tone={item.tone}>{item.label}</StatusChip>; }
