import { memo, useCallback, useMemo, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Tooltip } from '@mui/material';
import { CalendarDays } from 'lucide-react';

export type TimelineDate = string | Date;

/** Content rendered by the generic, data-driven tooltip. */
export interface TimelineTooltipData {
  title?: ReactNode;
  subtitle?: ReactNode;
  start?: TimelineDate;
  end?: TimelineDate;
  duration?: ReactNode;
  badges?: ReactNode[];
  status?: ReactNode;
  description?: ReactNode;
}

export interface TimelineSegment {
  id: string;
  start: TimelineDate;
  end: TimelineDate;
  color?: string;
  label?: string;
  /** Structured tooltip content. Missing dates and duration are derived from the segment. */
  tooltipData?: TimelineTooltipData;
  /** Custom tooltip content retained for backwards compatibility. */
  tooltip?: ReactNode;
  progress?: number;
  status?: string;
  ariaLabel?: string;
}

export interface TimelineRowData {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  start?: TimelineDate;
  end?: TimelineDate;
  color?: string;
  status?: string;
  badges?: ReactNode[];
  description?: ReactNode;
  tooltipData?: TimelineTooltipData;
  tooltip?: ReactNode;
  progress?: number;
  segments?: TimelineSegment[];
  ariaLabel?: string;
}

export interface TimelineLegendItem { label: string; color: string }

export interface TimelineHeaderConfig {
  title?: ReactNode;
  showDateRange?: boolean;
  showDayCount?: boolean;
}

export interface OperationsTimelineProps {
  startDate: TimelineDate;
  endDate: TimelineDate;
  rows: TimelineRowData[];
  legend?: TimelineLegendItem[];
  tickInterval?: number;
  emptyMessage?: string;
  header?: TimelineHeaderConfig;
  showTodayMarker?: boolean;
  /** The injected current date. No marker is rendered when null or outside the range. */
  today?: TimelineDate | null;
  onRowClick?: (row: TimelineRowData) => void;
  onSegmentClick?: (row: TimelineRowData, segment: TimelineSegment) => void;
  selectedRowId?: string;
  selectedSegmentId?: string;
  ariaLabel?: string;
}

