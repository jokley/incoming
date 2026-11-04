import type { RoomBookingUnitOccupant } from '../types.ts';

export const existingExternalReason='Bereits externer Aufenthalt vorhanden';
export const allExternalReason='Für alle Personen ist bereits ein externer Aufenthalt vorhanden.';

/** Presentation only; all mutation paths enforce the same rule on the server. */
export function externalStayEligibility(people:RoomBookingUnitOccupant[]) {
  const existingIds=new Set(people.filter(person=>person.accommodationCoverage?.segments.some(segment=>segment.accommodationType==='EXTERNAL')).map(person=>person.athleteId));
  const eligibleIds=people.filter(person=>person.accommodationRequirement!=='NO_ROOM' && person.accommodationCoverage?.coverageStatus!=='NO_ROOM' && !existingIds.has(person.athleteId)).map(person=>person.athleteId);
  return {existingIds,eligibleIds,canCreate:eligibleIds.length>0,canCreateTogether:people.length===2 && eligibleIds.length===2,
    defaultSelection:people.length===2 && eligibleIds.length===2 ? 'all' : eligibleIds[0] ?? ''};
}
