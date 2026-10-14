import type { WorldChampion } from '../types.ts';

export type ChampionEdition = {key:string;championship:string;year:number;label:string;count:number};
export function championEditionKey(row: Pick<WorldChampion,'championship'|'championshipYear'>): string {
  return JSON.stringify([row.championship,row.championshipYear]);
}
export function championEditions(rows: WorldChampion[]): ChampionEdition[] {
  const editions = new Map<string,ChampionEdition>();
  for (const row of rows) {
    const key=championEditionKey(row);
    const edition=editions.get(key) ?? {key,championship:row.championship,year:row.championshipYear,label:`${row.championship} ${row.championshipYear}`,count:0};
    edition.count++; editions.set(key,edition);
  }
  return [...editions.values()].sort((a,b)=>b.year-a.year || a.championship.localeCompare(b.championship,'de'));
}
export function championsForEdition(rows: WorldChampion[],key:string): WorldChampion[] {
  return rows.filter(row=>championEditionKey(row)===key).sort((a,b)=>
    a.eventGroup.localeCompare(b.eventGroup,'de') || a.discipline.localeCompare(b.discipline,'de') ||
    a.gender.localeCompare(b.gender,'de') || a.name.localeCompare(b.name,'de') || a.eventId.localeCompare(b.eventId) || a.id.localeCompare(b.id));
}
export type ChampionFilters = {editionKey:string;gender:string;discipline:string;search:string};
export const emptyChampionFilters = (editionKey=''):ChampionFilters => ({editionKey,gender:'',discipline:'',search:''});
export function scopedChampionFilters(filters:ChampionFilters,key:string):ChampionFilters {
  return filters.editionKey===key ? filters : emptyChampionFilters(key);
}
export function championDisciplines(rows:WorldChampion[]):string[] {
  return [...new Set(rows.map(row=>row.discipline))].sort((a,b)=>a.localeCompare(b,'de'));
}
export function filterChampions(rows:WorldChampion[],filters:ChampionFilters):WorldChampion[] {
  const search=filters.search.trim().toLocaleLowerCase('de');
  return rows.filter(row=>(!filters.gender || row.gender===filters.gender) &&
    (!filters.discipline || row.discipline===filters.discipline) &&
    (!search || `${row.name} ${row.nation}`.toLocaleLowerCase('de').includes(search)));
}
/** An edition is persisted by its first title, using existing structured fields. */
export function newChampionEdition(championship:string,year:number):ChampionEdition {
  const name=championship.trim();
  return {key:championEditionKey({championship:name,championshipYear:year}),championship:name,year,label:`${name} ${year}`,count:0};
}
export function championDraft(row: WorldChampion|undefined,edition:ChampionEdition|undefined,eventId:string):Partial<WorldChampion> {
  return row ? {...row} : {eventId,championship:edition?.championship ?? '',championshipYear:edition?.year ?? new Date().getFullYear(),titleType:'INDIVIDUAL',entitlementEnabled:true,active:true,gender:'M'};
}
export function championSourceUrl(source?:string|null):string|null {
  if (!source?.trim()) return null;
  // Validate the scheme only. Preserve the supplied URL, and leave external
  // availability to the browser; never rewrite FIS paths or probe on render.
  try {const url=new URL(source); return ['http:','https:'].includes(url.protocol) ? source : null;} catch {return null;}
}
