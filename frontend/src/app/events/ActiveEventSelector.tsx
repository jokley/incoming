import { CalendarDays, ChevronDown } from 'lucide-react';
import { useActiveEvent } from './ActiveEventProvider';
import type { ActiveEventState } from './activeEventStore';

export function EventSelector({ state, selectEvent }: { state: ActiveEventState; selectEvent: (id: string) => boolean }) {
  const enabled = state.switchingAllowed && state.events.length > 1;
  return <div className="min-w-0 max-w-60 text-xs">
    <div className="relative flex items-center rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] text-[var(--ops-text)]">
      <CalendarDays aria-hidden="true" size={14} className="pointer-events-none absolute left-2" />
      <select aria-label="Aktive Veranstaltung" title={`${state.selectedEvent?.name ?? ''} · ${enabled ? 'Veranstaltung auswählen' : 'Einziger operativ freigegebener Event'}`}
        className="w-full appearance-none truncate rounded-xl bg-transparent py-2 pl-7 pr-6 text-xs text-[var(--ops-text)] disabled:opacity-100"
        disabled={!enabled} value={state.selectedEvent?.id ?? ''} onChange={e => selectEvent(e.target.value)}>
        {state.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
      </select><ChevronDown aria-hidden="true" size={12} className="pointer-events-none absolute right-2" />
    </div>
    {state.error && <p role="status" className="mt-1 max-w-60 text-[var(--ops-tone-warning-text)]">{state.error}</p>}
  </div>;
}
export function ActiveEventSelector() {
  const context = useActiveEvent();
  return <EventSelector state={context} selectEvent={context.selectEvent} />;
}
