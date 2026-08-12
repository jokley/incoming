import { useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import type { Hotel, HotelRoomInventory, RoomType } from '../types';
import { HotelContingentForm } from './HotelContingentForm';
import { emptyContingentValues, validateHotelContingent, type HotelContingentValues } from './HotelContingentValidation';
import { ActivitySummaryCard } from './activity';

type Props = { open: boolean; mode: 'create' | 'edit'; hotel: Hotel | null; contingent?: HotelRoomInventory | null; roomTypes: RoomType[]; onClose: () => void; onSubmit: (values: HotelContingentValues) => Promise<void> };

export function HotelContingentDialog({ open, mode, hotel, contingent, roomTypes, onClose, onSubmit }: Props) {
  const initial = useMemo<HotelContingentValues>(() => mode === 'edit' && contingent ? { roomTypeId: contingent.roomType.id, roomCount: contingent.roomCount, availableFrom: contingent.availableFrom.slice(0, 10), availableUntil: contingent.availableUntil.slice(0, 10), hasHalfBoard: Boolean(contingent.hasHalfBoard), hasSR: Boolean(contingent.hasSR) } : emptyContingentValues, [mode, contingent]);
  const [values, setValues] = useState(initial); const [touched, setTouched] = useState(false); const [saving, setSaving] = useState(false); const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => { if (open) { setValues(initial); setTouched(false); setConfirmClose(false); } }, [open, initial]);
  const errors = validateHotelContingent(values); const dirty = JSON.stringify(values) !== JSON.stringify(initial); const valid = Object.keys(errors).length === 0;
  const requestClose = () => dirty ? setConfirmClose(true) : onClose();
  const save = async () => { setTouched(true); if (!valid) return; setSaving(true); try { await onSubmit(values); onClose(); } finally { setSaving(false); } };
  return <><Dialog open={open} onClose={(_, reason) => { if (reason === 'backdropClick' && dirty) setConfirmClose(true); else requestClose(); }} fullWidth maxWidth="sm">
    <DialogTitle>{mode === 'create' ? 'Neues Zimmerkontingent' : 'Zimmerkontingent bearbeiten'}</DialogTitle>
    <DialogContent dividers><Stack spacing={3}>
      <Box><Typography variant="overline" color="text.secondary">Hotelinformationen</Typography><Typography fontWeight={700}>{hotel?.name}</Typography><Typography variant="body2" color="text.secondary">{hotel?.location || 'Kein Ort'} · {hotel?.region || 'Keine Region'}</Typography>{mode === 'edit' && contingent && <Typography variant="body2" color="text.secondary">{contingent.availableFrom.slice(0,10)} – {contingent.availableUntil.slice(0,10)}</Typography>}</Box>
      <Divider /><HotelContingentForm values={values} errors={errors} touched={touched} roomTypes={roomTypes} onChange={(next) => { setValues(next); setTouched(true); }} />
      {mode === 'edit' && <ActivitySummaryCard entityType="hotels" entityId={contingent?.id} />}
    </Stack></DialogContent>
    <DialogActions sx={{ justifyContent: 'space-between' }}><Button onClick={requestClose} disabled={saving}>Abbrechen</Button><Button variant="contained" disabled={!valid || saving} onClick={save} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>{mode === 'create' ? 'Erstellen' : 'Speichern'}</Button></DialogActions>
  </Dialog>
  <Dialog open={confirmClose} onClose={() => setConfirmClose(false)}><DialogTitle>Änderungen verwerfen?</DialogTitle><DialogContent><DialogContentText>Ihre ungespeicherten Änderungen gehen verloren.</DialogContentText></DialogContent><DialogActions><Button onClick={() => setConfirmClose(false)}>Weiter bearbeiten</Button><Button color="error" onClick={() => { setConfirmClose(false); onClose(); }}>Verwerfen</Button></DialogActions></Dialog></>;
}
