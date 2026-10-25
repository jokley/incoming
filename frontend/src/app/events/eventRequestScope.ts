/** Transport lease derived from the single ActiveEventProvider, never a second selection UI. */
export const EVENT_HEADER = 'X-Championship-Event-ID';
export const contextCancelled = () => new DOMException('Der Eventkontext hat sich geändert.', 'AbortError');
export class EventRequestScope {
  private owner: string | null = null;
  private generation = 0;
  private requests = new Map<AbortController, { write: boolean; authentication: boolean }>();
  get eventId() { return this.owner; }
  get hasPendingWrites() { return [...this.requests.values()].some(request => request.write); }
  activate(owner: string | null) {
    this.generation++;
    this.owner = owner;
    for (const [controller, request] of this.requests) {
      // Auth refresh is independent of the operational workspace lifecycle.
      if (!request.authentication) { controller.abort(); this.requests.delete(controller); }
    }
  }
  async run<T>(url: string, init: RequestInit | undefined,
    consume: (response: Response, assertCurrent: () => void) => Promise<T>, bootstrap: false | 'auth' | 'context' | 'global-metadata' = false, managementOwner?: string): Promise<T> {
    if (!bootstrap && !this.owner && !managementOwner) throw new Error('Bitte zuerst einen verfügbaren Eventkontext laden.');
    const generation = this.generation;
    const controller = new AbortController();
    const headers = new Headers(init?.headers);
    if (!bootstrap) {
      const target = managementOwner ?? this.owner;
      if (managementOwner && new URL(url,'http://local').pathname.match(/^\/api\/admin\/events\/([1-9]\d*)(?:\/|$)/)?.[1] !== managementOwner) throw new Error('Ungültiger Administrationskontext.');
      if (headers.has(EVENT_HEADER) && headers.get(EVENT_HEADER) !== target) throw new Error('Widersprüchlicher Eventkontext.');
      headers.set(EVENT_HEADER, target!);
    }
    const assertCurrent = () => {
      if (controller.signal.aborted || (!bootstrap && generation !== this.generation)) throw contextCancelled();
    };
    const abort = () => controller.abort();
    if (init?.signal?.aborted) abort();
    init?.signal?.addEventListener('abort', abort, { once: true });
    this.requests.set(controller, { write: !['GET', 'HEAD', 'OPTIONS'].includes((init?.method ?? 'GET').toUpperCase()), authentication: bootstrap === 'auth' });
    try {
      const response = await fetch(url, { ...init, headers, signal: controller.signal });
      assertCurrent();
      const result = await consume(response, assertCurrent);
      assertCurrent(); // Includes JSON/body reads that finish after an event change.
      return result;
    } finally {
      init?.signal?.removeEventListener('abort', abort);
      this.requests.delete(controller);
    }
  }
}
