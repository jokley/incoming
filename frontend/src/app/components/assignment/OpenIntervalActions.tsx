import { createContext, useContext } from 'react';
import type { AccommodationInterval, AssignmentValidationResult, RoomBookingUnitOccupant } from '../../types';
export const OpenAssignmentContext=createContext<{
  activate:(personIds:string[],interval:AccommodationInterval)=>void;
  available:boolean;
  validations?:AssignmentValidationResult[];
  interval?:AccommodationInterval;
  occupantCount?:number;
}>({activate:()=>{},available:false});
export const intervalLabel=(interval:AccommodationInterval)=>[interval.checkInDate,interval.checkOutDate].map(date=>date?.slice(5).split('-').reverse().join('.') ?? '—').join('–');
export function OpenIntervalActions({person}:{person:RoomBookingUnitOccupant}) {
  const {activate,available}=useContext(OpenAssignmentContext);
  const coverage=person.accommodationCoverage;
  if(!coverage || coverage.coverageStatus==='FULLY_ASSIGNED') return null;
  return <div className="mt-1 max-h-28 space-y-1 overflow-y-auto text-[10px]">
    {coverage.segments.map(segment=><div key={segment.bookingId} className="truncate" title={segment.hotelName ?? undefined}>✓ {intervalLabel(segment)} · {segment.hotelName}</div>)}
    {coverage.openIntervals.map(interval=><div key={`${interval.checkInDate}:${interval.checkOutDate}`} className="flex flex-wrap items-center justify-between gap-1">
      <span>○ {intervalLabel(interval)} · Offen</span>
      {available && coverage.coverageStatus!=='CONFLICT' && <button type="button" onClick={event=>{event.stopPropagation();activate([person.athleteId],interval);}} className="text-[10px] font-bold text-[var(--ops-primary)]">{coverage.coverageStatus==='PARTIALLY_ASSIGNED' && coverage.openIntervals.length===1 ? 'Rest zuweisen' : 'Zuweisen'}</button>}
    </div>)}
  </div>;
}
