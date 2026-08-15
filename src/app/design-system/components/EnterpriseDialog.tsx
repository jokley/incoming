import { useId, type KeyboardEvent, type ReactNode } from 'react';
import Close from '@mui/icons-material/Close';
import { Box, Button, CircularProgress, Dialog, DialogContent, IconButton, Stack, Typography } from '@mui/material';

export type EnterpriseDialogSize = 'small' | 'medium' | 'large' | 'fullscreen';

const widthBySize = { small: 'sm', medium: 'md', large: 'lg' } as const;

interface EnterpriseDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  size?: EnterpriseDialogSize;
  busy?: boolean;
  onClose: () => void;
  onSubmit?: () => void;
}

/**
 * The single, accessible shell for application dialogs. Header and footer never
 * scroll; only the content region owns overflow.
 */
export function EnterpriseDialog({ open, title, description, status, children, actions, size = 'medium', busy = false, onClose, onSubmit }: EnterpriseDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSubmit || event.key !== 'Enter' || event.shiftKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.getAttribute('role') === 'button' || target.closest('[role="listbox"]')) return;
    event.preventDefault();
    onSubmit();
  };

  return <Dialog
    open={open}
    onClose={busy ? undefined : onClose}
    fullWidth
    fullScreen={size === 'fullscreen'}
    maxWidth={size === 'fullscreen' ? false : widthBySize[size]}
    aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onKeyDown={handleKeyDown}
  >
    <Box className="flex min-h-0 flex-1 flex-col bg-[var(--ops-surface)] text-[var(--ops-text)]">
      <Box component="header" className="flex shrink-0 items-start gap-4 border-b border-[var(--ops-divider)] px-5 py-4 sm:px-6">
        <Box className="min-w-0 flex-1">
          <Typography id={titleId} component="h2" variant="h3">{title}</Typography>
          {description && <Typography id={descriptionId} variant="body2" color="text.secondary" sx={{ mt: .5 }}>{description}</Typography>}
          {status && <Box className="mt-3 flex flex-wrap items-center gap-2">{status}</Box>}
        </Box>
        <IconButton aria-label="Dialog schließen" onClick={onClose} disabled={busy} size="small"><Close /></IconButton>
      </Box>
      <DialogContent className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6" tabIndex={-1}>{children}</DialogContent>
      {actions && <Box component="footer" className="flex min-h-16 shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--ops-divider)] px-5 py-3 sm:px-6">{actions}</Box>}
    </Box>
  </Dialog>;
}

export function EnterpriseDialogActions({ cancelLabel = 'Abbrechen', submitLabel = 'Speichern', destructive = false, busy = false, submitDisabled = false, secondary, onCancel, onSubmit }: {
  cancelLabel?: string; submitLabel?: string; destructive?: boolean; busy?: boolean; submitDisabled?: boolean; secondary?: ReactNode; onCancel: () => void; onSubmit?: () => void;
}) {
  return <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} sx={{ width: '100%', justifyContent: 'flex-end' }}>
    {secondary}<Button variant="text" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
    {onSubmit && <Button variant="contained" color={destructive ? 'error' : 'primary'} onClick={onSubmit} disabled={busy || submitDisabled} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>{submitLabel}</Button>}
  </Stack>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, busy = false, destructive = false, onCancel, onConfirm }: {
  open: boolean; title: ReactNode; description: ReactNode; confirmLabel: string; busy?: boolean; destructive?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <EnterpriseDialog open={open} size="small" title={title} description={description} busy={busy} onClose={onCancel} onSubmit={onConfirm}
    actions={<EnterpriseDialogActions cancelLabel="Abbrechen" submitLabel={confirmLabel} destructive={destructive} busy={busy} onCancel={onCancel} onSubmit={onConfirm} />}>
    <Box role={destructive ? 'alert' : undefined} className="rounded-[var(--ops-radius-lg)] border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4 text-sm text-[var(--ops-text-muted)]">Bitte prüfen Sie die Auswirkung, bevor Sie fortfahren.</Box>
  </EnterpriseDialog>;
}
