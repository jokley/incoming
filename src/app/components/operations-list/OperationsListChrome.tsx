import type { ReactNode } from 'react';
import { FileSpreadsheet, Search } from 'lucide-react';
import { ContentCard, OpsButton, Toolbar } from '../../design-system';

export type SummaryMetric = { id: string; label: string; value: string | number; emphasis?: boolean };

export function OperationsSummaryHeader({ metrics, hidden = false }: { metrics: SummaryMetric[]; hidden?: boolean }) {
  if (hidden) return null;
  return <ContentCard className="grid min-h-[3.75rem] grid-flow-col auto-cols-fr divide-x divide-[var(--ops-divider)] overflow-hidden" elevation="none">
    {metrics.map(metric => <div key={metric.id} className="flex min-w-0 flex-col justify-center px-4 py-2.5">
      <div className={`${metric.emphasis ? 'text-lg' : 'text-base'} leading-5 font-extrabold tabular-nums text-[var(--ops-text)]`}>{metric.value}</div>
      <div className="text-[9px] font-bold uppercase tracking-[.1em] text-[var(--ops-text-subtle)]">{metric.label}</div>
    </div>)}
  </ContentCard>;
}

export function OperationsListToolbar({
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
    <label className="flex h-8 min-w-[18rem] flex-1 items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5">
      <Search aria-hidden="true" size={15}/><input aria-label="Liste durchsuchen" className="w-full bg-transparent text-xs outline-none" placeholder={searchPlaceholder} value={search} onChange={event => onSearchChange(event.target.value)}/>
    </label>
    <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-subtle)]">Gruppieren
      <select aria-label="Liste gruppieren" className="h-8 min-w-28 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 text-xs font-medium normal-case tracking-normal text-[var(--ops-text)]" value={grouping} onChange={event => onGroupingChange(event.target.value)}>
        {groupingOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    {filters}
    <OpsButton className="ml-auto h-8 px-3 text-[10px]" onClick={onExport} disabled={exportDisabled}><FileSpreadsheet className="mr-1.5 inline" size={13}/>Excel</OpsButton>
  </Toolbar></ContentCard>;
}

export const listControlClass = 'h-8 min-w-28 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-2.5 text-xs';
