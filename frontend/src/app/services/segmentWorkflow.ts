import type { AccommodationCoverage, AccommodationInterval, RoomBookingUnit } from '../types.ts';

export const coverageLabels:Record<AccommodationCoverage['coverageStatus'],string> = {
  UNASSIGNED:'Nicht zugewiesen',PARTIALLY_ASSIGNED:'Teilweise zugewiesen',
  FULLY_ASSIGNED:'Vollständig zugewiesen',CONFLICT:'Aufenthalt prüfen',
};
export function accommodationView(coverage:AccommodationCoverage) {
  return {label:coverageLabels[coverage.coverageStatus],segments:coverage.segments,
    openIntervals:coverage.openIntervals,conflicts:coverage.conflicts,
    canAdd:coverage.coverageStatus!=='CONFLICT' && coverage.openIntervals.length>0};
}
export function unitCoverageComplete(unit:RoomBookingUnit):boolean {
  return unit.occupants.every(person=>person.accommodationCoverage
    ? person.accommodationCoverage.coverageStatus==='FULLY_ASSIGNED' : unit.isFullyAssigned);
}
/** Keep drag/drop for the unambiguous original full-stay case only. */
export function canUseFullStayDrag(unit:RoomBookingUnit,ids?:string[]):boolean {
  return unit.occupants.filter(person=>!ids?.length || ids.includes(person.athleteId)).every(person=>{
    const coverage=person.accommodationCoverage;
    if(!coverage) return !person.isAssigned;
    const interval=coverage.openIntervals[0];
    return coverage.coverageStatus==='UNASSIGNED' && coverage.segments.length===0 &&
      coverage.openIntervals.length===1 && interval.checkInDate===unit.checkInDate && interval.checkOutDate===unit.checkOutDate;
  });
}
export function datesWithinInterval(start:string,end:string,interval:AccommodationInterval):boolean {
  return Boolean(interval.checkInDate && interval.checkOutDate && start<end &&
    start>=interval.checkInDate && end<=interval.checkOutDate);
}
export function segmentDateDefaults(interval:AccommodationInterval) {
  return {checkInDate:interval.checkInDate ?? '',checkOutDate:interval.checkOutDate ?? ''};
}

export type ActiveAssignmentTarget = {unitId:string;athleteIds:string[];label:string;openInterval:AccommodationInterval};
/** Select an exact backend-projected gap. Never infer an intersection. */
export function assignmentTarget(unit:RoomBookingUnit,ids:string[],interval?:AccommodationInterval):ActiveAssignmentTarget|null {
  const people=unit.occupants.filter(person=>ids.includes(person.athleteId));
  if(!people.length || people.length!==new Set(ids).size || people.some(p=>p.accommodationCoverage?.coverageStatus==='CONFLICT')) return null;
  const chosen=interval ?? (people[0].accommodationCoverage?.openIntervals.length===1 ? people[0].accommodationCoverage.openIntervals[0] : undefined);
  if(!chosen?.checkInDate || !chosen.checkOutDate) return null;
  if(!people.every(person=>person.accommodationCoverage?.openIntervals.some(open=>open.checkInDate===chosen.checkInDate && open.checkOutDate===chosen.checkOutDate))) return null;
  return {unitId:unit.unitId,athleteIds:people.map(p=>p.athleteId),label:people.map(p=>p.name).join(' + '),openInterval:chosen};
}
