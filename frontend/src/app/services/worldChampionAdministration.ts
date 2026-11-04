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
const championDisciplineLabels:Record<string,string> = {
  BA:'Big Air',HP:'Halfpipe',SS:'Slopestyle',PGS:'Parallel Giant Slalom',PSL:'Parallel Slalom',
  PRT:'Parallel Team',SBX:'Snowboard Cross',BXT:'Snowboard Cross Team',SX:'Ski Cross',
  SXT:'Ski Cross Team',MO:'Moguls',DM:'Dual Moguls',DMT:'Dual Moguls Team',AE:'Aerials',AET:'Aerials Team',
};
export function championDisciplineKey(row:Pick<WorldChampion,'eventGroup'|'discipline'>):string {
  return JSON.stringify([row.eventGroup,row.discipline]);
}
export function championDisciplines(rows:WorldChampion[]):Array<{value:string;label:string}> {
  const groupsByLabel=new Map<string,Set<string>>();
  for(const row of rows) {
    const label=championDisciplineLabels[row.discipline] ?? row.discipline;
    const groups=groupsByLabel.get(label) ?? new Set<string>();
    groups.add(row.eventGroup); groupsByLabel.set(label,groups);
  }
  const options=new Map<string,{value:string;label:string}>();
  for(const row of rows) {
    const value=championDisciplineKey(row);
    const name=championDisciplineLabels[row.discipline] ?? row.discipline;
    // Exact structured Event Groups distinguish sports; no inference from names.
    const prefix=row.eventGroup==='Freeski Park & Pipe' ? 'Freeski'
      : row.eventGroup==='Snowboard Park & Pipe' ? 'Snowboard' : row.eventGroup;
    const label=(groupsByLabel.get(name)?.size ?? 0)>1 ? `${prefix} ${name}` : name;
    options.set(value,{value,label});
  }
  return [...options.values()].sort((a,b)=>a.label.localeCompare(b.label,'de') || a.value.localeCompare(b.value));
}
export function filterChampions(rows:WorldChampion[],filters:ChampionFilters):WorldChampion[] {
  const search=filters.search.trim().toLocaleLowerCase('de');
  return rows.filter(row=>(!filters.gender || row.gender===filters.gender) &&
    (!filters.discipline || championDisciplineKey(row)===filters.discipline) &&
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
