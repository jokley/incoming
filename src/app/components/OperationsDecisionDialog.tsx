import { type ReactNode, useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { AlertTriangle, ChevronDown, CircleDot } from 'lucide-react';

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
  gender: string;
  quota?: { current: number; allowed: number; label: string };
};

export function buildOperationsTask(session: ImportSession, approval: ImportApproval): OperationsTask {
  const quotaRecord = session.preview?.dispositionAnalysis?.categories.quotaAffected.records.find(record =>
    String(record.nation ?? '') === approval.nation,
  );
  const people = [quotaRecord?.athlete, quotaRecord?.person, quotaRecord?.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value));
  const isSingleRoom = /single|einzel|\bsr\b/i.test(`${approval.type} ${approval.description}`);
  const quotaCheck = session.preview?.quotaChecks?.find(check => check.nationCode === approval.nation && (!session.discipline || check.discipline === session.discipline));
  return {
    approval,
    nation: session.nation,
    discipline: session.discipline,
    people,
    rule: isSingleRoom ? 'Die gemeldeten Einzelzimmer überschreiten die aktuell verfügbare Quote.' : 'Die aktuell gültige Nationenquote wird durch die Meldung überschritten.',
    impact: 'Die bestehende Planung muss fachlich geprüft werden. Hotel- und Zimmerzuweisungen bleiben unverändert.',
    recommendation: isSingleRoom ? 'Mehrkosten mit der Nation abstimmen' : 'Neue Excel-Datei anfordern',
    gender: quotaCheck?.gender || '—',
    quota: quotaCheck ? { current: isSingleRoom ? quotaCheck.singleRooms : quotaCheck.officials, allowed: isSingleRoom ? quotaCheck.singleRoomsAllowed : quotaCheck.officialQuota, label: isSingleRoom ? 'Single Rooms' : 'Officials' } : undefined,
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
        <section><SectionHeader title="1. Quotenverletzung" subtitle="Das müssen Sie jetzt entscheiden" />
          <div className="mt-3 rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] p-4">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ops-warning)]"/><div><p className="font-extrabold">{task.approval.description}</p><p className="mt-1 text-sm text-[var(--ops-text-muted)]">{task.rule}</p></div></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><DecisionFact label="Nation" value={task.nation}/><DecisionFact label="Disziplin" value={task.discipline || '—'}/><DecisionFact label="Gender" value={task.gender}/><DecisionFact label="Empfehlung" value={task.recommendation}/></div>
          </div>
        </section>

        <section>
          <SectionHeader title="2. Änderung" />
          <div className="mt-3 rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] p-4">
            <p className="font-bold">{task.recommendation}</p><p className="mt-1 text-sm text-[var(--ops-text-muted)]">Wählen Sie unten das Ergebnis und dokumentieren Sie die Rücksprache.</p>
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

        <section><label htmlFor="decision-comment" className="block"><SectionHeader title="5. Bemerkung" subtitle="Telefonnotiz, Mail oder ergänzende Information" /></label><textarea id="decision-comment" value={comment} onChange={event=>setComment(event.target.value)} rows={4} placeholder="Bemerkung zur Entscheidung …" className="mt-3 w-full resize-y rounded-xl border border-[var(--ops-border)] bg-[var(--ops-background)] p-3 text-sm text-[var(--ops-text)] outline-none placeholder:text-[var(--ops-text-subtle)] focus:border-[var(--ops-primary)]" /></section>
        <details className="group rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)]">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 font-bold">Fachliche Details <ChevronDown className="h-4 w-4 transition group-open:rotate-180"/></summary>
          <div className="grid gap-3 border-t border-[var(--ops-divider)] p-4 sm:grid-cols-2"><DecisionFact label="Quote" value={task.quota ? `${task.quota.current} ${task.quota.label} gemeldet · ${task.quota.allowed} erlaubt` : 'Keine Berechnung verfügbar'}/><DecisionFact label="Auswirkung" value={task.impact}/><DecisionFact label="Betroffene Personen" value={task.people.length ? task.people.join(', ') : 'Gemeldete Gruppe'}/><DecisionFact label="Historie" value={task.approval.decision === 'PENDING' ? 'Entscheidung noch offen' : `Entschieden am ${new Date(task.approval.timestamp).toLocaleString('de-DE')}`}/></div>
        </details>
        <details className="group rounded-xl border border-[var(--ops-border)]">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-bold text-[var(--ops-text-muted)]">Technische Details <ChevronDown className="h-4 w-4 transition group-open:rotate-180"/></summary>
          <div className="grid gap-3 border-t border-[var(--ops-divider)] p-4 text-sm sm:grid-cols-2"><DecisionFact label="Entscheidungs-ID" value={task.approval.id}/><DecisionFact label="Session-ID" value={task.approval.sessionId}/><DecisionFact label="Regeltyp" value={task.approval.type}/><DecisionFact label="Version" value="Aktuelle Importversion"/></div>
        </details>
      </DialogContent>
      <DialogFooter><OpsButton type="button" onClick={onClose} disabled={saving}>Abbrechen</OpsButton><OpsButton type="button" disabled={saving||!contact||!date||(organizerApproval&&!deadline)} onClick={()=>onSave({decision:decision==='newList'?'NEW_LIST_ANNOUNCED':'APPROVED',comment,approvalType:decision==='newList'?undefined:organizerApproval?'ORGANIZER_APPROVED':'NATION_APPROVED',approvalMethod:method,approvalBy:contact,approvalDate:new Date(date).toISOString(),contactSubject:subject||undefined,deadlineAt:deadline?new Date(deadline).toISOString():undefined})} className="border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]">{saving?'Wird gespeichert …':'Dokumentation speichern'}</OpsButton></DialogFooter>
    </div>}
  </Dialog>;
}

