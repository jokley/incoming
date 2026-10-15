import type { AssignmentSlot } from '../types.ts';
/** Whole-timeline summary only: repeated segments never duplicate a room occupant.
 * Actual availability is still decided by the backend for the selected dates. */
export function slotPersonCount(slot:AssignmentSlot):number {
  return new Set(slot.bookings.flatMap(booking=>booking.occupants.map(person=>person.athleteId))).size;
}
