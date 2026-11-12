import type {StayWindow} from '../types.ts';
export function stayWindowText(value?:StayWindow):string {
 if(!value||value.reason==='NO_ROOM')return '';
 if(value.outsideNights===null)return value.reason==='STAY_DATES_UNCLEAR'?'Aufenthaltsdaten unklar':'Eventtermine nicht zuordenbar';
 return value.outsideNights?`${value.outsideNights} ${value.outsideNights===1?'Nacht':'Nächte'} außerhalb des Eventfensters`:'';
}
export function stayWindowDetails(value?:StayWindow):string {
 if(!value||value.reason==='NO_ROOM')return '';
 if(value.outsideNights===null)return stayWindowText(value);
 return `Event: ${value.eventStart} – ${value.eventEnd} · Zulässige An-/Abreise: ${value.allowedStart} – ${value.allowedEnd} · Aufenthalt: ${value.intervals?.map(i=>`${i.checkInDate} – ${i.checkOutDate}`).join(' · ') || `${value.arrivalDate} – ${value.departureDate}`} · ${value.nightsBefore} Nächte davor, ${value.nightsAfter} danach. ${stayWindowHotelNote(value)}`;
}

/** Import lists aggregate unknown dates; person details keep the exact reason. */
export function stayWindowRowText(value?:StayWindow):string {
 return value?.reason?'':stayWindowText(value);
}
export function stayWindowNights(value?:StayWindow):string {
 return value&&!value.reason&&(value.outsideNights??0)>0?`${value.nightsBefore} davor / ${value.nightsAfter} danach`:'';
}
export function stayWindowHotelNote(value?:StayWindow):string {
 if(!value||value.reason||!(value.outsideNights&&value.outsideNights>0))return '';
 return `${value.outsideNights} ${value.outsideNights===1?'Nacht':'Nächte'} außerhalb des vorgesehenen Unterkunftszeitraums. Für Übernachtungen außerhalb des vorgesehenen Unterkunftszeitraums kann das Hotel den regulären Hotelpreis verrechnen.`;
}

/** Presentation only: all night counts and event attribution come from the server. */
export function stayWindowDeviationText(value?:StayWindow):string {
 if(!value || value.reason || value.outsideNights===null)return stayWindowText(value);
 if(!value.outsideNights)return '';
 const nights=(count:number)=>`${count} ${count===1?'Nacht':'Nächte'}`;
 return [value.nightsBefore?`+${nights(value.nightsBefore)} vor`:'',value.nightsAfter?`+${nights(value.nightsAfter)} nach`:'']
  .filter(Boolean).join(' · ')+' Unterkunftsfenster';
}
