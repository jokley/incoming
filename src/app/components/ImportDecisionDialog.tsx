import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { ArrowUpRight, Loader2, Users } from 'lucide-react';

import { DialogFooter, DialogHeader, InfoPanel, OpsButton, SectionHeader, StatusChip } from '../design-system';
import type { ImportDecision } from '../data/importSessions';
import { api } from '../services/api';
import { SingleRoomStatusBadge, type SingleRoomStatus } from './SingleRoomStatusBadge';

const value = (input?: string | number | null) => input === undefined || input === null || input === '' ? '—' : String(input);
const dateTime = (input?: string | null) => input ? new Date(input).toLocaleString('de-DE') : '—';
const status = { PENDING: 'Offen', APPROVED: 'Genehmigt', NEW_LIST_ANNOUNCED: 'Neue Meldeliste angekündigt' } as const;
const method = { EMAIL: 'E-Mail', PHONE: 'Telefon' } as const;

export function ImportDecisionDialog({ decisionId, onClose, onOpenSession }: { decisionId: string | null; onClose: () => void; onOpenSession: (sessionId: string) => void }) {
  const [decision, setDecision] = useState<ImportDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDecision(null); setError(null);
    if (decisionId) void api.getImportDecision(decisionId).then(setDecision).catch(error => setError(error instanceof Error ? error.message : 'Entscheidung konnte nicht geladen werden'));
  }, [decisionId]);

  return <Dialog open={Boolean(decisionId)} onClose={onClose} fullWidth maxWidth="md">
    <div className="bg-[var(--ops-surface)] text-[var(--ops-text)]">
      <DialogHeader title="Entscheidung anzeigen" subtitle="Vollständige fachliche Importentscheidung · schreibgeschützt" />
      <DialogContent dividers className="space-y-6">
        {error && <InfoPanel tone="error" title="Laden fehlgeschlagen">{error}</InfoPanel>}
        {!decision && !error && <div className="flex items-center justify-center gap-2 py-14 text-sm text-[var(--ops-text-muted)]"><Loader2 className="h-5 w-5 animate-spin"/>Entscheidung wird geladen …</div>}
        {decision && <>
          <section><SectionHeader title="Entscheidung" subtitle="Fachlicher Beschluss und Importkontext"/><div className="mt-3 grid gap-3 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Status"><StatusChip tone={decision.decision === 'APPROVED' ? 'success' : decision.decision === 'PENDING' ? 'warning' : 'neutral'}>{status[decision.decision]}</StatusChip></Fact>
            <Fact label="Zeitpunkt" text={dateTime(decision.approvalDate || decision.timestamp)}/><Fact label="Bearbeiter" text={decision.user}/><Fact label="Nation" text={decision.nation}/><Fact label="Disziplin" text={decision.discipline}/><Fact label="Gender" text={decision.gender}/><Fact label="Importversion" text={decision.importVersion ? `Version ${decision.importVersion}` : null}/><Fact label="Importsession" text={`IS-${decision.importSession.id}`}/>
          </div></section>
          <section><SectionHeader title="Kommunikation" subtitle="Dokumentierte Abstimmung und fachliche Begründung"/><div className="mt-3 grid gap-3 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4 sm:grid-cols-2">
            <Fact label="Kommunikationsart" text={decision.approvalMethod ? method[decision.approvalMethod] : null}/><Fact label="Ansprechpartner" text={decision.approvalBy}/><Fact label="Kostenübernahme" text={decision.costCoverage}/><Fact label="Bemerkung" text={decision.comment}/><div className="sm:col-span-2"><Fact label="Fachliche Begründung" text={decision.description}/></div>
          </div></section>
          <section><SectionHeader title="Betroffene Personen" subtitle={`${decision.people.length} ${decision.people.length === 1 ? 'betroffene Person' : 'betroffene Personen'}`} actions={<Users className="h-5 w-5 text-[var(--ops-text-subtle)]"/>}/><div className="mt-3 overflow-hidden rounded-xl border border-[var(--ops-border)]">
            {decision.people.length ? decision.people.map(person => <div key={person.id} className="grid items-center gap-2 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)] p-3 last:border-0 sm:grid-cols-[1fr_100px_auto]"><strong>{person.name}</strong><span className="text-sm text-[var(--ops-text-muted)]">{person.nation}</span><SingleRoomStatusBadge status={person.singleRoomStatus as SingleRoomStatus}/></div>) : <div className="p-5 text-sm text-[var(--ops-text-muted)]">Keine Personen sind dieser Entscheidung zugeordnet.</div>}
          </div></section>
        </>}
      </DialogContent>
      <DialogFooter><OpsButton onClick={onClose}>Schließen</OpsButton>{decision && <OpsButton onClick={() => onOpenSession(decision.importSession.id)} className="border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]">Importsession öffnen <ArrowUpRight className="ml-2 inline h-4 w-4"/></OpsButton>}</DialogFooter>
    </div>
  </Dialog>;
}

function Fact({ label, text, children }: { label: string; text?: string | number | null; children?: ReactNode }) { return <div><div className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ops-text-subtle)]">{label}</div><div className="whitespace-pre-wrap text-sm font-semibold">{children ?? value(text)}</div></div>; }
