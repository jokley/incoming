import type { Athlete } from '../types.ts';

export function personFunctionOptions(people: Pick<Athlete,'id'|'function'>[]) {
  const groups = new Map<string,Set<string>>();
  for (const person of people) {
    const label = person.function || 'Athlet';
    const ids = groups.get(label) ?? new Set<string>();
    ids.add(person.id); groups.set(label,ids);
  }
  return [...groups].map(([value,ids])=>({value,label:value,count:ids.size}))
    .sort((a,b)=>a.label.localeCompare(b.label,'de'));
}

export function matchesPersonFunction(person: Pick<Athlete,'function'>, selected: string): boolean {
  return !selected || (person.function || 'Athlet') === selected;
}
