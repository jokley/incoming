import { useState } from 'react';
import { Scissors } from 'lucide-react';
import type { DispositionItem } from '../../services/dispositionItems';
import { periodLabel } from '../../services/dispositionItems';

export function DispositionQueueCard({unit,selected,highlighted,onSelect,onDragStart,onDragEnd,onQuickAssign,canEditAssignments,pending,hotelName,splitOptions=[],onSplit}:{
  unit:DispositionItem;selected:boolean;highlighted?:boolean;onSelect:()=>void;
  onDragStart:(id:string,ids:string[],label:string)=>void;onDragEnd:()=>void;
  onQuickAssign:(id:string,ids:string[])=>void;canEditAssignments:boolean;pending:boolean;hotelName?:string;
  splitOptions?:{bookingId:string;label:string}[];onSplit?:(bookingId:string)=>void;
}) {
  const [choosingSplit,setChoosingSplit]=useState(false);
  const enabled=canEditAssignments && unit.canAssign && !pending;
  const ids=unit.occupants.map(p=>p.athleteId);
  const drag=(event:React.DragEvent,people:string[])=>{
    if(!enabled){event.preventDefault();return;}
    event.stopPropagation();event.dataTransfer.setData('text/plain',unit.unitId);event.dataTransfer.effectAllowed='move';
    onDragStart(unit.unitId,people,unit.occupants.filter(p=>people.includes(p.athleteId)).map(p=>p.name).join(' + '));
  };
  const action=(people:string[],label:string)=><button key={people.join(',')} type="button" draggable={enabled} disabled={!enabled}
    onDragStart={event=>drag(event,people)} onDragEnd={onDragEnd}
    onClick={event=>{event.stopPropagation();if(hotelName)onQuickAssign(unit.unitId,people);}}
    title={hotelName ? `${label} in ${hotelName} zuweisen` : `${label} in den Zimmerbereich ziehen`}
    className={`${people.length>1 ? 'w-full bg-blue-600 !text-white hover:bg-blue-700' : ''} rounded-md border border-[var(--ops-border-strong)] px-2 py-1 text-[11px] font-semibold text-[var(--ops-primary)] disabled:opacity-40`}>
    {label}{hotelName ? ' hier zuweisen' : ' ziehen'}
  </button>;
  return <div id={encodeURIComponent(unit.unitId)} role="group" aria-label={`${unit.occupants.map(p=>p.name).join(' + ')} · ${periodLabel(unit.openPeriod)}`}
    draggable={enabled} onDragStart={event=>drag(event,ids)} onDragEnd={onDragEnd} onClick={onSelect}
    className={`rounded-xl border p-3 text-xs ${highlighted || selected ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]'} ${pending ? 'opacity-60' : ''}`}>
    <div className="flex items-center justify-between gap-2">
      <b className="text-sm tabular-nums">{periodLabel(unit.openPeriod)}</b>
      <span className="shrink-0 rounded border border-[var(--ops-border)] px-1.5 py-0.5 text-[10px] font-semibold">{unit.canAssign ? 'Offen' : 'Prüfen'}</span>
    </div>
    <div className="mt-2 space-y-1">
      {unit.occupants.map(person=><div key={person.athleteId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-[var(--ops-surface-elevated)] px-2 py-1.5">
        <span className="min-w-0 break-words font-bold">{person.name}</span>
        {enabled && action([person.athleteId],unit.occupants.length===1 ? 'Person' : person.firstname)}
      </div>)}
    </div>
    {unit.previous.length>0 && <div className="mt-2 text-[10px] leading-snug text-[var(--ops-text-muted)]" title={unit.previous.join('\n')}><span className="font-semibold">Bisher: </span><span className="line-clamp-2 break-words">{unit.previous.join(' · ')}</span></div>}
    {enabled && <>
      {unit.occupants.length===2 && <div className="mt-2">{action(ids,'Beide')}</div>}
      <div className="mt-1 text-[10px] leading-snug text-[var(--ops-text-muted)]">{hotelName ? `Ziel: ${hotelName}` : 'In den Zimmerbereich ziehen oder Hotel rechts öffnen.'}</div>
    </>}
    {canEditAssignments && unit.canAssign && onSplit && splitOptions.length>0 && <div className="mt-2 border-t border-[var(--ops-border)] pt-1.5" onClick={event=>event.stopPropagation()} onDragStart={event=>{event.preventDefault();event.stopPropagation();}}>
      <button type="button" disabled={pending} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ops-border-strong)] px-2 py-1 text-[11px] font-semibold text-[var(--ops-primary)] hover:bg-[var(--ops-surface-elevated)] disabled:opacity-40"
        aria-expanded={splitOptions.length>1 ? choosingSplit : undefined}
        title={splitOptions.length===1 ? splitOptions[0].label : 'Zugewiesenen Zeitraum auswählen'}
        onClick={()=>splitOptions.length===1 ? onSplit(splitOptions[0].bookingId) : setChoosingSplit(!choosingSplit)}><Scissors aria-hidden="true" className="h-3 w-3 shrink-0" />Zuweisung teilen</button>
      {choosingSplit && splitOptions.length>1 && <div className="mt-1 space-y-1" aria-label="Zugewiesenen Zeitraum auswählen">{splitOptions.map(option=><button type="button" key={option.bookingId} disabled={pending} onClick={()=>onSplit(option.bookingId)} className="block w-full rounded border border-[var(--ops-border)] px-2 py-1 text-left text-[11px] text-[var(--ops-primary)]">{option.label}</button>)}</div>}
    </div>}
  </div>;
}