const DAY = 86_400_000;
const asDate = (value: TimelineDate) => {
  const date = value instanceof Date ? value : new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const formatDate = (value: TimelineDate, year = false) => asDate(value).toLocaleDateString('de-DE', year ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const daysBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / DAY);
const inclusiveDays = (start: TimelineDate, end: TimelineDate) => Math.max(1, daysBetween(asDate(start), asDate(end)) + 1);

function getTicks(start: Date, end: Date, interval: number) {
  const ticks: Date[] = [];
  for (let offset = 0; offset <= daysBetween(start, end); offset += interval) ticks.push(new Date(start.getTime() + offset * DAY));
  if (ticks.at(-1)?.getTime() !== end.getTime()) ticks.push(end);
  return ticks;
}

const TimelineAxis = memo(function TimelineAxis({ start, end, tickInterval = 2 }: { start: Date; end: Date; tickInterval?: number }) {
  const ticks = useMemo(() => getTicks(start, end, tickInterval), [start, end, tickInterval]);
  const span = Math.max(1, daysBetween(start, end));
  return <div className="relative h-12" aria-hidden="true">{ticks.map((tick, index) => {
    const left = Math.min(100, Math.max(0, daysBetween(start, tick) / span * 100));
    return <div key={tick.toISOString()} className="absolute inset-y-0" style={{ left: `${left}%` }}>
      <span className={`absolute top-1 whitespace-nowrap text-[10px] font-bold tabular-nums text-[var(--ops-text-muted)] ${index === 0 ? '' : index === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}>{formatDate(tick)}</span>
      <span className="absolute bottom-0 h-3 border-l border-[var(--ops-border)]" />
    </div>;
  })}</div>;
});

const TodayMarker = memo(function TodayMarker({ left, label = false }: { left: number; label?: boolean }) {
  return <div className="pointer-events-none absolute inset-y-0 z-20 border-l-2 border-[var(--ops-warning,#f59e0b)]/70" style={{ left: `${left}%` }} aria-hidden="true">
    {label && <span className="absolute top-0 -translate-x-1/2 rounded bg-[var(--ops-warning,#f59e0b)] px-1.5 py-0.5 text-[9px] font-extrabold text-slate-950 shadow-sm">Heute</span>}
  </div>;
});

const TimelineHeader = memo(function TimelineHeader({ start, end, tickInterval, config, todayLeft }: { start: Date; end: Date; tickInterval?: number; config?: TimelineHeaderConfig; todayLeft?: number }) {
  const hasSummary = config && (config.title || config.showDateRange || config.showDayCount);
  return <>
    {hasSummary && <div className="flex min-w-[760px] flex-wrap items-center gap-x-5 gap-y-1 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)] px-4 py-3">
      {config.title && <strong className="text-sm text-[var(--ops-text)]">{config.title}</strong>}
      {config.showDateRange && <span className="text-xs font-semibold tabular-nums text-[var(--ops-text-subtle)]">{formatDate(start, true)} <span className="mx-2 text-[var(--ops-text-muted)]">—</span> {formatDate(end, true)}</span>}
      {config.showDayCount && <span className="rounded-md border border-[var(--ops-border)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ops-text-muted)]">{inclusiveDays(start, end)} Tage</span>}
    </div>}
    <div className="grid min-w-[760px] grid-cols-[12rem_minmax(28rem,1fr)_10rem] border-b border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)]">
      <div className="flex items-center gap-2 border-r border-[var(--ops-divider)] px-4 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ops-text-muted)]"><CalendarDays size={14} />Kategorie</div>
      <div className="relative px-4"><TimelineAxis start={start} end={end} tickInterval={tickInterval} />{todayLeft !== undefined && <div className="absolute inset-y-0 left-4 right-4"><TodayMarker left={todayLeft} label /></div>}</div>
      <div className="flex items-center justify-between border-l border-[var(--ops-divider)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]"><span>Start</span><span>Ende</span></div>
    </div>
  </>;
});

function TooltipContent({ data }: { data: TimelineTooltipData }) {
  return <div className="max-w-xs py-1 text-xs">
    {data.title && <div className="font-extrabold">{data.title}</div>}
    {data.subtitle && <div className="mt-0.5 opacity-75">{data.subtitle}</div>}
    {(data.start || data.end) && <div className="mt-2 tabular-nums">{data.start ? formatDate(data.start, true) : '–'} – {data.end ? formatDate(data.end, true) : '–'}</div>}
    {data.duration && <div className="mt-0.5 opacity-80">Dauer: {data.duration}</div>}
    {data.status && <div className="mt-1">Status: {data.status}</div>}
    {data.badges?.length ? <div className="mt-2 flex flex-wrap gap-1">{data.badges.map((badge, index) => <span key={index}>{badge}</span>)}</div> : null}
    {data.description && <div className="mt-2 border-t border-[var(--ops-divider)] pt-2 opacity-90">{data.description}</div>}
  </div>;
}

const TimelineBar = memo(function TimelineBar({ segment, timelineStart, timelineEnd, selected, onClick, tooltipData }: { segment: TimelineSegment; timelineStart: Date; timelineEnd: Date; selected?: boolean; onClick?: () => void; tooltipData: TimelineTooltipData }) {
  const span = Math.max(1, daysBetween(timelineStart, timelineEnd));
  const segmentStart = asDate(segment.start), segmentEnd = asDate(segment.end);
  const left = Math.max(0, daysBetween(timelineStart, segmentStart) / span * 100);
  const right = Math.min(100, daysBetween(timelineStart, segmentEnd) / span * 100);
  const style = { left: `${left}%`, width: `${Math.max(0.8, right - left)}%`, '--timeline-color': segment.color || 'var(--ops-primary-emphasis)' } as CSSProperties;
  const bar = <button type="button" onClick={(event) => { event.stopPropagation(); onClick?.(); }} className={`absolute top-1/2 h-7 -translate-y-1/2 overflow-hidden rounded-md border border-white/20 bg-[var(--timeline-color)] text-left shadow-[0_5px_16px_rgba(2,8,23,.3)] transition-[filter,box-shadow,transform] duration-150 hover:-translate-y-[52%] hover:brightness-110 focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ops-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ops-surface)] ${selected ? 'z-10 ring-2 ring-[var(--ops-focus)] ring-offset-2 ring-offset-[var(--ops-surface)] brightness-110' : ''} ${onClick ? 'cursor-pointer' : 'cursor-default'}`} style={style} aria-pressed={onClick ? selected : undefined} aria-label={segment.ariaLabel || `${segment.label || 'Zeitraum'}: ${formatDate(segment.start, true)} bis ${formatDate(segment.end, true)}`}>
    {segment.progress !== undefined && <span className="absolute inset-y-0 left-0 bg-white/20" style={{ width: `${Math.min(100, Math.max(0, segment.progress))}%` }} />}
    {segment.label && <span className="relative block truncate px-2 text-[10px] font-extrabold text-[var(--ops-on-accent)]">{segment.label}</span>}
  </button>;
  const content = segment.tooltip ?? <TooltipContent data={tooltipData} />;
  return <Tooltip title={content} arrow placement="top" slotProps={{ tooltip: { sx: { bgcolor: 'var(--ops-surface)', color: 'var(--ops-text)', border: '1px solid var(--ops-border-strong)', boxShadow: 'var(--ops-shadow-md)' } }, arrow: { sx: { color: 'var(--ops-surface)', '&::before': { border: '1px solid var(--ops-border-strong)' } } } }}>{bar}</Tooltip>;
});

const TimelineRow = memo(function TimelineRow({ row, start, end, onRowClick, onSegmentClick, selectedRowId, selectedSegmentId, todayLeft }: { row: TimelineRowData; start: Date; end: Date; onRowClick?: OperationsTimelineProps['onRowClick']; onSegmentClick?: OperationsTimelineProps['onSegmentClick']; selectedRowId?: string; selectedSegmentId?: string; todayLeft?: number }) {
  const segments = useMemo<TimelineSegment[]>(() => row.segments?.length ? row.segments : row.start && row.end ? [{ id: `${row.id}-period`, start: row.start, end: row.end, color: row.color, tooltip: row.tooltip, tooltipData: row.tooltipData, progress: row.progress, status: row.status }] : [], [row]);
  const first = useMemo(() => segments.reduce<TimelineSegment | undefined>((current, item) => !current || asDate(item.start) < asDate(current.start) ? item : current, undefined), [segments]);
  const last = useMemo(() => segments.reduce<TimelineSegment | undefined>((current, item) => !current || asDate(item.end) > asDate(current.end) ? item : current, undefined), [segments]);
  const selected = selectedRowId === row.id;
  const handleRowClick = useCallback(() => onRowClick?.(row), [onRowClick, row]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && onRowClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleRowClick(); }
  }, [handleRowClick, onRowClick]);
  return <div role="row" tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? handleRowClick : undefined} onKeyDown={handleKeyDown} aria-label={row.ariaLabel || (typeof row.title === 'string' ? row.title : `Timeline-Zeile ${row.id}`)} aria-selected={selected} className={`grid min-h-[72px] min-w-[760px] grid-cols-[12rem_minmax(28rem,1fr)_10rem] border-b border-[var(--ops-divider)] transition-colors duration-150 last:border-b-0 hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ops-focus)] ${selected ? 'bg-[var(--ops-primary-emphasis)]/10 shadow-[inset_3px_0_var(--ops-focus)]' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}>
    <div role="rowheader" className="flex min-w-0 flex-col justify-center border-r border-[var(--ops-divider)] px-4"><div className="truncate text-sm font-extrabold text-[var(--ops-text)]">{row.title}</div>{row.subtitle && <div className="mt-1 truncate text-xs text-[var(--ops-text-muted)]">{row.subtitle}</div>}{row.badges?.length ? <div className="mt-1 flex gap-1">{row.badges.map((badge, i) => <span key={i}>{badge}</span>)}</div> : null}</div>
    <div role="cell" className="relative mx-4 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(11.111%_-_1px),var(--ops-divider)_calc(11.111%_-_1px),var(--ops-divider)_11.111%)]">{todayLeft !== undefined && <TodayMarker left={todayLeft} />}{segments.map(segment => {
      const tooltipData = { title: row.title, subtitle: row.subtitle, badges: row.badges, description: row.description, status: segment.status || row.status, ...row.tooltipData, start: segment.start, end: segment.end, duration: `${inclusiveDays(segment.start, segment.end)} Tage`, ...segment.tooltipData };
      return <TimelineBar key={segment.id} segment={segment} timelineStart={start} timelineEnd={end} selected={selectedSegmentId === segment.id} onClick={onSegmentClick ? () => onSegmentClick(row, segment) : undefined} tooltipData={tooltipData} />;
    })}</div>
    <div role="cell" className="flex items-center justify-between gap-2 border-l border-[var(--ops-divider)] px-4 text-xs font-bold tabular-nums text-[var(--ops-text-subtle)]"><time>{first ? formatDate(first.start) : '–'}</time><span className="text-[var(--ops-text-muted)]">→</span><time>{last ? formatDate(last.end) : '–'}</time></div>
  </div>;
});

const TimelineLegend = memo(function TimelineLegend({ items }: { items: TimelineLegendItem[] }) { return <div className="flex flex-wrap gap-4 border-t border-[var(--ops-divider)] px-4 py-3" aria-label="Legende">{items.map(item => <span key={item.label} className="flex items-center gap-2 text-xs text-[var(--ops-text-muted)]"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden="true" />{item.label}</span>)}</div>; });

export const OperationsTimeline = memo(function OperationsTimeline({ startDate, endDate, rows, legend, tickInterval = 2, emptyMessage = 'Keine Zeiträume vorhanden.', header, showTodayMarker = false, today = null, onRowClick, onSegmentClick, selectedRowId, selectedSegmentId, ariaLabel = 'Operations-Timeline' }: OperationsTimelineProps) {
  const start = useMemo(() => asDate(startDate), [startDate]);
  const end = useMemo(() => asDate(endDate), [endDate]);
  const todayLeft = useMemo(() => {
    if (!showTodayMarker || today === null) return undefined;
    const current = asDate(today);
    if (current < start || current > end) return undefined;
    return daysBetween(start, current) / Math.max(1, daysBetween(start, end)) * 100;
  }, [end, showTodayMarker, start, today]);
  if (end <= start) throw new Error('OperationsTimeline: endDate must be after startDate.');
  return <section aria-label={ariaLabel} className="overflow-hidden rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
    <div className="overflow-x-auto" role="table" aria-rowcount={rows.length}><TimelineHeader start={start} end={end} tickInterval={tickInterval} config={header} todayLeft={todayLeft} />{rows.length ? rows.map(row => <TimelineRow key={row.id} row={row} start={start} end={end} onRowClick={onRowClick} onSegmentClick={onSegmentClick} selectedRowId={selectedRowId} selectedSegmentId={selectedSegmentId} todayLeft={todayLeft} />) : <div className="p-8 text-center text-sm text-[var(--ops-text-muted)]">{emptyMessage}</div>}</div>
    {legend?.length ? <TimelineLegend items={legend} /> : null}
  </section>;
});
