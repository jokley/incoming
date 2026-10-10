import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import type { OperationsLocationState } from '../operationsContext';

export function ImportConflictNotice() {
  const navigate = useNavigate(); const location = useLocation();
  const context = (location.state as OperationsLocationState | null)?.operationsContext;
  if (!context || context.source !== 'import') return null;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] px-4 py-3 text-sm">
    <div className="flex items-center gap-3"><AlertTriangle className="h-4 w-4 text-[var(--ops-warning)]"/><div><b>Importkonflikt</b><div className="text-xs text-[var(--ops-text-muted)]">Session: {context.sessionLabel}</div></div></div>
    <button type="button" onClick={() => navigate(`/import?sessionId=${encodeURIComponent(context.sessionId)}`)} className="flex items-center gap-1.5 font-bold text-[var(--ops-primary)]"><ArrowLeft className="h-4 w-4"/>Zurück zum Import</button>
  </div>;
}
