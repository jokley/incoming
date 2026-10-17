import type { DispositionItem } from './dispositionItems.ts';
import {isQueueAthlete} from './queuePersonType.ts';
export type HotelFit={state:'FIT_ALL'|'FIT_PARTIAL'|'NO_FIT';count:number;total:number;alreadyUsed:boolean;conservative:boolean};
export function hotelFitLabel(fit:HotelFit):string {
  if(!fit.total)return 'Kein offener Unterkunftsbedarf';
  return `${fit.state==='FIT_ALL' ? '✓ Passt komplett' : fit.state==='FIT_PARTIAL' ? '◐ Teilweise passend' : 'Nicht passend'} · ${fit.conservative ? 'mind. ' : ''}${fit.count} / ${fit.total} aufnehmbar`;
}
export const matchesHotelFit=(fit:HotelFit|undefined,filter:string)=>filter==='fit' ? fit?.state==='FIT_ALL' : filter==='used' ? !!fit?.alreadyUsed : true;
export const compareHotelFit=(a?:HotelFit,b?:HotelFit)=>['FIT_ALL','FIT_PARTIAL','NO_FIT'].indexOf(a?.state ?? 'NO_FIT')-['FIT_ALL','FIT_PARTIAL','NO_FIT'].indexOf(b?.state ?? 'NO_FIT');
export function queueDemandSummary(units:DispositionItem[]) {
  const needs=units.filter(u=>u.canAssign);
  const people=[...new Map(needs.flatMap(u=>u.occupants).filter(p=>p.accommodationRequirement!=='NO_ROOM').map(p=>[p.athleteId,p])).values()];
  const athletes=people.filter(isQueueAthlete).length;
  const ez=new Set(needs.filter(u=>u.roomCategoryLabel==='ez' || u.roomTypeLabel==='single').flatMap(u=>u.occupants.filter(p=>p.accommodationRequirement!=='NO_ROOM').map(p=>p.athleteId))).size;
  const dates=needs.flatMap(u=>[u.checkInDate,u.checkOutDate]).filter(Boolean).sort() as string[];
  return {people:people.length,athletes,officials:people.length-athletes,ez,dz:people.length-ez,start:dates[0],end:dates.at(-1)};
}
