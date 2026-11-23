import type { AssignmentSlot, RoomBookingUnit, RoomBookingUnitOccupant } from '../types.ts';

export function explicitRoomRequest(roomType?: string | null): string {
  const request = roomType?.trim() ?? '';
  const value = request.toLowerCase();
  if (value.includes('single') || value.startsWith('ez') || value.startsWith('sr')) return 'EZ';
  if (value.includes('double') || value.startsWith('dz')) return 'DZ';
  return request;
}

/** Display only: person room request from the canonical planning projection.
 * Never infer a request from assigned capacity, tariff or quota status. */
export function queueRoomRequest(person:Pick<RoomBookingUnitOccupant,'roomType'>, unit:Pick<RoomBookingUnit,'roomType'|'roomTypeLabel'|'roomCategoryLabel'>):string {
  const request=explicitRoomRequest(person.roomType);
  if(request)return request;
  if(unit.roomCategoryLabel==='ez' || unit.roomTypeLabel==='single')return 'EZ';
  if(unit.roomCategoryLabel==='dz' || unit.roomTypeLabel==='double')return 'DZ';
  return unit.roomType || '—';
}

/** Stable inventory order, natural room label, then stable identity. No occupancy. */
export function stableRoomSlots<T extends Pick<AssignmentSlot,'slotId'|'roomNumber'> & {slotIndex?:number}>(slots:readonly T[]):T[] {
  return [...slots].sort((a,b)=>{
    const indexA=Number.isFinite(a.slotIndex) ? a.slotIndex : undefined;
    const indexB=Number.isFinite(b.slotIndex) ? b.slotIndex : undefined;
    if(indexA!==undefined && indexB!==undefined && indexA!==indexB)return indexA-indexB;
    if(indexA!==undefined && indexB===undefined)return -1;
    if(indexB!==undefined && indexA===undefined)return 1;
    const label=(a.roomNumber || '').localeCompare(b.roomNumber || '','de',{numeric:true});
    return label || a.slotId.localeCompare(b.slotId,'de',{numeric:true});
  });
}

import type {PersonDispositionStatus,PersonDispositionSummary} from './fisRules.ts';
export const personTaskCategories = [
  {key:'fullyAssigned',label:'Vollständig',hint:'Vollständig untergebrachte Personen / operativer Bedarf in Personenplätzen, einschließlich gültiger virtueller Gruppen.'},
  {key:'unassigned',label:'Nicht zugewiesen',hint:'Personen ohne Unterbringung im erforderlichen Aufenthalt.'},
  {key:'partiallyAssigned',label:'Teilweise',hint:'Personen mit noch offenen Aufenthaltsintervallen.'},
  {key:'accommodationConflicts',label:'Konflikte',hint:'Personen mit Konflikten in der Aufenthaltsabdeckung.'},
  {key:'roomPreferenceMismatches',label:'Wunschabweichungen',hint:'Personen mit feststellbarer Abweichung vom gemeldeten Zimmerwunsch.'},
  {key:'pendingSingleRoomPeople',label:'EZ ungeklärt',hint:'Eindeutige Personen mit ungedeckter EZ-Nutzung, einschließlich kontextloser Fälle. Keine Zahl von Quotenkontexten.'},
] as const satisfies ReadonlyArray<{key:keyof PersonDispositionSummary;label:string;hint:string}>;
export type PersonTaskCategory=typeof personTaskCategories[number]['key'];
/** Select existing read-model facts only; never evaluate bookings or quotas. */
export function personTaskPeople(people:PersonDispositionStatus[],category:PersonTaskCategory,excludedAccommodationIds:string[]=[]) {
 const excluded=new Set(excludedAccommodationIds);
 const statuses={fullyAssigned:'FULLY_ASSIGNED',unassigned:'UNASSIGNED',partiallyAssigned:'PARTIALLY_ASSIGNED',accommodationConflicts:'CONFLICT'};
 return [...new Map(people.filter(person=>category==='pendingSingleRoomPeople'?person.singleRoom.status==='PENDING'
  :category==='roomPreferenceMismatches'?person.roomPreference.hasMismatch
  :!excluded.has(person.personId)&&person.accommodation.coverageStatus===statuses[category]).map(person=>[person.personId,person])).values()];
}
export const accommodationStatusText={UNASSIGNED:'Nicht zugewiesen',PARTIALLY_ASSIGNED:'Teilweise untergebracht',FULLY_ASSIGNED:'Vollständig untergebracht',CONFLICT:'Unterkunftskonflikt',NO_ROOM:'Kein Unterkunftsbedarf'};
export const preferenceStatusText={MATCH:'Zimmerwunsch erfüllt',MISMATCH:'Zimmerwunsch abweichend',UNKNOWN:'Zimmerwunsch nicht eindeutig bewertbar',UNASSIGNED:'Zimmerwunsch noch nicht umgesetzt',NOT_APPLICABLE:'Zimmerwunsch nicht anwendbar'};
export const singleStatusText={NO_SINGLE_USE:'Keine EZ-Nutzung',COVERED:'EZ regulär gedeckt',APPROVED_EXTRA:'Zusatzgenehmigung anwendbar und genutzt',EXEMPT:'Kostenfreie EZ-Ausnahme',PENDING:'EZ-Klärung erforderlich',UNKNOWN:'EZ-Bewertung nicht verfügbar'};
export function personStatusIndicators(person?:PersonDispositionStatus) {
 type Indicator={kind:'single'|'conflict'|'preference'|'coverage'|'unknown';label:string;tone:'warning'|'success'|'neutral'};
 if(!person)return [{kind:'unknown',label:'Personenstatus nicht verfügbar',tone:'neutral'}] as Indicator[];
 const indicators:Indicator[]=[];
 if(person.singleRoom.status==='PENDING')indicators.push({kind:'single',label:singleStatusText.PENDING,tone:'warning'});
 if(person.accommodation.coverageStatus==='CONFLICT')indicators.push({kind:'conflict',label:accommodationStatusText.CONFLICT,tone:'warning'});
 if(person.roomPreference.hasMismatch)indicators.push({kind:'preference',label:preferenceStatusText.MISMATCH,tone:'warning'});
 if(person.accommodation.coverageStatus!=='CONFLICT')indicators.push({kind:'coverage',label:accommodationStatusText[person.accommodation.coverageStatus],tone:person.accommodation.coverageStatus==='FULLY_ASSIGNED'?'success':'neutral'});
 if(person.singleRoom.status!=='PENDING')indicators.push({kind:'single',label:singleStatusText[person.singleRoom.status],tone:['COVERED','APPROVED_EXTRA','EXEMPT'].includes(person.singleRoom.status)?'success':'neutral'});
 return indicators.slice(0,2);
}
