export const ezQuotaLabel='Als EZ werten';
export const ezQuotaTooltip='Bestimmt ausschließlich die Quoten- und Mehrpreisbewertung. Die tatsächliche Zimmerart und Belegung bleiben unverändert.';
export const ezQuotaTooltipStyle={
  backgroundColor:'#172336',color:'#ffffff',border:'1px solid #64748b',
  boxShadow:'0 8px 24px rgba(0, 0, 0, 0.32)',fontSize:'12px',lineHeight:1.5,
};
type Person={roomType?:string|null;single_room_status?:string|null};
/** Explanation of the applicable context, never a setter/default calculation.
 * Manual evidence is session-local because bookings expose no origin field. */
export function ezQuotaReason(checked:boolean,capacity:number,people:Person[],manualValue?:boolean):string|undefined {
  if(manualValue!==undefined && manualValue===checked)return 'Manuell geändert';
  if(!checked)return undefined;
  if(capacity===1)return 'Automatisch: Einzelzimmer';
  if(people.length!==1)return undefined;
  const request=(people[0].roomType || '').trim().toLowerCase();
  if(request.includes('single') || request.startsWith('ez') || request.startsWith('sr'))return 'Automatisch: EZ-Wunsch';
  if(people[0].single_room_status==='APPROVED_EXTRA')return 'Automatisch: genehmigte Ausnahme';
  return undefined;
}
