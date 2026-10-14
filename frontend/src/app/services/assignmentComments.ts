import type { AssignmentGridHotel } from '../types.ts';

export function contingentComments(hotel:AssignmentGridHotel|undefined,roomTypeId?:string) {
  return (hotel?.inventoryComments ?? []).filter(item=>(!roomTypeId || item.roomTypeId===roomTypeId) && Boolean(item.comment?.trim()));
}

export function visibleAssignmentComment(comment?:string|null):string|null {
  return comment?.trim() || null;
}
