import type { Athlete } from '../types.ts';
import { disciplineDisplayName, sportAreaLabel, sportAreaValue } from './competitionPresentation.ts';

export type CompetitionFilterGroup = {
  value: string; label: string; count: number;
  competitionIds: string[]; competitionNames: string[]; sports: string[];
};

export function competitionFilterGroups(athletes: Pick<Athlete,'id'|'competitions'>[]): CompetitionFilterGroup[] {
  const groups = new Map<string,{ids:Set<string>;names:Set<string>;sports:Set<string>;people:Set<string>}>();
  for (const athlete of athletes) for (const competition of athlete.competitions ?? []) {
    // displayName is the structured neutral event name. The existing UI formatter
    // removes only known sport qualifiers from Big Air/Halfpipe/Slopestyle labels.
    // Older payloads without displayName use its deterministic name fallback.
    const label = disciplineDisplayName(competition.displayName || competition.name);
    const group = groups.get(label) ?? {ids:new Set<string>(),names:new Set<string>(),sports:new Set<string>(),people:new Set<string>()};
    group.ids.add(competition.id); group.names.add(competition.name);
    group.sports.add(competition.sport); group.people.add(athlete.id);
    groups.set(label,group);
  }
  return [...groups].map(([label,group])=>({value:label,label,count:group.people.size,
    competitionIds:[...group.ids],competitionNames:[...group.names],sports:[...group.sports]}))
    .sort((a,b)=>a.label.localeCompare(b.label,'de'));
}

export function competitionGroupSelected(group: CompetitionFilterGroup, selected: string[]): boolean {
  return [...group.competitionIds,...group.competitionNames].some(value=>selected.includes(value));
}

export function toggleCompetitionGroup(group: CompetitionFilterGroup, selected: string[]): string[] {
  const others = selected.filter(value=>!group.competitionIds.includes(value) && !group.competitionNames.includes(value));
  return competitionGroupSelected(group,selected) ? others : [...others,...group.competitionIds];
}

export function matchesCompetitionSelection(athlete: Pick<Athlete,'competitions'>, selected: string[], area = ''): boolean {
  if (!selected.length && !area) return true;
  return Boolean(athlete.competitions?.some(c =>
    (!area || sportAreaValue(c.sport) === area)
    && (!selected.length || selected.includes(c.id) || selected.includes(c.name))));
}

/** Existing family keys; every concrete membership participates, each person once. */
export function sportAreaOptions(athletes: Pick<Athlete,'id'|'competitions'>[], selected: string[] = []) {
  return ['Snowboard', 'Freestyle'].map(value => ({ value, label: sportAreaLabel(value),
    count: new Set(athletes.filter(person => matchesCompetitionSelection(person, selected, value)).map(person => person.id)).size }));
}
