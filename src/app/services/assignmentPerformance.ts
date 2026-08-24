import type { ProfilerOnRenderCallback } from 'react';

type ComponentMeasurement = {
  commits: number;
  renderMs: number;
  commitLatencyMs: number;
};

export type AssignmentPerformanceDetail = {
  operationId: string;
  endpoint: string;
  method: string;
  totalMs?: number;
  timeToHeadersMs?: number;
  bodyReadMs?: number;
  jsonParseMs?: number;
  responseBytes?: number;
  queryCount?: number;
  server?: Record<string, number>;
  components: Record<string, ComponentMeasurement>;
  domNodesBefore: number;
  domNodesAfter?: number;
  heapBytesBefore?: number;
  heapBytesAfter?: number;
  longTaskCount: number;
  longTaskMs: number;
  dropToRequestMs?: number;
};

type BrowserPerformanceMemory = Performance & {
  memory?: { usedJSHeapSize?: number };
};

type RequestTimings = {
  timeToHeadersMs: number;
  bodyReadMs: number;
  jsonParseMs: number;
  responseBytes: number;
};

// Temporary Sprint-1 diagnostics. Set VITE_ASSIGNMENT_PERFORMANCE=false to
// disable all browser observers, Profiler callbacks and console reporting.
export const assignmentPerformanceEnabled =
  import.meta.env.VITE_ASSIGNMENT_PERFORMANCE !== 'false';

const active = new Map<string, AssignmentPerformanceDetail>();
let lastDropAt = 0;
let longTaskObserver: PerformanceObserver | null = null;

function heapBytes() {
  return (performance as BrowserPerformanceMemory).memory?.usedJSHeapSize;
}

function domNodes() {
  return document.getElementsByTagName('*').length;
}

function ensureLongTaskObserver() {
  if (longTaskObserver || !('PerformanceObserver' in window)) return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        for (const detail of active.values()) {
          detail.longTaskCount += 1;
          detail.longTaskMs += entry.duration;
        }
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: false });
  } catch {
    // The Long Tasks API is optional (notably unavailable in Firefox/Safari).
    longTaskObserver = null;
  }
}

export function markAssignmentDrop() {
  if (assignmentPerformanceEnabled) lastDropAt = performance.now();
}

export function isMeasuredAssignmentRequest(endpoint: string) {
  return assignmentPerformanceEnabled && (
    endpoint.startsWith('/assignments/')
    || endpoint.startsWith('/fis/official-quotas')
    || endpoint.startsWith('/official-quotas')
    || endpoint.startsWith('/room-assignments')
  );
}

export function startAssignmentMeasurement(endpoint: string, method: string) {
  if (!assignmentPerformanceEnabled) return null;
  ensureLongTaskObserver();
  const operationId = crypto.randomUUID();
  const startedAt = performance.now();
  active.set(operationId, {
    operationId,
    endpoint,
    method,
    components: {},
    domNodesBefore: domNodes(),
    heapBytesBefore: heapBytes(),
    longTaskCount: 0,
    longTaskMs: 0,
    dropToRequestMs: lastDropAt ? startedAt - lastDropAt : undefined,
  });
  return { operationId, startedAt };
}

function parseServerTiming(value: string | null) {
  const result: Record<string, number> = {};
  for (const entry of value?.split(',') ?? []) {
    const [name, ...params] = entry.trim().split(';');
    const duration = params.find((part) => part.trim().startsWith('dur='));
    if (duration) result[name] = Number(duration.split('=')[1]);
  }
  return result;
}

function numericHeader(response: Response, name: string) {
  const value = response.headers.get(name);
  return value === null ? undefined : Number(value);
}

export function finishAssignmentRequest(
  operationId: string,
  startedAt: number,
  response: Response,
  timings: RequestTimings,
) {
  const detail = active.get(operationId);
  if (!detail) return;
  detail.totalMs = performance.now() - startedAt;
  detail.timeToHeadersMs = timings.timeToHeadersMs;
  detail.bodyReadMs = timings.bodyReadMs;
  detail.jsonParseMs = timings.jsonParseMs;
  detail.responseBytes = timings.responseBytes;
  detail.server = parseServerTiming(response.headers.get('server-timing'));
  detail.queryCount = numericHeader(response, 'x-assignment-query-count');

  // State updates happen after the request promise resolves. Two frames retain the
  // measurement through React render/commit and the browser's DOM update.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    detail.domNodesAfter = domNodes();
    detail.heapBytesAfter = heapBytes();
    console.groupCollapsed(`[Assignment Performance] ${detail.method} ${detail.endpoint}`);
    console.table({
      'Client total': detail.totalMs,
      'Time to headers': detail.timeToHeadersMs,
      'Body read / network': detail.bodyReadMs,
      'JSON parse': detail.jsonParseMs,
      'Server total': detail.server?.api,
      'Database': detail.server?.db,
      'Serialization': detail.server?.serialization,
      'Assignment logic': detail.server?.assignment,
      'Room projection': detail.server?.rooms,
      'Quota calculation': detail.server?.quota,
      'SQL queries': detail.queryCount,
      'Payload bytes': detail.responseBytes,
      'DOM nodes before': detail.domNodesBefore,
      'DOM nodes after': detail.domNodesAfter,
      'Heap bytes before': detail.heapBytesBefore,
      'Heap bytes after': detail.heapBytesAfter,
      'Long tasks': detail.longTaskCount,
      'Long task ms': detail.longTaskMs,
      'Drop to request': detail.dropToRequestMs,
    });
    console.table(detail.components);
    console.info('Raw measurement:', { ...detail });
    console.groupEnd();
    window.dispatchEvent(new CustomEvent('assignment:performance', { detail: { ...detail } }));
    active.delete(operationId);
  }));
}

export const recordAssignmentRender: ProfilerOnRenderCallback = (
  id,
  _phase,
  actualDuration,
  _baseDuration,
  startTime,
  commitTime,
) => {
  if (!assignmentPerformanceEnabled) return;
  for (const detail of active.values()) {
    const component = detail.components[id] ?? { commits: 0, renderMs: 0, commitLatencyMs: 0 };
    component.commits += 1;
    component.renderMs += actualDuration;
    component.commitLatencyMs += Math.max(0, commitTime - startTime);
    detail.components[id] = component;
  }
};
