import type { ReactNode } from 'react';
import { FileSpreadsheet, Search } from 'lucide-react';
import { ContentCard, OpsButton, Toolbar } from '../../design-system';

export type SummaryMetric = { id: string; label: string; value: string | number | null | undefined; emphasis?: boolean };

export function OverviewSummaryHeader({ metrics, hidden = false }: { metrics: SummaryMetric[]; hidden?: boolean }) {
  const validMetrics = metrics.filter(metric => metric.value !== null && metric.value !== undefined && metric.value !== '' && (typeof metric.value !== 'number' || Number.isFinite(metric.value)));
  if (hidden || validMetrics.length === 0) return null;
  return <ContentCard className="grid min-h-16 grid-cols-2 divide-x divide-y divide-[var(--ops-divider)] overflow-hidden sm:grid-cols-none sm:grid-flow-col sm:auto-cols-fr sm:divide-y-0" elevation="none">
    {validMetrics.map(metric => <div key={metric.id} className="flex min-h-16 min-w-0 flex-col justify-center px-3 py-2.5 sm:px-4">
      <div className={`${metric.emphasis ? 'text-lg' : 'text-base'} truncate leading-5 font-extrabold tabular-nums text-[var(--ops-text)]`}>{metric.value}</div>
      <div className="truncate text-[9px] font-bold uppercase tracking-[.1em] text-[var(--ops-text-subtle)]" title={metric.label}>{metric.label}</div>
    </div>)}
  </ContentCard>;
}

export function OverviewToolbar({
  search, onSearchChange, searchPlaceholder, grouping, onGroupingChange, groupingOptions,
  filters, onExport, exportDisabled = false,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  grouping: string;
  onGroupingChange: (value: string) => void;
  groupingOptions: Array<{ value: string; label: string }>;
  filters?: ReactNode;
  onExport: () => void;
  exportDisabled?: boolean;
}) {
  return <ContentCard className="p-2.5" elevation="none"><Toolbar className="min-h-9 border-0 bg-transparent p-0 shadow-none">
    <label className="flex h-8 min-w-0 basis-full items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 sm:min-w-[18rem] sm:flex-1 sm:basis-72">
      <Search aria-hidden="true" size={15}/><input aria-label="Liste durchsuchen" className="w-full bg-transparent text-xs outline-none" placeholder={searchPlaceholder} value={search} onChange={event => onSearchChange(event.target.value)}/>
    </label>
    <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-[var(--ops-divider)] sm:block" />
    <label className="flex h-8 items-center gap-2 rounded-lg bg-[var(--ops-surface)] pl-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Gruppieren
      <select aria-label="Liste gruppieren" className="h-8 min-w-28 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 text-xs font-medium normal-case tracking-normal text-[var(--ops-text)]" value={grouping} onChange={event => onGroupingChange(event.target.value)}>
        {groupingOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    {filters}
    <OpsButton className="ml-auto h-8 px-3 text-[10px]" onClick={onExport} disabled={exportDisabled}><FileSpreadsheet className="mr-1.5 inline" size={13}/>Excel</OpsButton>
  </Toolbar></ContentCard>;
}

export const listControlClass = 'h-8 w-32 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 text-xs text-[var(--ops-text)]';
