import type { OfficialQuotaUsage } from '../../services/fisRules';
import { AccommodationRateChip } from '../AccommodationRate';
export function QuotaPersonGroups({row}:{row?:OfficialQuotaUsage}) {
  return <section className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3">
    <h3 className="mb-2 text-xs font-bold uppercase text-[var(--ops-primary)]">Personengruppen</h3>
    <p className="mb-2 text-xs text-[var(--ops-text-muted)]">Gemeldete Personen in diesem Kontext, einschließlich Athleten. M/W-Kontexte können dieselben Personen enthalten.</p>
    <p className="mb-3 text-sm font-semibold">Sondertarif: {row?.specialRateCount ?? 0}</p>
    {row?.functionGroups?.map(group=><details key={group.function??''} className="border-t border-[var(--ops-divider)] py-2">
      <summary className="cursor-pointer text-sm font-semibold">{group.function || 'Funktion nicht angegeben'} <span className="float-right">{group.count}</span></summary>
      <ul className="mt-2 space-y-2 text-xs">{group.people.map(person=><li key={person.personId} className="flex flex-wrap items-center justify-between gap-2"><span>{person.name}</span><span className="flex items-center gap-2"><AccommodationRateChip category={person.accommodationRateCategory}/><span>{person.accommodationRequirement==='NO_ROOM' ? 'Kein Zimmer benötigt' : person.isAssigned?'Zugewiesen':'Offen'}</span></span></li>)}</ul>
    </details>)}
  </section>;
}
