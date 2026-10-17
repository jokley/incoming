import type { AssignmentSlot } from '../types.ts';
/** Whole-timeline summary only: repeated segments never duplicate a room occupant.
 * Actual availability is still decided by the backend for the selected dates. */
export function slotPersonCount(slot:AssignmentSlot):number {
  return new Set(slot.bookings.flatMap(booking=>booking.occupants.map(person=>person.athleteId))).size;
}

/** Capacity blocked by single use stays distinct from physical occupants. */
export function bookingFreeCapacity(booking:{capacity?:number;countsAsSingle?:boolean;occupants:unknown[]}):number {
  return booking.countsAsSingle ? 0 : Math.max(0,(booking.capacity ?? 0)-booking.occupants.length);
}
export function slotOperationalUsed(slot:AssignmentSlot):number {
  return slot.bookings.some(b=>b.countsAsSingle) ? slot.capacity : Math.min(slot.capacity,slotPersonCount(slot));
}
