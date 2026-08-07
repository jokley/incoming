import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { AlertTriangle, CheckCircle2, Clock3, Mail } from 'lucide-react';

import type { ImportApproval, ImportSession } from '../data/importSessions';
import { DialogFooter, DialogHeader, InfoPanel, OpsButton, SectionHeader, StatusChip } from '../design-system';

export type OperationsTask = {
  approval: ImportApproval;
  nation: string;
  discipline?: string;
  people: string[];
  rule: string;
  impact: string;
  recommendation: string;
};

const decisionOptions = [
  { value: 'request', title: 'Neue Excel-Datei wird angefordert', hint: 'Die Session bleibt in Rücksprache.', icon: Mail },
  { value: 'approve', title: 'Ausnahme genehmigen', hint: 'Die Aufgabe ist damit fachlich entschieden.', icon: CheckCircle2 },
  { value: 'later', title: 'Später bearbeiten', hint: 'Die Aufgabe bleibt unverändert offen.', icon: Clock3 },
] as const;

export function buildOperationsTask(session: ImportSession, approval: ImportApproval): OperationsTask {
  const quotaRecord = session.preview?.dispositionAnalysis?.categories.quotaAffected.records.find(record =>
    String(record.nation ?? '') === approval.nation,
  );
  const people = [quotaRecord?.athlete, quotaRecord?.person, quotaRecord?.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value));
  const isSingleRoom = /single|einzel|\bsr\b/i.test(`${approval.type} ${approval.description}`);
  return {
    approval,
    nation: session.nation,
    discipline: session.discipline,
    people,
    rule: isSingleRoom ? 'Die gemeldeten Einzelzimmer überschreiten die aktuell verfügbare Quote.' : 'Die aktuell gültige Nationenquote wird durch die Meldung überschritten.',
    impact: 'Die bestehende Planung muss fachlich geprüft werden. Hotel- und Zimmerzuweisungen bleiben unverändert.',
    recommendation: isSingleRoom ? 'Mehrkosten mit der Nation abstimmen' : 'Neue Excel-Datei anfordern',
  };
}

export function OperationsDecisionDialog({ task, saving, onClose, onSave }: {
  task: OperationsTask | null;
  saving: boolean;
  onClose: () => void;
  onSave: (decision: 'APPROVED' | 'REJECTED' | 'LATER', comment: string) => void;
}) {
  const [decision, setDecision] = useState<'request' | 'approve' | 'later'>('request');
  const [comment, setComment] = useState('');
  useEffect(() => { setDecision('request'); setComment(task?.approval.comment ?? ''); }, [task]);

  return <Dialog open={Boolean(task)} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
    {task && <div className="bg-[var(--ops-surface)] text-[var(--ops-text)]">
      <DialogHeader title={task.approval.description || 'Aufgabe entscheiden'} subtitle={`${task.nation}${task.discipline ? ` · ${task.discipline}` : ''}`} />
      <DialogContent dividers className="space-y-6">
        <section><SectionHeader title="1. Betroffene Person" subtitle="Wichtigste Stammdaten aus der Meldung" />
          <div className="mt-3 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4">
            <div className="grid gap-3 sm:grid-cols-2"><div><div className="text-xs font-bold text-[var(--ops-text-subtle)]">Athlet</div><div className="mt-1 font-bold">{task.people.length ? task.people.join(', ') : 'Gemeldete Gruppe'}</div></div><div><div className="text-xs font-bold text-[var(--ops-text-subtle)]">Nation</div><div className="mt-1 font-bold">{task.nation}</div></div>{task.discipline&&<div><div className="text-xs font-bold text-[var(--ops-text-subtle)]">Disziplin</div><div className="mt-1 font-bold">{task.discipline}</div></div>}</div>
          </div>
        </section>

        <section>
          <SectionHeader title="2. Änderung" />
          <div className="mt-3 rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] p-4">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ops-warning)]"/><div><p className="font-bold">{task.approval.description}</p><p className="mt-2 text-sm text-[var(--ops-text-muted)]">{task.rule}</p></div></div>
          </div>
        </section>

        <section><SectionHeader title="3. Auswirkungen" />
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4"><CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--ops-success)]"/><p className="font-bold">{task.impact}</p></div>
        </section>

        <section><SectionHeader title="4. Empfohlene Aktion" /><div className="mt-3"><InfoPanel tone="info" title="Empfehlung">{task.recommendation}</InfoPanel></div>
          <fieldset className="mt-4"><legend className="text-sm font-bold">Aktion im bestehenden Freigabeprozess ausführen</legend><div className="mt-3 grid gap-2">{decisionOptions.map(option => { const Icon=option.icon; return <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${decision===option.value?'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]':'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)]'}`}><input className="mt-1 accent-[var(--ops-primary)]" type="radio" name="operations-decision" checked={decision===option.value} onChange={()=>setDecision(option.value)}/><Icon className="mt-0.5 h-4 w-4 shrink-0"/><span><strong className="block text-sm">{option.title}</strong><span className="text-xs text-[var(--ops-text-muted)]">{option.hint}</span></span></label>; })}</div></fieldset>
        </section>

        <section><label htmlFor="decision-comment" className="block"><SectionHeader title="Bemerkung" subtitle="Telefonnotiz, Mail oder ergänzende Information" /></label><textarea id="decision-comment" value={comment} onChange={event=>setComment(event.target.value)} rows={4} placeholder="Bemerkung zur Entscheidung …" className="mt-3 w-full resize-y rounded-xl border border-[var(--ops-border)] bg-[var(--ops-background)] p-3 text-sm text-[var(--ops-text)] outline-none placeholder:text-[var(--ops-text-subtle)] focus:border-[var(--ops-primary)]" /></section>
      </DialogContent>
      <DialogFooter><OpsButton type="button" onClick={onClose} disabled={saving}>Abbrechen</OpsButton><OpsButton type="button" disabled={saving} onClick={()=>onSave(decision==='approve'?'APPROVED':decision==='request'?'REJECTED':'LATER',comment)} className="border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]">{saving?'Wird gespeichert …':'Entscheidung speichern'}</OpsButton></DialogFooter>
    </div>}
  </Dialog>;
}

export function OperationsTaskRow({ task, onOpen }: { task: OperationsTask; onOpen: () => void }) {
  const done = task.approval.decision !== 'PENDING';
  return <button type="button" onClick={onOpen} className="flex w-full items-start justify-between gap-3 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3 text-left transition hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-overlay)]">
    <span><span className="mb-1 flex items-center gap-2"><StatusChip tone={done?'success':'warning'}>{done?'Entschieden':'Offen'}</StatusChip><span className="text-xs font-bold text-[var(--ops-text-muted)]">{task.nation}{task.discipline?` · ${task.discipline}`:''}</span></span><strong className="block text-sm">{task.approval.description}</strong><span className="mt-1 block text-xs text-[var(--ops-text-muted)]">Empfehlung: {task.recommendation}</span></span>
    <span className="shrink-0 text-xs font-bold text-[var(--ops-primary)]">Öffnen →</span>
  </button>;
}
