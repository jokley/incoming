import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc';
export type SortState<K extends string = string> = { key: K; direction: SortDirection };

export function sortTableRows<T, K extends string>(rows: T[], sort: SortState<K>, value: (row: T, key: K) => unknown): T[] {
  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = value(left, sort.key); const b = value(right, sort.key);
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
    return collator.compare(String(a), String(b)) * direction;
  });
}

export function SortableTableHead<K extends string>({ column, label, sort, onSort, align = 'left' }: { column: K; label: ReactNode; sort: SortState<K>; onSort: (column: K) => void; align?: 'left' | 'right' | 'center' }) {
  const active = sort.key === column;
  const Icon = active ? sort.direction === 'asc' ? ArrowUp : ArrowDown : ChevronsUpDown;
  return <th scope="col" aria-sort={active ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={`overflow-hidden px-2 py-1 text-${align} font-extrabold`}>
    <button type="button" onClick={() => onSort(column)} className={`flex w-full min-w-0 items-center gap-1 overflow-hidden ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'} hover:text-[var(--ops-text)]`}>
      <span className="min-w-0 truncate whitespace-nowrap">{label}</span><Icon aria-hidden className="shrink-0" size={12}/>
    </button>
  </th>;
}
