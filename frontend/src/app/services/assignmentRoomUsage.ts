import type { ApartmentLayout, AssignmentSlot } from '../types.ts';
/** Whole-timeline summary only: repeated segments never duplicate a room occupant.
 * Actual availability is still decided by the backend for the selected dates. */
export function slotPersonCount(slot:AssignmentSlot):number {
  return new Set(slot.bookings.flatMap(booking=>booking.occupants.map(person=>person.athleteId))).size;
}

/** Capacity blocked by single use stays distinct from physical occupants. */
export function bookingFreeCapacity(booking:{capacity?:number;countsAsSingle?:boolean;occupants:unknown[]}):number {
  return booking.countsAsSingle ? 0 : Math.max(0,(booking.capacity ?? 0)-booking.occupants.length);
}
export function apartmentAvailability(layout: ApartmentLayout, maximum: number,
  bookings: Array<{bedroomIndex?: number | null; countsAsSingle?: boolean; occupants: unknown[]}>) {
  const bedrooms = new Set(bookings.flatMap(booking => booking.bedroomIndex ? [booking.bedroomIndex] : []));
  const people = bookings.reduce((sum,booking)=>sum+booking.occupants.length,0);
  if (bookings.some(booking=>!booking.bedroomIndex)) {
    return {freeBeds:0, occupiedBedrooms:bedrooms.size, exceptional:false};
  }
  const spare = bookings.reduce((sum,booking)=>sum+bookingFreeCapacity({
    ...booking, capacity:layout.bedrooms[booking.bedroomIndex!-1],
  }),0);
  const freeRooms = layout.bedrooms.filter((_,index)=>!bedrooms.has(index+1)).sort((a,b)=>b-a);
  const available = spare + freeRooms.slice(0,Math.max(0,layout.showers-bedrooms.size)).reduce((sum,beds)=>sum+beds,0);
  const exceptional = people > maximum || bedrooms.size > layout.showers;
  return {freeBeds:exceptional ? 0 : Math.max(0,Math.min(maximum-people,available)),
    occupiedBedrooms:bedrooms.size, exceptional};
}

export function slotOperationalUsed(slot:AssignmentSlot):number {
  if (slot.apartmentLayout) return slot.capacity-apartmentAvailability(slot.apartmentLayout,slot.capacity,slot.bookings).freeBeds;
  return slot.bookings.some(b=>b.countsAsSingle) ? slot.capacity : Math.min(slot.capacity,slotPersonCount(slot));
}

/** Compare inventory and occupancy at the same instant, including legacy bookings. */
export function assignmentCapacityPeak(slots: AssignmentSlot[]) {
  const dates = [...new Set(slots.flatMap(slot => [
    slot.dateCoverage.availableFrom, slot.dateCoverage.availableUntil,
    ...slot.bookings.flatMap(booking => [booking.checkInDate, booking.checkOutDate]),
  ]).filter((date): date is string => Boolean(date)))].sort();
  let peak = {date: '', totalRooms: 0, totalBeds: 0, usedRooms: 0, usedBeds: 0, operationalUsed: 0};
  for (const date of dates) {
    const day = {date, totalRooms: 0, totalBeds: 0, usedRooms: 0, usedBeds: 0, operationalUsed: 0};
    const people = new Set<string>();
    for (const slot of slots) {
      const {availableFrom, availableUntil} = slot.dateCoverage;
      if (availableFrom && availableUntil && availableFrom <= date && date < availableUntil) {
        day.totalRooms += 1;
        day.totalBeds += slot.capacity;
      }
      const active = slot.bookings.filter(booking => booking.checkInDate && booking.checkOutDate
        && booking.checkInDate <= date && date < booking.checkOutDate);
      if (active.length) {
        day.usedRooms += 1;
        day.operationalUsed += slotOperationalUsed({...slot, bookings: active});
        active.forEach(booking => booking.occupants.forEach(person => people.add(person.athleteId)));
      }
    }
    day.usedBeds = people.size;
    if (day.totalBeds > peak.totalBeds || (day.totalBeds === peak.totalBeds && day.operationalUsed > peak.operationalUsed)) {
      peak = day;
    }
  }
  return peak;
}
