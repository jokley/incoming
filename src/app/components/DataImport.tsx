import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Dialog, DialogContent, DialogTitle, Snackbar } from '@mui/material';
import { AlertTriangle, CheckCircle, ChevronRight, Clock3, FileCheck2, FileText, Loader2, RefreshCcw, Upload, Users, XCircle } from 'lucide-react';

import { api } from '../services/api';
import type { FisImportIssue, FisImportPreview } from '../types';
import { IMPORT_SESSION_STATUS, type ImportSession } from '../data/importSessions';
import { ContentCard, EmptyState, InfoPanel, OpsButton, PageHeader, SplitPageLayout, SectionHeader, StatusChip } from '../design-system';
import { ImportQueue } from './ImportQueue';
import { buildOperationsTask, OperationsDecisionDialog, type OperationsTask } from './OperationsDecisionDialog';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import { ActivitySummaryCard } from './activity';
import { AssignmentStatusChip } from './assignment/AssignmentInfo';
import { SingleRoomStatusBadge, type SingleRoomStatus } from './SingleRoomStatusBadge';

const REQUIRED_FILE_HINTS = ['ENTRIES-LIST', 'ENTRIES-ROOM-LIST-DETAILED'];
type WorkflowStep = { id: string; label: string; complete: boolean; current: boolean };
type Detail = { title: string; subtitle?: string; issues?: FisImportIssue[]; rows?: ReactNode[][]; headers?: string[] };

type VisibleImportStatus = 'Neu' | 'Aufenthalt geändert' | 'Zimmerpartner geändert' | 'Disposition prüfen' | 'Stammdaten prüfen';
const statusTone: Record<VisibleImportStatus, 'primary'|'info'|'warning'|'error'> = {
  Neu: 'primary', 'Aufenthalt geändert': 'info', 'Zimmerpartner geändert': 'primary',
  'Disposition prüfen': 'warning', 'Stammdaten prüfen': 'error',
};
const importStatuses = (statuses: VisibleImportStatus[]) => statuses.length ? <span className="flex flex-wrap gap-1">{[...new Set(statuses)].map(status => <StatusChip key={status} tone={statusTone[status]}>{status}</StatusChip>)}</span> : null;

