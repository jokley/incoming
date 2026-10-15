import { externalStayEligibility, existingExternalReason, allExternalReason } from '../../services/externalStayEligibility';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup, TextField } from '@mui/material';
import type { AssignmentGridHotel, ExternalStayPlan } from '../../types';
import type { DispositionItem } from '../../services/dispositionItems';
import { periodLabel } from '../../services/dispositionItems';
import { api } from '../../services/api';

export function ExternalStayPreview({plan}:{plan:ExternalStayPlan}) {
  return <div className="space-y-3 rounded-lg border border-[var(--ops-border)] p-3 text-sm">
    <p><b>Extern zugewiesen</b><br/>{periodLabel(plan)} · {plan.hotelName} · Extern</p>
    {plan.people.map(person=><div key={person.personId}><b>{person.name} · {plan.replaceStandard ? 'Danach' : 'Danach offen'}</b>{plan.replaceStandard && person.accommodationCoverage.segments.map(segment=><p key={`${segment.bookingId}:${segment.checkInDate}`}>{periodLabel(segment)} · {segment.hotelName}{segment.accommodationType==='EXTERNAL' ? ' · Extern' : ''}</p>)}{person.accommodationCoverage.openIntervals.length ? person.accommodationCoverage.openIntervals.map(interval=><p key={`${interval.checkInDate}:${interval.checkOutDate}`}>{periodLabel(interval)} · Offen</p>) : <p>Kein offener Zeitraum</p>}</div>)}
  </div>;
}

export type ExternalStayTarget=Pick<DispositionItem,'occupants'|'openPeriod'> & {replaceStandard?:boolean};

export function ExternalStayDialog({item,hotels,onClose,onComplete}:{item:ExternalStayTarget;hotels:AssignmentGridHotel[];onClose:()=>void;onComplete:(ids:string[])=>Promise<void>}) {
  const eligibility=externalStayEligibility(item.occupants);
  const [selection,setSelection]=useState(eligibility.defaultSelection),[hotelId,setHotelId]=useState('');
  const [start,setStart]=useState(item.openPeriod.checkInDate ?? ''),[end,setEnd]=useState(item.openPeriod.checkOutDate ?? '');
  const [plan,setPlan]=useState<ExternalStayPlan|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
  const generation=useRef(0);
  const ids=selection==='all' ? item.occupants.map(p=>p.athleteId) : selection ? [selection] : [];
  const selectionEligible=ids.length>0 && ids.every(id=>eligibility.eligibleIds.includes(id));
  const key=ids.join(',');
  const bounds=item.replaceStandard && ids.length===1 ? item.occupants.find(p=>p.athleteId===ids[0])?.accommodationCoverage?.overallInterval ?? item.openPeriod : item.openPeriod;
  const valid=selectionEligible && !!hotelId && !!start && !!end && bounds.checkInDate!<=start && start<end && end<=bounds.checkOutDate!;
  useEffect(()=>{
    const request=++generation.current;setPlan(null);setError('');setLoading(false);
    if(!valid)return;
    setLoading(true);
    api.previewExternalStay({athleteIds:key.split(','),hotelId,checkInDate:start,checkOutDate:end,openInterval:bounds,replaceStandard:item.replaceStandard})
      .then(value=>{if(generation.current===request)setPlan(value);})
      .catch(reason=>{if(generation.current===request)setError(reason.message);})
      .finally(()=>{if(generation.current===request)setLoading(false);});
    return ()=>{generation.current++;};
  },[key,hotelId,start,end,valid,item,bounds]);
  const matches=selectionEligible && plan && !!plan.replaceStandard===!!item.replaceStandard && plan.hotelId===hotelId && plan.checkInDate===start && plan.checkOutDate===end && plan.athleteIds.join(',')===[...ids].sort((a,b)=>Number(a)-Number(b)).join(',');
  return <Dialog open fullWidth maxWidth="sm" onClose={()=>!saving && onClose()}>
    <DialogTitle>Externen Aufenthalt</DialogTitle>
    <DialogContent dividers><div className="space-y-4 flex flex-col">
      <p className="text-sm">{item.replaceStandard ? 'Gesamtaufenthalt' : 'Offener Aufenthalt'} · <b>{periodLabel(bounds)}</b><br/>{item.occupants.map(p=>p.name).join(' + ')}</p>
      {item.occupants.length>1 && <RadioGroup aria-label="Personen" value={selection} onChange={e=>setSelection(e.target.value)}>{item.occupants.length===2 && <FormControlLabel value="all" control={<Radio disabled={saving || !eligibility.canCreateTogether}/>} disabled={saving || !eligibility.canCreateTogether} label={eligibility.canCreateTogether ? 'Beide' : `Beide · ${existingExternalReason}`}/>}{item.occupants.map(p=><FormControlLabel key={p.athleteId} value={p.athleteId} disabled={saving || eligibility.existingIds.has(p.athleteId)} control={<Radio disabled={saving || eligibility.existingIds.has(p.athleteId)}/>} label={eligibility.existingIds.has(p.athleteId) ? `${p.name} · ${existingExternalReason}` : p.name}/>)}</RadioGroup>}
      {!eligibility.canCreate && <Alert severity="info">{allExternalReason}</Alert>}
      <TextField select SelectProps={{MenuProps:{PaperProps:{sx:{maxHeight:280}}}}} fullWidth size="small" label="Externe Unterkunft" value={hotelId} disabled={saving} onChange={e=>setHotelId(e.target.value)}>{hotels.filter(h=>h.accommodationType==='EXTERNAL').map(h=><MenuItem key={h.hotelId} value={h.hotelId}>{h.hotelName}</MenuItem>)}</TextField>
      {!hotels.some(h=>h.accommodationType==='EXTERNAL') && <Alert severity="info">Zuerst eine externe Unterkunft unter Hotels anlegen.</Alert>}
      <div className="grid grid-cols-2 gap-3">{(['Von','Bis'] as const).map(label=><TextField key={label} type="date" size="small" label={label} disabled={saving} value={label==='Von' ? start : end} onChange={e=>label==='Von' ? setStart(e.target.value) : setEnd(e.target.value)} slotProps={{inputLabel:{shrink:true}}} inputProps={{min:bounds.checkInDate,max:bounds.checkOutDate}}/>)}</div>
      {!valid && hotelId && <p className="text-xs">Von muss vor Bis und innerhalb des angezeigten Aufenthalts liegen.</p>}
      {loading && <p className="text-sm">Vorschau wird geladen…</p>}{error && <Alert severity="error">{error}</Alert>}{matches && <ExternalStayPreview plan={plan}/>}
    </div></DialogContent>
    <DialogActions><Button disabled={saving} onClick={onClose}>Abbrechen</Button><Button variant="contained" disabled={saving || loading || !matches} onClick={async()=>{
      if(!plan || !matches)return;setSaving(true);setError('');
      try {await api.addExternalStay(plan);await onComplete(plan.athleteIds);onClose();}
      catch(reason){setError(reason instanceof Error ? reason.message : 'Zuweisung fehlgeschlagen.');setPlan(null);}
      finally{setSaving(false);}
    }}>Speichern</Button></DialogActions>
  </Dialog>;
}
