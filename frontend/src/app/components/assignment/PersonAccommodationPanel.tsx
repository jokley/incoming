import { AccommodationRateField } from '../AccommodationRate';
import { externalStayEligibility, allExternalReason } from '../../services/externalStayEligibility';
import { SegmentActionMenu } from './SegmentActionMenu';
import { useState } from 'react';
import { Alert, Button } from '@mui/material';
import type { AccommodationCoverage, AccommodationInterval, RoomBookingUnitOccupant } from '../../types';
import { api } from '../../services/api';
import { accommodationView } from '../../services/segmentWorkflow';

const dateLabel=(value:string|null)=>value ? value.slice(5).split('-').reverse().join('.') : '—';

export function PersonAccommodationPanel({people,canEdit,onChanged,onShowDisposition,onSplit,canSplit,onExternal}:{people:RoomBookingUnitOccupant[];canEdit:boolean;onChanged:(personId:string)=>Promise<void>;onShowDisposition?:(personId:string,interval:AccommodationInterval)=>void;onSplit?:(bookingId:string)=>void;canSplit?:(bookingId:string)=>boolean;onExternal?:(people:RoomBookingUnitOccupant[])=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [current,setCurrent]=useState<Record<string,{source:AccommodationCoverage;value:AccommodationCoverage}>>({});
  const coverageFor=(person:RoomBookingUnitOccupant)=>{
    const override=current[person.athleteId];
    return override && override.source===person.accommodationCoverage ? override.value : person.accommodationCoverage;
  };
  const remove=async(person:RoomBookingUnitOccupant,bookingId:string)=>{
    setBusy(true);setError('');
    try {
      const result=await api.mutateAccommodationSegment(person.athleteId,'DELETE',bookingId);
      setCurrent(values=>({...values,[person.athleteId]:{source:person.accommodationCoverage!,value:result.accommodationCoverage}}));
      await onChanged(person.athleteId);
    } catch(failure) {setError(failure instanceof Error ? failure.message : 'Zuweisung fehlgeschlagen.');}
    finally {setBusy(false);}
  };
  const externalEligibility=externalStayEligibility(people.map(p=>({...p,accommodationCoverage:coverageFor(p)})));
  return <section className="space-y-3 border-b border-[var(--ops-divider)] p-4">
    <h3 className="text-sm font-bold">Unterkunft · Gesamtaufenthalt</h3>
    {error && <Alert severity="error">{error}</Alert>}
    {people.map(person=>{
      const coverage=coverageFor(person);
      if(!coverage) return null;
      const view=accommodationView(coverage);
      return <div key={person.athleteId} className="space-y-2 rounded-lg border border-[var(--ops-border)] p-3 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><b>{person.name}</b><span>{view.label}</span></div>
        <div className="max-w-sm"><AccommodationRateField value={person.accommodationRateCategory} disabled={!canEdit || busy} compact onChange={async accommodationRateCategory=>{
          setBusy(true);setError('');
          try {await api.updateAthlete(person.athleteId,{accommodationRateCategory});await onChanged(person.athleteId);}
          catch(e){setError(e instanceof Error ? e.message : 'Tarif konnte nicht gespeichert werden.');}
          finally {setBusy(false);}
        }}/></div>
        {person.accommodationRequirement==='NO_ROOM' && <p>Kein Zimmer benötigt</p>}
        <p>{dateLabel(coverage.overallInterval.checkInDate)}–{dateLabel(coverage.overallInterval.checkOutDate)}</p>
        {view.conflicts.length>0 && <Alert severity="warning">Prüfen: Zuweisungen oder Aufenthaltsdaten sind widersprüchlich. Teilen ist bis zur Klärung gesperrt.</Alert>}
        {view.segments.map(segment=><div key={segment.bookingId} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ops-divider)] pt-2">
          <span>{segment.conflictCodes.length ? '⚠' : '✓'} {dateLabel(segment.checkInDate)}–{dateLabel(segment.checkOutDate)} · {segment.hotelName} · {segment.accommodationType==='EXTERNAL' ? 'Extern' : [segment.roomTypeName,segment.roomNumber].filter(Boolean).join(' · ')}</span>
          {canEdit && <SegmentActionMenu label={`${person.name} · ${dateLabel(segment.checkInDate)}–${dateLabel(segment.checkOutDate)} · ${segment.hotelName}`} busy={busy}
            canChange={coverage.coverageStatus!=='CONFLICT'} canSplit={canSplit?.(segment.bookingId)!==false}
            onSplit={onSplit && segment.accommodationType!=='EXTERNAL' ? ()=>onSplit(segment.bookingId) : undefined}
            onRemove={()=>void remove(person,segment.bookingId)}/>}
        </div>)}
        {view.openIntervals.map(interval=><div key={`${interval.checkInDate}:${interval.checkOutDate}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ops-divider)] pt-2"><span>○ {dateLabel(interval.checkInDate)}–{dateLabel(interval.checkOutDate)} · Offen</span>{onShowDisposition && <button type="button" disabled={busy || !view.canAdd} onClick={()=>onShowDisposition(person.athleteId,interval)} className="font-semibold text-[var(--ops-primary)] disabled:opacity-40">In Disposition anzeigen</button>}</div>)}
      </div>;
    })}
    {canEdit && onExternal && people.length>0 && people.every(person=>person.accommodationRequirement!=='NO_ROOM' && person.accommodationCoverage?.coverageStatus!=='NO_ROOM') && <span className="inline-block" title={!externalEligibility.canCreate ? allExternalReason : undefined}><Button size="small" variant="outlined" disabled={busy || !externalEligibility.canCreate || people.some(p=>coverageFor(p)?.coverageStatus==='CONFLICT')} onClick={()=>onExternal(people)}>Externen Aufenthalt</Button></span>}

  </section>;
}
