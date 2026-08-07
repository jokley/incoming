export type AssignmentPerformanceDetail = {
  operationId: string;
  endpoint?: string;
  dropToRequestMs?: number;
  apiMs?: number;
  renderMs?: number;
  renderCount?: number;
  requestCount?: number;
  responseBytes?: number;
  components?: string[];
  server?: Record<string, number>;
};

const active = new Map<string, AssignmentPerformanceDetail>();
let lastDropAt = 0;

export function markAssignmentDrop() {
  lastDropAt = performance.now();
}

export function startAssignmentMeasurement(endpoint: string) {
  const operationId = crypto.randomUUID();
  const detail: AssignmentPerformanceDetail = {
    operationId,
    endpoint,
    dropToRequestMs: lastDropAt ? performance.now() - lastDropAt : 0,
    requestCount: 1,
    renderCount: 0,
    components: [],
  };
  active.set(operationId, detail);
  return { operationId, startedAt: performance.now() };
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

export function finishAssignmentRequest(
  operationId: string,
  startedAt: number,
  response: Response,
  responseBytes: number,
) {
  const detail = active.get(operationId);
  if (!detail) return;
  detail.apiMs = performance.now() - startedAt;
  detail.responseBytes = responseBytes;
  detail.server = parseServerTiming(response.headers.get('server-timing'));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    detail.renderMs = performance.now() - startedAt - (detail.apiMs ?? 0);
    console.groupCollapsed(`[Assignment Performance] ${detail.endpoint}`);
    console.table({
      API: detail.apiMs,
      DB: detail.server?.db,
      Quota: detail.server?.quota,
      Zimmerberechnung: detail.server?.rooms,
      Assignment: detail.server?.assignment,
      Serialisierung: detail.server?.serialization,
      'Frontend Render': detail.renderMs,
      'Drop bis Request': detail.dropToRequestMs,
      Requests: detail.requestCount,
      'Response Bytes': detail.responseBytes,
      'React Re-Renders': detail.renderCount,
    });
    console.info('Neu gerenderte Komponenten:', detail.components);
    console.groupEnd();
    window.dispatchEvent(new CustomEvent('assignment:performance', { detail: { ...detail } }));
    active.delete(operationId);
  }));
}

export function recordAssignmentRender(component: string, duration: number) {
  for (const detail of active.values()) {
    detail.renderCount = (detail.renderCount ?? 0) + 1;
    detail.renderMs = (detail.renderMs ?? 0) + duration;
    if (!detail.components?.includes(component)) detail.components?.push(component);
  }
}
