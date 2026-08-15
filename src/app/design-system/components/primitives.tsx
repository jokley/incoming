import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
type Density = 'comfortable' | 'compact';
type Elevation = 'none' | 'sm' | 'md' | 'lg';
type Surface = 'default' | 'raised' | 'elevated';

export const semanticToneClasses: Record<Tone, string> = {
  neutral: 'border-[var(--ops-tone-neutral-border)] bg-[var(--ops-tone-neutral-surface)] text-[var(--ops-tone-neutral-text)]',
  primary: 'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)] text-[var(--ops-tone-primary-text)]',
  success: 'border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)] text-[var(--ops-tone-success-text)]',
  warning: 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] text-[var(--ops-tone-warning-text)]',
  error: 'border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)] text-[var(--ops-tone-error-text)]',
  info: 'border-[var(--ops-tone-info-border)] bg-[var(--ops-tone-info-surface)] text-[var(--ops-tone-info-text)]',
};

const elevationClasses: Record<Elevation, string> = {
  none: 'shadow-none',
  sm: 'shadow-[var(--ops-shadow-sm)]',
  md: 'shadow-[var(--ops-shadow-md)]',
  lg: 'shadow-[var(--ops-shadow-lg)]',
};

const surfaceClasses: Record<Surface, string> = {
  default: 'bg-[var(--ops-surface)]',
  raised: 'bg-[var(--ops-surface-raised)]',
  elevated: 'bg-[var(--ops-surface-elevated)]',
};

export function AppLayout({ children, sidebar, header, className = '' }: { children: ReactNode; sidebar?: ReactNode; header?: ReactNode; className?: string }) {
  return <div className={clsx('min-h-screen bg-[var(--ops-background)] text-[var(--ops-text)]', className)}>{header}<div className="mx-auto flex w-full max-w-[var(--ops-layout-max)] gap-[calc(var(--ops-space)*2)] px-[calc(var(--ops-space)*2)] py-[calc(var(--ops-space)*2)]">{sidebar && <aside className="w-72 shrink-0">{sidebar}</aside>}<main className="min-w-0 flex-1">{children}</main></div></div>;
}

export function PageLayout({ children, className = '', density = 'comfortable' }: { children: ReactNode; className?: string; density?: Density }) {
  return <div className={clsx('mx-auto w-full max-w-[var(--ops-layout-max)]', density === 'compact' ? 'space-y-[calc(var(--ops-space)*2)]' : 'space-y-[calc(var(--ops-space)*3)]', className)}>{children}</div>;
}

/**
 * Shared viewport shell for all master/detail workspaces.
 *
 * The application frame owns the viewport while this component owns the
 * remaining height below the global navigation. Individual pages only define
 * their content; spacing and overflow behavior stay consistent here.
 */
export function SplitPageLayout({ children, className = '', density = 'comfortable' }: { children: ReactNode; className?: string; density?: Density }) {
  return <div className={clsx(
    'ops-split-page mx-auto flex h-full min-h-0 w-full max-w-[var(--ops-layout-max)] flex-col',
    density === 'compact' ? 'gap-[calc(var(--ops-space)*2)]' : 'gap-[calc(var(--ops-space)*2.5)]',
    className,
  )}>{children}</div>;
}

export function SplitPaneLayout({ sidebar, children, className = '', sidebarClassName = '', contentClassName = '' }: { sidebar: ReactNode; children: ReactNode; className?: string; sidebarClassName?: string; contentClassName?: string }) {
  return <div className={clsx('flex min-h-0 flex-1 flex-col gap-[calc(var(--ops-space)*2.5)] xl:flex-row', className)}><aside className={clsx('min-h-0 xl:w-[22rem] xl:shrink-0 xl:overflow-y-auto', sidebarClassName)}>{sidebar}</aside><main className={clsx('min-h-0 min-w-0 flex-1 xl:overflow-y-auto', contentClassName)}>{children}</main></div>;
}

export function WorkspaceFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={clsx('flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[var(--ops-radius-xxl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] text-[var(--ops-text)] shadow-[var(--ops-shadow-md)]', className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, eyebrow, actions, meta, className = '' }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; meta?: ReactNode; className?: string }) {
  return <header className={clsx('rounded-[var(--ops-radius-xxl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] px-[calc(var(--ops-space)*2.5)] py-[calc(var(--ops-space)*2)] shadow-[var(--ops-shadow-sm)]', className)}><div className="flex flex-col gap-[calc(var(--ops-space)*2)] md:flex-row md:items-start md:justify-between"><div className="min-w-0">{eyebrow && <div className="mb-[var(--ops-space)] text-[var(--ops-type-label-size)] font-extrabold uppercase tracking-[0.14em] text-[var(--ops-text-subtle)]">{eyebrow}</div>}<h1 className="truncate text-[var(--ops-type-page-title-size)] font-bold leading-tight tracking-[-0.02em] text-[var(--ops-text)]">{title}</h1>{subtitle && <p className="mt-1 max-w-3xl text-[var(--ops-type-body-size)] leading-[var(--ops-type-body-line)] text-[var(--ops-text-muted)]">{subtitle}</p>}{meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}</div>{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}</div></header>;
}

