import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { Download, RotateCcw } from 'lucide-react';

export type EnterpriseSeries = { key: string; label: string; color: string; group?: 'beds' | 'rooms' | 'quality' };

type Props = {
  id: string;
  data: Array<Record<string, unknown>>;
  series: EnterpriseSeries[];
  children: ReactElement;
  height?: number;
  onPointClick?: (row: Record<string, unknown>) => void;
};

function mapSeries(node: ReactNode, visible: Set<string>, highlighted: string | null): ReactNode {
  return Children.map(node, child => {
    if (!isValidElement(child)) return child;
    const props = child.props as Record<string, unknown>;
    const key = typeof props.dataKey === 'string' ? props.dataKey : null;
    const nested = props.children ? mapSeries(props.children as ReactNode, visible, highlighted) : props.children;
    const changes: Record<string, unknown> = nested !== props.children ? { children: nested } : {};
    if (key) {
      changes.hide = !visible.has(key);
      if (highlighted) changes.opacity = highlighted === key ? 1 : 0.18;
    }
    return cloneElement(child, changes);
  });
}

export function EnterpriseChart({ id, data, series, children, height = 320, onPointClick }: Props) {
  const storageKey = `enterprise-chart:${id}:visible`;
  const seriesKey = series.map(item => item.key).join('|');
  const allKeys = useMemo(() => series.map(item => item.key), [seriesKey]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null') || allKeys; } catch { return allKeys; }
  });
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [isolated, setIsolated] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const visible = new Set(visibleKeys);
  const save = (keys: string[]) => { setVisibleKeys(keys); localStorage.setItem(storageKey, JSON.stringify(keys)); };
  const toggle = (key: string) => save(visible.has(key) ? visibleKeys.filter(item => item !== key) : [...visibleKeys, key]);
  const isolate = (key: string) => { const reset = isolated === key; setIsolated(reset ? null : key); save(reset ? allKeys : [key]); };
  const exportCsv = () => {
    const columns = ['label', 'date', ...visibleKeys];
    const csv = [columns.join(';'), ...data.map(row => columns.map(column => JSON.stringify(row[column] ?? '')).join(';'))].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `${id}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const exportPng = () => {
    const svg = root.current?.querySelector('svg'); if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg), image = new Image();
    image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = svg.clientWidth * 2; canvas.height = svg.clientHeight * 2; const context = canvas.getContext('2d'); if (!context) return; context.scale(2, 2); context.drawImage(image, 0, 0); const link = document.createElement('a'); link.download = `${id}.png`; link.href = canvas.toDataURL('image/png'); link.click(); };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  };
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
      setVisibleKeys(Array.isArray(stored) && stored.some(key => allKeys.includes(key)) ? stored.filter(key => allKeys.includes(key)) : allKeys);
    } catch {
      setVisibleKeys(allKeys);
    }
    setHighlighted(null);
    setIsolated(null);
  }, [storageKey, allKeys]);

  return <div key={id} ref={root} className="relative select-none" onContextMenu={event => event.preventDefault()}>
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-[var(--ops-divider)] px-4 py-3" aria-label="Diagrammlegende">
      {series.map(item => <button key={item.key} type="button" aria-pressed={visible.has(item.key)} onClick={() => toggle(item.key)} onDoubleClick={() => isolate(item.key)} onMouseEnter={() => setHighlighted(item.key)} onMouseLeave={() => setHighlighted(null)} className={`flex items-center gap-2 text-xs font-bold transition-opacity ${visible.has(item.key) ? 'opacity-100' : 'opacity-35 line-through'}`} title="Klick: ein-/ausblenden · Doppelklick: isolieren"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }}/>{item.label}</button>)}
      <button type="button" onClick={() => { setIsolated(null); save(allKeys); }} className="ml-auto text-[var(--ops-text-muted)]" title="Alle anzeigen"><RotateCcw size={15}/></button>
      <button onClick={exportPng} className="inline-flex items-center gap-1 text-[var(--ops-text-muted)]"><Download size={12}/>PNG</button><button onClick={exportCsv} className="inline-flex items-center gap-1 text-[var(--ops-text-muted)]"><Download size={12}/>CSV</button>
    </div>
    <div style={{ height }} onClick={(event) => { if (!onPointClick) return; const target = event.target as SVGElement; const index = Number(target.getAttribute?.('index')); if (Number.isFinite(index) && data[index]) onPointClick(data[index]); }}><ResponsiveContainer key={id} width="100%" height="100%">{mapSeries(children, visible, highlighted) as ReactElement}</ResponsiveContainer></div>
  </div>;
}
