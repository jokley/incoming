import React, { type ReactNode } from 'react';
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';

interface CrudDialogProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  dirty?: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  onClose: () => void;
  onSave: () => void;
}

/** Shared create/edit shell used by operational master-data modules. */
export function CrudDialog({ open, title, children, dirty = false, saving = false, saveDisabled = false, saveLabel = 'Speichern', onClose, onSave }: CrudDialogProps) {
  const [confirmClose, setConfirmClose] = React.useState(false);
  const requestClose = () => dirty ? setConfirmClose(true) : onClose();

  return <>
    <Dialog open={open} onClose={(_, reason) => reason === 'backdropClick' && dirty ? setConfirmClose(true) : requestClose()} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={requestClose}>Abbrechen</Button>
        <Button variant="contained" disabled={saveDisabled || saving} startIcon={saving ? <CircularProgress size={16} /> : undefined} onClick={onSave}>{saveLabel}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={confirmClose} onClose={() => setConfirmClose(false)}>
      <DialogTitle>Änderungen verwerfen?</DialogTitle>
      <DialogContent>Ihre ungespeicherten Änderungen gehen verloren.</DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirmClose(false)}>Weiter bearbeiten</Button>
        <Button color="error" onClick={() => { setConfirmClose(false); onClose(); }}>Verwerfen</Button>
      </DialogActions>
    </Dialog>
  </>;
}
