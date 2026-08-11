import { type ReactNode, useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { AlertTriangle, BedDouble, ChevronDown, ClipboardCheck } from 'lucide-react';

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
  singleRoomCandidates: Array<{ personKey: string; name: string; function?: string }>;
  excessCount: number;
};

export function quotaViolationLabel(label: string, current: number, allowed: number) {
  return `${label} überschritten (${current} / ${allowed})`;
}

export function buildOperationsTask(session: ImportSession, approval: ImportApproval): OperationsTask {
  const quotaRecord = session.preview?.dispositionAnalysis?.categories.quotaAffected.records.find(record =>
    String(record.nation ?? '') === approval.nation,
  );
  const people = [quotaRecord?.athlete, quotaRecord?.person, quotaRecord?.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value));
  const isSingleRoom = /single|einzel|\bsr\b/i.test(`${approval.type} ${approval.description}`);
  const quotaCheck = session.preview?.quotaChecks?.find(check => check.nationCode === approval.nation && (!session.discipline || check.discipline === session.discipline));
  const singleRoomCandidates = approval.quotaDetails?.singleRoomCandidates ?? [];
  return {
    approval,
    nation: session.nation,
    discipline: session.discipline,
    people,
    rule: isSingleRoom ? 'Die gemeldeten Einzelzimmer überschreiten die aktuell verfügbare Quote.' : 'Die aktuell gültige Nationenquote wird durch die Meldung überschritten.',
    impact: 'Die bestehende Planung muss fachlich geprüft werden. Hotel- und Zimmerzuweisungen bleiben unverändert.',
    recommendation: isSingleRoom ? 'Mehrkosten abstimmen' : 'Neue Meldeliste anfordern',
    gender: approval.quotaDetails?.gender || quotaCheck?.gender || '—',
    quota: quotaCheck ? { current: Number(isSingleRoom ? approval.quotaDetails?.importedSingleRooms ?? quotaCheck.singleRooms : approval.quotaDetails?.importedOfficials ?? quotaCheck.officials), allowed: Number(isSingleRoom ? approval.quotaDetails?.singleRoomsAllowed ?? quotaCheck.singleRoomsAllowed : approval.quotaDetails?.officialQuota ?? quotaCheck.officialQuota), label: isSingleRoom ? 'Single Rooms' : 'Officials' } : undefined,
    singleRoomCandidates,
    excessCount: Number(approval.quotaDetails?.excessCount ?? 0),
  };
}

function taskTitle(task: OperationsTask) {
  return task.quota ? quotaViolationLabel(task.quota.label, task.quota.current, task.quota.allowed) : task.approval.description;
}

