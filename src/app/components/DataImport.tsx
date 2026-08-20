import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { AlertTriangle, CheckCircle, ChevronRight, Clock3, FileCheck2, FileText, Loader2, RefreshCcw, Upload, Users } from 'lucide-react';

import { api } from '../services/api';
import type { FisImportIssue, FisImportPreview } from '../types';
import { IMPORT_SESSION_STATUS, type ImportSession } from '../data/importSessions';
import { ContentCard, EmptyState, InfoPanel, OpsButton, PageHeader, SplitPageLayout, SectionHeader, StatusChip } from '../design-system';
import { ImportQueue } from './ImportQueue';
import { buildOperationsTask, OperationsDecisionDialog, OperationsTaskRow, quotaViolationLabel, type OperationsTask } from './OperationsDecisionDialog';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import { ActivitySummaryCard } from './activity';

const REQUIRED_FILE_HINTS = ['ENTRIES-LIST', 'ENTRIES-ROOM-LIST-DETAILED'];
type WorkflowStep = { id: string; label: string; complete: boolean; current: boolean };
type Detail = { title: string; subtitle?: string; issues?: FisImportIssue[]; rows?: string[][]; headers?: string[] };

export function DataImport() {
  const [searchParams] = useSearchParams();
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ImportSession | null>(null);
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<FisImportPreview | null>(null);
  const [loading, setLoading] = useState(false), [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [activeTask, setActiveTask] = useState<OperationsTask | null>(null);
  const [shownDecisionId, setShownDecisionId] = useState<string | null>(searchParams.get('decisionId'));
  const [savingTask, setSavingTask] = useState(false);
  const quotaWarnings = useMemo(() => preview?.warnings.filter(i => i.code.startsWith('QUOTA_')) ?? [], [preview]);
  const otherWarnings = useMemo(() => preview?.warnings.filter(i => !i.code.startsWith('QUOTA_')) ?? [], [preview]);

  const refreshSessions = async () => setSessions(await api.getImportSessions());
  useEffect(() => { (async () => { try { const loaded = await api.getImportSessions(); setSessions(loaded); const requested = searchParams.get('sessionId'); const requestedDecision = searchParams.get('decisionId'); const match = requested ? loaded.find(session => session.id === requested) : requestedDecision ? loaded.find(session => session.approvals.some(approval => String(approval.id) === requestedDecision)) : undefined; if (match) await selectSession(match); } catch(e) { setError(e instanceof Error ? e.message : 'Sessions konnten nicht geladen werden'); } })(); }, []);
  const selectSession = async (session: ImportSession) => { const full = await api.getImportSession(session.id); setSelected(full); setPreview(full.preview ?? null); setFiles([]); setSuccess(null); detailScrollRef.current?.scrollTo({ top: 0 }); };
  const createSession = () => { setSelected(null); setPreview(null); setSuccess(null); setError(null); detailScrollRef.current?.scrollTo({ top: 0 }); };
  const handleFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return; const accepted = Array.from(incoming).filter(f => /\.xlsx?$/i.test(f.name));
    if (!accepted.length) { setError('Bitte Excel-Dateien (.xlsx, .xls) hochladen.'); return; }
    setFiles([...new Map(accepted.map(f => [f.name.toLowerCase(), f])).values()]); setPreview(null); setSuccess(null); setError(null);
  };
  const cancel = () => { setFiles([]); setPreview(null); setError(null); setSuccess(null); const input = document.getElementById('fis-files-input') as HTMLInputElement | null; if (input) input.value = ''; };
  const runPreview = async () => { if (files.length < 2) return; setLoading(true); setError(null); setSuccess(null); setPreview(null); try { const result = await api.previewFisImport(files, !selected, selected?.id); setPreview(result); if (result.session) { setSelected({...result.session, preview: result}); setFiles([]); await refreshSessions(); } } catch (e) { setError(e instanceof Error ? e.message : 'Preview fehlgeschlagen'); } finally { setLoading(false); } };
  const approve = async () => { if (!selected) return; setConfirming(true); setError(null); try { const updated = await api.approveImportSession(selected.id); setSelected(updated); await refreshSessions(); } catch(e) { setError(e instanceof Error ? e.message : 'Freigabe fehlgeschlagen'); } finally { setConfirming(false); } };
  const confirm = async () => { if (!selected || selected.status !== 'APPROVED') return; setConfirming(true); setError(null); try { const result = await api.importSession(selected.id); setSuccess(`Import erfolgreich: ${result.summary.peopleCreated} neu, ${result.summary.peopleUpdated} aktualisiert. Bestehende Dispositionen wurden nicht verändert.`); setSelected(await api.getImportSession(selected.id)); await refreshSessions(); } catch (e) { setError(e instanceof Error ? e.message : 'Import fehlgeschlagen'); } finally { setConfirming(false); } };
  const saveTask = async (payload: {decision:'APPROVED'|'NEW_LIST_ANNOUNCED'; comment:string; approvalType?:'NATION_APPROVED'|'ORGANIZER_APPROVED'; approvalMethod:'EMAIL'|'PHONE'; approvalBy:string; approvalDate:string; contactSubject?:string; costCoverage?:string; deadlineAt?:string}) => {
    if (!selected || !activeTask) return;
    setSavingTask(true); setError(null);
    try {
      const updated = await api.decideImportTask(selected.id, activeTask.approval.id, payload);
      setSelected(updated); setPreview(updated.preview ?? null);
      const nextApproval = updated.approvals.find(approval => approval.decision === 'PENDING');
      setActiveTask(nextApproval ? buildOperationsTask(updated, nextApproval) : null);
      setSuccess(nextApproval ? 'Nächster Schritt geöffnet.' : 'Entscheidung gespeichert.');
      await refreshSessions();
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Entscheidung konnte nicht gespeichert werden'); }
    finally { setSavingTask(false); }
  };

  const openIssues = (title: string, issues: FisImportIssue[]) => setDetail({ title, subtitle: `${issues.length} betroffene Prüfhinweise`, issues });
  const approvedPersonKeys = new Set(selected?.approvals.flatMap(approval => approval.approvedPersonKeys ?? []) ?? []);
  const peopleRows = preview?.people.map(p => {
    const entitlement = approvedPersonKeys.has((p as FisImportPreviewPersonWithKey).matchKey)
      ? 'Einzelzimmer außerhalb Quote (Mehrpreis)'
      : p.singleRoomEntitlement === 'IN_QUOTA' ? 'Einzelzimmer innerhalb Quote'
        : p.singleRoomEntitlement === 'APPROVAL_REQUIRED' ? 'Einzelzimmer außerhalb Quote (Genehmigung offen)' : '—';
    return [`${p.firstname} ${p.lastname}`, p.nationCode, p.discipline || '—', p.function || '—', entitlement, p.operation];
  }) ?? [];
  const roomRows = preview?.rooms.map(r => [r.person1Name, r.person2Name || '—', r.roomType, [r.checkInDate, r.checkOutDate].filter(Boolean).join(' → ') || '—']) ?? [];

  return <div className="h-full min-h-0 bg-[var(--ops-background)] text-[var(--ops-text)]">
    <SplitPageLayout className="flex h-full min-h-0 flex-col gap-5 space-y-0">
      <PageHeader eyebrow="Operations Center" title="Import Center" subtitle="FIS-Import Sessions prüfen, entscheiden und kontrolliert abschließen." meta={selected ? <><StatusChip tone={selected.errors ? 'error' : selected.warnings ? 'warning' : 'success'}>{IMPORT_SESSION_STATUS[selected.status]}</StatusChip><span className="text-sm text-[var(--ops-text-muted)]">IS-{selected.id} · {selected.nation} · {selected.discipline}</span></> : <StatusChip tone="primary">Neue Import Session</StatusChip>} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 xl:flex-row">
        <ImportQueue sessions={sessions} selectedId={selected?.id ?? null} isCreating={!selected} onCreate={createSession} onSelect={selectSession} />
        <ContentCard surface="raised" className="min-h-0 flex-1 overflow-hidden">
          <div ref={detailScrollRef} className="h-full overflow-y-auto">
            {!selected ? <NewSessionWorkspace files={files} preview={preview} loading={loading} confirming={confirming} error={error} success={success} onFiles={handleFiles} onPreview={runPreview} onConfirm={confirm} onCancel={cancel} /> : <>
            <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] p-5">
              <div><SectionHeader title="Session" /><h2 className="mt-2 text-2xl font-extrabold">{selected.nation} · {selected.discipline}</h2><p className="text-sm text-[var(--ops-text-muted)]">{selected.uploadedAt} · {selected.uploadedBy} · Version {selected.currentVersion?.version ?? 0}</p></div>
              <div className="flex gap-2"><OpsButton onClick={approve} disabled={!preview?.isValid || selected.approvals.some(a => a.decision !== 'APPROVED') || !['PROFESSIONALLY_REVIEWED','READY_FOR_IMPORT','WAITING_FOR_NATION','NATION_CLARIFICATION','NEW_LIST_RECEIVED','EXCEPTION_APPROVED'].includes(selected.status)}>Freigeben</OpsButton><OpsButton onClick={confirm} disabled={selected.status !== 'APPROVED' || confirming} className="border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]"><CheckCircle className="mr-2 inline h-4 w-4" />Importieren</OpsButton></div>
            </div>
            <div className="space-y-5 p-5">
              <Workflow session={selected} />
              {error && <InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}{success && <InfoPanel tone="success" title="Import abgeschlossen">{success}</InfoPanel>}
              {preview && <ImportChangeSummary preview={preview}/>}
              <TaskList session={selected} onOpen={setActiveTask}/>
              <ProblemList preview={preview} fallback={selected} quota={quotaWarnings} others={otherWarnings} onOpen={openIssues}/>
              <PreviewCard peopleRows={peopleRows} roomRows={roomRows} onOpen={setDetail}/>
              <SessionHistory session={selected} onShowDecision={setShownDecisionId}/>
              <details className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4"><summary className="cursor-pointer font-extrabold">Neue Meldeliste hochladen</summary><div className="mt-4 grid items-start gap-5 lg:grid-cols-2"><UploadCard files={files} onChange={handleFiles}/><div><p className="text-sm text-[var(--ops-text-muted)]">Die neue Meldeliste wird als Version {(selected.currentVersion?.version ?? 0) + 1} geprüft. Die bisherige Version bleibt in der Historie erhalten.</p><div className="mt-4 flex gap-2"><OpsButton onClick={runPreview} disabled={files.length<2||loading}>{loading?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 inline h-4 w-4"/>}Version prüfen</OpsButton><OpsButton onClick={cancel} disabled={!files.length}>Abbrechen</OpsButton></div></div></div></details>
              <ActivitySummaryCard entityType="import" entityId={selected.id} createdAt={selected.uploadedAt} updatedAt={selected.currentVersion?.uploadedAt}/>
            </div>
            </>}
          </div>
        </ContentCard>
      </div>
    </SplitPageLayout>
    <DetailDialog detail={detail} onClose={() => setDetail(null)} />
    <OperationsDecisionDialog task={activeTask} saving={savingTask} onClose={() => setActiveTask(null)} onSave={saveTask}/>
    <ImportDecisionDialog decisionId={shownDecisionId} onClose={() => setShownDecisionId(null)} onOpenSession={async sessionId => { setShownDecisionId(null); const session = sessions.find(item => item.id === sessionId); if (session) await selectSession(session); }} />
  </div>;
}

