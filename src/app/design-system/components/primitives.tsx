import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
type Density = 'comfortable' | 'compact';

const toneClasses: Record<Tone, string> = {
  neutral: 'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] text-[var(--ops-text)]',
  primary: 'border-blue-400/35 bg-blue-500/12 text-blue-100',
  success: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100',
  warning: 'border-amber-400/35 bg-amber-500/12 text-amber-100',
  error: 'border-rose-400/35 bg-rose-500/12 text-rose-100',
  info: 'border-sky-400/35 bg-sky-500/12 text-sky-100',
};

export function AppLayout({ children, sidebar, header, className = '' }: { children: ReactNode; sidebar?: ReactNode; header?: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-h-screen bg-[var(--ops-background)] text-[var(--ops-text)]', className)}>
      {header}
      <div className="mx-auto flex w-full max-w-[var(--ops-layout-max)] gap-4 px-4 py-4">
        {sidebar && <aside className="w-72 shrink-0">{sidebar}</aside>}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function PageLayout({ children, className = '', density = 'comfortable' }: { children: ReactNode; className?: string; density?: Density }) {
  return <div className={clsx('mx-auto w-full max-w-[var(--ops-layout-max)]', density === 'compact' ? 'space-y-4' : 'space-y-6', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, eyebrow, actions, meta, className = '' }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <header className={clsx('rounded-[var(--ops-radius-xxl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] px-5 py-4 shadow-[var(--ops-shadow-sm)]', className)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-2 text-[var(--ops-type-label-size)] font-extrabold uppercase tracking-[0.14em] text-[var(--ops-text-subtle)]">{eyebrow}</div>}
          <h1 className="truncate text-[var(--ops-type-page-title-size)] font-bold leading-tight tracking-[-0.02em] text-[var(--ops-text)]">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-[var(--ops-text-muted)]">{subtitle}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function SectionHeader({ title, subtitle, actions, className = '' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return <div className={clsx('flex items-center justify-between gap-3', className)}><div><h2 className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ops-text-muted)]">{title}</h2>{subtitle && <p className="mt-1 text-xs text-[var(--ops-text-subtle)]">{subtitle}</p>}</div>{actions && <div className="flex items-center gap-2">{actions}</div>}</div>;
}

export function ContentCard({ children, className = '', interactive = false }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return <section className={clsx('rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] shadow-[var(--ops-shadow-sm)]', interactive && 'transition hover:border-blue-300/45 hover:bg-[var(--ops-surface-elevated)]', className)}>{children}</section>;
}

export function DataPanel({ children, title, actions, className = '' }: { children: ReactNode; title?: ReactNode; actions?: ReactNode; className?: string }) {
  return <ContentCard className={clsx('overflow-hidden', className)}>{(title || actions) && <div className="flex min-h-12 items-center justify-between border-b border-[var(--ops-divider)] px-4 py-3"><SectionHeader title={title} />{actions}</div>}<div>{children}</div></ContentCard>;
}

export function DetailSidebar({ children, title, className = '' }: { children: ReactNode; title?: ReactNode; className?: string }) {
  return <aside className={clsx('h-full rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)]', className)}>{title && <div className="border-b border-[var(--ops-divider)] px-4 py-3"><SectionHeader title={title} /></div>}<div className="p-4">{children}</div></aside>;
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={clsx('flex flex-wrap items-center gap-2 rounded-[var(--ops-radius-lg)] border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-2', className)}>{children}</div>; }
export const SearchToolbar = Toolbar;
export const FilterToolbar = Toolbar;
export const ActionToolbar = Toolbar;
export const SectionToolbar = Toolbar;

export function StatusChip({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) { return <span className={clsx('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold', toneClasses[tone])}>{children}</span>; }
export const ProgressChip = StatusChip;
export const SeverityBadge = StatusChip;

export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) { return <div className="rounded-[var(--ops-radius-xl)] border border-dashed border-[var(--ops-border)] px-6 py-10 text-center"><div className="font-semibold text-[var(--ops-text)]">{title}</div>{description && <p className="mt-2 text-sm text-[var(--ops-text-muted)]">{description}</p>}{action && <div className="mt-4">{action}</div>}</div>; }
export function LoadingState({ label = 'Laden…' }: { label?: ReactNode }) { return <div className="animate-pulse rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6 text-sm text-[var(--ops-text-muted)]">{label}</div>; }
export function ErrorState({ title = 'Fehler', description, action }: { title?: ReactNode; description?: ReactNode; action?: ReactNode }) { return <InfoPanel tone="error" title={title} action={action}>{description}</InfoPanel>; }
export function InfoPanel({ children, title, tone = 'info', action }: { children?: ReactNode; title?: ReactNode; tone?: Tone; action?: ReactNode }) { return <div className={clsx('rounded-[var(--ops-radius-lg)] border p-4', toneClasses[tone])}><div className="flex items-start justify-between gap-3"><div>{title && <div className="font-bold">{title}</div>}{children && <div className="mt-1 text-sm opacity-90">{children}</div>}</div>{action}</div></div>; }
export const ConfirmationPanel = InfoPanel;

export function DialogHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) { return <div className="border-b border-[var(--ops-divider)] px-5 py-4"><h2 className="text-lg font-bold text-[var(--ops-text)]">{title}</h2>{subtitle && <p className="mt-1 text-sm text-[var(--ops-text-muted)]">{subtitle}</p>}</div>; }
export function DialogFooter({ children }: { children: ReactNode }) { return <div className="flex justify-end gap-2 border-t border-[var(--ops-divider)] px-5 py-4">{children}</div>; }
export function OpsButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={clsx('rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 text-sm font-bold text-[var(--ops-text)] transition hover:border-blue-300/45 hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-50', className)} />; }
export type OpsDivProps = HTMLAttributes<HTMLDivElement>;
