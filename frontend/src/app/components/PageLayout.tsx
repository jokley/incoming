import type { ReactNode } from 'react';

const readOnlyTooltip = 'Nur für Benutzer mit Bearbeitungsrechten verfügbar.';

export function PageLayout({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-6 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-2xl font-bold tracking-tight text-slate-950" title={title}>{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ContentCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-slate-200/80 bg-white/95 shadow-sm ${className}`}>{children}</div>;
}

export function PermissionButton({ allowed, children, className = '', disabled, title, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { allowed: boolean }) {
  const isDisabled = disabled || !allowed;
  return (
    <button
      {...props}
      disabled={isDisabled}
      title={!allowed ? readOnlyTooltip : title}
      className={`${className} ${isDisabled ? 'cursor-not-allowed opacity-50 hover:bg-inherit' : ''}`}
    >
      {children}
    </button>
  );
}

export const READ_ONLY_TOOLTIP = readOnlyTooltip;
