import { periodLabel, type DispositionItem } from './dispositionItems.ts';

/** Presentation grouping only. Never use as a FIS quota classification. */
export type QueuePersonType = '' | 'athletes' | 'officials';
type Person = { function?: string | null };
export const isQueueAthlete = (person: Person) => (person.function || '').trim().toLowerCase() === 'athlete';
export const queueFunctionLabel = (person: Person) => person.function?.trim() ? person.function : 'Official';
export const matchesQueuePersonType = (person: Person, type: QueuePersonType) => !type
  || (type === 'athletes' ? isQueueAthlete(person) : !isQueueAthlete(person));

/** Keep canonical item identity/dates; actions receive only the visible person IDs. */
export function filterQueuePersonType(items: DispositionItem[], type: QueuePersonType): DispositionItem[] {
  if (!type) return items;
  return items.flatMap(item => {
    const occupants = item.occupants.filter(person => matchesQueuePersonType(person, type));
    if (!occupants.length) return [];
    if (occupants.length === item.occupants.length) return [item];
    return [{ ...item, occupants, occupantCount: occupants.length,
      previous: [...new Set(occupants.flatMap(person => person.accommodationCoverage?.segments.map(segment =>
        `${periodLabel(segment)} · ${segment.hotelName ?? '—'}`) ?? []))] }];
  });
}
