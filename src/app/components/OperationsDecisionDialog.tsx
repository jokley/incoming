import { type ReactNode, useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

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
  onSave: (payload: {decision:'APPROVED'|'NEW_LIST_ANNOUNCED'; comment:string; approvalType?:'NATION_APPROVED'|'ORGANIZER_APPROVED'; approvalMethod:'EMAIL'|'PHONE'; approvalBy:string; approvalDate:string; contactSubject?:string; deadlineAt?:string}) => void;
}) {
  const now = () => new Date().toISOString().slice(0,16);
  const [decision, setDecision] = useState<'nation' | 'newList'>('nation');
  const [organizerApproval,setOrganizerApproval]=useState(false);
  const [comment, setComment] = useState('');
  const [contact, setContact] = useState(''); const [method,setMethod]=useState<'EMAIL'|'PHONE'>('EMAIL');
  const [date,setDate]=useState(now); const [subject,setSubject]=useState(''); const [deadline,setDeadline]=useState('');
  useEffect(() => { setDecision('nation'); setOrganizerApproval(false); setComment(task?.approval.comment ?? ''); setContact(task?.approval.approvalBy??''); setMethod(task?.approval.approvalMethod??'EMAIL'); setDate(task?.approval.approvalDate?.slice(0,16)??now()); setSubject(task?.approval.contactSubject??''); setDeadline(task?.approval.deadlineAt?.slice(0,16)??''); }, [task]);

  return <Dialog open={Boolean(task)} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
    {task && <div className="bg-[var(--ops-surface)] text-[var(--ops-text)]">
      <DialogHeader title={task.approval.description || 'Aufgabe entscheiden'} subtitle={`${task.nation}${task.discipline ? ` · ${task.discipline}` : ''}`} />
      <DialogContent dividers className="space-y-6">
        <section><SectionHeader title="1. Quotenverletzung" subtitle="Kombination aus Nation, Disziplin und Gender" />
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

        <section><SectionHeader title="3. Rücksprache dokumentieren" subtitle="Die E-Mail selbst wird nicht gespeichert"/><div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Ansprechpartner / Verantwortlicher"><input value={contact} onChange={e=>setContact(e.target.value)} className="field"/></Field>
          <Field label="Medium"><select value={method} onChange={e=>setMethod(e.target.value as 'EMAIL'|'PHONE')} className="field"><option value="EMAIL">E-Mail</option><option value="PHONE">Telefon</option></select></Field>
          <Field label="Datum und Uhrzeit"><input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)} className="field"/></Field>
          <Field label="Betreff der E-Mail (optional)"><input value={subject} onChange={e=>setSubject(e.target.value)} className="field"/></Field>
        </div></section>
        <section><SectionHeader title="4. Ergebnis der Rücksprache"/><div className="mt-3 grid gap-2">
          {([['nation','Ausnahme durch Nation genehmigt'],['newList','Neue Meldeliste angekündigt']] as const).map(([value,label])=><label key={value} className={`rounded-xl border p-3 ${decision===value?'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]':'border-[var(--ops-border)]'}`}><input type="radio" className="mr-3" checked={decision===value} onChange={()=>setDecision(value)}/><strong>{label}</strong></label>)}
        </div><div className="mt-5 rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] p-3"><label className="font-bold"><input type="checkbox" className="mr-3" checked={organizerApproval} onChange={e=>{setOrganizerApproval(e.target.checked);if(e.target.checked)setDecision('nation')}}/>Organisatorische Freigabe (keine Reaktion innerhalb der Frist)</label>{organizerApproval&&<div className="mt-3"><Field label="Frist gesetzt bis"><input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)} className="field"/></Field><div className="mt-2"><InfoPanel tone="warning" title="Ausnahme">Diese Freigabe wird ausdrücklich als organisatorische Entscheidung protokolliert.</InfoPanel></div></div>}</div></section>

        <section><label htmlFor="decision-comment" className="block"><SectionHeader title="Bemerkung" subtitle="Telefonnotiz, Mail oder ergänzende Information" /></label><textarea id="decision-comment" value={comment} onChange={event=>setComment(event.target.value)} rows={4} placeholder="Bemerkung zur Entscheidung …" className="mt-3 w-full resize-y rounded-xl border border-[var(--ops-border)] bg-[var(--ops-background)] p-3 text-sm text-[var(--ops-text)] outline-none placeholder:text-[var(--ops-text-subtle)] focus:border-[var(--ops-primary)]" /></section>
      </DialogContent>
      <DialogFooter><OpsButton type="button" onClick={onClose} disabled={saving}>Abbrechen</OpsButton><OpsButton type="button" disabled={saving||!contact||!date||(organizerApproval&&!deadline)} onClick={()=>onSave({decision:decision==='newList'?'NEW_LIST_ANNOUNCED':'APPROVED',comment,approvalType:decision==='newList'?undefined:organizerApproval?'ORGANIZER_APPROVED':'NATION_APPROVED',approvalMethod:method,approvalBy:contact,approvalDate:new Date(date).toISOString(),contactSubject:subject||undefined,deadlineAt:deadline?new Date(deadline).toISOString():undefined})} className="border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]">{saving?'Wird gespeichert …':'Dokumentation speichern'}</OpsButton></DialogFooter>
    </div>}
  </Dialog>;
}

function Field({label,children}:{label:string;children:ReactNode}) { return <label className="block text-sm font-bold">{label}<span className="mt-1 block [&_.field]:w-full [&_.field]:rounded-lg [&_.field]:border [&_.field]:border-[var(--ops-border)] [&_.field]:bg-[var(--ops-background)] [&_.field]:p-2.5 [&_.field]:text-[var(--ops-text)]">{children}</span></label>; }

export function OperationsTaskRow({ task, onOpen }: { task: OperationsTask; onOpen: () => void }) {
  const done = task.approval.decision !== 'PENDING';
  return <button type="button" onClick={onOpen} className="flex w-full items-start justify-between gap-3 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3 text-left transition hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-overlay)]">
    <span><span className="mb-1 flex items-center gap-2"><StatusChip tone={done?'success':'warning'}>{done?'Entschieden':'Offen'}</StatusChip><span className="text-xs font-bold text-[var(--ops-text-muted)]">{task.nation}{task.discipline?` · ${task.discipline}`:''}</span></span><strong className="block text-sm">{task.approval.description}</strong><span className="mt-1 block text-xs text-[var(--ops-text-muted)]">Empfehlung: {task.recommendation}</span></span>
    <span className="shrink-0 text-xs font-bold text-[var(--ops-primary)]">Öffnen →</span>
  </button>;
}
