import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { History, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { DialogFooter, DialogHeader, InfoPanel, OpsButton } from '../../design-system';
import { api } from '../../services/api';
import { describeAuditEvent, type AuditActivityContext } from '../../services/auditActivity';
import type { AuditEvent } from '../../types';
import { ActivityTimeline } from './ActivityTimeline';
import { belongsToEntity, loadAllAuditEvents } from './activityData';

export function ActivityHistoryDialog({ entityType, entityId, onClose }: { entityType: string | null; entityId: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [context, setContext] = useState<AuditActivityContext>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!entityType || !entityId) return;
    setLoading(true); setError(''); setEvents([]);
    Promise.all([loadAllAuditEvents(), api.getAthletes().catch(() => []), api.getHotels().catch(() => []), api.getRoomTypes().catch(() => []), api.getEvents().catch(() => []), api.getImportSessions().catch(() => [])])
      .then(([all, athletes, hotels, roomTypes, eventItems, importSessions]) => { setEvents(all.filter(event => belongsToEntity(event, entityType, entityId))); setContext({ athletes, hotels, roomTypes, events: eventItems, importSessions }); })
      .catch(() => setError('Der Änderungsverlauf konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [entityId, entityType]);
  const items = useMemo(() => events.map(event => ({ event, description: describeAuditEvent(event, context) })), [context, events]);
  return <Dialog open={Boolean(entityType && entityId)} onClose={onClose} fullWidth maxWidth="md">
    <div className="bg-[var(--ops-surface)] text-[var(--ops-text)]"><DialogHeader title="Änderungsverlauf" subtitle="Vollständige fachliche Historie · schreibgeschützt" />
      <DialogContent dividers><div className="mb-5 flex items-center gap-2 text-sm text-[var(--ops-text-muted)]"><History size={17}/>Alle Änderungen an diesem Objekt in zeitlicher Reihenfolge.</div>
        {error && <InfoPanel tone="error" title="Laden fehlgeschlagen">{error}</InfoPanel>}
        {loading ? <div className="flex justify-center gap-2 py-14 text-sm text-[var(--ops-text-muted)]"><Loader2 className="animate-spin" size={20}/>Aktivitäten werden geladen …</div> : !error && <ActivityTimeline items={items} onOpen={item => { if (item.description.href) { onClose(); navigate(item.description.href); } }}/>}
      </DialogContent><DialogFooter><OpsButton onClick={onClose}>Schließen</OpsButton></DialogFooter></div>
  </Dialog>;
}
