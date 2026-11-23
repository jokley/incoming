/** UI-only label; official FIS values remain unchanged in data and API calls. */
export function previewEventGroupLabel(groups?: string[]): string {
  return groups?.join(', ') || '—';
}

/** Presentation aliases for existing sport/family values, never a quota mapping.
 * Unknown values remain visible; Competition identities and Event Groups are untouched. */
export function sportAreaValue(sport?: string | null): 'Snowboard' | 'Freestyle' | null {
  return sport === 'Snowboard' ? 'Snowboard'
    : ['Freestyle', 'Freeski', 'Freestyle Ski'].includes(sport || '') ? 'Freestyle' : null;
}

export function sportAreaLabel(sport?: string | null): string {
  return sportAreaValue(sport) === 'Freestyle' ? 'Freestyle / Freeski' : sport || '—';
}

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
  return (quotaDisciplines || []).includes(filter);
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

/** Concrete memberships only: no fallback from an Event Group or legacy label. */
export function competitionMembershipList(memberships?: ReadonlyArray<{name:string;displayName?:string}>) {
  return [...new Set((memberships??[]).map(c=>disciplineDisplayName(c.displayName||c.name)).filter(Boolean))].join(' · ');
}