function NewSessionWorkspace({files,preview,loading,confirming,error,success,onFiles,onPreview,onConfirm,onCancel}:{files:File[];preview:FisImportPreview|null;loading:boolean;confirming:boolean;error:string|null;success:string|null;onFiles:(files:FileList|null)=>void;onPreview:()=>void;onConfirm:()=>void;onCancel:()=>void}) { return <>
  <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] p-5"><div><SectionHeader title="Session-Erstellung"/><h2 className="mt-2 text-2xl font-extrabold">Neue Import Session</h2><p className="text-sm text-[var(--ops-text-muted)]">FIS-Dateien hochladen und vor dem Import gemeinsam prüfen.</p></div><div className="flex gap-2"><OpsButton onClick={onPreview} disabled={files.length<2||loading}>{loading?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 inline h-4 w-4"/>}Preview prüfen</OpsButton><OpsButton onClick={onConfirm} disabled={true} className="border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]"><CheckCircle className="mr-2 inline h-4 w-4"/>Importieren</OpsButton></div></div>
  <div className="space-y-5 p-5"><Workflow session={null}/>{preview&&<ImportChangeSummary preview={preview}/>}<div className="grid items-start gap-5 lg:grid-cols-2"><UploadCard files={files} onChange={onFiles}/><ContentCard surface="elevated" className="p-4"><SectionHeader title="Ausgewählte Dateien" subtitle="Dateien für die neue Session"/><div className="mt-4 space-y-2">{files.length?files.map(file=><div key={file.name} className="flex items-center justify-between rounded-lg bg-[var(--ops-surface)] p-3 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0"/><span className="truncate">{file.name}</span></span><span className="font-mono text-xs text-[var(--ops-text-muted)]">{(file.size/1024).toFixed(1)} KB</span></div>):<EmptyState title="Noch keine Dateien" description="Beide FIS-Dateien gemeinsam hochladen."/>}</div><div className="mt-3"><OpsButton onClick={onCancel} disabled={!files.length&&!preview}><RefreshCcw className="mr-2 inline h-4 w-4"/>Upload zurücksetzen</OpsButton></div></ContentCard></div>{error&&<InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}{success&&<InfoPanel tone="success" title="Import abgeschlossen">{success}</InfoPanel>}</div>