export function OperationsDecisionDialog({ task, saving, onClose, onSave }: {
  task: OperationsTask | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: {decision:'APPROVED'|'NEW_LIST_ANNOUNCED'; comment:string; approvalType?:'NATION_APPROVED'|'ORGANIZER_APPROVED'; approvalMethod:'EMAIL'|'PHONE'; approvalBy:string; approvalDate:string; contactSubject?:string; costCoverage?:string; deadlineAt?:string; approvedPersonKeys?:string[]}) => void;
}) {
  const now = () => new Date().toISOString().slice(0,16);
  const [decision, setDecision] = useState<'nation' | 'newList'>('nation');
  const [organizerApproval,setOrganizerApproval]=useState(false);
  const [comment, setComment] = useState('');
  const [contact, setContact] = useState(''); const [method,setMethod]=useState<'EMAIL'|'PHONE'>('EMAIL');
  const [date,setDate]=useState(now); const [subject,setSubject]=useState(''); const [deadline,setDeadline]=useState('');
  const [costCoverage,setCostCoverage]=useState('');
  const [approvedPersonKeys,setApprovedPersonKeys]=useState<string[]>([]);
  useEffect(() => { setDecision('nation'); setOrganizerApproval(false); setComment(task?.approval.comment ?? ''); setContact(task?.approval.approvalBy??''); setMethod(task?.approval.approvalMethod??'EMAIL'); setDate(task?.approval.approvalDate?.slice(0,16)??now()); setSubject(task?.approval.contactSubject??''); setCostCoverage(task?.approval.costCoverage??''); setDeadline(task?.approval.deadlineAt?.slice(0,16)??''); setApprovedPersonKeys(task?.approval.approvedPersonKeys??[]); }, [task]);

  return <Dialog open={Boolean(task)} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
    {task && <div className="bg-[var(--ops-surface)] text-[var(--ops-text)]">
      <DialogHeader title={taskTitle(task) || 'Aufgabe entscheiden'} subtitle="Eine Entscheidung nach der anderen · nach dem Speichern geht es automatisch weiter" />
      <DialogContent dividers className="space-y-6">
        <section><SectionHeader title="Zusammenfassung" subtitle="Das ist jetzt zu klären" />
          <div className="mt-3 rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] p-4">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ops-warning)]"/><p className="text-lg font-extrabold">{taskTitle(task)}</p></div>
            <div className="mt-4 grid grid-cols-3 gap-3"><DecisionFact label="Nation" value={task.nation}/><DecisionFact label="Disziplin" value={task.discipline || '—'}/><DecisionFact label="Gender" value={task.gender}/></div>
          </div>
        </section>

        <InfoPanel tone="info" title="Empfehlung"><strong>{task.recommendation}</strong><span className="mt-1 block text-sm">Folgen Sie dieser Aktion oder dokumentieren Sie unten eine abweichende Entscheidung.</span></InfoPanel>

        <section><SectionHeader title="Rücksprache dokumentieren" subtitle="Wer wurde wann und auf welchem Weg kontaktiert?"/><div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Ansprechpartner / Verantwortlicher"><input value={contact} onChange={e=>setContact(e.target.value)} className="field"/></Field>
          <Field label="Medium"><select value={method} onChange={e=>setMethod(e.target.value as 'EMAIL'|'PHONE')} className="field"><option value="EMAIL">E-Mail</option><option value="PHONE">Telefon</option></select></Field>
          <Field label="Datum und Uhrzeit"><input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)} className="field"/></Field>
          <Field label="Betreff der E-Mail (optional)"><input value={subject} onChange={e=>setSubject(e.target.value)} className="field"/></Field>
          <Field label="Kostenübernahme (optional)"><input value={costCoverage} onChange={e=>setCostCoverage(e.target.value)} className="field"/></Field>
        </div></section>
        <section><SectionHeader title="Entscheidung" subtitle="Wie soll mit der Quotenverletzung weitergearbeitet werden?"/><div className="mt-3 grid gap-2">
          {([['nation','Ausnahme durch Nation genehmigt'],['newList','Neue Meldeliste angekündigt']] as const).map(([value,label])=><label key={value} className={`rounded-xl border p-3 ${decision===value?'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]':'border-[var(--ops-border)]'}`}><input type="radio" className="mr-3" checked={decision===value} onChange={()=>setDecision(value)}/><strong>{label}</strong></label>)}
        </div><div className="mt-5 rounded-xl border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] p-3"><label className="font-bold"><input type="checkbox" className="mr-3" checked={organizerApproval} onChange={e=>{setOrganizerApproval(e.target.checked);if(e.target.checked)setDecision('nation')}}/>Organisatorische Freigabe (keine Reaktion innerhalb der Frist)</label>{organizerApproval&&<div className="mt-3"><Field label="Frist gesetzt bis"><input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)} className="field"/></Field><div className="mt-2"><InfoPanel tone="warning" title="Ausnahme">Diese Freigabe wird ausdrücklich als organisatorische Entscheidung protokolliert.</InfoPanel></div></div>}</div></section>

        {task.singleRoomCandidates.length > 0 && decision === 'nation' && <section><SectionHeader title="Genehmigte Einzelzimmeransprüche" subtitle={`Genau ${task.excessCount} Person(en) außerhalb der Quote auswählen.`}/><div className="mt-3 grid gap-2">{task.singleRoomCandidates.map(person=><label key={person.personKey} className="flex items-center gap-3 rounded-xl border border-[var(--ops-border)] p-3"><input type="checkbox" checked={approvedPersonKeys.includes(person.personKey)} onChange={event=>setApprovedPersonKeys(current=>event.target.checked?[...current,person.personKey]:current.filter(key=>key!==person.personKey))}/><span><strong className="block">{person.name}</strong><span className="text-sm text-[var(--ops-text-muted)]">{person.function || 'Official'} · Einzelzimmer</span></span></label>)}</div><p className="mt-2 text-xs text-[var(--ops-text-muted)]">{approvedPersonKeys.length} von {task.excessCount} ausgewählt. Diese Auswahl bestimmt Anspruch und Mehrkosten unabhängig vom später zugewiesenen Zimmertyp.</p></section>}

        <section><label htmlFor="decision-comment" className="block"><SectionHeader title="Bemerkung" subtitle="Optional: Telefonnotiz, Mail oder ergänzende Information" /></label><textarea id="decision-comment" value={comment} onChange={event=>setComment(event.target.value)} rows={4} placeholder="Bemerkung zur Entscheidung …" className="mt-3 w-full resize-y rounded-xl border border-[var(--ops-border)] bg-[var(--ops-background)] p-3 text-sm text-[var(--ops-text)] outline-none placeholder:text-[var(--ops-text-subtle)] focus:border-[var(--ops-primary)]" /></section>
        <details className="group rounded-xl border border-[var(--ops-border)]">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-bold text-[var(--ops-text-muted)]">Technische Details <ChevronDown className="h-4 w-4 transition group-open:rotate-180"/></summary>
          <div className="grid gap-3 border-t border-[var(--ops-divider)] p-4 text-sm sm:grid-cols-2"><DecisionFact label="Entscheidungs-ID" value={task.approval.id}/><DecisionFact label="Session-ID" value={task.approval.sessionId}/><DecisionFact label="Regeltyp" value={task.approval.type}/><DecisionFact label="Version" value="Aktuelle Importversion"/></div>
        </details>
      </DialogContent>
      <DialogFooter><OpsButton type="button" onClick={onClose} disabled={saving}>Abbrechen</OpsButton><OpsButton type="button" disabled={saving||!contact||!date||(organizerApproval&&!deadline)||(decision==='nation'&&task.singleRoomCandidates.length>0&&approvedPersonKeys.length!==task.excessCount)} onClick={()=>onSave({decision:decision==='newList'?'NEW_LIST_ANNOUNCED':'APPROVED',comment,approvalType:decision==='newList'?undefined:organizerApproval?'ORGANIZER_APPROVED':'NATION_APPROVED',approvalMethod:method,approvalBy:contact,approvalDate:new Date(date).toISOString(),contactSubject:subject||undefined,costCoverage:costCoverage||undefined,deadlineAt:deadline?new Date(deadline).toISOString():undefined,approvedPersonKeys:decision==='nation'?approvedPersonKeys:[]})} className="border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]">{saving?'Wird gespeichert …':'Dokumentation speichern'}</OpsButton></DialogFooter>
    </div>}
  </Dialog>;
}

