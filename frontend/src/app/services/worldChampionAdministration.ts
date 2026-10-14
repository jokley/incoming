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
    a.name.localeCompare(b.name,'de') || a.eventId.localeCompare(b.eventId) || a.id.localeCompare(b.id));
}
export function championDraft(row: WorldChampion|undefined,edition:ChampionEdition|undefined,eventId:string):Partial<WorldChampion> {
  return row ? {...row} : {eventId,championship:edition?.championship ?? '',championshipYear:edition?.year ?? new Date().getFullYear(),titleType:'INDIVIDUAL',entitlementEnabled:true,active:true,gender:'M'};
}
export function championSourceUrl(source:string):string|null {
  try {const url=new URL(source); return ['http:','https:'].includes(url.protocol) ? url.href : null;} catch {return null;}
}
