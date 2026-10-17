import { Button, MenuItem, TextField } from '@mui/material';
import type { AccommodationRequirement, AccommodationRequirementFields } from '../types';
import { requirementSourceLabel } from '../services/accommodationRequirement';
export function AccommodationRequirementField({person,onChange,onRelease,disabled=false,label='Unterkunftsbedarf'}:{person:AccommodationRequirementFields;onChange:(value:AccommodationRequirement)=>void;onRelease?:()=>void;disabled?:boolean;label?:string}) {
  return <div className="space-y-1"><TextField select fullWidth size="small" label={label} value={person.accommodationRequirement||'REQUIRED'} disabled={disabled} onChange={e=>onChange(e.target.value as AccommodationRequirement)}>
    <MenuItem value="REQUIRED">Unterkunft benötigt</MenuItem><MenuItem value="NO_ROOM">Kein Zimmer benötigt</MenuItem>
  </TextField><div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--ops-text-muted)]"><span>Herkunft: {requirementSourceLabel(person.accommodationRequirementSource)}</span>
    {person.accommodationRequirementSource==='MANUAL' ? onRelease && <Button size="small" sx={{fontSize:10,minWidth:0,px:0.5,py:0.25}} disabled={disabled} onClick={onRelease}>Quellwert übernehmen</Button> : <Button size="small" sx={{fontSize:10,minWidth:0,px:0.5,py:0.25}} disabled={disabled} onClick={()=>onChange(person.accommodationRequirement||'REQUIRED')}>Manuell festlegen</Button>}
  </div>{person.accommodationRequirement==='NO_ROOM' && <p className="text-xs text-[var(--ops-text-muted)]">Erzeugt keinen offenen Unterkunftsbedarf.</p>}</div>;
}
