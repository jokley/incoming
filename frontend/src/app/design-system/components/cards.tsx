import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Link } from 'react-router';
import { ContentCard, SectionHeader, StatusChip } from './primitives';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

type MetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  /** The period or data state in which the value is valid. */
  context?: ReactNode;
  /** The decision or next step represented by the linked work context. */
  action?: ReactNode;
  href?: string;
  icon?: ReactNode;
  helper?: ReactNode;
  trend?: ReactNode;
  tone?: Tone;
  compact?: boolean;
};

export function MetricCard({ label, value, context, action, href, icon, helper, trend, tone = 'neutral', compact = false }: MetricCardProps) {
  const detail = context && helper ? <>{context} · {helper}</> : context || helper;
  const status = action || trend;
  const content = <div className={clsx('flex h-full min-w-0 items-start', compact ? 'gap-2.5' : 'gap-3')}>
    {icon && <span className={clsx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ops-radius-lg)]', toneAccent[tone])}>{icon}</span>}
    <div className="min-w-0 flex-1">
      <div className={clsx('font-extrabold uppercase text-[var(--ops-text-subtle)]', compact ? 'text-[10px] tracking-[0.06em]' : 'text-[11px] tracking-[0.14em]')}>{label}</div>
      <div className={clsx('font-mono text-[var(--ops-type-kpi-size)] font-extrabold leading-none text-[var(--ops-text)]', compact ? 'mt-1.5 tracking-[-0.04em]' : 'mt-3')}>{value}</div>
      {(detail || status) && <div className={clsx('flex items-center justify-between gap-2 text-xs text-[var(--ops-text-muted)]', compact ? 'mt-1.5 leading-4' : 'mt-3')}>
        {detail && <span className="truncate">{detail}</span>}
        {status && <StatusChip tone={tone}>{status}</StatusChip>}
      </div>}
    </div>
  </div>;

  return <ContentCard interactive={Boolean(href)} className={clsx(compact ? 'min-h-[6.5rem] p-3' : 'p-4')} surface={compact ? 'elevated' : 'default'} elevation={compact ? 'none' : 'sm'}>
    {href ? <Link to={href} className="block h-full focus-visible:outline-none" aria-label={`${String(label)}: ${String(value)}. ${String(action || helper || '')}`}>{content}</Link> : content}
  </ContentCard>;
}

const toneAccent: Record<Tone, string> = {
  neutral: 'bg-[var(--ops-surface-overlay)] text-[var(--ops-text-muted)]',
  primary: 'bg-[var(--ops-tone-primary-surface)] text-[var(--ops-primary)]',
  success: 'bg-[var(--ops-tone-success-surface)] text-[var(--ops-success)]',
  warning: 'bg-[var(--ops-tone-warning-surface)] text-[var(--ops-warning)]',
  error: 'bg-[var(--ops-tone-error-surface)] text-[var(--ops-error)]',
  info: 'bg-[var(--ops-tone-info-surface)] text-[var(--ops-info)]',
};

export function StatusCard({ title, status, children, tone = 'neutral' }: { title: ReactNode; status: ReactNode; children?: ReactNode; tone?: Tone }) { return <ContentCard className="p-4"><SectionHeader title={title} actions={<StatusChip tone={tone}>{status}</StatusChip>} />{children && <div className="mt-4 text-sm text-[var(--ops-text-muted)]">{children}</div>}</ContentCard>; }
export function EntityCard({ title, subtitle, meta, actions, children }: { title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) { return <ContentCard interactive className="p-4"><div className="flex justify-between gap-3"><div className="min-w-0"><div className="truncate font-bold text-[var(--ops-text)]">{title}</div>{subtitle && <div className="mt-1 truncate text-xs text-[var(--ops-text-muted)]">{subtitle}</div>}</div>{actions}</div>{meta && <div className="mt-3 flex flex-wrap gap-2">{meta}</div>}{children && <div className="mt-4">{children}</div>}</ContentCard>; }
export function ProgressCard({ title, value, max = 100, label }: { title: ReactNode; value: number; max?: number; label?: ReactNode }) { const percent = Math.max(0, Math.min(100, (value / max) * 100)); return <ContentCard className="p-4"><SectionHeader title={title} actions={label} /><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--ops-background)]"><div className="h-full rounded-full bg-[var(--ops-primary)] transition-[width] duration-300" style={{ width: `${percent}%` }} /></div></ContentCard>; }
export function TimelineCard({ title, items }: { title: ReactNode; items: Array<{ id: string; title: ReactNode; meta?: ReactNode; tone?: Tone }> }) { return <ContentCard className="p-4"><SectionHeader title={title} /><ol className="mt-4 space-y-3">{items.map((item) => <li key={item.id} className="flex gap-3"><span className={clsx('mt-1 h-2 w-2 rounded-full', item.tone === 'warning' ? 'bg-[var(--ops-warning)]' : item.tone === 'error' ? 'bg-[var(--ops-error)]' : item.tone === 'success' ? 'bg-[var(--ops-success)]' : 'bg-[var(--ops-primary)]')} /><div className="min-w-0 text-sm"><div className="text-[var(--ops-text)]">{item.title}</div>{item.meta && <div className="text-xs text-[var(--ops-text-subtle)]">{item.meta}</div>}</div></li>)}</ol></ContentCard>; }
export function InfoCard({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) { return <ContentCard className="p-4"><SectionHeader title={title} actions={actions} />{children && <div className="mt-4 text-sm text-[var(--ops-text-muted)]">{children}</div>}</ContentCard>; }
