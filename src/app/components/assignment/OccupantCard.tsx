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

export function OccupantCard({ person, status, fallbackArrival, fallbackDeparture, footer, className = '', hideNation = false, hideDiscipline = false, hideRole = false, layout = 'responsive' }: {
  person: OccupantCardPerson;
  status: AssignmentStatus;
  fallbackArrival?: string | null;
  fallbackDeparture?: string | null;
  footer?: ReactNode;
  className?: string;
  hideNation?: boolean;
  hideDiscipline?: boolean;
  hideRole?: boolean;
  /** Responsive keeps the name readable by stacking compact cards; horizontal is for known-wide hosts. */
  layout?: 'responsive' | 'horizontal';
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

  return <article className={`ops-occupant-card rounded-lg border bg-[var(--ops-surface-elevated)] px-2.5 py-2 ${person.hasPendingReview ? 'border-[var(--ops-tone-warning-border)] ring-1 ring-[var(--ops-warning)]/35' : 'border-[var(--ops-border)]'} ${className}`}>
    <div className={`ops-occupant-card__content ${layout === 'horizontal' ? 'ops-occupant-card__content--horizontal' : ''}`}>
      <strong className="ops-occupant-card__name text-xs text-[var(--ops-text)]">{name}</strong>
      <span className="ops-occupant-card__details">
        {context.length > 0 && <span className="ops-occupant-card__context text-[10px] font-medium text-[var(--ops-text-muted)]" title={contextLabel}>{contextLabel}</span>}
        <span className="ops-occupant-card__stay whitespace-nowrap font-mono text-[10px] font-semibold text-[var(--ops-text-subtle)]">{shortDate(arrival)} → {shortDate(departure)}</span>
      </span>
      <span className="ops-occupant-card__status"><AssignmentStatusChip status={status} /></span>
    </div>
    {footer && <div className="mt-1.5">{footer}</div>}
  </article>;
}