export function DataImport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const [duplicateNotice, setDuplicateNotice] = useState(false);

  const refreshSessions = async () => setSessions(await api.getImportSessions());
  useEffect(() => { (async () => { try { const loaded = await api.getImportSessions(); setSessions(loaded); const requested = searchParams.get('sessionId'); const requestedDecision = searchParams.get('decisionId'); const match = requested ? loaded.find(session => session.id === requested) : requestedDecision ? loaded.find(session => session.approvals.some(approval => String(approval.id) === requestedDecision)) : undefined; if (match) await selectSession(match); } catch(e) { setError(e instanceof Error ? e.message : 'Sessions konnten nicht geladen werden'); } })(); }, []);
  const selectSession = async (session: ImportSession) => { const full = await api.getImportSession(session.id); setSelected(full); setPreview(full.preview ?? null); setFiles([]); setSuccess(null); };
  const createSession = () => { setSelected(null); setPreview(null); setSuccess(null); setError(null); };
  const handleFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return; const accepted = Array.from(incoming).filter(f => /\.xlsx?$/i.test(f.name));
    if (!accepted.length) { setError('Bitte Excel-Dateien (.xlsx, .xls) hochladen.'); return; }
    setFiles([...new Map(accepted.map(f => [f.name.toLowerCase(), f])).values()]); setPreview(null); setSuccess(null); setError(null);
  };
  const cancel = () => { setFiles([]); if (!selected) setPreview(null); setError(null); setSuccess(null); const input = document.getElementById('fis-files-input') as HTMLInputElement | null; if (input) input.value = ''; };
  const runPreview = async () => { if (files.length < 2) return; setLoading(true); setError(null); setSuccess(null); setPreview(null); try { const result = await api.previewFisImport(files, !selected, selected?.id); if (result.alreadyImported) { setSuccess(result.message ?? 'Diese Meldeliste wurde bereits importiert.'); setDuplicateNotice(true); setFiles([]); return; } setPreview(result); if (result.session) { setSelected({...result.session, preview: result}); setFiles([]); await refreshSessions(); } } catch (e) { setError(e instanceof Error ? e.message : 'Preview fehlgeschlagen'); } finally { setLoading(false); } };
  const abortSession = async () => { if (!selected) return; setConfirming(true); setError(null); try { await api.cancelImportSession(selected.id); setSelected(null); setPreview(null); setFiles([]); setSuccess('Importsession wurde abgebrochen und vollständig bereinigt.'); await refreshSessions(); } catch(e) { setError(e instanceof Error ? e.message : 'Importsession konnte nicht abgebrochen werden'); } finally { setConfirming(false); } };
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
  const recordNames = (category: keyof FisImportPreview['dispositionAnalysis']['categories']) => new Set((preview?.dispositionAnalysis.categories[category]?.records ?? []).map(record => String(record.athlete ?? '')));
  const newNames=recordNames('newAthletes'), stayNames=recordNames('stayChanged'), roommateNames=recordNames('roommateAffected'), dispositionNames=recordNames('dispositionAffected');
  const technicalRows = new Set((preview?.errors ?? []).map(issue => Number(issue.details?.row)).filter(Boolean));
  const statusesFor = (name:string,rowNumber?:number,operation?:'create'|'update'):VisibleImportStatus[] => {
    const statuses:VisibleImportStatus[]=[];
    if(operation==='create' || newNames.has(name)) statuses.push('Neu');
    if(stayNames.has(name)) statuses.push('Aufenthalt geändert');
    if(roommateNames.has(name)) statuses.push('Zimmerpartner geändert');
    if(dispositionNames.has(name)) statuses.push('Disposition prüfen');
    if(rowNumber && technicalRows.has(rowNumber)) statuses.push('Stammdaten prüfen');
    return statuses;
  };
  const peopleRows = preview?.people.map(p => {
    const status: SingleRoomStatus = approvedPersonKeys.has((p as FisImportPreviewPersonWithKey).matchKey)
      ? 'APPROVED_EXTRA'
      : p.singleRoomEntitlement === 'IN_QUOTA' ? 'IN_QUOTA'
        : p.singleRoomEntitlement === 'APPROVAL_REQUIRED' ? 'PENDING_APPROVAL' : 'NONE';
    const entitlement = status === 'NONE' ? '—' : <SingleRoomStatusBadge status={status}/>;
    const name=`${p.firstname} ${p.lastname}`;
    return [name, p.nationCode, p.discipline || '—', p.function || '—', entitlement, importStatuses(statusesFor(name,p.rowNumber,p.operation))];
  }) ?? [];
  const roomRows = preview?.rooms.map(r => {
    const people = preview.people.filter(person => [r.person1Name, r.person2Name].filter(Boolean).includes(`${person.firstname} ${person.lastname}`));
    const statuses=people.flatMap(person=>statusesFor(`${person.firstname} ${person.lastname}`, r.rowNumber, person.operation));
    return [r.person1Name, r.person2Name || '—', r.roomType, [r.checkInDate, r.checkOutDate].filter(Boolean).join(' → ') || '—', importStatuses(statuses)];
  }) ?? [];

  return <div className="h-full min-h-0 bg-[var(--ops-background)] text-[var(--ops-text)]">
    <SplitPageLayout className="flex h-full min-h-0 flex-col gap-5 space-y-0">
      <PageHeader eyebrow="Operations Center" title="Import Center" subtitle="FIS-Importsessions prüfen, entscheiden und kontrolliert abschließen." meta={selected ? <><StatusChip tone={selected.errors ? 'error' : selected.warnings ? 'warning' : 'success'}>{IMPORT_SESSION_STATUS[selected.status]}</StatusChip><span className="text-sm text-[var(--ops-text-muted)]">IS-{selected.id} · {selected.nation} · {selected.discipline}</span></> : <StatusChip tone="primary">Neue Importsession</StatusChip>} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 xl:flex-row">
        <ImportQueue sessions={sessions} selectedId={selected?.id ?? null} isCreating={!selected} onCreate={createSession} onSelect={selectSession} />
        <ContentCard surface="raised" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">
            {!selected ? <NewSessionWorkspace files={files} preview={preview} loading={loading} error={error} success={success} onFiles={handleFiles} onPreview={runPreview} onCancel={cancel} /> : <>
            <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] px-5 py-4">
              <div><SectionHeader title="Importprüfung" /><h2 className="mt-1 text-xl font-extrabold">{selected.nation} · {selected.discipline}</h2><p className="text-xs text-[var(--ops-text-muted)]">IS-{selected.id} · {selected.uploadedAt} · {selected.uploadedBy} · Version {selected.currentVersion?.version ?? 0}</p></div>
              <div className="flex items-center gap-3"><StatusChip tone={selected.status === 'IMPORTED' ? 'success' : selected.approvals.some(a => a.decision === 'PENDING') ? 'warning' : 'primary'}>{IMPORT_SESSION_STATUS[selected.status]}</StatusChip><SessionPrimaryAction session={selected} preview={preview} files={files} loading={loading} confirming={confirming} onPreview={runPreview} onOpenTask={setActiveTask} onApprove={approve} onImport={confirm}/>{!['IMPORTED','ARCHIVED','REPLACED','CANCELLED'].includes(selected.status)&&<span className="ml-4 border-l border-[var(--ops-divider)] pl-4"><OpsButton onClick={abortSession} disabled={confirming} className="border-[var(--ops-tone-warning-border)] bg-transparent text-[var(--ops-warning)] hover:bg-[var(--ops-tone-warning-surface)]"><XCircle className="mr-2 inline h-4 w-4"/>Workflow abbrechen</OpsButton></span>}</div>
            </div>
            <div className="space-y-4 p-5">
              <SessionUploadWorkspace session={selected} files={files} preview={preview} onFiles={handleFiles} onCancel={cancel}/>
              <Workflow session={selected} />
              {error && <InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}
              <NextAction session={selected} success={success}/>
              {preview && <ImportChangeSummary preview={preview} onNavigate={href=>navigate(href)}/>}
              <ProblemList preview={preview} fallback={selected} onOpen={openIssues}/>
              <PreviewCard peopleRows={peopleRows} roomRows={roomRows} onOpen={setDetail}/>
              <SessionHistory session={selected} onShowDecision={setShownDecisionId}/>
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
    <Snackbar open={duplicateNotice} autoHideDuration={7000} onClose={()=>setDuplicateNotice(false)} anchorOrigin={{vertical:'top',horizontal:'center'}}><Alert severity="info" variant="filled" onClose={()=>setDuplicateNotice(false)}><strong>Diese Meldeliste wurde bereits importiert.</strong><br/>Es wurde keine neue Version erzeugt.</Alert></Snackbar>
  </div>;
}

