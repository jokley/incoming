import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from '@mui/material';
import type { AccommodationCoverage, AccommodationInterval, AssignmentGridHotel, RoomBookingUnitOccupant } from '../../types';
import { api } from '../../services/api';
import { accommodationView, datesWithinInterval, segmentDateDefaults } from '../../services/segmentWorkflow';

type Editor = {person:RoomBookingUnitOccupant;bookingId:string;bounds:AccommodationInterval;checkInDate:string;checkOutDate:string;hotelId:string;room:string};
const dateLabel=(value:string|null)=>value ? value.slice(5).split('-').reverse().join('.') : '—';

export function PersonAccommodationPanel({people,hotels,canEdit,onChanged,onShowDisposition,onSplit,canSplit}:{people:RoomBookingUnitOccupant[];hotels:AssignmentGridHotel[];canEdit:boolean;onChanged:(personId:string)=>Promise<void>;onShowDisposition?:(personId:string,interval:AccommodationInterval)=>void;onSplit?:(bookingId:string)=>void;canSplit?:(bookingId:string)=>boolean}) {
  const [editor,setEditor]=useState<Editor|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [current,setCurrent]=useState<Record<string,{source:AccommodationCoverage;value:AccommodationCoverage}>>({});
  const coverageFor=(person:RoomBookingUnitOccupant)=>{
    const override=current[person.athleteId];
    return override && override.source===person.accommodationCoverage ? override.value : person.accommodationCoverage;
  };
  const open=(person:RoomBookingUnitOccupant,interval:AccommodationInterval,segment:AccommodationCoverage['segments'][number])=>{
    setError('');
    const slot=hotels.find(h=>h.hotelId===segment.hotelId)?.slots.find(s=>s.roomTypeId===segment.roomTypeId && s.roomNumber===segment.roomNumber);
    setEditor({person,bookingId:segment.bookingId,bounds:interval,...segmentDateDefaults(segment),
      hotelId:segment.hotelId,room:slot ? `slot:${slot.slotId}` : ''});
  };
  const hotel=hotels.find(h=>h.hotelId===editor?.hotelId);
  const options=hotel?.slots.map(slot=>({key:`slot:${slot.slotId}`,label:`${slot.roomTypeName} · ${slot.roomNumber}`,slot})) ?? [];
  const option=options.find(value=>value.key===editor?.room);
  const mutate=async(person:RoomBookingUnitOccupant,method:'PUT'|'DELETE',bookingId?:string)=>{
    setBusy(true);setError('');
    try {
      const result=await api.mutateAccommodationSegment(person.athleteId,method,bookingId,method==='DELETE' ? undefined : {
        hotelId:editor!.hotelId,roomTypeId:hotel?.accommodationType==='EXTERNAL' ? undefined : option!.slot.roomTypeId,roomNumber:hotel?.accommodationType==='EXTERNAL' ? undefined : option!.slot.roomNumber ?? undefined,
        checkInDate:editor!.checkInDate,checkOutDate:editor!.checkOutDate,
      });
      setCurrent(values=>({...values,[person.athleteId]:{source:person.accommodationCoverage!,value:result.accommodationCoverage}}));
      setEditor(null);
      await onChanged(person.athleteId);
    } catch(failure) {setError(failure instanceof Error ? failure.message : 'Zuweisung fehlgeschlagen.');}
    finally {setBusy(false);}
  };
  return <section className="space-y-3 border-b border-[var(--ops-divider)] p-4">
    <h3 className="text-sm font-bold">Unterkunft · Gesamtaufenthalt</h3>
    {error && !editor && <Alert severity="error">{error}</Alert>}
    {people.map(person=>{
      const coverage=coverageFor(person);
      if(!coverage) return null;
      const view=accommodationView(coverage);
      return <div key={person.athleteId} className="space-y-2 rounded-lg border border-[var(--ops-border)] p-3 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><b>{person.name}</b><span>{view.label}</span></div>
        <p>{dateLabel(coverage.overallInterval.checkInDate)}–{dateLabel(coverage.overallInterval.checkOutDate)}</p>
        {view.conflicts.length>0 && <Alert severity="warning">Prüfen: Zuweisungen oder Aufenthaltsdaten sind widersprüchlich. Teilen ist bis zur Klärung gesperrt.</Alert>}
        {view.segments.map(segment=><div key={segment.bookingId} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ops-divider)] pt-2">
          <span>{segment.conflictCodes.length ? '⚠' : '✓'} {dateLabel(segment.checkInDate)}–{dateLabel(segment.checkOutDate)} · {segment.hotelName} · {segment.accommodationType==='EXTERNAL' ? 'Extern' : [segment.roomTypeName,segment.roomNumber].filter(Boolean).join(' · ')}</span>
          {canEdit && <div className="flex gap-2"><button type="button" disabled={busy || coverage.coverageStatus==='CONFLICT'} onClick={()=>open(person,coverage.overallInterval,segment)} className="font-semibold text-[var(--ops-primary)] disabled:opacity-40">Bearbeiten</button>{onSplit && <button type="button" disabled={busy || coverage.coverageStatus==='CONFLICT' || canSplit?.(segment.bookingId)===false} onClick={()=>onSplit(segment.bookingId)} className="font-semibold text-[var(--ops-primary)] disabled:opacity-40">Zuweisung teilen</button>}<button type="button" disabled={busy} onClick={()=>void mutate(person,'DELETE',segment.bookingId)} className="text-[var(--ops-error)] disabled:opacity-40">Entfernen</button></div>}
        </div>)}
        {view.openIntervals.map(interval=><div key={`${interval.checkInDate}:${interval.checkOutDate}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ops-divider)] pt-2"><span>○ {dateLabel(interval.checkInDate)}–{dateLabel(interval.checkOutDate)} · Offen</span>{onShowDisposition && <button type="button" disabled={busy || !view.canAdd} onClick={()=>onShowDisposition(person.athleteId,interval)} className="font-semibold text-[var(--ops-primary)] disabled:opacity-40">In Disposition anzeigen</button>}</div>)}
      </div>;
    })}
    <Dialog open={Boolean(editor)} onClose={()=>!busy && setEditor(null)} fullWidth maxWidth="sm">
      <DialogTitle>Zuweisung bearbeiten · {editor?.person.name}</DialogTitle>
      <DialogContent dividers><div className="grid gap-4 pt-1">
        {error && <Alert severity="error">{error}</Alert>}
        <p className="text-xs">Nur diese Person und dieser Zeitraum werden geändert. Andere Zuweisungen bleiben erhalten. Bei einem geteilten Zimmer für abweichende Daten ein anderes freies Zimmer wählen.</p>
        <TextField select size="small" label="Hotel" disabled={busy} value={editor?.hotelId ?? ''} onChange={event=>setEditor(editor && {...editor,hotelId:event.target.value,room:''})}>{hotels.map(h=><MenuItem key={h.hotelId} value={h.hotelId}>{h.hotelName}{h.slots[0]?.dateCoverage.availableFrom && ` · ${dateLabel(h.slots[0].dateCoverage.availableFrom)}–${dateLabel(h.slots[0].dateCoverage.availableUntil)}`}</MenuItem>)}</TextField>
        {hotel?.accommodationType!=='EXTERNAL' && <TextField select size="small" label="Zimmer / Zimmertyp" disabled={busy} value={editor?.room ?? ''} onChange={event=>setEditor(editor && {...editor,room:event.target.value})}>{options.map(o=><MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>)}</TextField>}
        <div className="grid grid-cols-2 gap-3">{(['checkInDate','checkOutDate'] as const).map(field=><TextField key={field} type="date" size="small" disabled={busy} label={field==='checkInDate' ? 'Von' : 'Bis'} value={editor?.[field] ?? ''} slotProps={{inputLabel:{shrink:true}}} inputProps={{min:editor?.bounds.checkInDate,max:editor?.bounds.checkOutDate}} onChange={event=>setEditor(editor && {...editor,[field]:event.target.value})}/>)}</div>
      </div></DialogContent>
      <DialogActions><Button disabled={busy} onClick={()=>setEditor(null)}>Abbrechen</Button><Button variant="contained" disabled={busy || !editor || (hotel?.accommodationType!=='EXTERNAL' && !option) || !datesWithinInterval(editor.checkInDate,editor.checkOutDate,editor.bounds)} onClick={()=>editor && void mutate(editor.person,'PUT',editor.bookingId)}>Speichern</Button></DialogActions>
    </Dialog>
  </section>;
}
