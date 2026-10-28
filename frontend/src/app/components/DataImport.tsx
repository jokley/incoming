import {importListFilters,personMatchesImportFilter,roomMatchesImportFilter,roomNeedsPartner,personMatchesQuotaFilter,type QuotaPeopleFilter,type ImportListFilter} from '../services/importHints';
import {ImportPersonDialog,visibleControlIssues} from './ImportControl';
import type {ImportControl} from '../types';
import { useActiveEvent, useActiveEventBlocker } from '../events/ActiveEventProvider';
import { AccommodationRateProvenance } from './AthleteTariffSelection';
import { QuotaOverviewDialog, AthleteQuotaPreviewStatus } from './QuotaOverviewDialog';
import { ImportChangePlan } from './ImportChangePlan';
import { canConfirmReview, importReviewRequest } from '../services/importReview';
import { AccommodationRequirementField } from './AccommodationRequirementField';
import { AccommodationRateField } from './AccommodationRate';
import type { SingleRoomQuotaExemptReason } from '../types';
import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Dialog, DialogContent, DialogTitle, Tooltip } from '@mui/material';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Clock3, Crown, FileCheck2, FileText, Loader2, RefreshCcw, Upload, XCircle } from 'lucide-react';

import { api } from '../services/api';
import { canonicalSessionState, currentPreviewDetail } from '../services/importPreview';
import { importConfirmationMessage, reloadImportSession } from '../services/importConfirmation';
import { competitionDisplayName, previewEventGroupLabel } from '../services/competitionPresentation';
import type { FisImportIssue, FisImportPreview, ImportChange } from '../types';
import { IMPORT_SESSION_STATUS, type ImportSession } from '../data/importSessions';
import { ContentCard, EmptyState, InfoPanel, OpsButton, PageHeader, SplitPageLayout, SectionHeader, StatusChip } from '../design-system';
import { ImportQueue } from './ImportQueue';
import { buildOperationsTask, OperationsDecisionDialog, OperationsTaskRow, type OperationsTask } from './OperationsDecisionDialog';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import { ActivitySummaryCard } from './activity';
import { SingleRoomStatusBadge, type SingleRoomStatus } from './SingleRoomStatusBadge';

const REQUIRED_FILE_HINTS = ['ENTRIES-LIST', 'ENTRIES-ROOM-LIST-DETAILED'];
type WorkflowStep = { id: string; label: string; complete: boolean; current: boolean };
type Detail = { title: string; subtitle?: string; issues?: FisImportIssue[]; rows?: ReactNode[][]; headers?: string[] };

const PEOPLE_HEADERS=['Name','Nation','Disziplin','Funktion','Unterkunftsbedarf','Unterkunftstarif','EZ-Status','Importstatus'];

type VisibleImportStatus = 'Neu' | 'Entfernt' | 'Aufenthalt geändert' | 'Zimmerpartner geändert' | 'Zimmer erstellt' | 'Zimmer entfernt' | 'Disposition prüfen' | 'Stammdaten prüfen';
const statusTone: Record<VisibleImportStatus, 'primary'|'info'|'warning'|'error'> = {
  Neu: 'primary', Entfernt: 'warning', 'Aufenthalt geändert': 'info', 'Zimmerpartner geändert': 'primary',
  'Zimmer erstellt': 'primary', 'Zimmer entfernt': 'warning',
  'Disposition prüfen': 'warning', 'Stammdaten prüfen': 'error',
};
const importStatuses = (statuses: VisibleImportStatus[]) => statuses.length ? <span className="flex flex-wrap gap-1">{[...new Set(statuses)].map(status => <StatusChip key={status} tone={statusTone[status]}>{status}</StatusChip>)}</span> : null;