function Field({label,children}:{label:string;children:ReactNode}) { return <label className="block text-sm font-bold">{label}<span className="mt-1 block [&_.field]:w-full [&_.field]:rounded-lg [&_.field]:border [&_.field]:border-[var(--ops-border)] [&_.field]:bg-[var(--ops-background)] [&_.field]:p-2.5 [&_.field]:text-[var(--ops-text)]">{children}</span></label>; }

function DecisionFact({label,value}:{label:string;value:string}) { return <div><div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ops-text-subtle)]">{label}</div><div className="mt-1 text-sm font-bold">{value}</div></div>; }
export function OperationsTaskRow({ task, onOpen }: { task: OperationsTask; onOpen: () => void }) {
  const done = task.approval.decision !== 'PENDING';
  const singleRoom = /single|einzel|\bsr\b/i.test(`${task.approval.type} ${task.approval.description}`);
  return <button type="button" onClick={onOpen} className={`w-full rounded-xl border p-4 text-left transition hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-overlay)] ${done?'border-[var(--ops-border)] bg-[var(--ops-surface)] opacity-80':'border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)]'}`}>
    <span className="flex items-start justify-between gap-3"><span className="flex items-center gap-2">{singleRoom?<BedDouble className="h-5 w-5 text-orange-400"/>:<ClipboardCheck className="h-5 w-5 text-yellow-400"/>}<strong>{taskTitle(task)}</strong></span><StatusChip tone={done?'success':'warning'}>{done?'Erledigt':'Offen'}</StatusChip></span>
    <span className="mt-3 block text-sm font-semibold">{task.nation}</span>
    <span className="block text-sm text-[var(--ops-text-muted)]">{task.discipline || '—'} {task.gender !== '—' ? `· ${task.gender}` : ''}</span>
    <span className="mt-4 flex items-center justify-between border-t border-[var(--ops-divider)] pt-3"><span><span className="block text-[11px] font-bold uppercase text-[var(--ops-text-subtle)]">Empfohlene Aktion</span><strong className="text-sm">{task.recommendation}</strong></span><span className="shrink-0 rounded-lg bg-[var(--ops-primary)] px-3 py-2 text-xs font-extrabold text-white">{done?'Entscheidung ansehen':'Entscheidung öffnen'}</span></span>
  </button>;
}
