import type { AccommodationCoverage, AccommodationInterval, RoomBookingUnit } from '../types.ts';

export const coverageLabels:Record<AccommodationCoverage['coverageStatus'],string> = {
  UNASSIGNED:'Nicht zugewiesen',PARTIALLY_ASSIGNED:'Teilweise zugewiesen',
  FULLY_ASSIGNED:'Zugewiesen',CONFLICT:'Prüfen',
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
export function datesWithinInterval(start:string,end:string,interval:AccommodationInterval):boolean {
  return Boolean(interval.checkInDate && interval.checkOutDate && start<end &&
    start>=interval.checkInDate && end<=interval.checkOutDate);
}
export function segmentDateDefaults(interval:AccommodationInterval) {
  return {checkInDate:interval.checkInDate ?? '',checkOutDate:interval.checkOutDate ?? ''};
}