</>; }

function ImportChangeSummary({preview}:{preview:FisImportPreview}) {
  const categories = preview.dispositionAnalysis.categories;
  const items = [
    [categories.stayChanged?.count || 0, 'Aufenthalte geändert'],
    [categories.roommateAffected?.count || 0, 'Zimmerpartner geändert'],
    [categories.newAthletes?.count || 0, 'neue Athleten'],
    [categories.hotelAssignmentAffected?.count || 0, 'Hotelzuweisungen betroffen'],
  ] as const;
  const disposition = categories.dispositionAffected?.count || 0;
  return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Erkannte Änderungen" subtitle="Kompakte Freigabeinformation – die fachlichen Details folgen in der Disposition"/><div className="mt-3 flex flex-wrap gap-2">{items.filter(([count])=>count>0).map(([count,label])=><StatusChip key={label} tone="neutral">{count} {label}</StatusChip>)}{disposition>0&&<StatusChip tone="warning">Disposition erforderlich</StatusChip>}{items.every(([count])=>count===0)&&<StatusChip tone="success">Keine operativen Änderungen</StatusChip>}</div></ContentCard>;
}

function visibleWorkflow(session: ImportSession | null): WorkflowStep[] {
  if (!session) return [{ id: 'upload', label: 'Importdateien', complete: false, current: true }, { id: 'validation', label: 'Technische Prüfung', complete: false, current: false }, { id: 'approval', label: 'Freigabe', complete: false, current: false }, { id: 'import', label: 'Import', complete: false, current: false }];
  const status = session.status;
  const imported = status === 'IMPORTED';
  const validationComplete = status !== 'DRAFT';
  const pendingDecisions = session.approvals.some(item => item.decision === 'PENDING');
  const hasDecisions = session.approvals.length > 0;
  const approved = ['APPROVED', 'IMPORTED'].includes(status);
  const clarification = ['WAITING_FOR_NATION', 'NATION_CLARIFICATION', 'NEW_LIST_RECEIVED', 'RECHECK_REQUIRED'].includes(status);
  const steps: WorkflowStep[] = [
    { id: 'upload', label: 'Importdateien', complete: true, current: status === 'DRAFT' },
    { id: 'validation', label: 'Technische Prüfung', complete: validationComplete, current: false },
  ];
  if (hasDecisions) steps.push({ id: 'decision', label: 'Fachliche Entscheidung', complete: !pendingDecisions, current: pendingDecisions });
  if (clarification) steps.push({ id: 'clarification', label: 'Klärung / neue Liste', complete: false, current: true });
  steps.push({ id: 'approval', label: 'Freigabe', complete: approved, current: !approved && !pendingDecisions && !clarification && validationComplete });
  steps.push({ id: 'import', label: 'Import', complete: imported, current: status === 'APPROVED' || imported });
  return steps;
}

