import type { AccommodationInterval, AssignmentGridHotel, RoomBookingUnit, RoomBookingUnitOccupant } from '../types.ts';

export type DispositionItem = RoomBookingUnit & {openPeriod:AccommodationInterval;canAssign:boolean;previous:string[]};
export const periodLabel=(interval:AccommodationInterval)=>[interval.checkInDate,interval.checkOutDate].map(value=>value?.slice(5).split('-').reverse().join('.') ?? '—').join('–');
export const dispositionItemId=(ids:string[],period:AccommodationInterval)=>`need:${[...ids].sort().join(',')}:${period.checkInDate}:${period.checkOutDate}`;

/** Presentation adapter only. Every period is copied from backend coverage. */
export function dispositionItems(units:RoomBookingUnit[],hotels:AssignmentGridHotel[]):DispositionItem[] {
  const people=new Map<string,{person:RoomBookingUnitOccupant;unit:RoomBookingUnit}>();
  units.forEach(unit=>unit.occupants.forEach(person=>people.set(person.athleteId,{person,unit})));
  const used=new Set<string>(),items:DispositionItem[]=[];
  const add=(ids:string[],period:AccommodationInterval,canAssign=true)=>{
    const records=ids.map(id=>people.get(id)!);
    if(records.some(value=>!value))return;
    const occupants=records.map(value=>value.person);
    const base=records[0].unit;
    const previous=Array.from(new Set(occupants.flatMap(p=>p.accommodationCoverage?.segments.map(s=>`${periodLabel(s)} · ${s.hotelName ?? '—'}`) ?? [])));
    items.push({...base,unitId:dispositionItemId(ids,period),sourceRowKey:base.unitId,occupants,
      checkInDate:period.checkInDate,checkOutDate:period.checkOutDate,openPeriod:period,canAssign,previous,
      occupantCount:ids.length,isFullyAssigned:false,assignedBookingId:null,
      assignmentWarnings:canAssign ? [] : base.assignmentWarnings});
    ids.forEach(id=>used.add(dispositionItemId([id],period)));
  };
  const common=(ids:string[],start?:string|null)=>{
    const first=people.get(ids[0])?.person.accommodationCoverage;
    if(!first || ids.length!==2 || ids.some(id=>people.get(id)?.person.accommodationCoverage?.coverageStatus==='CONFLICT'))return;
    first.openIntervals.forEach(period=>{
      if(start && period.checkInDate!==start)return;
      if(ids.some(id=>used.has(dispositionItemId([id],period))))return;
      if(ids.every(id=>people.get(id)?.person.accommodationCoverage?.openIntervals.some(p=>p.checkInDate===period.checkInDate && p.checkOutDate===period.checkOutDate))) add(ids,period);
    });
  };
  // A retained shared booking is persistent context, not a new roommate preference.
  const bookings=hotels.flatMap(h=>h.slots.flatMap(s=>s.bookings)).sort((a,b)=>(b.checkOutDate ?? '').localeCompare(a.checkOutDate ?? '') || a.bookingId.localeCompare(b.bookingId));
  bookings.forEach(b=>common(b.occupants.map(p=>p.athleteId),b.checkOutDate));
  units.filter(u=>u.occupants.length===2).forEach(u=>common(u.occupants.map(p=>p.athleteId)));
  people.forEach(({person})=>{
    const coverage=person.accommodationCoverage;
    if(!coverage)return;
    if(coverage.coverageStatus==='CONFLICT') {add([person.athleteId],coverage.overallInterval,false);return;}
    coverage.openIntervals.forEach(period=>{
      if(!used.has(dispositionItemId([person.athleteId],period)))add([person.athleteId],period);
    });
  });
  return items.sort((a,b)=>(a.checkInDate ?? '').localeCompare(b.checkInDate ?? '') || a.unitId.localeCompare(b.unitId));
}

export function itemContainsPeople(item:DispositionItem,ids:string[],period?:AccommodationInterval) {
  return ids.some(id=>item.occupants.some(p=>p.athleteId===id)) && (!period || (item.checkInDate===period.checkInDate && item.checkOutDate===period.checkOutDate));
}
