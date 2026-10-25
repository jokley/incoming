import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '../services/api';
import { ActiveEventStore, type ActiveEventState } from './activeEventStore';

const ActiveEventContext = createContext<ActiveEventStore | null>(null);
const noEventSubscription = () => () => {};
const noEventSnapshot = () => null;

export function useEventWriteAccess() {
  const store = useContext(ActiveEventContext);
  const state = useSyncExternalStore<ActiveEventState | null>(
    store?.subscribe ?? noEventSubscription, store?.snapshot ?? noEventSnapshot, store?.snapshot ?? noEventSnapshot);
  return state?.status === 'ready' && state.selectedEvent?.canWrite === true;
}
const domBlockReason = () => document.querySelector('[role="dialog"], [role="alertdialog"], form[data-event-dirty="true"]')
  ? 'Bitte offene Dialoge und ungespeicherte Formulare zuerst abschließen oder schließen.' : null;

export function ActiveEventProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ActiveEventStore(api.eventScope, () => api.getActiveEventContext(), domBlockReason,
    () => window.history.replaceState(null, '', '/')));
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    void store.load();
    const markForm = (event: globalThis.Event) => {
      const form = event.target instanceof Element ? event.target.closest('form') : null;
      if (form) form.dataset.eventDirty = 'true';
    };
    document.addEventListener('input', markForm, true);
    document.addEventListener('change', markForm, true);
    return () => {
      store.dispose();
      document.removeEventListener('input', markForm, true);
      document.removeEventListener('change', markForm, true);
    };
  }, [store]);
  if (state.status === 'loading') return <div role="status" className="p-8 text-[var(--ops-text)]">Eventkontext wird geladen …</div>;
  if (state.status === 'error') return <div role="alert" className="p-8 text-[var(--ops-text)]"><p>{state.error}</p><button className="mt-3 rounded border px-3 py-2" onClick={() => void store.load()}>Erneut prüfen</button></div>;
  return <ActiveEventContext.Provider value={store}>{children}</ActiveEventContext.Provider>;
}
export function useActiveEvent() {
  const store = useContext(ActiveEventContext);
  if (!store) throw new Error('useActiveEvent requires ActiveEventProvider');
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return { ...state, eventId: state.selectedEvent!.id, selectEvent: store.select, refreshEvents: () => store.refreshChoices() };
}
export function useActiveEventBlocker(blocked: boolean, reason: string) {
  const store = useContext(ActiveEventContext);
  useEffect(() => blocked && store ? store.block(reason) : undefined, [store, blocked, reason]);
}
