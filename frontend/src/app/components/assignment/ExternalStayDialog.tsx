import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup, TextField } from '@mui/material';
import type { AssignmentGridHotel, ExternalStayPlan } from '../../types';
import type { DispositionItem } from '../../services/dispositionItems';
import { periodLabel } from '../../services/dispositionItems';
import { api } from '../../services/api';

export function ExternalStayPreview({plan}:{plan:ExternalStayPlan}) {
  return <div className="space-y-3 rounded-lg border border-[var(--ops-border)] p-3 text-sm">
    <p><b>Extern zugewiesen</b><br/>{periodLabel(plan)} · {plan.hotelName} · Extern</p>
    {plan.people.map(person=><div key={person.personId}><b>{person.name} · Danach offen</b>{person.accommodationCoverage.openIntervals.length ? person.accommodationCoverage.openIntervals.map(interval=><p key={`${interval.checkInDate}:${interval.checkOutDate}`}>{periodLabel(interval)} · Offen</p>) : <p>Kein offener Zeitraum</p>}</div>)}
  </div>;
}

export function ExternalStayDialog({item,hotels,onClose,onComplete}:{item:DispositionItem;hotels:AssignmentGridHotel[];onClose:()=>void;onComplete:(ids:string[])=>Promise<void>}) {
  const [selection,setSelection]=useState('all'),[hotelId,setHotelId]=useState('');
  const [start,setStart]=useState(item.openPeriod.checkInDate ?? ''),[end,setEnd]=useState(item.openPeriod.checkOutDate ?? '');
  const [plan,setPlan]=useState<ExternalStayPlan|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
  const generation=useRef(0);
  const ids=selection==='all' ? item.occupants.map(p=>p.athleteId) : [selection];
  const key=ids.join(',');
  const valid=!!hotelId && !!start && !!end && item.openPeriod.checkInDate!<=start && start<end && end<=item.openPeriod.checkOutDate!;
  useEffect(()=>{
    const request=++generation.current;setPlan(null);setError('');setLoading(false);
    if(!valid)return;
    setLoading(true);
    api.previewExternalStay({athleteIds:key.split(','),hotelId,checkInDate:start,checkOutDate:end,openInterval:item.openPeriod})
      .then(value=>{if(generation.current===request)setPlan(value);})
      .catch(reason=>{if(generation.current===request)setError(reason.message);})
      .finally(()=>{if(generation.current===request)setLoading(false);});
    return ()=>{generation.current++;};
  },[key,hotelId,start,end,valid,item]);
  const matches=plan && plan.hotelId===hotelId && plan.checkInDate===start && plan.checkOutDate===end && plan.athleteIds.join(',')===[...ids].sort((a,b)=>Number(a)-Number(b)).join(',');
  return <Dialog open fullWidth maxWidth="sm" onClose={()=>!saving && onClose()}>
    <DialogTitle>Aufenthalt teilen</DialogTitle>
    <DialogContent dividers><div className="space-y-4">
      <p className="text-sm">Offener Aufenthalt · <b>{periodLabel(item.openPeriod)}</b><br/>{item.occupants.map(p=>p.name).join(' + ')}</p>
      {item.occupants.length>1 && <RadioGroup aria-label="Personen" value={selection} onChange={e=>setSelection(e.target.value)}><FormControlLabel value="all" control={<Radio disabled={saving}/>} label="Beide"/>{item.occupants.map(p=><FormControlLabel key={p.athleteId} value={p.athleteId} control={<Radio disabled={saving}/>} label={p.name}/>)}</RadioGroup>}
      <TextField select fullWidth size="small" label="Externe Unterkunft" value={hotelId} disabled={saving} onChange={e=>setHotelId(e.target.value)}>{hotels.filter(h=>h.accommodationType==='EXTERNAL').map(h=><MenuItem key={h.hotelId} value={h.hotelId}>{h.hotelName}</MenuItem>)}</TextField>
      {!hotels.some(h=>h.accommodationType==='EXTERNAL') && <Alert severity="info">Zuerst eine externe Unterkunft unter Hotels anlegen.</Alert>}
      <div className="grid grid-cols-2 gap-3">{(['Von','Bis'] as const).map(label=><TextField key={label} type="date" size="small" label={label} disabled={saving} value={label==='Von' ? start : end} onChange={e=>label==='Von' ? setStart(e.target.value) : setEnd(e.target.value)} slotProps={{inputLabel:{shrink:true}}} inputProps={{min:item.openPeriod.checkInDate,max:item.openPeriod.checkOutDate}}/>)}</div>
      {!valid && hotelId && <p className="text-xs">Von muss vor Bis und innerhalb des offenen Aufenthalts liegen.</p>}
      {loading && <p className="text-sm">Vorschau wird geladen…</p>}{error && <Alert severity="error">{error}</Alert>}{matches && <ExternalStayPreview plan={plan}/>}
    </div></DialogContent>
    <DialogActions><Button disabled={saving} onClick={onClose}>Abbrechen</Button><Button variant="contained" disabled={saving || loading || !matches} onClick={async()=>{
      if(!plan || !matches)return;setSaving(true);setError('');
      try {await api.addExternalStay(plan);await onComplete(plan.athleteIds);onClose();}
      catch(reason){setError(reason instanceof Error ? reason.message : 'Zuweisung fehlgeschlagen.');setPlan(null);}
      finally{setSaving(false);}
    }}>Extern zuweisen</Button></DialogActions>
  </Dialog>;
}
