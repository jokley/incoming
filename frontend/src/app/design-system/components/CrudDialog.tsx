import React, { type ReactNode } from 'react';
import { ConfirmDialog, EnterpriseDialog, EnterpriseDialogActions, type EnterpriseDialogSize } from './EnterpriseDialog';

interface CrudDialogProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  dirty?: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  description?: ReactNode;
  status?: ReactNode;
  size?: EnterpriseDialogSize;
  onClose: () => void;
  onSave: () => void;
}

/** Shared create/edit shell used by operational master-data modules. */
export function CrudDialog({ open, title, description = 'Pflichtfelder vollständig ausfüllen und Änderungen anschließend speichern.', status, children, dirty = false, saving = false, saveDisabled = false, saveLabel = 'Speichern', size = 'small', onClose, onSave }: CrudDialogProps) {
  const [confirmClose, setConfirmClose] = React.useState(false);
  const requestClose = () => dirty ? setConfirmClose(true) : onClose();

  return <>
    <EnterpriseDialog open={open} title={title} description={description} status={status} size={size} busy={saving} onClose={requestClose} onSubmit={saveDisabled || saving ? undefined : onSave}
      actions={<EnterpriseDialogActions busy={saving} submitDisabled={saveDisabled} submitLabel={saveLabel} onCancel={requestClose} onSubmit={onSave} />}>
      {children}
    </EnterpriseDialog>
    <ConfirmDialog open={confirmClose} title="Änderungen verwerfen?" description="Ihre ungespeicherten Änderungen gehen verloren." confirmLabel="Verwerfen" destructive onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} />
  </>;
}
