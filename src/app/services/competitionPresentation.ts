/** UI-only label; official FIS values remain unchanged in data and API calls. */
export function competitionDisplayName(name?: string | null): string {
  if (!name) return '';
  return name.replace(/^(?:Men's|Women's)\s+/i, '').replace(/^Mixed\s+/i, '');
}

export function competitionDisplayList(names?: Array<string | null> | null, fallback?: string | null): string {
  const values = names?.filter((name): name is string => Boolean(name)) || [];
  return (values.length ? values : fallback ? [fallback] : [])
    .map(competitionDisplayName)
    .join(' • ');
}