function Workflow({session}:{session:ImportSession|null}) {
  const steps = visibleWorkflow(session);
  return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Workflow" subtitle="Nur Schritte, die in dieser Session eine Aktion erfordern"/><ol className="mt-4 grid gap-2" style={{gridTemplateColumns:`repeat(${steps.length}, minmax(0, 1fr))`}}>{steps.map((step,index)=><li key={step.id}><div aria-current={step.current?'step':undefined} className={`h-full min-h-20 rounded-lg border p-2.5 text-left ${step.current?'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)] ring-2 ring-[var(--ops-primary)]':step.complete?'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]':'border-[var(--ops-border)] bg-[var(--ops-surface)]'}`}><span className="font-mono text-[10px] text-[var(--ops-text-subtle)]">0{index+1}</span><div className="text-xs font-bold">{step.label}</div></div></li>)}</ol></ContentCard>;
}
function SessionHistory({session,onShowDecision}:{session:ImportSession;onShowDecision:(id:string)=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Historie" subtitle={`${session.versions?.length ?? 0} Version(en) · kompakter Session-Verlauf`}/><div className="mt-4 space-y-3">{session.history?.length ? [...session.history].reverse().map(event=>{const content=<><Clock3 className="mt-0.5 h-4 w-4 text-[var(--ops-text-subtle)]"/><div><div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{event.title}</span><span className="font-mono text-xs text-[var(--ops-text-subtle)]">{new Date(event.timestamp).toLocaleString('de-DE')} · {event.user}</span></div>{event.description&&<p className="mt-1 text-sm text-[var(--ops-text-muted)]">{event.description}</p>}</div></>;return event.decisionId?<button key={event.id} type="button" onClick={()=>onShowDecision(event.decisionId!)} className="grid w-full grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3 text-left transition hover:text-[var(--ops-primary)]">{content}</button>:<div key={event.id} className="grid grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3">{content}</div>}):<EmptyState title="Noch keine Historieneinträge" description="Versionen, Entscheidungen und Freigaben werden automatisch protokolliert."/>}</div></ContentCard>; }
function UploadCard({files,onChange}:{files:File[];onChange:(f:FileList|null)=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Neue Import Session" subtitle="Beide Dateien in einem Schritt auswählen"/><label className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-[var(--ops-border-strong)] bg-[var(--ops-surface)] p-6 text-center hover:bg-[var(--ops-tone-primary-surface)]"><input id="fis-files-input" type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={e=>onChange(e.target.files)}/><Upload className="mx-auto h-8 w-8 text-[var(--ops-primary)]"/><p className="mt-2 font-bold">{files.length ? `${files.length} Datei(en) ausgewählt` : 'Dateien auswählen oder ablegen'}</p><p className="mt-1 text-xs text-[var(--ops-text-muted)]">{REQUIRED_FILE_HINTS.join(' + ')}</p></label></ContentCard>; }
function quotaIssueLabel(issue:FisImportIssue) { const single=issue.code==='QUOTA_SINGLE_ROOMS_EXCEEDED'; const current=Number(issue.details?.[single?'importedSingleRooms':'importedOfficials']); const allowed=Number(issue.details?.[single?'singleRoomsAllowed':'officialQuota']); return Number.isFinite(current)&&Number.isFinite(allowed)?quotaViolationLabel(single?'Single Rooms':'Officials',current,allowed):issue.message; }
function ProblemList({preview,fallback,quota,others,onOpen}:{preview:FisImportPreview|null;fallback:ImportSession;quota:FisImportIssue[];others:FisImportIssue[];onOpen:(t:string,i:FisImportIssue[])=>void}) {
  const blocking=preview?.errors??[];
  const problemCount=quota.length+blocking.length+others.length;
  return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Prüfergebnis" subtitle="Kurzübersicht; Details öffnen sich nur bei Bedarf"/><div className="mt-3 space-y-2">
    {quota.map((issue,index)=><button key={`${issue.code}-${index}`} type="button" onClick={()=>onOpen('Entscheidung erforderlich',[issue])} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-[var(--ops-surface-overlay)]"><span className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="h-4 w-4 text-[var(--ops-warning)]"/>{quotaIssueLabel(issue)}</span><ChevronRight className="h-4 w-4 text-[var(--ops-text-subtle)]"/></button>)}
    {blocking.length>0&&<SummaryRow label="Blockierende Fehler" count={blocking.length} tone="error" onClick={()=>onOpen('Blockierend',blocking)}/>}
    {others.length>0&&<SummaryRow label="Weitere Hinweise" count={others.length} tone="neutral" onClick={()=>onOpen('Information',others)}/>}
    {problemCount===0&&fallback.errors===0&&<div className="flex items-center gap-2 px-2 py-2 text-sm font-bold"><CheckCircle className="h-4 w-4 text-[var(--ops-success)]"/>Keine weiteren Probleme</div>}
  </div></ContentCard>;
}
function TaskList({session,onOpen}:{session:ImportSession;onOpen:(task:OperationsTask)=>void}) { const pending=session.approvals.map(approval=>buildOperationsTask(session,approval)).filter(task=>task.approval.decision==='PENDING'); if(!pending.length)return null; return <ContentCard surface="elevated" className="p-4"><SectionHeader title={`${pending.length} ${pending.length===1?'Entscheidung':'Entscheidungen'} erforderlich`} subtitle="Arbeiten Sie die Entscheidungen Schritt für Schritt ab." actions={<StatusChip tone="warning">Offen</StatusChip>}/><div className="mt-4 space-y-2">{pending.map(task=><OperationsTaskRow key={task.approval.id} task={task} onOpen={()=>onOpen(task)}/>)}</div></ContentCard>; }
type FisImportPreviewPersonWithKey = FisImportPreview['people'][number] & { matchKey?: string };
function PreviewCard({peopleRows,roomRows,onOpen}:{peopleRows:string[][];roomRows:string[][];onOpen:(detail:Detail)=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Preview" subtitle="Die vollständigen Inhalte der beiden Excel-Dateien prüfen"/><div className="mt-4 grid gap-3 sm:grid-cols-2"><SummaryRow label="Personen-Vorschau" count={peopleRows.length} onClick={()=>onOpen({title:'Personen-Vorschau',subtitle:`${peopleRows.length} Personen`,rows:peopleRows,headers:['Name','Nation','Disziplin','Funktion','Einzelzimmeranspruch','Aktion']})}/><SummaryRow label="Zimmer-Vorschau" count={roomRows.length} onClick={()=>onOpen({title:'Zimmer-Vorschau',subtitle:`${roomRows.length} Zimmerzuordnungen`,rows:roomRows,headers:['Person 1','Person 2','Zimmer','Aufenthalt']})}/></div></ContentCard>; }
function SummaryRow({label,count,tone='neutral',disabled,onClick}:{label:string;count:number;tone?:'neutral'|'success'|'warning'|'error';disabled?:boolean;onClick:()=>void}) { return <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center justify-between rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2.5 text-left transition hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-overlay)] disabled:cursor-default disabled:opacity-70"><span className="flex items-center gap-2 text-sm font-bold">{tone==='error'?<AlertTriangle className="h-4 w-4 text-[var(--ops-error)]"/>:tone==='success'?<CheckCircle className="h-4 w-4 text-[var(--ops-success)]"/>:<Users className="h-4 w-4 text-[var(--ops-text-subtle)]"/>}{label}</span><span className="flex items-center gap-2"><StatusChip tone={tone}>{count}</StatusChip><ChevronRight className="h-4 w-4 text-[var(--ops-text-subtle)]"/></span></button>; }
const issueCopy:Record<string,{message:string;causes?:string[];action:string}>={
  ROOM_PERSON_NOT_FOUND:{message:'Neue Person erkannt.',action:'Die Person wird beim Import neu angelegt.'},
  ROOM_PARTNER_NOT_FOUND:{message:'Neue Person als Zimmerpartner erkannt.',action:'Die Person wird beim Import neu angelegt.'},
  ROOM_INVALID_ARRIVAL_DATE:{message:'Das Anreisedatum ist nicht lesbar.',action:'Importdaten korrigieren'}, ROOM_INVALID_DEPARTURE_DATE:{message:'Das Abreisedatum ist nicht lesbar.',action:'Importdaten korrigieren'},
  ROOM_INVALID_STAY_RANGE:{message:'Die Abreise liegt vor der Anreise.',action:'Importdaten korrigieren'}, ROOM_DAY_VALUE_NOT_NUMERIC:{message:'Die Zimmerbelegung enthält einen ungültigen Wert.',action:'Keine Aktion erforderlich'}, ROOM_NO_DAY_OVERLAP:{message:'Der Aufenthalt liegt außerhalb des gemeldeten Zeitraums.',action:'Keine Aktion erforderlich'},
};
const detailLabels:Record<string,string>={firstname:'Vorname',lastname:'Nachname',nationCode:'Nation',discipline:'Disziplin',gender:'Gender',hotel:'Hotel',roomType:'Zimmertyp',sharedWithName:'Zimmerpartner',sharedWithNationcode:'Nation',arrivalDate:'Anreise',departureDate:'Abreise',value:'Wert'};
function displayValue(value:unknown):string { if(value===null||value===undefined||value==='')return 'Noch zu ermitteln'; if(Array.isArray(value))return value.map(displayValue).join(', '); if(typeof value==='object')return Object.entries(value as Record<string,unknown>).map(([key,item])=>`${detailLabels[key]??key}: ${displayValue(item)}`).join(' · '); return String(value); }
function RecordSection({title,children}:{title:string;children:ReactNode}) { return <section><h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-[var(--ops-text-subtle)]">{title}</h3><div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4">{children}</div></section>; }
function IssueRecord({issue,isInformation,isDecision}:{issue:FisImportIssue;isInformation:boolean;isDecision:boolean}) { const copy=issueCopy[issue.code]; const detected=/discipline/i.test(issue.code); return <article className="space-y-4"><RecordSection title="1. Betroffene Person"><div className="grid gap-3 sm:grid-cols-2">{Object.entries(issue.details??{}).filter(([key])=>['firstname','lastname','nationCode','discipline','gender','hotel','roomType','sharedWithName','sharedWithNationcode','arrivalDate','departureDate'].includes(key)).map(([key,value])=><div key={key}><div className="text-xs font-bold text-[var(--ops-text-subtle)]">{detailLabels[key]??key}</div><div className="font-semibold">{displayValue(value)}</div></div>)}</div></RecordSection><RecordSection title="2. Änderung"><p className="font-bold">{detected?'Disziplin automatisch erkannt':copy?.message??'Die Importdatei enthält einen Prüfhinweis.'}</p>{detected&&<p className="mt-2 text-sm text-[var(--ops-text-muted)]">Erkannt: {displayValue(issue.details?.discipline??issue.details?.value)} · Quelle: Dateiname</p>}</RecordSection><RecordSection title="3. Auswirkungen"><div className="flex gap-2 font-bold">{isInformation?<CheckCircle className="h-5 w-5 text-[var(--ops-success)]"/>:<AlertTriangle className="h-5 w-5 text-[var(--ops-warning)]"/>}{isInformation?'Keine Aktion notwendig':isDecision?'Fachliche Entscheidung erforderlich':'Import ist bis zur Korrektur blockiert'}</div>{!copy&&!detected&&<details className="mt-3 text-sm"><summary className="cursor-pointer font-bold">Technische Details</summary><p className="mt-2 text-[var(--ops-text-muted)]">{issue.message}</p></details>}</RecordSection><InfoPanel tone={isInformation?'success':'info'} title="Empfohlene Aktion">{isInformation?'Keine Aktion erforderlich':copy?.action??'Importdaten prüfen'}</InfoPanel></article>; }
function DetailDialog({detail,onClose}:{detail:Detail|null;onClose:()=>void}) {
  const isInformation=detail?.title==='Information', isDecision=detail?.title==='Entscheidung erforderlich';
  return (
    <Dialog open={Boolean(detail)} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{detail?.title}<div className="text-sm font-normal text-[var(--ops-text-muted)]">{detail?.subtitle}</div></DialogTitle>
      <DialogContent dividers>
        <div className="space-y-6">{detail?.issues?.map((issue,i)=><IssueRecord key={`${issue.code}-${i}`} issue={issue} isInformation={Boolean(isInformation)} isDecision={Boolean(isDecision)}/>)}</div>
        {detail?.rows&&detail.rows.length>0&&<div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{detail.headers?.map(h=><th key={h} className="border-b border-[var(--ops-divider)] px-3 py-2 text-left text-xs uppercase text-[var(--ops-text-subtle)]">{h}</th>)}</tr></thead><tbody>{detail.rows.map((r,i)=><tr key={i} className="border-b border-[var(--ops-divider)]">{r.map((c,j)=><td key={j} className="px-3 py-2">{c}</td>)}</tr>)}</tbody></table></div>}
        {detail&&!detail.issues?.length&&!detail.rows?.length&&<EmptyState title="Keine betroffenen Datensätze" description="Für diese Session liegen keine Detailänderungen vor."/>}
      </DialogContent>
    </Dialog>
  );
}