function NewSessionWorkspace({files,preview,loading,error,success,onFiles,onPreview,onCancel}:{files:File[];preview:FisImportPreview|null;loading:boolean;error:string|null;success:string|null;onFiles:(files:FileList|null)=>void;onPreview:()=>void;onCancel:()=>void}) { return <>
  <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] p-5"><div><SectionHeader title="Importprüfung"/><h2 className="mt-2 text-2xl font-extrabold">Neue Importsession</h2><p className="text-sm text-[var(--ops-text-muted)]">FIS-Dateien hochladen und vor dem Import gemeinsam prüfen.</p></div><OpsButton onClick={onPreview} disabled={files.length<2||loading}>{loading?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 inline h-4 w-4"/>}Dateien prüfen</OpsButton></div>
  <div className="space-y-4 p-5"><UploadWorkspace files={files} preview={preview} onFiles={onFiles} onCancel={onCancel}/><Workflow session={null}/>{preview&&<ImportChangeSummary preview={preview} onNavigate={()=>{}}/>} {error&&<InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}{success&&<InfoPanel tone="success" title="Import abgeschlossen">{success}</InfoPanel>}</div>
</>; }

function UploadWorkspace({files,preview,onFiles,onCancel}:{files:File[];preview:FisImportPreview|null;onFiles:(files:FileList|null)=>void;onCancel:()=>void}) { return <div className="grid items-start gap-4 lg:grid-cols-2"><UploadCard files={files} onChange={onFiles}/><SelectedFiles files={files} preview={preview} onCancel={onCancel}/></div>; }

