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
