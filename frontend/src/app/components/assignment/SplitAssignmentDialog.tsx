import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, TextField } from '@mui/material';
import type { AccommodationSplitPlan, AccommodationSplitResult, RoomBooking } from '../../types';
import { api } from '../../services/api';
import { periodLabel } from '../../services/dispositionItems';

export function SplitPreview({plan}:{plan:AccommodationSplitPlan}) {
  const open=new Map<string,{label:string;names:string[]}>();
  plan.people.filter(p=>p.selected).forEach(person=>person.affectedOpenIntervals.forEach(interval=>{
    const key=`${interval.checkInDate}:${interval.checkOutDate}`;
    if(!open.has(key))open.set(key,{label:periodLabel(interval),names:[]});
    open.get(key)!.names.push(person.name);
  }));
  return <div className="space-y-3 text-sm" aria-label="Vorschau nach Teilung">
    <div><b>Bestehender Teil · Zugewiesen</b>{plan.retainedSegments.map(s=><p key={s.bookingId}>{periodLabel(s)} · {plan.booking.hotel.name} · {plan.people.filter(p=>s.athleteIds.includes(p.personId)).map(p=>p.name).join(' + ')}</p>)}</div>
    <div><b>Neuer Teil · Offen</b>{Array.from(open.entries()).map(([key,value])=><p key={key}>{value.label} · {value.names.join(' + ')} · Offen</p>)}</div>
    {plan.people.some(p=>!p.selected) && <p>Die Unterkunft der übrigen Bewohner bleibt durchgehend erhalten.</p>}
  </div>;
}

export type SplitSource=Omit<RoomBooking,'occupants'> & {occupants:Array<{athlete:{id:string;firstname:string;lastname:string}}>};

export function SplitAssignmentDialog({booking,onClose,onSplit}:{booking:SplitSource;onClose:()=>void;onSplit:(result:AccommodationSplitResult)=>Promise<void>}) {
  const [selection,setSelection]=useState('all'),[date,setDate]=useState('');
  const [plan,setPlan]=useState<AccommodationSplitPlan|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
  const generation=useRef(0);
  const ids=selection==='all' ? booking.occupants.map(o=>o.athlete.id) : [selection];
  const key=ids.join(',');
  const valid=Boolean(date && booking.checkInDate && booking.checkOutDate && booking.checkInDate<date && date<booking.checkOutDate);
  useEffect(()=>{
    const request=++generation.current;setPlan(null);setError('');setLoading(false);
    if(!valid)return;
    setLoading(true);
    api.previewAccommodationSplit(booking.id,key.split(','),date).then(value=>{if(request===generation.current)setPlan(value);})
      .catch(error=>{if(request===generation.current)setError(error.message);})
      .finally(()=>{if(request===generation.current)setLoading(false);});
    return ()=>{generation.current+=1;};
  },[booking.id,key,date,valid]);
  const matches=plan && plan.splitDate===date && [...plan.athleteIds].sort().join(',')===[...ids].sort().join(',');
  const confirm=async()=>{
    if(!plan || !matches)return;setSaving(true);setError('');
    try {const result=await api.splitAccommodation(booking.id,plan);await onSplit(result);onClose();}
    catch(error){setError(error instanceof Error ? error.message : 'Teilung fehlgeschlagen.');setPlan(null);}
    finally{setSaving(false);}
  };
  return <Dialog open onClose={()=>!saving && onClose()} fullWidth maxWidth="sm">
    <DialogTitle>Zuweisung teilen</DialogTitle><DialogContent dividers>
      <div className="mb-4 text-sm"><b>{booking.hotel.name}</b><p>{booking.hotel.accommodationType==='EXTERNAL' ? 'Extern' : booking.roomType?.name} {booking.roomNumber && `· ${booking.roomNumber}`} · {periodLabel({checkInDate:booking.checkInDate ?? null,checkOutDate:booking.checkOutDate ?? null})}</p><p>{booking.occupants.map(o=>`${o.athlete.firstname} ${o.athlete.lastname}`).join(' + ')}</p></div>
      {booking.occupants.length>1 && <fieldset className="mb-3"><legend>Personen</legend><RadioGroup value={selection} onChange={event=>setSelection(event.target.value)}>
        <FormControlLabel disabled={saving} value="all" control={<Radio size="small"/>} label={booking.occupants.length===2 ? 'Beide' : 'Alle Bewohner'}/>
        {booking.occupants.map(o=><FormControlLabel key={o.athlete.id} disabled={saving} value={o.athlete.id} control={<Radio size="small"/>} label={`${o.athlete.firstname} ${o.athlete.lastname}`}/>)}
      </RadioGroup></fieldset>}
      <TextField fullWidth size="small" type="date" label="Teilungsdatum" disabled={saving} value={date} onChange={event=>setDate(event.target.value)} slotProps={{inputLabel:{shrink:true}}} inputProps={{min:booking.checkInDate,max:booking.checkOutDate}} helperText="Muss nach Anreise und vor Abreise liegen."/>
      {date && !valid && <Alert severity="warning">Teilungsdatum muss innerhalb der Zuweisung liegen.</Alert>}
      {error && <Alert severity="error" className="mt-3">{error} Datum oder Personen erneut auswählen, um die Vorschau zu aktualisieren.</Alert>}
      {loading && <p role="status" className="mt-3 text-sm">Vorschau wird geprüft …</p>}
      {plan && !loading && <div className="mt-4 rounded-lg border border-[var(--ops-border)] p-3"><SplitPreview plan={plan}/></div>}
    </DialogContent><DialogActions><Button disabled={saving} onClick={onClose}>Abbrechen</Button><Button variant="contained" disabled={saving || loading || !plan || !matches || !valid} onClick={()=>void confirm()}>Teilen</Button></DialogActions>
  </Dialog>;
}