function SessionUploadWorkspace({session,files,preview,onFiles,onCancel}:{session:ImportSession;files:File[];preview:FisImportPreview|null;onFiles:(files:FileList|null)=>void;onCancel:()=>void}) { const nextVersion=(session.currentVersion?.version ?? 0)+1; const expectsFiles=['DRAFT','WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED','IMPORTED'].includes(session.status); return <details open={expectsFiles||files.length>0||!preview} className="group"><summary className="mb-2 flex cursor-pointer items-center justify-between"><p className="text-xs font-bold text-[var(--ops-text-muted)]">Neue Importsession · nächste Meldeliste wird als Version {nextVersion} geprüft.</p><StatusChip tone="neutral">Version {nextVersion}</StatusChip></summary><UploadWorkspace files={files} preview={preview} onFiles={onFiles} onCancel={onCancel}/></details>; }

function SelectedFiles({files,preview,onCancel}:{files:File[];preview:FisImportPreview|null;onCancel:()=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Ausgewählte Dateien" subtitle="Dateien für die nächste Prüfung"/><div className="mt-3 space-y-2">{files.length?files.map(file=><div key={file.name} className="flex items-center justify-between rounded-lg bg-[var(--ops-surface)] px-3 py-2 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0"/><span className="truncate">{file.name}</span></span><span className="font-mono text-xs text-[var(--ops-text-muted)]">{(file.size/1024).toFixed(1)} KB</span></div>):<EmptyState title="Noch keine Dateien" description="Beide FIS-Dateien gemeinsam hochladen."/>}</div><div className="mt-3"><OpsButton onClick={onCancel} disabled={!files.length}><RefreshCcw className="mr-2 inline h-4 w-4"/>Auswahl zurücksetzen</OpsButton></div></ContentCard>; }

function ImportChangeSummary({preview,onNavigate}:{preview:FisImportPreview;onNavigate:(href:string)=>void}) {
  const categories = preview.dispositionAnalysis.categories;
  const items = [
    [categories.stayChanged?.count || 0, 'Aufenthalt geändert', '/assignments?workflow=review&importChange=stay'],
    [categories.roommateAffected?.count || 0, 'Zimmerpartner geändert', '/assignments?workflow=review&importChange=roommate'],
    [categories.newAthletes?.count || 0, 'neue Athleten', '/athletes?status=new'],
    [categories.hotelAssignmentAffected?.count || 0, 'Hotelzuweisungen betroffen', '/assignments?workflow=review'],
  ] as const;
  const disposition = categories.dispositionAffected?.count || 0;
  return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Erkannte Änderungen" subtitle="Dieselbe Statussprache führt von der Importprüfung direkt in die Disposition."/><div className="mt-3 flex flex-wrap gap-2">{items.filter(([count])=>count>0).map(([count,label,href])=><button type="button" key={label} onClick={()=>onNavigate(href)} className="rounded-full focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]"><StatusChip tone="neutral">{count} {label} →</StatusChip></button>)}{disposition>0&&<button type="button" onClick={()=>onNavigate('/assignments?workflow=review')}><AssignmentStatusChip status="review" /></button>}{items.every(([count])=>count===0)&&<StatusChip tone="success">Keine operativen Änderungen</StatusChip>}</div></ContentCard>;
}

function visibleWorkflow(session: ImportSession | null): WorkflowStep[] {
  if (!session) return [{ id: 'validation', label: 'Technische Validierung', complete: false, current: true }, { id: 'decision', label: 'Entscheidung (falls erforderlich)', complete: false, current: false }, { id: 'approval', label: 'Freigeben', complete: false, current: false }, { id: 'import', label: 'Importieren', complete: false, current: false }];
  const status = session.status;
  const imported = status === 'IMPORTED';
  const validationComplete = status !== 'DRAFT';
  const pendingDecisions = session.approvals.some(item => item.decision === 'PENDING');
  const approved = ['APPROVED', 'IMPORTED'].includes(status);
  const clarification = ['WAITING_FOR_NATION', 'NATION_CLARIFICATION', 'RECHECK_REQUIRED'].includes(status);
  return [
    { id: 'validation', label: 'Technische Validierung', complete: validationComplete, current: !validationComplete },
    { id: 'decision', label: 'Entscheidung (falls erforderlich)', complete: validationComplete && !pendingDecisions && !clarification, current: validationComplete && (pendingDecisions || clarification) },
    { id: 'approval', label: 'Freigeben', complete: approved, current: !approved && !pendingDecisions && !clarification && validationComplete },
    { id: 'import', label: 'Importieren', complete: imported, current: status === 'APPROVED' },
  ];
}

function Workflow({session}:{session:ImportSession|null}) {
  const steps = visibleWorkflow(session);
  return <ContentCard surface="elevated" className="p-3"><SectionHeader title="Importworkflow" subtitle="Status der aktuellen Importsession"/><ol className="mt-3 flex items-stretch">{steps.map((step,index)=><li key={step.id} className="flex min-w-0 flex-1 items-center"><div aria-current={step.current?'step':undefined} className={`flex min-h-14 w-full items-center gap-2 rounded-lg border px-3 py-2 ${step.current?'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)] ring-1 ring-[var(--ops-primary)]':step.complete?'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]':'border-[var(--ops-border)] bg-[var(--ops-surface)]'}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${step.complete?'bg-[var(--ops-primary)] text-white':'bg-[var(--ops-surface-overlay)] text-[var(--ops-text-muted)]'}`}>{step.complete?<CheckCircle className="h-3.5 w-3.5"/>:index+1}</span><div className="min-w-0"><div className="truncate text-xs font-extrabold">{step.label}</div>{step.current&&<div className="text-[10px] font-bold text-[var(--ops-primary-emphasis)]">Aktueller Status</div>}</div></div>{index<steps.length-1&&<ChevronRight className="mx-1 h-4 w-4 shrink-0 text-[var(--ops-text-subtle)]"/>}</li>)}</ol></ContentCard>;
}

function SessionPrimaryAction({session,preview,files,loading,confirming,onPreview,onOpenTask,onApprove,onImport}:{session:ImportSession;preview:FisImportPreview|null;files:File[];loading:boolean;confirming:boolean;onPreview:()=>void;onOpenTask:(task:OperationsTask)=>void;onApprove:()=>void;onImport:()=>void}) {
  const pending=session.approvals.map(approval=>buildOperationsTask(session,approval)).filter(task=>task.approval.decision==='PENDING');
  const needsFiles=['DRAFT','WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED'].includes(session.status);
  const canApprove=Boolean(preview?.isValid)&&session.approvals.every(a=>a.decision==='APPROVED')&&['PROFESSIONALLY_REVIEWED','READY_FOR_IMPORT','WAITING_FOR_NATION','NATION_CLARIFICATION','NEW_LIST_RECEIVED','EXCEPTION_APPROVED'].includes(session.status);
  if(pending.length) return <OpsButton onClick={()=>onOpenTask(pending[0])}>Entscheidung öffnen</OpsButton>;
  if(session.status==='APPROVED') return <OpsButton onClick={onImport} disabled={confirming} className="border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]"><CheckCircle className="mr-2 inline h-4 w-4"/>Importieren</OpsButton>;
  if(files.length>=2 || session.status==='IMPORTED' || needsFiles) return <OpsButton onClick={onPreview} disabled={files.length<2||loading}>{loading?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 inline h-4 w-4"/>}Dateien prüfen</OpsButton>;
  return <OpsButton onClick={onApprove} disabled={!canApprove}>Freigeben</OpsButton>;
}

function NextAction({session,success}:{session:ImportSession;success:string|null}) {
  const pending=session.approvals.filter(approval=>approval.decision==='PENDING').length;
  const clarification=['WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED'].includes(session.status);
  if(pending) return <InfoPanel tone="warning" title="Entscheidung erforderlich">{pending} {pending===1?'offene Entscheidung muss':'offene Entscheidungen müssen'} vor der Freigabe abgeschlossen werden.</InfoPanel>;
  if(session.status==='IMPORTED') return <InfoPanel tone="success" title="Import abgeschlossen">{success ?? `Die Importsession ist abgeschlossen. Im Uploadbereich kann eine neue Meldeliste als Version ${(session.currentVersion?.version ?? 0)+1} geprüft werden.`}</InfoPanel>;
  if(session.status==='APPROVED') return <InfoPanel tone="success" title="Freigegeben">Die Importsession ist bereit für den kontrollierten Import.</InfoPanel>;
  if(clarification) return <InfoPanel tone="warning" title="Klärung erforderlich">Die fachliche Klärung oder eine neue Meldeliste ist erforderlich, bevor freigegeben werden kann.</InfoPanel>;
  return <InfoPanel tone="info" title="Prüfung abgeschlossen">Alle Prüfungen und erforderlichen Entscheidungen sind abgeschlossen.</InfoPanel>;
}
function SessionHistory({session,onShowDecision}:{session:ImportSession;onShowDecision:(id:string)=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Historie" subtitle={`${session.versions?.length ?? 0} Version(en) · kompakter Session-Verlauf`}/><div className="mt-4 space-y-3">{session.history?.length ? [...session.history].reverse().map(event=>{const content=<><Clock3 className="mt-0.5 h-4 w-4 text-[var(--ops-text-subtle)]"/><div><div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{event.title}</span><span className="font-mono text-xs text-[var(--ops-text-subtle)]">{new Date(event.timestamp).toLocaleString('de-DE')} · {event.user}</span></div>{event.description&&<p className="mt-1 text-sm text-[var(--ops-text-muted)]">{event.description}</p>}</div></>;return event.decisionId?<button key={event.id} type="button" onClick={()=>onShowDecision(event.decisionId!)} className="grid w-full grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3 text-left transition hover:text-[var(--ops-primary)]">{content}</button>:<div key={event.id} className="grid grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3">{content}</div>}):<EmptyState title="Noch keine Historieneinträge" description="Versionen, Entscheidungen und Freigaben werden automatisch protokolliert."/>}</div></ContentCard>; }
function UploadCard({files,onChange}:{files:File[];onChange:(f:FileList|null)=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Neue Importsession" subtitle="Beide Dateien in einem Schritt auswählen"/><label className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-[var(--ops-border-strong)] bg-[var(--ops-surface)] p-6 text-center hover:bg-[var(--ops-tone-primary-surface)]"><input id="fis-files-input" type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={e=>onChange(e.target.files)}/><Upload className="mx-auto h-8 w-8 text-[var(--ops-primary)]"/><p className="mt-2 font-bold">{files.length ? `${files.length} Datei(en) ausgewählt` : 'Dateien auswählen oder ablegen'}</p><p className="mt-1 text-xs text-[var(--ops-text-muted)]">{REQUIRED_FILE_HINTS.join(' + ')}</p></label></ContentCard>; }
function ProblemList({preview,fallback,onOpen}:{preview:FisImportPreview|null;fallback:ImportSession;onOpen:(t:string,i:FisImportIssue[])=>void}) {
  const blocking=preview?.errors??[];
  if (blocking.length===0 && fallback.errors===0) return null;
  return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Prüfergebnis" subtitle="Kurzübersicht; Details öffnen sich nur bei Bedarf"/><div className="mt-3 space-y-2">
    {blocking.length>0&&<SummaryRow label="Blockierende Fehler" count={blocking.length} tone="error" onClick={()=>onOpen('Blockierend',blocking)}/>}
  </div></ContentCard>;
}
type FisImportPreviewPersonWithKey = FisImportPreview['people'][number] & { matchKey?: string };
function PreviewCard({peopleRows,roomRows,onOpen}:{peopleRows:ReactNode[][];roomRows:ReactNode[][];onOpen:(detail:Detail)=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Importvorschau" subtitle="Die vollständigen Inhalte der beiden Excel-Dateien prüfen"/><div className="mt-4 grid gap-3 sm:grid-cols-2"><SummaryRow label="Personen" count={peopleRows.length} onClick={()=>onOpen({title:'Personen der Importvorschau',subtitle:`${peopleRows.length} Personen`,rows:peopleRows,headers:['Name','Nation','Disziplin','Funktion','Einzelzimmerstatus','Importstatus']})}/><SummaryRow label="Zimmerzuordnungen" count={roomRows.length} onClick={()=>onOpen({title:'Zimmer der Importvorschau',subtitle:`${roomRows.length} Zimmerzuordnungen`,rows:roomRows,headers:['Person 1','Person 2','Zimmer','Aufenthalt','Importstatus']})}/></div></ContentCard>; }
function SummaryRow({label,count,tone='neutral',disabled,onClick}:{label:string;count:number;tone?:'neutral'|'success'|'warning'|'error';disabled?:boolean;onClick:()=>void}) { return <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center justify-between rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2.5 text-left transition hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-overlay)] disabled:cursor-default disabled:opacity-70"><span className="flex items-center gap-2 text-sm font-bold">{tone==='error'?<AlertTriangle className="h-4 w-4 text-[var(--ops-error)]"/>:tone==='success'?<CheckCircle className="h-4 w-4 text-[var(--ops-success)]"/>:<Users className="h-4 w-4 text-[var(--ops-text-subtle)]"/>}{label}</span><span className="flex items-center gap-2"><StatusChip tone={tone}>{count}</StatusChip><ChevronRight className="h-4 w-4 text-[var(--ops-text-subtle)]"/></span></button>; }
const issueCopy:Record<string,{message:string;causes?:string[];action:string}>={
  ENTRY_MISSING_COLUMNS:{message:'Die ENTRIES-LIST hat eine fehlerhafte Excel-Struktur: Pflichtspalten fehlen.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ROOM_MISSING_COLUMNS:{message:'Die Zimmerliste hat eine fehlerhafte Excel-Struktur: Pflichtspalten fehlen.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ENTRY_DUPLICATE_PERSON:{message:'Eine Person ist mehrfach in der Meldeliste enthalten.',action:'Bitte die doppelte Person durch den Verband korrigieren lassen.'},
  ENTRY_INVALID_ARRIVAL_DATE:{message:'Das Anreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ENTRY_INVALID_DEPARTURE_DATE:{message:'Das Abreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ENTRY_INVALID_STAY_RANGE:{message:'Das Abreisedatum liegt vor dem Anreisedatum.',action:'Bitte die Aufenthaltsdaten durch den Verband korrigieren lassen.'},
  ROOM_PERSON_NOT_FOUND:{message:'Neue Person erkannt.',action:'Die Person wird beim Import neu angelegt.'},
  ROOM_PARTNER_NOT_FOUND:{message:'Neue Person als Zimmerpartner erkannt.',action:'Die Person wird beim Import neu angelegt.'},
  ROOM_INVALID_ARRIVAL_DATE:{message:'Das Anreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'}, ROOM_INVALID_DEPARTURE_DATE:{message:'Das Abreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ROOM_INVALID_STAY_RANGE:{message:'Die Abreise liegt vor der Anreise.',action:'Bitte die Aufenthaltsdaten durch den Verband korrigieren lassen.'}, ROOM_DAY_VALUE_NOT_NUMERIC:{message:'Die Zimmerbelegung enthält einen ungültigen Wert.',action:'Keine Aktion erforderlich'}, ROOM_NO_DAY_OVERLAP:{message:'Der Aufenthalt liegt außerhalb des gemeldeten Zeitraums.',action:'Keine Aktion erforderlich'},
};
const detailLabels:Record<string,string>={firstname:'Vorname',lastname:'Nachname',nationCode:'Nation',discipline:'Disziplin',gender:'Gender',hotel:'Hotel',roomType:'Zimmertyp',sharedWithName:'Zimmerpartner',sharedWithNationcode:'Nation',arrivalDate:'Anreise',departureDate:'Abreise',value:'Wert'};
function displayValue(value:unknown):string { if(value===null||value===undefined||value==='')return 'Noch zu ermitteln'; if(Array.isArray(value))return value.map(displayValue).join(', '); if(typeof value==='object')return Object.entries(value as Record<string,unknown>).map(([key,item])=>`${detailLabels[key]??key}: ${displayValue(item)}`).join(' · '); return String(value); }
function RecordSection({title,children}:{title:string;children:ReactNode}) { return <section><h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-[var(--ops-text-subtle)]">{title}</h3><div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4">{children}</div></section>; }
function IssueRecord({issue,isInformation,isDecision}:{issue:FisImportIssue;isInformation:boolean;isDecision:boolean}) { const copy=issueCopy[issue.code]; const detected=/discipline/i.test(issue.code); return <article className="space-y-4"><RecordSection title="1. Was ist passiert?"><p className="font-bold">{detected?'Disziplin automatisch erkannt':copy?.message??issue.message}</p>{detected&&<p className="mt-2 text-sm text-[var(--ops-text-muted)]">Erkannt: {displayValue(issue.details?.discipline??issue.details?.value)} · Quelle: Dateiname</p>}</RecordSection>{Object.keys(issue.details??{}).length>0&&<RecordSection title="2. Betroffene Daten"><div className="grid gap-3 sm:grid-cols-2">{Object.entries(issue.details??{}).map(([key,value])=><div key={key}><div className="text-xs font-bold text-[var(--ops-text-subtle)]">{detailLabels[key]??key}</div><div className="font-semibold">{displayValue(value)}</div></div>)}</div></RecordSection>}<RecordSection title="3. Auswirkung"><div className="flex gap-2 font-bold">{isInformation?<CheckCircle className="h-5 w-5 text-[var(--ops-success)]"/>:<AlertTriangle className="h-5 w-5 text-[var(--ops-warning)]"/>}{isInformation?'Keine Aktion notwendig':isDecision?'Fachliche Entscheidung erforderlich':'Import ist bis zur Korrektur blockiert'}</div></RecordSection><InfoPanel tone={isInformation?'success':'info'} title="Was ist jetzt zu tun?">{isInformation?'Keine Aktion erforderlich':copy?.action??'Bitte eine korrigierte Meldeliste beim Verband anfordern.'}</InfoPanel></article>; }
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
