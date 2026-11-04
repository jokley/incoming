import { EventRequestScope } from './eventRequestScope.ts';
export interface OperationalEvent {
  id: string; name: string; year?: number | null; active: boolean;
  fisEventId?: string | null; sectorCode?: string | null; canRead: boolean; canWrite: boolean;
}
export interface EventCapabilities { events: OperationalEvent[]; selectedEventId: string | null; switchingAllowed: boolean }
export interface ActiveEventState {
  status: 'loading' | 'ready' | 'error'; events: OperationalEvent[];
  selectedEvent: OperationalEvent | null; switchingAllowed: boolean; revision: number; error: string | null;
}
/** One selection owner; React subscribes to this store instead of duplicating page state. */
export class ActiveEventStore {
  private state: ActiveEventState = { status: 'loading', events: [], selectedEvent: null, switchingAllowed: false, revision: 0, error: null };
  private listeners = new Set<() => void>();
  private blockers = new Map<symbol, string>();
  private loadGeneration = 0;
  private choicesGeneration = 0;
  private transport: EventRequestScope;
  private capabilities: () => Promise<EventCapabilities>;
  private canLeave: () => string | null;
  private beforeChange: () => void;
  constructor(transport: EventRequestScope, capabilities: () => Promise<EventCapabilities>,
    canLeave: () => string | null = () => null, beforeChange: () => void = () => {}) {
    this.transport = transport; this.capabilities = capabilities; this.canLeave = canLeave; this.beforeChange = beforeChange;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(patch: Partial<ActiveEventState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  async load() {
    const generation = ++this.loadGeneration;
    this.transport.activate(null);
    this.update({ status: 'loading', selectedEvent: null, events: [], error: null });
    try {
      const result = await this.capabilities();
      if (generation !== this.loadGeneration) return;
      const ids = result.events.map(e => e.id);
      const selected = result.events.find(e => e.id === result.selectedEventId && e.active && e.canRead);
      if (!selected || new Set(ids).size !== ids.length) throw new Error('Kein eindeutig freigegebener Eventkontext verfügbar.');
      this.transport.activate(selected.id);
      this.update({ status: 'ready', events: result.events.filter(e => e.active && e.canRead), selectedEvent: selected,
        switchingAllowed: result.switchingAllowed === true, revision: this.state.revision + 1, error: null });
    } catch (error) {
      if (generation === this.loadGeneration) this.update({ status: 'error', error: error instanceof Error ? error.message : 'Eventkontext konnte nicht geladen werden.' });
    }
  }
  block(reason: string) { const key = Symbol(); this.blockers.set(key, reason); return () => { this.blockers.delete(key); }; }
  async refreshChoices() {
    const choice = ++this.choicesGeneration; const revision = this.state.revision;
    const generation = this.loadGeneration; const selected = this.state.selectedEvent?.id;
    const result = await this.capabilities();
    if (choice !== this.choicesGeneration || revision !== this.state.revision || generation !== this.loadGeneration || selected !== this.state.selectedEvent?.id) return;
    if (!result.events.some(e => e.id === selected && e.active && e.canRead)) { await this.load(); return; }
    this.update({events: result.events.filter(e => e.active && e.canRead),
      selectedEvent: result.events.find(e => e.id === selected)!, switchingAllowed: result.switchingAllowed});
  }
  select = (id: string): boolean => {
    if (id === this.state.selectedEvent?.id) return true;
    const target = this.state.events.find(e => e.id === id && e.canRead && e.active);
    const reason = this.state.status !== 'ready' || !this.state.switchingAllowed || !target
      ? 'Ein weiterer operativer Event ist nicht freigegeben.'
      : this.transport.hasPendingWrites ? 'Bitte die laufende Speicherung oder den Import abschließen.'
      : this.blockers.values().next().value || this.canLeave();
    if (reason || !target) { this.update({ error: reason || 'Event nicht verfügbar.' }); return false; }
    this.beforeChange();
    this.transport.activate(id);
    this.blockers.clear();
    this.update({ selectedEvent: target, revision: this.state.revision + 1, error: null });
    return true;
  };
  dispose() { this.loadGeneration++; this.transport.activate(null); this.blockers.clear(); }
}
