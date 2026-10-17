import type { AssignmentSlot, RoomBookingUnit, RoomBookingUnitOccupant } from '../types.ts';

/** Display only: person room request from the canonical planning projection.
 * Never infer a request from assigned capacity, tariff or quota status. */
export function queueRoomRequest(person:Pick<RoomBookingUnitOccupant,'roomType'>, unit:Pick<RoomBookingUnit,'roomType'|'roomTypeLabel'|'roomCategoryLabel'>):string {
  const request=person.roomType?.trim();
  if(request) {
    const value=request.toLowerCase();
    if(value.includes('single') || value.startsWith('ez') || value.startsWith('sr'))return 'EZ';
    if(value.includes('double') || value.startsWith('dz'))return 'DZ';
    return request;
  }
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
