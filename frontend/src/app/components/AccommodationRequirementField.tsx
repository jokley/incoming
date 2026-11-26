import { Button, Checkbox, FormControlLabel, MenuItem, TextField, Tooltip } from '@mui/material';
import { GitCompareArrows } from 'lucide-react';
import type { AccommodationRequirement, AccommodationRequirementFields } from '../types';
import { requirementSourceLabel, requiresAccommodation } from '../services/accommodationRequirement';
export function AccommodationRequirementField({person,onChange,onRelease,disabled=false,label='Unterkunftsbedarf',compact=false,allowNoDispo=false,sourceRoomType,onToggleNoDispo}:{person:AccommodationRequirementFields;onChange:(value:AccommodationRequirement)=>void;onRelease?:()=>void;disabled?:boolean;label?:string;compact?:boolean;allowNoDispo?:boolean;sourceRoomType?:string;onToggleNoDispo?:(checked:boolean)=>void}) {
  const excluded = person.accommodationRequirement === 'NO_DISPO';
  const unresolved = person.accommodationRequirement === 'UNRESOLVED';
  return <div className="space-y-1">
    {onToggleNoDispo && <FormControlLabel sx={{ display: 'flex', width: 'fit-content', ml: 0, mr: 0, mb: 1 }} label={<span className="text-xs">Nicht disponieren</span>}
      control={<Checkbox size="small" sx={{ p: 0.5 }} checked={excluded} disabled={disabled || unresolved}
        inputProps={{ 'aria-label': `Nicht disponieren · ${label}` }} onChange={event=>onToggleNoDispo(event.target.checked)} />} />}
    <TextField title={!requiresAccommodation(person)?'Erzeugt keinen offenen Unterkunftsbedarf.':undefined} select fullWidth size="small" label={compact?'Unterkunftsbedarf':label} slotProps={{select:{inputProps:{'aria-label':label}}}} sx={{'& .MuiSelect-nativeInput':{display:'none'},...(compact?{'& .MuiInputBase-root':{minHeight:32,fontSize:12},'& .MuiSelect-select':{py:0.75},'& .MuiInputLabel-root':{fontSize:12}}:{})}} value={person.accommodationRequirement||'REQUIRED'} disabled={disabled || Boolean(onToggleNoDispo && (excluded || unresolved))} onChange={e=>onChange(e.target.value as AccommodationRequirement)}>
    {person.accommodationRequirement === 'UNRESOLVED' && <MenuItem value="UNRESOLVED" disabled>Unterkunftsbedarf offen</MenuItem>}
    <MenuItem value="REQUIRED">Unterkunft benötigt</MenuItem><MenuItem value="NO_ROOM">Kein Zimmer benötigt</MenuItem>
    {(allowNoDispo || person.accommodationRequirement==='NO_DISPO') && <MenuItem value="NO_DISPO">{onToggleNoDispo ? 'Nicht disponieren' : 'Nicht einplanen'}</MenuItem>}
  </TextField><div className={`${compact?"flex min-w-0 items-center gap-1":"flex flex-wrap items-center gap-2"} text-[10px] text-[var(--ops-text-muted)]`}><span className="min-w-0 flex-1 truncate" title={sourceRoomType?`Quelle: ${sourceRoomType} · ${requirementSourceLabel(person.accommodationRequirementSource)}`:undefined}>{compact ? requirementSourceLabel(person.accommodationRequirementSource) : `Herkunft: ${requirementSourceLabel(person.accommodationRequirementSource)}`}{sourceRoomType ? ` · ${compact?"":"Quelle: "}${sourceRoomType}` : ""}</span>
    {(!onToggleNoDispo || (!excluded && person.accommodationRequirementSource==='MANUAL')) && (person.accommodationRequirementSource==='MANUAL' ? onRelease && <Button size="small" sx={{fontSize:compact?9:10,minWidth:0,px:compact?0:0.5,py:0,minHeight:20,flexShrink:0,textTransform:"none"}} disabled={disabled} onClick={onRelease}>Quellwert übernehmen</Button> : person.accommodationRequirement !== 'UNRESOLVED' && <Button size="small" sx={{fontSize:compact?9:10,minWidth:0,px:compact?0:0.5,py:0,minHeight:20,flexShrink:0,textTransform:"none"}} disabled={disabled} onClick={()=>onChange(person.accommodationRequirement||'REQUIRED')}>Manuell festlegen</Button>)}
  </div>
    {onToggleNoDispo && !excluded && !unresolved && person.accommodationRequirementSource !== 'MANUAL' &&
      <Button size="small" variant="outlined" disabled={disabled}
        onClick={()=>onChange(person.accommodationRequirement || 'REQUIRED')}>Bedarf bestätigen</Button>}
{!compact && !requiresAccommodation(person) && <p className="text-[10px] leading-tight text-[var(--ops-text-muted)]">Erzeugt keinen offenen Unterkunftsbedarf.</p>}</div>;
}

export function FisDeviationBadge({person, expanded=false}: {person: AccommodationRequirementFields; expanded?: boolean}) {
  if (!person.hasFisAccommodationDeviation) return null;
  const reason = person.fisAccommodationDeviationReasons?.join(', ');
  const label = reason ? `Abweichung zur FIS-Meldung · ${reason}` : 'Abweichung zur FIS-Meldung';
  if (expanded) return <span className="block text-xs text-[var(--ops-warning)]">{label}</span>;
  return <Tooltip title={label}><span role="img" aria-label={label} className="inline-flex align-middle text-[var(--ops-warning)]">
    <GitCompareArrows size={14} aria-hidden="true"/>
  </span></Tooltip>;
}
