import type { ReactNode } from 'react';

import { AssignmentStatusChip, type AssignmentStatus } from './AssignmentInfo';

export type OccupantCardPerson = {
  athleteId: string;
  name?: string;
  firstname?: string;
  lastname?: string;
  nationCode?: string | null;
  discipline?: string | null;
  function?: string | null;
  arrivalDate?: string | null;
  departureDate?: string | null;
  hasPendingReview?: boolean;
};

const shortDate = (value?: string | null) => value
  ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  : '—';

export function OccupantCard({ person, status, fallbackArrival, fallbackDeparture, footer, className = '', hideNation = false, hideDiscipline = false, hideRole = false }: {
  person: OccupantCardPerson;
  status: AssignmentStatus;
  fallbackArrival?: string | null;
  fallbackDeparture?: string | null;
  footer?: ReactNode;
  className?: string;
  hideNation?: boolean;
  hideDiscipline?: boolean;
  hideRole?: boolean;
}) {
  const name = person.name || `${person.firstname || ''} ${person.lastname || ''}`.trim() || '—';
  const context = [
    !hideNation && (person.nationCode || '—'),
    !hideDiscipline && (person.discipline || '—'),
    !hideRole && (person.function || 'Athlet'),
  ].filter((value): value is string => Boolean(value));
  const contextLabel = context.join(' · ');
  const arrival = person.arrivalDate || fallbackArrival;
  const departure = person.departureDate || fallbackDeparture;

  return <article className={`rounded-lg border bg-[var(--ops-surface-elevated)] px-2.5 py-2 ${person.hasPendingReview ? 'border-[var(--ops-tone-warning-border)] ring-1 ring-[var(--ops-warning)]/35' : 'border-[var(--ops-border)]'} ${className}`}>
    <div className={`grid min-w-0 items-center gap-x-3 gap-y-1 ${context.length ? 'grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto_auto]'}`}>
      <strong className="truncate text-xs text-[var(--ops-text)]" title={name}>{name}</strong>
      {context.length > 0 && <span className="truncate text-[10px] font-medium text-[var(--ops-text-muted)]" title={contextLabel}>{contextLabel}</span>}
      <span className="whitespace-nowrap font-mono text-[10px] font-semibold text-[var(--ops-text-subtle)]">{shortDate(arrival)} → {shortDate(departure)}</span>
      <AssignmentStatusChip status={status} />
    </div>
    {footer && <div className="mt-1.5">{footer}</div>}
  </article>;
}
