import type {StayWindow} from '../types.ts';
export function stayWindowText(value?:StayWindow):string {
 if(!value||value.reason==='NO_ROOM')return '';
 if(value.outsideNights===null)return value.reason==='STAY_DATES_UNCLEAR'?'Aufenthaltsdaten unklar':'Eventtermine unklar';
 return value.outsideNights?`${value.outsideNights} ${value.outsideNights===1?'Nacht':'Nächte'} außerhalb des Eventfensters`:'';
}
export function stayWindowDetails(value?:StayWindow):string {
 if(!value||value.reason==='NO_ROOM')return '';
 if(value.outsideNights===null)return stayWindowText(value);
 return `Event: ${value.eventStart} – ${value.eventEnd} · Zulässige An-/Abreise: ${value.allowedStart} – ${value.allowedEnd} · Aufenthalt: ${value.arrivalDate} – ${value.departureDate} · ${value.nightsBefore} Nächte davor, ${value.nightsAfter} danach. Preisbewertung durch das Hotel.`;
}
