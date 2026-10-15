import type { DispositionItem } from '../../services/dispositionItems';
import { periodLabel } from '../../services/dispositionItems';

export function DispositionQueueCard({unit,selected,highlighted,onSelect,onDragStart,onDragEnd,onQuickAssign,canEditAssignments,pending,hotelName}:{
  unit:DispositionItem;selected:boolean;highlighted?:boolean;onSelect:()=>void;
  onDragStart:(id:string,ids:string[],label:string)=>void;onDragEnd:()=>void;
  onQuickAssign:(id:string,ids:string[])=>void;canEditAssignments:boolean;pending:boolean;hotelName?:string;
}) {
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
    className="rounded-md border border-[var(--ops-border-strong)] px-2 py-1 text-[11px] font-semibold text-[var(--ops-primary)] disabled:opacity-40">
    {label}{hotelName ? ' hier zuweisen' : ' ziehen'}
  </button>;
  return <div id={encodeURIComponent(unit.unitId)} role="group" aria-label={`${unit.occupants.map(p=>p.name).join(' + ')} · ${periodLabel(unit.openPeriod)}`}
    draggable={enabled} onDragStart={event=>drag(event,ids)} onDragEnd={onDragEnd} onClick={onSelect}
    className={`rounded-xl border p-3 text-xs ${highlighted || selected ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]'} ${pending ? 'opacity-60' : ''}`}>
    <div className="font-bold">{unit.occupants.map(p=>p.name).join(' + ')}</div>
    <div className="mt-1 flex justify-between gap-2"><b>{periodLabel(unit.openPeriod)}</b><span>{unit.canAssign ? 'Offen' : 'Prüfen'}</span></div>
    {unit.previous.length>0 && <div className="mt-1 truncate text-[10px] text-[var(--ops-text-muted)]" title={unit.previous.join('\n')}>Bisher: {unit.previous.join(' · ')}</div>}
    {enabled && <><div className="mt-2 flex flex-wrap gap-1">{unit.occupants.length===2 && action(ids,'Beide')}{unit.occupants.map(p=>action([p.athleteId],unit.occupants.length===1 ? 'Person' : p.firstname))}</div>
      <div className="mt-1 text-[10px] text-[var(--ops-text-muted)]">{hotelName ? `Ziel: ${hotelName}` : 'In den Zimmerbereich ziehen oder zuerst Hotel rechts öffnen.'}</div></>}
  </div>;
}