export function DataImport() {
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<ImportSession | null>(null);
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<FisImportPreview | null>(null);
  const [loading, setLoading] = useState(false), [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const [personKey,setPersonKey]=useState<string|null>(null);
  const [personFilter,setPersonFilter]=useState<ImportListFilter>('all');
  const [personSearch,setPersonSearch]=useState('');
  const [quotaPeopleFilter,setQuotaPeopleFilter]=useState<QuotaPeopleFilter|null>(null);
  useEffect(()=>{setPersonKey(null);setPersonFilter('all');setPersonSearch('');setQuotaPeopleFilter(null);},[selected?.id,selected?.currentVersionId]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [activeTask, setActiveTask] = useState<OperationsTask | null>(null);
  const [shownDecisionId, setShownDecisionId] = useState<string | null>(searchParams.get('decisionId'));
  const [savingTask, setSavingTask] = useState(false);
  const [destructiveConfirmed,setDestructiveConfirmed]=useState(false);
  useEffect(()=>{setDestructiveConfirmed(false);},[preview?.changePlan?.digest]);
  const { eventId, selectedEvent } = useActiveEvent();
  useActiveEventBlocker(Boolean(selected || preview || files.length || loading || confirming || savingTask), 'Bitte den laufenden Import-Review zuerst abschließen oder verlassen.');

  const refreshSessions = async () => setSessions(await api.getImportSessions());
  useEffect(() => { setShownDecisionId(searchParams.get('decisionId')); }, [searchParams]);
  useEffect(() => { (async () => { try { const loaded = await api.getImportSessions(); setSessions(loaded); const requested = searchParams.get('sessionId'); const requestedDecision = searchParams.get('decisionId'); const match = requested ? loaded.find(session => session.id === requested) : requestedDecision ? loaded.find(session => session.approvals.some(approval => String(approval.id) === requestedDecision)) : undefined; if (match) await selectSession(match); } catch(e) { setError(e instanceof Error ? e.message : 'Sessions konnten nicht geladen werden'); } })(); }, []);
  const selectSession = async (session: ImportSession) => {
    setLoading(true);
    try {
      const full = await api.getImportSession(session.id);
      if (full.preview?.eventId && String(full.preview.eventId) !== eventId) throw new Error('Importsession gehört zu einem anderen Event.');
      setSelected(full); setPreview(full.preview ?? null); setFiles([]); setSuccess(null);
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Importsession konnte nicht geladen werden.'); }
    finally { setLoading(false); }
  };
  const createSession = () => { setSelected(null); setPreview(null); setSuccess(null); setError(null); };
  const handleFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return; const accepted = Array.from(incoming).filter(f => /\.xlsx?$/i.test(f.name));
    if (!accepted.length) { setError('Bitte Excel-Dateien (.xlsx, .xls) hochladen.'); return; }
    setFiles([...new Map(accepted.map(f => [f.name.toLowerCase(), f])).values()]); setPreview(null); setSuccess(null); setError(null);
  };
  const cancel = () => { setFiles([]); if (!selected) setPreview(null); setError(null); setSuccess(null); const input = document.getElementById('fis-files-input') as HTMLInputElement | null; if (input) input.value = ''; };
  const runPreview = async () => { if (files.length < 2 || !eventId) return; setLoading(true); setError(null); setSuccess(null); setPreview(null); try { const result = await api.previewFisImport(files, !selected, selected?.id, eventId); setPreview(result); if(result.knownFiles)setSuccess(result.message ?? 'Bekannte Dateien erneut geprüft.'); if (result.session) { setSelected({...result.session, preview: result}); setFiles([]); await refreshSessions(); } } catch (e) { setError(e instanceof Error ? e.message : 'Preview fehlgeschlagen'); } finally { setLoading(false); } };
  const abortSession = async () => { if (!selected) return; setConfirming(true); setError(null); try { const restored=await api.cancelImportSession(selected.id,selected.currentVersionId); setSelected(restored.status==='IMPORTED'?restored:null); setPreview(restored.status==='IMPORTED'?restored.preview??null:null); setFiles([]); setSuccess('Aktuelle Prüfversion abgebrochen. Frühere Imports, Personen und Genehmigungen bleiben erhalten.'); await refreshSessions(); } catch(e) { setError(e instanceof Error ? e.message : 'Importsession konnte nicht abgebrochen werden'); } finally { setConfirming(false); } };
  const approve = async () => { if (!selected || !canConfirmReview(preview?.changePlan,destructiveConfirmed,preview?.planStale)) return; setConfirming(true); setError(null); try { const updated = canonicalSessionState(await api.approveImportSession(selected.id, importReviewRequest(preview?.changePlan,destructiveConfirmed,preview?.planStale))); setSelected(updated.selected); setPreview(updated.preview); await refreshSessions(); } catch(e) { if(e && typeof e==='object' && 'error' in e && e.error==='STALE_PREVIEW')setPreview(p=>p?{...p,planStale:true}:p); setError(e instanceof Error ? e.message : 'Freigabe fehlgeschlagen'); } finally { setConfirming(false); } };
  const confirm = async () => { if (!selected || selected.status !== 'APPROVED') return; setConfirming(true); setError(null); setSuccess(null); try { const result = await api.importSession(selected.id,selected.currentVersionId); setSuccess(importConfirmationMessage(result)); const [updated, loaded] = await reloadImportSession(selected.id, api); setSelected(updated); setPreview(updated.preview ?? null); setSessions(loaded); } catch (e) { if(e && typeof e==='object' && 'error' in e && e.error==='STALE_PREVIEW')setPreview(p=>p?{...p,planStale:true}:p); setError(e instanceof Error ? e.message : 'Import fehlgeschlagen'); } finally { setConfirming(false); } };
  const recheck = async () => {if(!selected)return;setConfirming(true);setError(null);try{const updated=await api.recheckImportSession(selected.id);setSelected(updated);setPreview(updated.preview??null);await refreshSessions();}catch(e){setError(e instanceof Error?e.message:'Erneute Prüfung fehlgeschlagen');}finally{setConfirming(false);}};
  const saveTask = async (payload: {decision:'APPROVED'|'NEW_LIST_ANNOUNCED'; comment:string; approvalType?:'NATION_APPROVED'|'ORGANIZER_APPROVED'; approvalMethod:'EMAIL'|'PHONE'; approvalBy:string; approvalDate:string; contactSubject?:string; costCoverage?:string; deadlineAt?:string; approvedPersonKeys?:string[];tariffEffect?:'NONE'|'SPECIAL_SELECTED';approvedExtent?:import('../types').QuotaExtent}) => {
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

  const setPreviewRequirement = async (personKey:string, accommodationRequirement:'REQUIRED'|'NO_ROOM'|null) => {
    if(!selected)return;
    setSavingTask(true);setError(null);
    try {const updated=await api.stageAccommodationRequirement(selected.id,personKey,accommodationRequirement);setSelected(updated);setPreview(updated.preview??null);await refreshSessions();}
    catch(e){setError(e instanceof Error ? e.message : 'Unterkunftsbedarf konnte nicht gespeichert werden.');}
    finally {setSavingTask(false);}
  };
  const setPreviewRate = async (personKey:string, category:'STANDARD'|'SPECIAL') => {
    if(!selected)return;
    setSavingTask(true);setError(null);
    try {const updated=await api.stageAccommodationRate(selected.id,personKey,category);setSelected(updated);setPreview(updated.preview??null);await refreshSessions();}
    catch(e){setError(e instanceof Error ? e.message : 'Tarif konnte nicht gespeichert werden.');}
    finally {setSavingTask(false);}
  };
  const setPreviewExemption = async (personKey: string, reason: string, refreshDialog = false) => {
    if (!selected) return;
    setSavingTask(true); setError(null);
    try {
      const updated = await api.stageSingleRoomQuotaExemption(selected.id, personKey, (reason || null) as SingleRoomQuotaExemptReason);
      setSelected(updated); setPreview(updated.preview ?? null);
      if (refreshDialog && activeTask) {
        const pending = updated.approvals.find(approval => approval.decision === 'PENDING'
          && approval.quotaDetails?.singleRoomCandidates
          && approval.quotaDetails?.discipline === activeTask?.approval.quotaDetails?.discipline
          && approval.quotaDetails?.gender === activeTask?.approval.quotaDetails?.gender);
        setActiveTask(pending ? buildOperationsTask(updated, pending) : null);
        if (!pending) setSuccess('Quote nach Sonderstatus erfüllt. Keine Genehmigung mehr erforderlich.');
      }
      await refreshSessions();
    }
    catch (error) { setError(error instanceof Error ? error.message : 'EZ-Sonderstatus konnte nicht gespeichert werden.'); }
    finally { setSavingTask(false); }
  };
  const changes = preview?.dispositionAnalysis.changes ?? [];
  const statusesFor = (previewArea:ImportChange['preview'],entityId:string,rowNumber?:number,operation?:'create'|'update'):VisibleImportStatus[] => {
    const statuses:VisibleImportStatus[]=[];
    // Row numbers and business identifiers can overlap between the two Excel
    // files.  Never let a person change leak into a room (or vice versa).
    const matching=changes.filter(change=>change.preview===previewArea&&(change.entityId===entityId || (rowNumber && change.entityId===String(rowNumber))));
    if(operation==='create' || matching.some(change=>change.type==='NEW_PERSON')) statuses.push('Neu');
    if(matching.some(change=>change.type==='STAY_CHANGED')) statuses.push('Aufenthalt geändert');
    if(matching.some(change=>change.type==='ROOMMATE_CHANGED')) statuses.push('Zimmerpartner geändert');
    if(matching.some(change=>change.type==='ROOM_CREATED')) statuses.push('Zimmer erstellt');
    if(matching.some(change=>change.type==='ROOM_REMOVED')) statuses.push('Zimmer entfernt');
    if(matching.some(change=>['SINGLE_ROOM_CHANGED','ROOMTYPE_CHANGED'].includes(change.type))) statuses.push('Disposition prüfen');
    if(matching.some(change=>['VALIDATION_ERROR','FUNCTION_CHANGED','COUNTRY_CHANGED'].includes(change.type))) statuses.push('Stammdaten prüfen');
    return statuses;
  };
  const peopleRows = preview?.people.map(p => {
    const status: SingleRoomStatus = p.singleRoomEntitlement === 'APPROVED_EXTRA'
      ? 'APPROVED_EXTRA'
      : p.singleRoomEntitlement === 'IN_QUOTA' ? 'IN_QUOTA'
        : p.singleRoomEntitlement === 'APPROVAL_REQUIRED' ? 'PENDING_APPROVAL' : 'NONE';
    const single = preview.rooms.some(room => [room.person1Key,room.person2Key].includes(p.matchKey) && room.roomType.toLowerCase() === 'single');
    const entitlement = <span className="inline-flex flex-wrap gap-1">{single && status !== 'IN_QUOTA' && <StatusChip tone="info">Einzelzimmer</StatusChip>}{status !== 'NONE' && <SingleRoomStatusBadge status={status}/>}</span>;
    const name=`${p.firstname} ${p.lastname}`;
    const personKey=String((p as FisImportPreviewPersonWithKey).matchKey??'');
    const exemption=p.function?.toLowerCase() === 'athlete' ? <button type="button" aria-label={`Weltmeisterstatus ${name}`} aria-pressed={p.singleRoomQuotaExemptReason === 'WORLD_CHAMPION'} disabled={!selected || savingTask || p.singleRoomQuotaExemptReason === 'OTHER' || ['APPROVED','IMPORTED'].includes(selected.status)} onClick={() => void setPreviewExemption(personKey,p.singleRoomQuotaExemptReason === 'WORLD_CHAMPION' ? '' : 'WORLD_CHAMPION',true)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1"><Crown className={`h-4 w-4 ${p.singleRoomQuotaExemptReason === 'WORLD_CHAMPION' ? 'text-amber-500 fill-amber-200' : ''}`}/>{p.singleRoomQuotaExemptReason === 'WORLD_CHAMPION' ? 'Weltmeister' : '—'}</button> : p.singleRoomQuotaExemptReason === 'OTHER' ? 'Historische EZ-Ausnahme' : '—';
    return [<div><button type="button" className="text-left font-bold text-[var(--ops-primary)] hover:underline" aria-label={`Importdetails ${name}`} onClick={()=>setPersonKey(personKey)}>{name} <span className="text-xs font-normal">Details →</span></button>{selected?.importControl&&visibleControlIssues(selected.importControl).filter(i=>i.kind!=='info'&&i.personKeys.includes(personKey)).map((issue,index)=><p key={index} title={`${issue.source??''}${issue.row?` · Zeile ${issue.row}`:''}`} className="ops-table-wrap mt-1 max-w-xs text-xs text-[var(--ops-warning)]">{issue.message}</p>)}</div>, p.nationCode, previewEventGroupLabel(p.quotaDisciplines), p.function || '—', <div className="w-[190px] max-w-full space-y-1"><AccommodationRequirementField compact sourceRoomType={p.roomType || "Keine Angabe"} label={`Unterkunftsbedarf ${name}`} person={p} disabled={!selected || savingTask || ['APPROVED','IMPORTED','ARCHIVED','REPLACED','CANCELLED'].includes(selected.status)} onChange={value=>void setPreviewRequirement(personKey,value)} onRelease={()=>void setPreviewRequirement(personKey,null)}/>{p.accommodationRequirementReviewRequired && <p className="text-xs">Unterkunftswunsch prüfen; unbekannte Werte bedeuten nicht No room.</p>}</div>, <div className="max-w-[220px] space-y-1"><AccommodationRateField dense compact label={`Unterkunftstarif ${name}`} value={p.accommodationRateCategory} disabled={!selected || savingTask || ['APPROVED','IMPORTED','ARCHIVED','REPLACED','CANCELLED'].includes(selected.status)} onChange={category=>void setPreviewRate(personKey,category)}/><AccommodationRateProvenance person={p}/></div>, <div key="ez" className="space-y-1">{exemption}{entitlement}</div>, importStatuses(statusesFor('persons',personKey,p.rowNumber,p.operation))];
  }) ?? [];
  preview?.dispositionAnalysis.categories.removedAthletes.records.forEach(record => {
    peopleRows.push([String(record.athlete??'—'),String(record.nation??'—'),competitionDisplayName(String(record.discipline ?? '')) || '—','—','—','—','—',importStatuses(['Entfernt'])]);
  });
  const filteredPeopleRows=peopleRows.filter((_,index)=>{
    const p=preview?.people[index];
    if(!p)return !quotaPeopleFilter&&personFilter==='all'&&!personSearch;
    return (`${p.firstname} ${p.lastname} ${p.function || ''}`.toLocaleLowerCase('de').includes(personSearch.toLocaleLowerCase('de')))
      && personMatchesImportFilter(p,personFilter,preview!,selected?.importControl)&&personMatchesQuotaFilter(p,quotaPeopleFilter);
  });
  const activePerson=preview?.people.find(p=>p.matchKey===personKey);
  const roomRows = preview?.rooms.map(r => {
    const statuses=statusesFor('rooms',r.sourceRowKey,r.rowNumber);
    const markers = [r.person1Key,r.person2Key].map(key => preview.people.find(p => (p as FisImportPreviewPersonWithKey).matchKey === key)).filter(Boolean).map(p => p?.accommodationRequirement==='NO_ROOM' ? 'No room · kein Unterkunftsbedarf' : p?.singleRoomQuotaExemptReason === 'WORLD_CHAMPION' ? '👑 Weltmeister' : p?.singleRoomEntitlement === 'APPROVED_EXTRA' ? 'Mehrpreis genehmigt' : p?.singleRoomEntitlement === 'APPROVAL_REQUIRED' ? '+EZ offen' : '').filter(Boolean);
    return [<div key="person">{r.person1Name}{roomNeedsPartner(r,selected?.importControl)&&<p className="ops-table-wrap text-xs text-[var(--ops-warning)]" title={`Room List · Zeile ${r.rowNumber}`}>Zimmerpartner ungeklärt · Zeile {r.rowNumber}</p>}{selected?.importControl?.issues.filter(i=>i.kind==='clarification'&&i.source==='Room List'&&i.row===r.rowNumber&&!/PARTNER/.test(i.code)).map((issue,index)=><p key={index} className="ops-table-wrap text-xs text-[var(--ops-warning)]">{issue.message} · Zeile {r.rowNumber}</p>)}</div>, r.person2Name || (roomNeedsPartner(r,selected?.importControl)?'Zimmerpartner fehlt':'—'), <span key="room-markers">{r.roomType}{markers.map((label,i) => <span key={i} className="ml-2 text-xs">{label}</span>)}</span>, [r.checkInDate, r.checkOutDate].filter(Boolean).join(' → ') || '—', importStatuses(statuses)];
  }) ?? [];
  const removedAssignments=new Set<string>();
  preview?.dispositionAnalysis.categories.dispositionAffected.records.forEach(record => {
    const assignmentId=String(record.assignmentId??'');
    if(!assignmentId||removedAssignments.has(assignmentId)||!changes.some(change=>change.preview==='rooms'&&change.type==='ROOM_REMOVED'&&change.entityId===assignmentId)) return;
    removedAssignments.add(assignmentId);
    roomRows.push([String(record.athlete??'—'),Array.isArray(record.roommates)?record.roommates.join(', '):'—',String(record.roomType??'—'),'—',importStatuses(['Zimmer entfernt'])]);
  });

  return <div className="min-h-full xl:h-full xl:min-h-0 bg-[var(--ops-background)] text-[var(--ops-text)]">
    <SplitPageLayout className="flex min-h-full flex-col gap-5 space-y-0 xl:h-full xl:min-h-0">
      <PageHeader eyebrow="Operations Center" title="Import Center" subtitle="FIS-Importsessions prüfen, entscheiden und kontrolliert abschließen." meta={selected ? <><StatusChip tone={selected.errors ? 'error' : selected.approvals.some(a => a.decision === 'PENDING') ? 'warning' : 'success'}>{IMPORT_SESSION_STATUS[selected.status]}</StatusChip><span className="text-sm text-[var(--ops-text-muted)]">IS-{selected.id} · {selected.nation} · {competitionDisplayName(selected.discipline)}</span></> : <StatusChip tone="primary">Neue Importsession</StatusChip>} />
      <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row">
        <ImportQueue sessions={sessions} selectedId={selected?.id ?? null} isCreating={!selected} onCreate={createSession} onSelect={selectSession} />
        <ContentCard surface="raised" className="min-w-0 shrink-0 overflow-hidden xl:min-h-0 xl:flex-1">
          <div className="xl:h-full xl:overflow-y-auto"><div className="border-b border-[var(--ops-divider)] p-5"><span className="text-sm text-[var(--ops-text-muted)]">Veranstaltung: <strong className="text-[var(--ops-text)]">{selectedEvent?.name}</strong></span></div>
            {!selected ? <NewSessionWorkspace files={files} preview={preview} loading={loading} error={error} success={success} onFiles={handleFiles} onPreview={runPreview} onCancel={cancel} /> : <>
            <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] px-5 py-4">
              <div><SectionHeader title="Importprüfung" /><h2 className="mt-1 text-xl font-extrabold">{selected.nation} - {competitionDisplayName(selected.discipline)}</h2><p className="text-xs text-[var(--ops-text-muted)]">IS-{selected.id} · {selected.uploadedAt} · {selected.uploadedBy} · Version {selected.currentVersion?.version ?? 0}</p></div>
              <StatusChip tone={selected.status === 'IMPORTED' ? 'success' : selected.approvals.some(a => a.decision === 'PENDING') ? 'warning' : 'primary'}>{IMPORT_SESSION_STATUS[selected.status]}</StatusChip>
            </div>
            <div className="space-y-4 p-5">
              <Workflow session={selected} actionStep={primaryActionStep(selected, files)} upload={<SessionUploadWorkspace session={selected} files={files} preview={preview} onFiles={handleFiles} onCancel={cancel}/>} action={<SessionPrimaryAction session={selected} preview={preview} files={files} loading={loading} confirming={confirming} onPreview={runPreview} onOpenTask={setActiveTask} onApprove={approve} onImport={confirm} reviewConfirmed={canConfirmReview(preview?.changePlan,destructiveConfirmed,preview?.planStale)}/>} secondaryAction={!['IMPORTED','ARCHIVED','REPLACED','CANCELLED'].includes(selected.status)?<OpsButton onClick={abortSession} disabled={confirming} className="border-transparent bg-transparent px-2 text-[var(--ops-text-muted)] shadow-none hover:border-[var(--ops-border)] hover:bg-[var(--ops-surface)]"><XCircle className="mr-2 inline h-4 w-4"/>Workflow abbrechen</OpsButton>:null} />
              {error && <InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}
              {success && selected.status!=='IMPORTED' && <InfoPanel tone="info" title="Prüfstand">{success}</InfoPanel>}
              {preview?.quotaRulesChanged&&<InfoPanel tone="warning" title="Quotenregeln wurden geändert – bitte erneut prüfen">Die ursprüngliche Review-Version bleibt erhalten. Vor der Freigabe erneut prüfen.</InfoPanel>}
              <NextAction session={selected} success={success}/>
              <CompletedDecisions session={selected} onOpen={setActiveTask}/>
              <ImportChangePlan plan={preview?.changePlan} stale={preview?.planStale} editable={selected.status!=='IMPORTED' && selected.status!=='APPROVED'} destructiveConfirmed={destructiveConfirmed} onDestructive={setDestructiveConfirmed} onRecheck={recheck} busy={confirming || loading}/>

              <PreviewCard control={selected.importControl} onFilter={(area,filter)=>{setQuotaPeopleFilter(null);setPersonFilter(filter);setPersonSearch('');setDetail({title:area==='people'?'Personen der Importvorschau':'Zimmer der Importvorschau',headers:area==='people'?PEOPLE_HEADERS:['Person 1','Person 2','Zimmer','Aufenthalt','Importstatus']});}} preview={preview} peopleRows={peopleRows} roomRows={roomRows} onOpen={d=>{if(['Personen der Importvorschau','Zimmer der Importvorschau'].includes(d.title)){setQuotaPeopleFilter(null);setPersonFilter('all');setPersonSearch('');}setDetail(d);}}/>
              <SessionHistory session={selected} onShowDecision={setShownDecisionId}/>
              <ActivitySummaryCard entityType="import" entityId={selected.id} createdAt={selected.uploadedAt} updatedAt={selected.currentVersion?.uploadedAt}/>
            </div>
            </>}
          </div>
        </ContentCard>
      </div>
    </SplitPageLayout>
    <DetailDialog detail={currentPreviewDetail(detail, {people:filteredPeopleRows, rooms:roomRows.filter((_,index)=>{const room=preview?.rooms[index];return room?roomMatchesImportFilter(room,personFilter,preview!,selected?.importControl)&&`${room.person1Name} ${room.person2Name??''}`.toLocaleLowerCase('de').includes(personSearch.toLocaleLowerCase('de')):personFilter==='all'&&!personSearch;}), quota:quotaRows(preview),athleteQuota:athleteQuotaRows(preview)})} preview={preview} control={selected?.importControl} personFilter={personFilter} onFilter={setPersonFilter} search={personSearch} onSearch={setPersonSearch} quotaPeopleFilter={quotaPeopleFilter} onQuotaPeople={filter=>{setQuotaPeopleFilter(filter);setPersonFilter('all');setPersonSearch('');setDetail({title:'Personen der Importvorschau',headers:PEOPLE_HEADERS});}} onClose={() => setDetail(null)} />
    {activePerson&&preview&&<ImportPersonDialog key={activePerson.matchKey} person={activePerson} preview={preview} session={selected} onClose={()=>setPersonKey(null)} />}
    <OperationsDecisionDialog task={activeTask} saving={savingTask} onClose={() => setActiveTask(null)} onSave={saveTask}/>
    <ImportDecisionDialog decisionId={shownDecisionId} onClose={() => setShownDecisionId(null)} onOpenSession={async sessionId => { setShownDecisionId(null); const session = sessions.find(item => item.id === sessionId); if (session) await selectSession(session); }} />

  </div>;
}

function NewSessionWorkspace({files,preview,loading,error,success,onFiles,onPreview,onCancel}:{files:File[];preview:FisImportPreview|null;loading:boolean;error:string|null;success:string|null;onFiles:(files:FileList|null)=>void;onPreview:()=>void;onCancel:()=>void}) { return <>
  <div className="sticky top-0 z-10 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] p-5"><SectionHeader title="Importprüfung"/><h2 className="mt-2 text-2xl font-extrabold">Neue Importsession</h2><p className="text-sm text-[var(--ops-text-muted)]">FIS-Dateien hochladen und vor dem Import gemeinsam prüfen.</p></div>
  <div className="space-y-4 p-5"><Workflow session={null} actionStep="validation" upload={<UploadWorkspace files={files} preview={preview} onFiles={onFiles} onCancel={onCancel}/>} action={<OpsButton onClick={onPreview} disabled={files.length<2||loading}>{loading?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 inline h-4 w-4"/>}Dateien prüfen</OpsButton>}/>{error&&<InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}{success&&<InfoPanel tone="success" title="Import abgeschlossen">{success}</InfoPanel>}</div>
</>; }

function UploadWorkspace({files,preview,onFiles,onCancel,versionLabel}:{files:File[];preview:FisImportPreview|null;onFiles:(files:FileList|null)=>void;onCancel:()=>void;versionLabel?:string}) { return <div className="grid items-start gap-3 lg:grid-cols-2"><UploadCard files={files} onChange={onFiles} versionLabel={versionLabel}/><SelectedFiles files={files} preview={preview} onCancel={onCancel}/></div>; }

function SessionUploadWorkspace({session,files,preview,onFiles,onCancel}:{session:ImportSession;files:File[];preview:FisImportPreview|null;onFiles:(files:FileList|null)=>void;onCancel:()=>void}) { const nextVersion=(session.currentVersion?.version ?? 0)+1; return <UploadWorkspace files={files} preview={preview} onFiles={onFiles} onCancel={onCancel} versionLabel={`Nächste Prüfung: Version ${nextVersion}`}/>; }

function SelectedFiles({files,preview,onCancel}:{files:File[];preview:FisImportPreview|null;onCancel:()=>void}) { return <ContentCard surface="elevated" className="p-2"><SectionHeader title="Ausgewählte Dateien"/><div className="mt-2 space-y-1.5">{files.length?files.map(file=><div key={file.name} className="flex items-center justify-between rounded-lg bg-[var(--ops-surface)] px-3 py-1.5 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0"/><span className="truncate">{file.name}</span></span><span className="font-mono text-xs text-[var(--ops-text-muted)]">{(file.size/1024).toFixed(1)} KB</span></div>):<p className="rounded-lg bg-[var(--ops-surface)] px-3 py-2 text-sm font-bold text-[var(--ops-text-muted)]">Noch keine Dateien</p>}</div><div className="mt-2"><OpsButton onClick={onCancel} disabled={!files.length}><RefreshCcw className="mr-2 inline h-4 w-4"/>Auswahl zurücksetzen</OpsButton></div></ContentCard>; }

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

function Workflow({session,upload,action,actionStep,secondaryAction}:{session:ImportSession|null;upload:ReactNode;action:ReactNode;actionStep:WorkflowStep['id'];secondaryAction?:ReactNode}) {
  const steps = visibleWorkflow(session);
  const activeStep = steps.find(step => step.id === actionStep) ?? steps.find(step => step.current) ?? steps[0];
  return <ContentCard surface="elevated" className="p-3">
    <SectionHeader title="Workflow" subtitle="Von der technischen Prüfung bis zum kontrollierten Import"/>
    <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4" aria-label="Importworkflow">
      {steps.map((step,index) => {
        const isActive = step.id === activeStep.id;
        return <li key={step.id} aria-current={isActive?'step':undefined} className="relative flex items-center">
          <div className={`flex min-h-14 w-full items-center gap-2 rounded-xl border px-3 py-2 ${isActive?'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)] ring-1 ring-[var(--ops-primary)]':step.complete?'border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]':'border-[var(--ops-border)] bg-[var(--ops-surface)]'}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${step.complete&&!isActive?'bg-[var(--ops-success)] text-white':isActive?'bg-[var(--ops-primary)] text-white':'bg-[var(--ops-surface-overlay)] text-[var(--ops-text-muted)]'}`}>{step.complete&&!isActive?<CheckCircle className="h-4 w-4"/>:index+1}</span>
            <div className="min-w-0"><div className="text-xs font-bold text-[var(--ops-text-subtle)]">Schritt {index+1}</div><div className="truncate text-sm font-extrabold">{step.label.replace(' (falls erforderlich)','')}</div></div>
          </div>
          {index<steps.length-1&&<ChevronRight aria-hidden="true" className="absolute -right-3 z-[1] hidden h-5 w-5 rounded-full bg-[var(--ops-surface-raised)] text-[var(--ops-text-subtle)] md:block"/>}
        </li>;
      })}
    </ol>
    <ActiveWorkflowStep step={activeStep} session={session} upload={upload} action={action}/>
    {secondaryAction&&<div className="mt-2 flex items-center justify-between border-t border-[var(--ops-divider)] px-1 pt-2" aria-label="Workflowverwaltung"><span className="text-xs font-bold text-[var(--ops-text-muted)]">Workflowverwaltung</span>{secondaryAction}</div>}
  </ContentCard>;
}

function ActiveWorkflowStep({step,session,upload,action}:{step:WorkflowStep;session:ImportSession|null;upload:ReactNode;action:ReactNode}) {
  const pending = session?.approvals.filter(approval=>approval.decision==='PENDING').length ?? 0;
  const description:Record<WorkflowStep['id'],string> = {
    validation: 'Dateien auswählen und technische Prüfung starten.',
    decision: pending ? `${pending} offene fachliche ${pending===1?'Entscheidung':'Entscheidungen'} prüfen.` : 'Offene fachliche Entscheidungen prüfen.',
    approval: 'Geprüfte Version für den Import freigeben.',
    import: 'Freigegebene Version kontrolliert übernehmen.',
  };
  return <div className="mt-2">
    <section className="rounded-lg border border-[var(--ops-border-strong)] bg-[var(--ops-surface)] px-2 py-1.5" aria-labelledby={`workflow-step-${step.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><StatusChip tone="primary">Aktueller Schritt</StatusChip><h3 id={`workflow-step-${step.id}`} className="font-extrabold">{step.label.replace(' (falls erforderlich)','')}</h3></div><div>{action}</div></div>
      <p className="mt-0.5 text-xs text-[var(--ops-text-muted)]">{description[step.id]}</p>
    </section>
    {step.id==='validation'&&<div className="mt-2">{upload}</div>}
  </div>;
}

function primaryActionStep(session:ImportSession, files:File[]):WorkflowStep['id'] {
  if(session.approvals.some(approval=>approval.decision==='PENDING')) return 'decision';
  if(session.status==='APPROVED') return 'import';
  if(files.length>=2 || session.status==='IMPORTED' || ['DRAFT','WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED'].includes(session.status)) return 'validation';
  return 'approval';
}

function SessionPrimaryAction({session,preview,files,loading,confirming,onPreview,onOpenTask,onApprove,onImport,reviewConfirmed}:{reviewConfirmed:boolean;session:ImportSession;preview:FisImportPreview|null;files:File[];loading:boolean;confirming:boolean;onPreview:()=>void;onOpenTask:(task:OperationsTask)=>void;onApprove:()=>void;onImport:()=>void}) {
  const pending=session.approvals.map(approval=>buildOperationsTask(session,approval)).filter(task=>task.approval.decision==='PENDING');
  const needsFiles=['DRAFT','WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED'].includes(session.status);
  const canApprove=Boolean(preview?.isValid)&&session.approvals.every(a=>a.decision==='APPROVED')&&['PROFESSIONALLY_REVIEWED','READY_FOR_IMPORT','WAITING_FOR_NATION','NATION_CLARIFICATION','NEW_LIST_RECEIVED','EXCEPTION_APPROVED'].includes(session.status);
  if(pending.length) return <OpsButton onClick={()=>onOpenTask(pending[0])}>Entscheidung öffnen</OpsButton>;
  if(session.status==='APPROVED') return <OpsButton onClick={onImport} disabled={confirming || preview?.planStale} className="border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]"><CheckCircle className="mr-2 inline h-4 w-4"/>Importieren</OpsButton>;
  if(files.length>=2 || session.status==='IMPORTED' || needsFiles) return <OpsButton onClick={onPreview} disabled={files.length<2||loading}>{loading?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 inline h-4 w-4"/>}Dateien prüfen</OpsButton>;
  return <OpsButton onClick={onApprove} disabled={!canApprove || !reviewConfirmed}>Freigeben</OpsButton>;
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
function CompletedDecisions({session,onOpen}:{session:ImportSession;onOpen:(task:OperationsTask)=>void}) {
  const completed=session.approvals.filter(approval=>approval.decision==='APPROVED');
  if(!completed.length) return null;
  return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Abgeschlossene Entscheidungen" subtitle="Bestehende Genehmigungen bleiben erledigt und können ausdrücklich geändert werden."/><div className="mt-3 space-y-2">{completed.map(approval=><OperationsTaskRow key={approval.id} task={buildOperationsTask(session,approval)} onOpen={()=>onOpen(buildOperationsTask(session,approval))}/>)}</div></ContentCard>;
}
function SessionHistory({session,onShowDecision}:{session:ImportSession;onShowDecision:(id:string)=>void}) { return <ContentCard surface="elevated" className="p-4"><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-3"><SectionHeader title="Historie" subtitle={`${session.versions?.length ?? 0} Version(en) · bei Bedarf aufklappen`}/><ChevronDown className="h-5 w-5 shrink-0 text-[var(--ops-text-subtle)] transition-transform group-open:rotate-180"/></summary><div className="mt-4 space-y-3">{session.history?.length ? [...session.history].reverse().map(event=>{const content=<><Clock3 className="mt-0.5 h-4 w-4 text-[var(--ops-text-subtle)]"/><div><div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{event.title}</span><span className="font-mono text-xs text-[var(--ops-text-subtle)]">{new Date(event.timestamp).toLocaleString('de-DE')} · {event.user}</span></div>{event.description&&<p className="mt-1 text-sm text-[var(--ops-text-muted)]">{event.description}</p>}</div></>;return event.decisionId?<button key={event.id} type="button" onClick={()=>onShowDecision(event.decisionId!)} className="grid w-full grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3 text-left transition hover:text-[var(--ops-primary)]">{content}</button>:<div key={event.id} className="grid grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3">{content}</div>}):<EmptyState title="Noch keine Historieneinträge" description="Versionen, Entscheidungen und Freigaben werden automatisch protokolliert."/>}</div></details></ContentCard>; }
function UploadCard({files,onChange,versionLabel}:{files:File[];onChange:(f:FileList|null)=>void;versionLabel?:string}) { return <ContentCard surface="elevated" className="p-2"><div className="flex flex-wrap items-center justify-between gap-2"><SectionHeader title="Neue Importsession"/>{versionLabel&&<span className="text-xs font-bold text-[var(--ops-text-muted)]">{versionLabel}</span>}</div><label className="mt-2 block cursor-pointer rounded-xl border-2 border-dashed border-[var(--ops-border-strong)] bg-[var(--ops-surface)] p-3 text-center hover:bg-[var(--ops-tone-primary-surface)]"><input id="fis-files-input" type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={e=>onChange(e.target.files)}/><Upload className="mx-auto h-7 w-7 text-[var(--ops-primary)]"/><p className="mt-1 font-bold">{files.length ? `${files.length} Datei(en) ausgewählt` : 'Dateien auswählen oder ablegen'}</p><p className="mt-0.5 text-xs text-[var(--ops-text-muted)]">{REQUIRED_FILE_HINTS.join(' + ')}</p></label></ContentCard>; }
type FisImportPreviewPersonWithKey = FisImportPreview['people'][number] & { matchKey?: string };
export function PreviewCard({preview,peopleRows,roomRows,onOpen,control,onFilter}:{preview:FisImportPreview|null;peopleRows:ReactNode[][];roomRows:ReactNode[][];onOpen:(detail:Detail)=>void;control?:ImportControl;onFilter?:(area:'people'|'rooms',filter:ImportListFilter)=>void}) {
 const tile='flex min-h-40 flex-col rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4';
 const openPeople=()=>onOpen({title:'Personen der Importvorschau',rows:peopleRows,headers:PEOPLE_HEADERS});
 const openRooms=()=>onOpen({title:'Zimmer der Importvorschau',rows:roomRows,headers:['Person 1','Person 2','Zimmer','Aufenthalt','Importstatus']});
 const personFilters=(['error','clarification','noRoom','singleRoom','special'] as const).map(filter=>({filter,count:filter==='error'?(preview?.errors.filter(i=>!i.code.startsWith('ROOM_')).length??0):(preview?.people.filter(p=>personMatchesImportFilter(p,filter,preview,control)).length??0)})).filter(h=>h.count);
 const roomFilters=(['error','clarification','partner'] as const).map(filter=>({filter,count:filter==='error'?(preview?.errors.filter(i=>i.code.startsWith('ROOM_')).length??0):(preview?.rooms.filter(r=>roomMatchesImportFilter(r,filter,preview,control)).length??0)})).filter(h=>h.count);
 return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Importvorschau"/><div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
  <div className={tile}><button type="button" onClick={openPeople} className="text-left"><strong>Personen</strong><p>{preview?.people.length??0} Personen</p></button>{personFilters.map(h=><button type="button" key={h.filter} onClick={()=>onFilter?onFilter('people',h.filter):openPeople()} className="mt-2 text-left text-sm text-[var(--ops-primary)]">{h.count} {importListFilters[h.filter]}</button>)}{preview&&!personFilters.some(h=>h.filter==='error'||h.filter==='clarification')&&<span className="mt-auto pt-2 text-sm text-[var(--ops-success)]">OK</span>}</div>
  <div className={tile}><button type="button" onClick={openRooms} className="text-left"><strong>Zimmerzuordnungen</strong><p>{preview?.rooms.length??0} Zimmerangaben</p></button>{roomFilters.map(h=><button type="button" key={h.filter} onClick={()=>onFilter?onFilter('rooms',h.filter):openRooms()} className="mt-2 text-left text-sm text-[var(--ops-primary)]">{h.count} {h.filter==='partner'?'Partner ungeklärt':importListFilters[h.filter]}</button>)}{preview&&!roomFilters.length&&<span className="mt-auto pt-2 text-sm text-[var(--ops-success)]">OK</span>}</div>
  <button type="button" onClick={()=>onOpen({title:'Officials & EZ-Quote'})} className={`${tile} text-left`}><strong>Officials & EZ-Quote</strong><span>{preview?.quotaOverview?.nations.reduce((sum,n)=>sum+n.ezDecisionsOpen,0)??0} offene Entscheidungen</span><span className="mt-auto pt-2">{preview?.quotaOverview?.nations.some(n=>n.coverageReviewRequired||n.incomplete)?'Quotenabdeckung prüfen':preview?.quotaChecks?.some(q=>q.singleRoomsPending>0)?'EZ-Entscheidung offen':'OK'}</span></button>
  <button type="button" onClick={()=>onOpen({title:'Athleten-/Disziplinquote'})} className={`${tile} text-left`}><strong>Athleten-/Disziplinquote</strong><span>{preview?.quotaOverview?.nations.reduce((sum,n)=>sum+n.athletes,0)??0} Athleten</span><span>{preview?.athleteQuotaChecks?.map(q=>`${q.topLevelDiscipline}: Limit ${q.athleteQuotaLimit}`).join(' · ')}</span><span className="mt-auto pt-2">{preview?<AthleteQuotaPreviewStatus preview={preview}/>: 'Noch keine Vorschau'}</span></button>
 </div></ContentCard>;
}
export function athleteQuotaRows(preview:FisImportPreview|null):ReactNode[][] {
  const extent=(v?:import('../types').QuotaExtent)=>v?`Gesamtgrenze: ${v.total} · Männer: ${v.M} · Frauen: ${v.F}`:'—';
  return preview?.athleteQuotaChecks?.map(q=>[q.topLevelDiscipline==='Freestyle'?'Freestyle / Freeski':q.topLevelDiscipline,`${q.athleteQuotaUsed} / ${q.athleteQuotaLimit}`,`${q.athleteGenderUsed.M} / ${q.athleteGenderLimit}`,`${q.athleteGenderUsed.F} / ${q.athleteGenderLimit}`,extent(q.approvedExtent),extent(q.uncoveredExtent),q.decisionStatus==='PENDING'?'Offen':q.decisionStatus==='APPROVED'?'Ausnahme genehmigt':q.athleteQuotaStatus==='INCOMPLETE'?'Unvollständig':'Innerhalb der Quote']) ?? [];
}
const quotaHeaders = ['Event Group','Gender','Athleten','Officials Basis','Officials gemeldet','EZ Anspruch','EZ angefordert','Handlungsbedarf'];
function quotaRows(preview: FisImportPreview | null): ReactNode[][] {
  return preview?.quotaChecks?.map(q => [q.discipline,q.gender,q.athletes,q.officialQuota,<Tooltip title={`${q.officials} eindeutige Officials in diesem Kontext. Dieselbe Person kann in M und W berücksichtigt sein. M/W-Werte nicht als globale Personenzahl addieren.`}><span tabIndex={0} className="cursor-help border-b border-dotted border-[var(--ops-border)]">{q.officials}</span></Tooltip>,q.singleRoomsAllowed,q.singleRoomsRequested,q.singleRoomsPending > 0 ? <StatusChip tone="warning">+{q.singleRoomsPending} EZ offen</StatusChip> : <StatusChip tone="success">✓</StatusChip>]) ?? [];
}
const issueCopy:Record<string,{message:string;causes?:string[];action:string}>={
  ENTRY_MISSING_COLUMNS:{message:'Die ENTRIES-LIST hat eine fehlerhafte Excel-Struktur: Pflichtspalten fehlen.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ROOM_MISSING_COLUMNS:{message:'Die Zimmerliste hat eine fehlerhafte Excel-Struktur: Pflichtspalten fehlen.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ENTRY_DUPLICATE_PERSON:{message:'Eine Person ist mehrfach in der Meldeliste enthalten.',action:'Bitte die doppelte Person durch den Verband korrigieren lassen.'},
  ENTRY_INVALID_ARRIVAL_DATE:{message:'Das Anreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ENTRY_INVALID_DEPARTURE_DATE:{message:'Das Abreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ENTRY_INVALID_STAY_RANGE:{message:'Das Abreisedatum liegt vor dem Anreisedatum.',action:'Bitte die Aufenthaltsdaten durch den Verband korrigieren lassen.'},
  ROOM_PERSON_NOT_FOUND:{message:'Neue Person erkannt.',action:'Die Person wird beim Import neu angelegt.'},
  ROOM_PARTNER_NOT_FOUND:{message:'Zimmerpartner konnte nicht eindeutig zugeordnet werden.',action:'Bitte vollständigen Namen und Nation mit der Entries-Liste abgleichen. Die Zuordnung bleibt ungeklärt.'},
  ENTRY_SINGLE_ROOM_CONTEXT_UNRESOLVED:{message:'Einzelzimmer ohne gültigen Quota-Kontext muss geprüft werden.',action:'Bitte die exakten Competition-Zuordnungen klären oder einen ausdrücklich geprüften EZ-Sonderstatus dokumentieren.'},
  ENTRY_WSC_SOURCE_EVIDENCE_MISSING:{message:'Die gespeicherten WSC-Quellzuordnungen sind unvollständig.',action:'Bitte die Entries-/Room-Listen erneut zur Prüfung hochladen.'},
  ROOM_INVALID_ARRIVAL_DATE:{message:'Das Anreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'}, ROOM_INVALID_DEPARTURE_DATE:{message:'Das Abreisedatum ist ungültig.',action:'Bitte eine korrigierte Meldeliste beim Verband anfordern.'},
  ROOM_INVALID_STAY_RANGE:{message:'Die Abreise liegt vor der Anreise.',action:'Bitte die Aufenthaltsdaten durch den Verband korrigieren lassen.'}, ROOM_DAY_VALUE_NOT_NUMERIC:{message:'Die Zimmerbelegung enthält einen ungültigen Wert.',action:'Keine Aktion erforderlich'}, ROOM_NO_DAY_OVERLAP:{message:'Der Aufenthalt liegt außerhalb des gemeldeten Zeitraums.',action:'Keine Aktion erforderlich'},
};
const detailLabels:Record<string,string>={firstname:'Vorname',lastname:'Nachname',nationCode:'Nation',discipline:'Disziplin',gender:'Gender',hotel:'Hotel',roomType:'Zimmertyp',sharedWithName:'Zimmerpartner',sharedWithNationcode:'Nation',arrivalDate:'Anreise',departureDate:'Abreise',value:'Wert'};
function displayValue(value:unknown):string { if(value===null||value===undefined||value==='')return 'Noch zu ermitteln'; if(Array.isArray(value))return value.map(displayValue).join(', '); if(typeof value==='object')return Object.entries(value as Record<string,unknown>).map(([key,item])=>`${detailLabels[key]??key}: ${displayValue(item)}`).join(' · '); return String(value); }
function RecordSection({title,children}:{title:string;children:ReactNode}) { return <section><h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-[var(--ops-text-subtle)]">{title}</h3><div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4">{children}</div></section>; }
function IssueRecord({issue,isInformation,isDecision}:{issue:FisImportIssue;isInformation:boolean;isDecision:boolean}) { const copy=issueCopy[issue.code]; const detected=/discipline/i.test(issue.code); return <article className="space-y-4"><RecordSection title="1. Was ist passiert?"><p className="font-bold">{detected?'Disziplin automatisch erkannt':copy?.message??issue.message}</p>{detected&&<p className="mt-2 text-sm text-[var(--ops-text-muted)]">Erkannt: {displayValue(issue.details?.discipline??issue.details?.value)} · Quelle: Dateiname</p>}</RecordSection>{Object.keys(issue.details??{}).length>0&&<RecordSection title="2. Betroffene Daten"><div className="grid gap-3 sm:grid-cols-2">{Object.entries(issue.details??{}).map(([key,value])=><div key={key}><div className="text-xs font-bold text-[var(--ops-text-subtle)]">{detailLabels[key]??key}</div><div className="font-semibold">{displayValue(value)}</div></div>)}</div></RecordSection>}<RecordSection title="3. Auswirkung"><div className="flex gap-2 font-bold">{isInformation?<CheckCircle className="h-5 w-5 text-[var(--ops-success)]"/>:<AlertTriangle className="h-5 w-5 text-[var(--ops-warning)]"/>}{isInformation?'Information · keine zusätzliche Importsperre':isDecision?'Fachlich klären · keine zusätzliche Importsperre':'Import ist bis zur Korrektur blockiert'}</div></RecordSection><InfoPanel tone={isInformation?'success':'info'} title="Was ist jetzt zu tun?">{isInformation?'Hinweis anhand der Quelldaten nachvollziehen.':isDecision?'Sachverhalt bei Bedarf mit Nation oder FIS klären. Bestehende Genehmigungsfälle bleiben unverändert.':copy?.action??'Bitte die fehlerhaften Quelldaten korrigieren.'}</InfoPanel></article>; }
function DetailDialog({detail,onClose,preview,control,personFilter,onFilter,search,onSearch,quotaPeopleFilter,onQuotaPeople}:{detail:Detail|null;onClose:()=>void;preview:FisImportPreview|null;control?:ImportControl;personFilter:ImportListFilter;onFilter:(kind:ImportListFilter)=>void;search:string;onSearch:(value:string)=>void;quotaPeopleFilter:QuotaPeopleFilter|null;onQuotaPeople:(filter:QuotaPeopleFilter|null)=>void}) {
  if(detail && ['Officials & EZ-Quote','Quota & EZ','Athleten-/Disziplinquote'].includes(detail.title))return <QuotaOverviewDialog preview={preview} control={control} kind={detail.title==='Athleten-/Disziplinquote'?'athlete':'officials'} onPeople={onQuotaPeople} onClose={onClose}/>;
  const isQuota=detail?.title === 'Officials & EZ-Quote';
  const wide= isQuota || detail?.title === 'Personen der Importvorschau';
  return (
    <Dialog open={Boolean(detail)} onClose={onClose} fullWidth maxWidth={wide ? false : "lg"} sx={wide ? {'& .MuiDialog-paper': {width: {xs: 'calc(100vw - 32px)', sm: '90vw'}, maxWidth: '1600px', maxHeight: 'calc(100dvh - 64px)'}} : undefined}>
      <DialogTitle>{detail?.title}<div className="text-sm font-normal text-[var(--ops-text-muted)]">{detail?.subtitle}</div></DialogTitle>
      <DialogContent dividers sx={{overflowY: 'auto'}}>
        {['Personen der Importvorschau','Zimmer der Importvorschau'].includes(detail?.title??'')&&preview&&<div className="space-y-3"><div className="flex flex-wrap gap-3"><label className="text-sm">Person suchen<input value={search} onChange={e=>onSearch(e.target.value)} className="ml-2 rounded border border-[var(--ops-border)] bg-[var(--ops-background)] p-2"/></label><label className="text-sm">Anzeigen<select value={personFilter} onChange={e=>onFilter(e.target.value as ImportListFilter)} className="ml-2 rounded border border-[var(--ops-border)] bg-[var(--ops-background)] p-2">{Object.entries(importListFilters).map(([key,label])=><option key={key} value={key}>{key==='all'&&detail?.title==='Personen der Importvorschau'?'Alle Personen':label}</option>)}</select></label></div></div>}
        {personFilter==='error'&&preview&&['Personen der Importvorschau','Zimmer der Importvorschau'].includes(detail?.title??'')&&<ul className="space-y-1 text-sm text-[var(--ops-error)]">{preview.errors.filter(i=>i.code.startsWith('ROOM_')===(detail?.title==='Zimmer der Importvorschau')).map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}
        {detail?.title==='Personen der Importvorschau'&&quotaPeopleFilter&&<div className="mb-2 flex flex-wrap items-center gap-2 text-sm" aria-label="Quoten-Personenfilter"><strong>{quotaPeopleFilter.role==='officials'?'Officials':'Athleten'} · {quotaPeopleFilter.nation}{quotaPeopleFilter.group?` · ${quotaPeopleFilter.group}`:''}{quotaPeopleFilter.multipleGroups?' · Mehrere Event Groups':''}{quotaPeopleFilter.family?` · ${quotaPeopleFilter.family}`:''}{quotaPeopleFilter.gender?` · ${quotaPeopleFilter.gender==='M'?'Männer':'Frauen'}`:''}</strong><button type="button" className="text-[var(--ops-primary)] underline" onClick={()=>onQuotaPeople(null)}>Filter aufheben</button></div>}
        <div className="space-y-6">{(['Personen der Importvorschau','Zimmer der Importvorschau'].includes(detail?.title??'')?[]:detail?.issues)?.map((issue,i)=><IssueRecord key={`${issue.code}-${i}`} issue={issue} isInformation={!preview?.errors.some(e=>e.code===issue.code)&&!control?.issues.some(i=>i.code===issue.code&&i.kind==='clarification')} isDecision={!preview?.errors.some(e=>e.code===issue.code)&&Boolean(control?.issues.some(i=>i.code===issue.code&&i.kind==='clarification'))}/>)}</div>
        {detail?.rows&&detail.rows.length>0&&<div tabIndex={0} role="region" aria-label={`${detail.title} – Tabelle horizontal scrollbar`} className="mt-3 overflow-x-auto"><table className={`w-full text-sm ${wide ? 'min-w-[1050px]' : ''}`}><thead><tr>{detail.headers?.map(h=><th key={h} className={`border-b border-[var(--ops-divider)] px-3 py-2 whitespace-nowrap text-xs uppercase text-[var(--ops-text-subtle)] ${isQuota && quotaHeaders.indexOf(h) >= 2 && quotaHeaders.indexOf(h) <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead><tbody>{detail.rows.map((r,i)=><tr key={i} className="border-b border-[var(--ops-divider)]">{r.map((c,j)=><td key={j} className={`px-3 py-2 ${isQuota && j >= 2 && j <= 6 ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody></table></div>}
        {detail&&!detail.issues?.length&&!detail.rows?.length&&<EmptyState title="Keine betroffenen Datensätze" description="Für diese Session liegen keine Detailänderungen vor."/>}
      </DialogContent>
    </Dialog>
  );
}
