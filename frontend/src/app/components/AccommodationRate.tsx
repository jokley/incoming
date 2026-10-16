import { MenuItem, TextField } from '@mui/material';
import type { AccommodationRateCategory } from '../types';
import { StatusChip } from '../design-system';
export const accommodationRateHelp = 'Sondertarif = abweichende Unterkunftspreisregel, unabhängig von EZ/DZ und EZ-Genehmigung.';
export function AccommodationRateChip({category}:{category?:AccommodationRateCategory}) {
  return category==='SPECIAL' ? <StatusChip tone="info">Sondertarif</StatusChip> : null;
}
export function AccommodationRateField({value,onChange,disabled=false,compact=false,label='Unterkunftstarif'}:{value?:AccommodationRateCategory;onChange:(value:AccommodationRateCategory)=>void;disabled?:boolean;compact?:boolean;label?:string}) {
  return <TextField select size="small" fullWidth label={label} slotProps={{select:{inputProps:{"aria-label":label}}}} value={value || 'STANDARD'} disabled={disabled} onChange={e=>onChange(e.target.value as AccommodationRateCategory)} helperText={compact ? undefined : accommodationRateHelp} title={accommodationRateHelp} sx={{minWidth:150}}>
    <MenuItem value="STANDARD">Standard</MenuItem><MenuItem value="SPECIAL">Sondertarif</MenuItem>
  </TextField>;
}
