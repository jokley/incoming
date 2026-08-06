import { Checkbox, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, Stack, TextField } from '@mui/material';
import type { RoomType } from '../types';
import type { HotelContingentErrors, HotelContingentValues } from './HotelContingentValidation';

export function HotelContingentForm({ values, errors, touched, roomTypes, onChange }: { values: HotelContingentValues; errors: HotelContingentErrors; touched: boolean; roomTypes: RoomType[]; onChange: (values: HotelContingentValues) => void }) {
  const show = (field: keyof HotelContingentValues) => touched ? errors[field] : undefined;
  return <Stack spacing={2.25}>
    <FormControl error={Boolean(show('roomTypeId'))} fullWidth required>
      <InputLabel id="room-type-label">Zimmertyp</InputLabel>
      <Select labelId="room-type-label" label="Zimmertyp" value={values.roomTypeId} onChange={(event) => onChange({ ...values, roomTypeId: event.target.value })}>
        {roomTypes.map((type) => <MenuItem key={type.id} value={type.id}>{type.name} · {type.maxPersons} Betten</MenuItem>)}
      </Select>
      {show('roomTypeId') && <FormHelperText>{show('roomTypeId')}</FormHelperText>}
    </FormControl>
    <TextField required fullWidth type="number" label="Anzahl Zimmer" value={values.roomCount} error={Boolean(show('roomCount'))} helperText={show('roomCount')} slotProps={{ htmlInput: { min: 1 } }} onChange={(event) => onChange({ ...values, roomCount: event.target.value === '' ? '' : Number(event.target.value) })} />
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField required fullWidth type="date" label="Startdatum" value={values.availableFrom} error={Boolean(show('availableFrom'))} helperText={show('availableFrom')} slotProps={{ inputLabel: { shrink: true } }} onChange={(event) => onChange({ ...values, availableFrom: event.target.value })} />
      <TextField required fullWidth type="date" label="Enddatum" value={values.availableUntil} error={Boolean(show('availableUntil'))} helperText={show('availableUntil')} slotProps={{ inputLabel: { shrink: true } }} onChange={(event) => onChange({ ...values, availableUntil: event.target.value })} />
    </Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <FormControlLabel control={<Checkbox checked={values.hasHalfBoard} onChange={(event) => onChange({ ...values, hasHalfBoard: event.target.checked })} />} label="Halbpension / HP-Aufpreis" />
      <FormControlLabel control={<Checkbox checked={values.hasSR} onChange={(event) => onChange({ ...values, hasSR: event.target.checked })} />} label="SR-Aufpreis" />
    </Stack>
  </Stack>;
}
