import type { AssignmentGridHotel, AssignmentSlot } from '../types.ts';

export function contingentComments(hotel:AssignmentGridHotel|undefined,roomTypeId?:string) {
  return (hotel?.inventoryComments ?? []).filter(item=>(!roomTypeId || item.roomTypeId===roomTypeId) && Boolean(item.comment?.trim()));
}

export function visibleAssignmentComment(comment?:string|null):string|null {
  return comment?.trim() || null;
}

/** Display exact category inventory periods; never turn separate intervals into an envelope. */
export function contingentPeriodLabel(slots: Pick<AssignmentSlot,'dateCoverage'>[]):string {
  const periods=[...new Map(slots.flatMap(slot=>slot.dateCoverage.intervals ?? [])
    .map(period=>[`${period.availableFrom}/${period.availableUntil}`,period])).values()]
    .sort((a,b)=>a.availableFrom.localeCompare(b.availableFrom) || a.availableUntil.localeCompare(b.availableUntil));
  const date=(value:string,year=true)=>new Date(`${value}T00:00:00Z`).toLocaleDateString('de-DE',
    {day:'2-digit',month:'2-digit',...(year?{year:'numeric' as const}:{}),timeZone:'UTC'});
  return periods.length ? `Kontingent: ${periods.map(period=>`${date(period.availableFrom,period.availableFrom.slice(0,4)!==period.availableUntil.slice(0,4))}–${date(period.availableUntil)}`).join(' · ')}`
    : 'Kontingent: Zeitraum nicht verfügbar';
}
