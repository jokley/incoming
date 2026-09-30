/** UI-only label; official FIS values remain unchanged in data and API calls. */
export function competitionDisplayName(name?: string | null): string {
  if (!name) return '';
  return name.replace(/^(?:Men's|Women's)\s+/i, '').replace(/^Mixed\s+/i, '');
}

/** UI-only discipline label; filter values remain the canonical API values. */
export function disciplineDisplayName(name?: string | null): string {
  return competitionDisplayName(name)
    .replace(/^(?:Snowboard|Freeski)\s+(?=(?:Big Air|Halfpipe|Slopestyle)$)/i, '');
}

export function matchesDisciplineMembership(
  discipline: string | null | undefined,
  quotaDisciplines: string[] | undefined,
  filter: string,
): boolean {
  if (!filter) return true;
  return quotaDisciplines?.length ? quotaDisciplines.includes(filter) : discipline === filter;
}

export function matchesDisciplineAndGender(
  person: { discipline?: string | null; quotaDisciplines?: string[]; gender?: string | null },
  disciplineFilter: string,
  genderFilter: string,
): boolean {
  const gender = person.gender?.trim().toUpperCase();
  const normalizedGender = gender?.startsWith('M') ? 'M'
    : gender?.startsWith('F') || gender?.startsWith('W') ? 'F' : gender || '';
  return matchesDisciplineMembership(person.discipline, person.quotaDisciplines, disciplineFilter)
    && (!genderFilter || normalizedGender === genderFilter);
}

export function competitionDisplayList(names?: Array<string | null> | null, fallback?: string | null): string {
  const values = names?.filter((name): name is string => Boolean(name)) || [];
  return (values.length ? values : fallback ? [fallback] : [])
    .map(competitionDisplayName)
    .join(' • ');
}
