import type { CSSProperties, ReactNode } from 'react';
import { Tooltip } from '@mui/material';
import { CalendarDays } from 'lucide-react';

export type TimelineDate = string | Date;

export interface TimelineSegment {
  id: string;
  start: TimelineDate;
  end: TimelineDate;
  color?: string;
  label?: string;
  tooltip?: ReactNode;
  progress?: number;
  status?: string;
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
  tooltip?: ReactNode;
  progress?: number;
  segments?: TimelineSegment[];
}

export interface TimelineLegendItem { label: string; color: string }

export interface OperationsTimelineProps {
  startDate: TimelineDate;
  endDate: TimelineDate;
  rows: TimelineRowData[];
  legend?: TimelineLegendItem[];
  tickInterval?: number;
  emptyMessage?: string;
  onSegmentClick?: (row: TimelineRowData, segment: TimelineSegment) => void;
  selectedSegmentId?: string;
}

const DAY = 86_400_000;
const asDate = (value: TimelineDate) => {
  const date = value instanceof Date ? value : new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const formatDate = (value: TimelineDate, year = false) => asDate(value).toLocaleDateString('de-DE', year ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const daysBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / DAY);

function getTicks(start: Date, end: Date, interval: number) {
  const ticks: Date[] = [];
  for (let offset = 0; offset <= daysBetween(start, end); offset += interval) ticks.push(new Date(start.getTime() + offset * DAY));
  if (ticks.at(-1)?.getTime() !== end.getTime()) ticks.push(end);
  return ticks;
}

export function TimelineAxis({ start, end, tickInterval = 2 }: { start: Date; end: Date; tickInterval?: number }) {
  const span = Math.max(1, daysBetween(start, end));
  return <div className="relative h-12" aria-hidden="true">{getTicks(start, end, tickInterval).map((tick, index) => {
    const left = Math.min(100, Math.max(0, daysBetween(start, tick) / span * 100));
    return <div key={tick.toISOString()} className="absolute inset-y-0" style={{ left: `${left}%` }}>
      <span className={`absolute top-1 whitespace-nowrap text-[10px] font-bold tabular-nums text-[var(--ops-text-muted)] ${index === 0 ? '' : index === getTicks(start, end, tickInterval).length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}>{formatDate(tick)}</span>
      <span className="absolute bottom-0 h-3 border-l border-[var(--ops-border)]" />
    </div>;
  })}</div>;
}

export function TimelineHeader({ start, end, tickInterval }: { start: Date; end: Date; tickInterval?: number }) {
  return <div className="grid min-w-[760px] grid-cols-[12rem_minmax(28rem,1fr)_10rem] border-b border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)]">
    <div className="flex items-center gap-2 border-r border-[var(--ops-divider)] px-4 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ops-text-muted)]"><CalendarDays size={14} />Kategorie</div>
    <div className="px-4"><TimelineAxis start={start} end={end} tickInterval={tickInterval} /></div>
    <div className="flex items-center justify-between border-l border-[var(--ops-divider)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-text-muted)]"><span>Start</span><span>Ende</span></div>
  </div>;
}

export function TimelineBar({ segment, timelineStart, timelineEnd, selected, onClick }: { segment: TimelineSegment; timelineStart: Date; timelineEnd: Date; selected?: boolean; onClick?: () => void }) {
  const span = Math.max(1, daysBetween(timelineStart, timelineEnd));
  const segmentStart = asDate(segment.start), segmentEnd = asDate(segment.end);
  const left = Math.max(0, daysBetween(timelineStart, segmentStart) / span * 100);
  const right = Math.min(100, daysBetween(timelineStart, segmentEnd) / span * 100);
  const style = { left: `${left}%`, width: `${Math.max(0.8, right - left)}%`, '--timeline-color': segment.color || 'var(--ops-primary-emphasis)' } as CSSProperties;
  const bar = <button type="button" onClick={onClick} className={`absolute top-1/2 h-7 -translate-y-1/2 overflow-hidden rounded-md border border-white/20 bg-[var(--timeline-color)] text-left shadow-[0_5px_16px_rgba(2,8,23,.3)] transition hover:-translate-y-[55%] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ops-focus)] ${selected ? 'ring-2 ring-white' : ''} ${onClick ? 'cursor-pointer' : 'cursor-default'}`} style={style} aria-label={`${segment.label || 'Zeitraum'}: ${formatDate(segment.start, true)} bis ${formatDate(segment.end, true)}`}>
    {segment.progress !== undefined && <span className="absolute inset-y-0 left-0 bg-white/20" style={{ width: `${Math.min(100, Math.max(0, segment.progress))}%` }} />}
    {segment.label && <span className="relative block truncate px-2 text-[10px] font-extrabold text-[var(--ops-on-accent)]">{segment.label}</span>}
  </button>;
  return segment.tooltip ? <Tooltip title={segment.tooltip} arrow placement="top">{bar}</Tooltip> : bar;
}

export function TimelineRow({ row, start, end, onSegmentClick, selectedSegmentId }: { row: TimelineRowData; start: Date; end: Date; onSegmentClick?: OperationsTimelineProps['onSegmentClick']; selectedSegmentId?: string }) {
  const segments = row.segments?.length ? row.segments : row.start && row.end ? [{ id: `${row.id}-period`, start: row.start, end: row.end, color: row.color, tooltip: row.tooltip, progress: row.progress, status: row.status }] : [];
  const first = segments.reduce<TimelineSegment | undefined>((current, item) => !current || asDate(item.start) < asDate(current.start) ? item : current, undefined);
  const last = segments.reduce<TimelineSegment | undefined>((current, item) => !current || asDate(item.end) > asDate(current.end) ? item : current, undefined);
  return <div className="grid min-h-[72px] min-w-[760px] grid-cols-[12rem_minmax(28rem,1fr)_10rem] border-b border-[var(--ops-divider)] last:border-b-0 hover:bg-white/[0.025]">
    <div className="flex min-w-0 flex-col justify-center border-r border-[var(--ops-divider)] px-4"><div className="truncate text-sm font-extrabold text-[var(--ops-text)]">{row.title}</div>{row.subtitle && <div className="mt-1 truncate text-xs text-[var(--ops-text-muted)]">{row.subtitle}</div>}{row.badges?.length ? <div className="mt-1 flex gap-1">{row.badges.map((badge, i) => <span key={i}>{badge}</span>)}</div> : null}</div>
    <div className="relative mx-4 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(11.111%_-_1px),var(--ops-divider)_calc(11.111%_-_1px),var(--ops-divider)_11.111%)]">{segments.map(segment => <TimelineBar key={segment.id} segment={segment} timelineStart={start} timelineEnd={end} selected={selectedSegmentId === segment.id} onClick={onSegmentClick ? () => onSegmentClick(row, segment) : undefined} />)}</div>
    <div className="flex items-center justify-between gap-2 border-l border-[var(--ops-divider)] px-4 text-xs font-bold tabular-nums text-[var(--ops-text-subtle)]"><time>{first ? formatDate(first.start) : '–'}</time><span className="text-[var(--ops-text-muted)]">→</span><time>{last ? formatDate(last.end) : '–'}</time></div>
  </div>;
}

export function TimelineLegend({ items }: { items: TimelineLegendItem[] }) { return <div className="flex flex-wrap gap-4 border-t border-[var(--ops-divider)] px-4 py-3">{items.map(item => <span key={item.label} className="flex items-center gap-2 text-xs text-[var(--ops-text-muted)]"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />{item.label}</span>)}</div>; }

export function OperationsTimeline({ startDate, endDate, rows, legend, tickInterval = 2, emptyMessage = 'Keine Zeiträume vorhanden.', onSegmentClick, selectedSegmentId }: OperationsTimelineProps) {
  const start = asDate(startDate), end = asDate(endDate);
  if (end <= start) throw new Error('OperationsTimeline: endDate must be after startDate.');
  return <div className="overflow-hidden rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
    <div className="overflow-x-auto"><TimelineHeader start={start} end={end} tickInterval={tickInterval} />{rows.length ? rows.map(row => <TimelineRow key={row.id} row={row} start={start} end={end} onSegmentClick={onSegmentClick} selectedSegmentId={selectedSegmentId} />) : <div className="p-8 text-center text-sm text-[var(--ops-text-muted)]">{emptyMessage}</div>}</div>
    {legend?.length ? <TimelineLegend items={legend} /> : null}
  </div>;
}