function Field({label,children}:{label:string;children:ReactNode}) { return <label className="block text-sm font-bold">{label}<span className="mt-1 block [&_.field]:w-full [&_.field]:rounded-lg [&_.field]:border [&_.field]:border-[var(--ops-border)] [&_.field]:bg-[var(--ops-background)] [&_.field]:p-2.5 [&_.field]:text-[var(--ops-text)]">{children}</span></label>; }

function DecisionFact({label,value}:{label:string;value:string}) { return <div><div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ops-text-subtle)]">{label}</div><div className="mt-1 text-sm font-bold">{value}</div></div>; }

export function OperationsTaskRow({ task, onOpen }: { task: OperationsTask; onOpen: () => void }) {
  const done = task.approval.decision !== 'PENDING';
  return <button type="button" onClick={onOpen} className={`w-full rounded-xl border p-4 text-left transition hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-overlay)] ${done?'border-[var(--ops-border)] bg-[var(--ops-surface)] opacity-80':'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)]'}`}>
    <span className="flex items-start justify-between gap-3"><span className="flex items-center gap-2"><CircleDot className={`h-4 w-4 ${done?'text-[var(--ops-success)]':'text-[var(--ops-warning)]'}`}/><strong>{task.approval.description}</strong></span><StatusChip tone={done?'success':'warning'}>{done?'Erledigt':'Offen'}</StatusChip></span>
    <span className="mt-3 grid grid-cols-3 gap-2"><DecisionFact label="Nation" value={task.nation}/><DecisionFact label="Disziplin" value={task.discipline || '—'}/><DecisionFact label="Gender" value={task.gender}/></span>
    <span className="mt-3 block text-sm text-[var(--ops-text-muted)]">{task.rule}</span>
    {task.quota&&<span className="mt-2 block font-bold">{task.quota.current} {task.quota.label} gemeldet · {task.quota.allowed} erlaubt</span>}
    <span className="mt-4 flex items-center justify-between border-t border-[var(--ops-divider)] pt-3"><span><span className="block text-[11px] font-bold uppercase text-[var(--ops-text-subtle)]">Empfohlene Aktion</span><strong className="text-sm">{task.recommendation}</strong></span><span className="shrink-0 rounded-lg bg-[var(--ops-primary)] px-3 py-2 text-xs font-extrabold text-white">{done?'Entscheidung ansehen':'Entscheidung öffnen'}</span></span>
  </button>;
}