export function SectionHeader({ title, subtitle, actions, className = '' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return <div className={clsx('flex items-center justify-between gap-3', className)}><div><h2 className="text-[var(--ops-type-section-title-size)] font-extrabold uppercase tracking-[0.14em] text-[var(--ops-text-subtle)]">{title}</h2>{subtitle && <p className="mt-1 text-[var(--ops-type-caption-size)] text-[var(--ops-text-muted)]">{subtitle}</p>}</div>{actions && <div className="flex items-center gap-2">{actions}</div>}</div>;
}

export function ContentCard({ children, className = '', interactive = false, elevation = 'sm', surface = 'default' }: { children: ReactNode; className?: string; interactive?: boolean; elevation?: Elevation; surface?: Surface }) {
  return <section className={clsx('rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)]', surfaceClasses[surface], elevationClasses[elevation], interactive && 'transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-elevated)] focus-within:shadow-[var(--ops-focus-ring)]', className)}>{children}</section>;
}

export function DataPanel({ children, title, actions, className = '' }: { children: ReactNode; title?: ReactNode; actions?: ReactNode; className?: string }) {
  return <ContentCard className={clsx('overflow-hidden', className)}>{(title || actions) && <div className="flex min-h-12 items-center justify-between border-b border-[var(--ops-divider)] px-4 py-3"><SectionHeader title={title} />{actions}</div>}<div>{children}</div></ContentCard>;
}

export function DetailSidebar({ children, title, className = '' }: { children: ReactNode; title?: ReactNode; className?: string }) {
  return <aside className={clsx('h-full rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)]', className)}>{title && <div className="border-b border-[var(--ops-divider)] px-4 py-3"><SectionHeader title={title} /></div>}<div className="p-4">{children}</div></aside>;
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={clsx('flex flex-wrap items-center gap-2 rounded-[var(--ops-radius-lg)] border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-2 shadow-[var(--ops-shadow-xs)]', className)}>{children}</div>; }
export const SearchToolbar = Toolbar;
export const FilterToolbar = Toolbar;
export const ActionToolbar = Toolbar;
export const SectionToolbar = Toolbar;

export function StatusChip({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) { return <span data-tone={tone} className={clsx('inline-flex items-center rounded-[var(--ops-radius-sm)] border px-2 py-0.5 text-[11px] font-bold', semanticToneClasses[tone])}>{children}</span>; }
export const ProgressChip = StatusChip;
export const SeverityBadge = StatusChip;

export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) { return <div className="rounded-[var(--ops-radius-xl)] border border-dashed border-[var(--ops-border-strong)] px-6 py-10 text-center"><div className="font-semibold text-[var(--ops-text)]">{title}</div>{description && <p className="mt-2 text-sm text-[var(--ops-text-muted)]">{description}</p>}{action && <div className="mt-4">{action}</div>}</div>; }
export function LoadingState({ label = 'Laden…' }: { label?: ReactNode }) { return <div role="status" aria-live="polite" className="animate-pulse rounded-[var(--ops-radius-xl)] border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6 text-sm text-[var(--ops-text-muted)]">{label}</div>; }
export function ErrorState({ title = 'Fehler', description, action }: { title?: ReactNode; description?: ReactNode; action?: ReactNode }) { return <InfoPanel tone="error" title={title} action={action}>{description}</InfoPanel>; }
export function InfoPanel({ children, title, tone = 'info', action }: { children?: ReactNode; title?: ReactNode; tone?: Tone; action?: ReactNode }) { return <div data-tone={tone} className={clsx('rounded-[var(--ops-radius-lg)] border p-4', semanticToneClasses[tone])}><div className="flex items-start justify-between gap-3"><div>{title && <div className="font-bold">{title}</div>}{children && <div className="mt-1 text-sm opacity-95">{children}</div>}</div>{action}</div></div>; }
export const ConfirmationPanel = InfoPanel;

export function DialogHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) { return <div className="border-b border-[var(--ops-divider)] px-5 py-4"><h2 className="text-[var(--ops-type-title-size)] font-bold text-[var(--ops-text)]">{title}</h2>{subtitle && <p className="mt-1 text-sm text-[var(--ops-text-muted)]">{subtitle}</p>}</div>; }
export function DialogFooter({ children }: { children: ReactNode }) { return <div className="flex justify-end gap-2 border-t border-[var(--ops-divider)] px-5 py-4">{children}</div>; }
export function OpsButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={clsx('rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2 text-sm font-bold text-[var(--ops-text)] transition-[background-color,border-color,box-shadow] duration-150 hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-tone-primary-surface)] focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50', className)} />; }
export function InlineActionLink({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button type={type} {...props} className={clsx('inline-flex cursor-pointer items-center gap-1 font-semibold text-[var(--ops-primary)] transition-colors hover:text-[var(--ops-primary-emphasis)] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50', className)} />; }
export type OpsDivProps = HTMLAttributes<HTMLDivElement>;
