import { useEffect, useMemo, useState } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { CrudDialog } from '../design-system';
import type { Hotel, HotelRoomInventory, RoomType } from '../types';
import { HotelContingentForm } from './HotelContingentForm';
import { emptyContingentValues, validateHotelContingent, type HotelContingentValues } from './HotelContingentValidation';
import { ActivitySummaryCard } from './activity';

type Props = { open: boolean; mode: 'create' | 'edit'; hotel: Hotel | null; contingent?: HotelRoomInventory | null; roomTypes: RoomType[]; onClose: () => void; onSubmit: (values: HotelContingentValues) => Promise<void> };

export function HotelContingentDialog({ open, mode, hotel, contingent, roomTypes, onClose, onSubmit }: Props) {
  const initial = useMemo<HotelContingentValues>(() => mode === 'edit' && contingent ? { roomTypeId: contingent.roomType.id, roomCount: contingent.roomCount, availableFrom: contingent.availableFrom.slice(0, 10), availableUntil: contingent.availableUntil.slice(0, 10), hasHalfBoard: Boolean(contingent.hasHalfBoard), hasSR: Boolean(contingent.hasSR) } : emptyContingentValues, [mode, contingent]);
  const [values, setValues] = useState(initial); const [touched, setTouched] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setValues(initial); setTouched(false); } }, [open, initial]);
  const errors = validateHotelContingent(values); const dirty = JSON.stringify(values) !== JSON.stringify(initial); const valid = Object.keys(errors).length === 0;
  const save = async () => { setTouched(true); if (!valid) return; setSaving(true); try { await onSubmit(values); onClose(); } finally { setSaving(false); } };
  return <CrudDialog open={open} title={mode === 'create' ? 'Neues Zimmerkontingent' : 'Zimmerkontingent bearbeiten'} description="Verfügbarkeit und Leistungsumfang für das gewählte Hotel festlegen." dirty={dirty} saving={saving} saveDisabled={!valid} saveLabel={mode === 'create' ? 'Erstellen' : 'Speichern'} onClose={onClose} onSave={save}>
    <Stack spacing={3}>
      <Box><Typography variant="overline" color="text.secondary">Hotelinformationen</Typography><Typography fontWeight={700}>{hotel?.name}</Typography><Typography variant="body2" color="text.secondary">{hotel?.location || 'Kein Ort'} · {hotel?.region || 'Keine Region'}</Typography>{mode === 'edit' && contingent && <Typography variant="body2" color="text.secondary">{contingent.availableFrom.slice(0,10)} – {contingent.availableUntil.slice(0,10)}</Typography>}</Box>
      <Divider /><HotelContingentForm values={values} errors={errors} touched={touched} roomTypes={roomTypes} onChange={(next) => { setValues(next); setTouched(true); }} />
      {mode === 'edit' && <ActivitySummaryCard entityType="hotels" entityId={contingent?.id} />}
    </Stack>
  </CrudDialog>;
}
