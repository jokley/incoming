import { usePermissions } from '../auth/AuthProvider';
import { NationClarificationDialog } from './NationClarificationDialog';
import {stayWindowText,stayWindowDetails} from '../services/stayWindow';
import {singleRoomSummary,sportClarifications,importListFilters,personMatchesImportFilter,roomMatchesImportFilter,roomNeedsPartner,personMatchesQuotaFilter,type QuotaPeopleFilter,type ImportListFilter} from '../services/importHints';
import {ImportPersonDialog,visibleControlIssues} from './ImportControl';
import type {ImportControl} from '../types';
import { useActiveEvent, useActiveEventBlocker } from '../events/ActiveEventProvider';
import { AccommodationRateProvenance } from './AthleteTariffSelection';
import { QuotaOverviewDialog, AthleteQuotaPreviewStatus } from './QuotaOverviewDialog';
import {stayWindowRowText,stayWindowNights} from '../services/stayWindow';
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
import { archiveImportSessionChecked, importConfirmationMessage, reloadImportSession } from '../services/importConfirmation';
import { competitionDisplayName, competitionMembershipList, previewEventGroupLabel } from '../services/competitionPresentation';
import type { FisImportIssue, FisImportPreview, ImportChange } from '../types';
import { closedImportStatuses, IMPORT_SESSION_STATUS, type ImportSession, type NationClarification } from '../data/importSessions';
import { ContentCard, EmptyState, EnterpriseDialog, InfoPanel, OpsButton, PageHeader, SplitPageLayout, SectionHeader, StatusChip } from '../design-system';
import { ImportQueue } from './ImportQueue';
import { buildOperationsTask, OperationsDecisionDialog, OperationsTaskRow, type OperationsTask } from './OperationsDecisionDialog';
import { ImportDecisionDialog } from './ImportDecisionDialog';
import { ActivitySummaryCard } from './activity';
import { SingleRoomStatusBadge, type SingleRoomStatus } from './SingleRoomStatusBadge';

const REQUIRED_FILE_HINTS = ['ENTRIES-LIST', 'ENTRIES-ROOM-LIST-DETAILED'];
type WorkflowStep = { id: string; label: string; complete: boolean; current: boolean };
type Detail = { title: string; focusSport?:boolean; subtitle?: string; issues?: FisImportIssue[]; rows?: ReactNode[][]; headers?: string[] };

const PEOPLE_HEADERS=['Name','Nation','Disziplin','Funktion','Unterkunftsbedarf','Unterkunftstarif','EZ-Status','Importstatus'];

type VisibleImportStatus = 'Neu' | 'Entfernt' | 'Aufenthalt geändert' | 'Zimmerpartner geändert' | 'Zimmer erstellt' | 'Zimmer entfernt' | 'Disposition prüfen' | 'Stammdaten prüfen';
const statusTone: Record<VisibleImportStatus, 'primary'|'info'|'warning'|'error'> = {
  Neu: 'primary', Entfernt: 'warning', 'Aufenthalt geändert': 'info', 'Zimmerpartner geändert': 'primary',
  'Zimmer erstellt': 'primary', 'Zimmer entfernt': 'warning',
  'Disposition prüfen': 'warning', 'Stammdaten prüfen': 'error',
};
const importStatuses = (statuses: VisibleImportStatus[]) => statuses.length ? <span className="flex flex-wrap gap-1">{[...new Set(statuses)].map(status => <StatusChip key={status} tone={statusTone[status]}>{status}</StatusChip>)}</span> : null;

function importScopeLabel(preview: FisImportPreview | null): string {
  const scope = preview?.replacementScope;
  return preview?.submissionSources ? 'Erfasster Nationsentwurf' : scope?.kind === 'SPORT_FAMILY' ? `Teilmeldung · ${scope.family === 'Snowboard' ? 'Snowboard (SB)' : 'Freestyle/Freeski (FS)'}`
    : scope?.kind === 'FULL_NATION' ? 'Sonderaktion · vollständiger Nationsersatz' : '';
}

/** Opening an up-to-date joint review must preserve its approvals and version. */
export function nationReviewSelection(session: ImportSession, force = false) {
  if (closedImportStatuses.has(session.status)) return undefined;
  const sources = session.submissions ?? [];
  if (!sources.length || session.preview?.replacementScope?.kind === 'FULL_NATION') return undefined; // Historical FULL_NATION reviews retain their scope.
  const selected = session.preview?.submissionSources;
  const current = selected && Object.keys(selected).length === sources.length
    && sources.every(source => String(selected[source.family]) === source.versionId);
  return force || !current || session.preview?.planStale || session.preview?.quotaRulesChanged
    ? {sourceVersionIds: sources.map(source => source.versionId)} : undefined;
}

export function DataImport() {
  const permissions = usePermissions();
  const importAllowed = permissions.canManageImports;
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<ImportSession | null>(null);
  const [closingSession,setClosingSession]=useState<ImportSession|null>(null);
  const [closeError,setCloseError]=useState<string|null>(null);
  const [closeRefreshWarning,setCloseRefreshWarning]=useState<string|null>(null);
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [fullReplacement,setFullReplacement]=useState(false);
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
  const [question,setQuestion]=useState<{action:'OPEN'|'REPLY'|'RESOLVE';item?:NationClarification}|null>(null);
  const [questionBusy,setQuestionBusy]=useState(false);
  useEffect(()=>{setQuestion(null);},[selected?.id,selected?.currentVersionId]);
  const openQuestion=(action:'OPEN'|'REPLY'|'RESOLVE',item?:NationClarification)=>setQuestion({action,item});
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
      setSelected(full); setPreview(null); setFiles([]); setSuccess(null); setError(null);setCloseRefreshWarning(null);
      const selection = importAllowed ? nationReviewSelection(full) : undefined;
      const draft = selection ? await api.recheckImportSession(full.id, selection) : full;
      setSelected(draft); setPreview(closedImportStatuses.has(draft.status)?null:draft.preview ?? null);
      if (selection) await refreshSessions();
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Importsession konnte nicht geladen werden.'); }
    finally { setLoading(false); }
  };

  const handleFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return; setFullReplacement(false); const accepted = Array.from(incoming).filter(f => /\.xlsx?$/i.test(f.name));
    if (!accepted.length) { setError('Bitte Excel-Dateien (.xlsx, .xls) hochladen.'); return; }
    setFiles([...new Map(accepted.map(f => [f.name.toLowerCase(), f])).values()]); setPreview(null); setSuccess(null); setError(null);
    const input=document.getElementById('fis-files-input') as HTMLInputElement|null;
    if(input)input.value=''; // The same file pair may be selected again for a reimport.
  };
  const cancel = () => { setFiles([]); setPreview(selected?.preview ?? null); setError(null); setSuccess(null); const input = document.getElementById('fis-files-input') as HTMLInputElement | null; if (input) input.value = ''; };
  const runPreview = async () => { if (files.length < 2 || !eventId) return; setLoading(true); setError(null); setSuccess(null); setPreview(null);setCloseRefreshWarning(null); try { const result = await api.previewFisImport(files, true, undefined, eventId, fullReplacement?'FULL_NATION':'AUTO'); setPreview(result); if(result.knownFiles)setSuccess(result.message ?? 'Bekannte Dateien erneut geprüft.'); if (result.session) { const uploaded = {...result.session, preview: result}; setSelected(uploaded); setFiles([]); setPreview(null);
      const selection = fullReplacement ? undefined : nationReviewSelection(uploaded);
      const draft = selection ? await api.recheckImportSession(uploaded.id, selection) : uploaded;
      setSelected(draft); setPreview(draft.preview ?? null); await refreshSessions(); } } catch (e) { setError(e instanceof Error ? e.message : 'Preview fehlgeschlagen'); } finally { setLoading(false); } };
  const closeSession = async () => {
    if(!closingSession)return;setConfirming(true);setCloseError(null);setCloseRefreshWarning(null);
    let archived: ImportSession;
    try {archived=await archiveImportSessionChecked(closingSession,api);}
    catch(e){setCloseError(e instanceof Error?e.message:'Importsession konnte nicht geschlossen werden.');setConfirming(false);return;}
    setSessions(rows=>rows.map(row=>row.id===archived.id?archived:row));
    if(selected?.id===archived.id){setSelected(null);setPreview(null);setFiles([]);setDetail(null);setActiveTask(null);setQuestion(null);setError(null);setSuccess(null);}
    setClosingSession(null);
    try {await refreshSessions();}
    catch {setCloseRefreshWarning(`${archived.nation}: Importsession ist geschlossen. Die Warteschlange konnte nicht neu geladen werden. Bitte die Seite zur Aktualisierung erneut laden.`);}
    finally{setConfirming(false);}
  };
  const abortSession = async () => { if (!selected) return; setConfirming(true); setError(null); try { const restored=await api.cancelImportSession(selected.id,selected.currentVersionId); const keep=restored.status!=='CANCELLED'||Boolean(restored.submissions?.length);setSelected(keep?restored:null); setPreview(null);
      if(keep){const selection=nationReviewSelection(restored);const draft=selection?await api.recheckImportSession(restored.id,selection):restored;setSelected(draft);setPreview(draft.preview??null);} setFiles([]); setSuccess('Aktuelle Prüfversion abgebrochen. Frühere Imports, Personen und Genehmigungen bleiben erhalten.'); await refreshSessions(); } catch(e) { setError(e instanceof Error ? e.message : 'Importsession konnte nicht abgebrochen werden'); } finally { setConfirming(false); } };
  const approve = async () => { if (!selected || !canConfirmReview(preview?.changePlan,destructiveConfirmed,preview?.planStale)) return; setConfirming(true); setError(null); try { const updated = canonicalSessionState(await api.approveImportSession(selected.id, importReviewRequest(preview?.changePlan,destructiveConfirmed,preview?.planStale))); setSelected(updated.selected); setPreview(updated.preview); await refreshSessions(); } catch(e) { if(e && typeof e==='object' && 'error' in e && e.error==='STALE_PREVIEW')setPreview(p=>p?{...p,planStale:true}:p); setError(e instanceof Error ? e.message : 'Freigabe fehlgeschlagen'); } finally { setConfirming(false); } };
  const confirm = async () => { if (!selected || selected.status !== 'APPROVED') return; setConfirming(true); setError(null); setSuccess(null); try { const result = await api.importSession(selected.id,selected.currentVersionId); setSuccess(importConfirmationMessage(result)); const [updated, loaded] = await reloadImportSession(selected.id, api); setSelected(updated); setPreview(updated.preview ?? null); setSessions(loaded); } catch (e) { if(e && typeof e==='object' && 'error' in e && e.error==='STALE_PREVIEW')setPreview(p=>p?{...p,planStale:true}:p); setError(e instanceof Error ? e.message : 'Import fehlgeschlagen'); } finally { setConfirming(false); } };
  const recheck = async () => {
    if(!selected)return;
    setConfirming(true);setError(null);
    try {
      // Another browser may have uploaded a correction since this view was opened.
      const current=await api.getImportSession(selected.id);
      const family=!preview?.submissionSources&&preview?.replacementScope?.kind==='SPORT_FAMILY'?preview.replacementScope.family:undefined;
      const source=family?current.submissions?.find(part=>part.family===family):undefined;
      const selection=source?{sourceVersionId:source.versionId}:nationReviewSelection(current,true);
      const updated=await api.recheckImportSession(selected.id,selection);
      setSelected(updated);setPreview(updated.preview??null);await refreshSessions();
    } catch(e){setError(e instanceof Error?e.message:'Erneute Prüfung fehlgeschlagen');}
    finally{setConfirming(false);}
  };

  const prepareSubmissions = async (sourceVersionId?:string) => {
    if(!selected)return;
    setConfirming(true);setError(null);setSuccess(null);
    try {const updated=await api.recheckImportSession(selected.id,sourceVersionId?{sourceVersionId}:nationReviewSelection(selected,true));setSelected(updated);setPreview(updated.preview??null);setFiles([]);await refreshSessions();}
    catch(e){setError(e instanceof Error?e.message:'Teilmeldungen konnten nicht geprüft werden.');}
    finally{setConfirming(false);}
  };
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
    return [<div><button type="button" className="text-left font-bold text-[var(--ops-primary)] hover:underline" aria-label={`Importdetails ${name}`} onClick={()=>setPersonKey(personKey)}>{name} <span className="text-xs font-normal">Details →</span></button><p title={stayWindowDetails(selected?.importControl?.people.find(r=>r.personKey===personKey)?.stayWindow)} className="ops-table-wrap text-xs text-[var(--ops-warning)]">{stayWindowRowText(selected?.importControl?.people.find(r=>r.personKey===personKey)?.stayWindow)}<span className="block text-[var(--ops-text-muted)]">{stayWindowNights(selected?.importControl?.people.find(r=>r.personKey===personKey)?.stayWindow)}</span></p>{selected?.importControl&&visibleControlIssues(selected.importControl).filter(i=>i.kind!=='info'&&i.personKeys.includes(personKey)).map((issue,index)=><p key={index} title={`${issue.source??''}${issue.row?` · Zeile ${issue.row}`:''}`} className="ops-table-wrap mt-1 max-w-xs text-xs text-[var(--ops-warning)]">{issue.message}</p>)}</div>, p.nationCode, <div>{previewEventGroupLabel(p.quotaDisciplines)}<span className="ops-table-wrap block text-xs text-[var(--ops-text-muted)]">{competitionMembershipList(selected?.importControl?.people.find(row=>row.personKey===personKey)?.competitions)}</span></div>, p.function || '—', <div className="w-[190px] max-w-full space-y-1"><AccommodationRequirementField compact sourceRoomType={p.roomType || "Keine Angabe"} label={`Unterkunftsbedarf ${name}`} person={p} disabled={!selected || savingTask || ['APPROVED','IMPORTED','ARCHIVED','REPLACED','CANCELLED'].includes(selected.status)} onChange={value=>void setPreviewRequirement(personKey,value)} onRelease={()=>void setPreviewRequirement(personKey,null)}/>{p.accommodationRequirementReviewRequired && <p className="text-xs">Unterkunftswunsch prüfen; unbekannte Werte bedeuten nicht No room.</p>}</div>, <div className="max-w-[220px] space-y-1"><AccommodationRateField dense compact label={`Unterkunftstarif ${name}`} value={p.accommodationRateCategory} disabled={!selected || savingTask || ['APPROVED','IMPORTED','ARCHIVED','REPLACED','CANCELLED'].includes(selected.status)} onChange={category=>void setPreviewRate(personKey,category)}/><AccommodationRateProvenance person={p}/></div>, <div key="ez" className="space-y-1">{exemption}{entitlement}</div>, importStatuses(statusesFor('persons',personKey,p.rowNumber,p.operation))];
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
    <input id="fis-files-input" type="file" accept=".xlsx,.xls" multiple disabled={!importAllowed||loading||confirming||savingTask} className="hidden" onChange={e=>handleFiles(e.target.files)}/>
    <SplitPageLayout className="flex min-h-full flex-col gap-5 space-y-0 xl:h-full xl:min-h-0">
      <PageHeader eyebrow="Operations Center" title="Import Center" subtitle="Nationen prüfen, freigeben und kontrolliert importieren." meta={selected ? <><StatusChip tone={!preview||preview.planStale||preview.quotaRulesChanged ? 'warning' : selected.errors ? 'error' : selected.approvals.some(a => a.decision === 'PENDING') ? 'warning' : 'success'}>{closedImportStatuses.has(selected.status)?IMPORT_SESSION_STATUS[selected.status]:!preview||preview.planStale||preview.quotaRulesChanged?'Prüfung erforderlich':IMPORT_SESSION_STATUS[selected.status]}</StatusChip><span className="text-sm text-[var(--ops-text-muted)]">{selected.nation} · {importScopeLabel(preview) || 'Nationsentwurf'}</span></> : <StatusChip tone="primary">Dateien hinzufügen</StatusChip>} />
      {closeRefreshWarning&&<InfoPanel tone="warning" title="Aktualisierung ausstehend">{closeRefreshWarning}</InfoPanel>}
    {files.length>0&&<details className="mx-5 mb-3 text-sm"><summary className="cursor-pointer">Sonderaktion: vollständige Nation ersetzen</summary><label className="mt-2 flex gap-2"><input type="checkbox" checked={fullReplacement} onChange={e=>setFullReplacement(e.target.checked)} disabled={loading||confirming}/>Diese Dateien bilden die vollständige Nation. Fehlende Personen können nach Prüfung und Bestätigung entfernt werden.</label></details>}
      <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row">
        <ImportQueue sessions={sessions} selectedId={selected?.id ?? null} onSelect={selectSession} onClose={importAllowed?session=>{setCloseError(null);setClosingSession(session);}:undefined} busy={loading||confirming||savingTask||questionBusy} />
        <ContentCard surface="raised" className="min-w-0 shrink-0 overflow-hidden xl:min-h-0 xl:flex-1">
          <div className="xl:h-full xl:overflow-y-auto"><div className="border-b border-[var(--ops-divider)] p-5"><span className="text-sm text-[var(--ops-text-muted)]">Veranstaltung: <strong className="text-[var(--ops-text)]">{selectedEvent?.name}</strong></span></div>
            {!selected ? <NewSessionWorkspace canWrite={importAllowed} files={files} preview={preview} loading={loading} error={error} success={success} onFiles={handleFiles} onPreview={runPreview} onCancel={cancel} /> : <>
            <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] px-5 py-4">
              <div><SectionHeader title="Importprüfung" /><h2 className="mt-1 text-xl font-extrabold">{selected.nation} – {importScopeLabel(preview) || 'Nationsentwurf'}</h2><p className="text-xs text-[var(--ops-text-muted)]">{closedImportStatuses.has(selected.status) ? 'Workflow geschlossen · Historie bleibt erhalten.' : preview ? `${preview.people.length} eindeutige Personen · ${preview.people.filter(p=>(p.function??'').toLowerCase()==='athlete').length} Athleten · ${preview.people.filter(p=>(p.function??'').toLowerCase()!=='athlete').length} Officials` : files.length ? 'Nation wird anhand der Dateien erkannt.' : 'Nationsentwurf wird geprüft.'}</p></div>
              <StatusChip tone={!preview||preview.planStale||preview.quotaRulesChanged ? 'warning' : selected.status === 'IMPORTED' ? 'success' : selected.approvals.some(a => a.decision === 'PENDING') ? 'warning' : 'primary'}>{!preview||preview.planStale||preview.quotaRulesChanged?'Prüfung erforderlich':IMPORT_SESSION_STATUS[selected.status]}</StatusChip>
            </div>
            <div className="space-y-4 p-5">
              {closedImportStatuses.has(selected.status)?<><InfoPanel tone="info" title="Importsession geschlossen">Historische Entscheidungen bleiben erhalten. Für eine neue Prüfung Dateien erneut hochladen.</InfoPanel><NewSessionWorkspace canWrite={importAllowed} files={files} preview={preview} loading={loading} error={error} success={success} onFiles={handleFiles} onPreview={runPreview} onCancel={cancel}/></>:<>
              {Boolean(selected.submissions?.length)&&<section aria-label="Erfasste Meldungen" className="text-sm">
                <div className="flex flex-wrap gap-x-5 gap-y-1">{selected.submissions?.map(part=><span key={part.versionId}>{part.family==='Snowboard'?'Snowboard':'Freestyle/Freeski'} · {part.people} Personen · {IMPORT_SESSION_STATUS[part.status]}</span>)}</div>
                {selected.submissionTotal?.conflict&&<p className="mt-1 text-[var(--ops-warning)]">{selected.submissionTotal.conflict}</p>}
              </section>}
              <Workflow session={selected} actionStep={primaryActionStep(selected, files, preview)} upload={<UploadWorkspace files={files} preview={preview} onFiles={handleFiles} onCancel={cancel}/>} action={<SessionPrimaryAction canWrite={importAllowed} session={selected} preview={preview} files={files} loading={loading} confirming={confirming} onPreview={runPreview} onRecheck={recheck} onOpenTask={setActiveTask} onApprove={approve} onImport={confirm} reviewConfirmed={canConfirmReview(preview?.changePlan,destructiveConfirmed,preview?.planStale)}/>} secondaryAction={<details className="w-full text-sm"><summary className="cursor-pointer">Weitere Aktionen</summary><div className="mt-2 flex flex-wrap gap-2">
                {selected.submissions?.map(part=><OpsButton key={part.versionId} disabled={!importAllowed||confirming||loading||savingTask||files.length>0} onClick={()=>void prepareSubmissions(part.versionId)}>Nur {part.family==='Snowboard'?'Snowboard':'Freestyle/Freeski'} prüfen / importieren</OpsButton>)}
                {preview&&!preview.submissionSources&&Boolean(selected.submissions?.length)&&<OpsButton disabled={!importAllowed||confirming||loading||files.length>0} onClick={()=>void prepareSubmissions()}>Nationsentwurf öffnen</OpsButton>}
                {!['IMPORTED','ARCHIVED','REPLACED','CANCELLED'].includes(selected.status)&&<OpsButton onClick={abortSession} disabled={!importAllowed||confirming||loading} className="border-transparent bg-transparent px-2 text-[var(--ops-text-muted)] shadow-none hover:border-[var(--ops-border)] hover:bg-[var(--ops-surface)]"><XCircle className="mr-2 inline h-4 w-4"/>Aktuelle Prüfung abbrechen</OpsButton>}
              </div></details>} />
              {error && <InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}
              {success && selected.status!=='IMPORTED' && <InfoPanel tone="info" title="Prüfstand">{success}</InfoPanel>}
              {preview?.quotaRulesChanged&&<InfoPanel tone="warning" title="Quotenregeln wurden geändert – bitte erneut prüfen">Die ursprüngliche Review-Version bleibt erhalten. Vor der Freigabe erneut prüfen.</InfoPanel>}
              <NextAction session={selected} preview={preview} success={success}/>
              <CompletedDecisions session={selected} onOpen={setActiveTask}/>
              {preview?.cancelledPeople?.length? <details className="rounded-xl border border-[var(--ops-border)] p-3 text-sm"><summary>{preview.cancelledPeople.length} stornierte Meldung(en) · im betroffenen Sportbereich inaktiv</summary><p className="mt-2 text-xs">Bestehende Personen und Competition-Zuordnungen werden ausschließlich über den geprüften Änderungsplan entfernt. Andere Sportbereiche bleiben geschützt.</p><ul className="mt-2 space-y-1">{preview.cancelledPeople.map((p,index)=><li key={index}>{p.firstname} {p.lastname} · {p.sourceFamily==='Freestyle'?'Freestyle/Freeski':p.sourceFamily||'Nationsmeldung'} · Present = CANCELLED · Entry-Zeile {p.rowNumber}</li>)}</ul></details>:null}
              <ImportChangePlan plan={preview?.changePlan} stale={preview?.planStale} editable={selected.status!=='IMPORTED' && selected.status!=='APPROVED'} destructiveConfirmed={destructiveConfirmed} onDestructive={setDestructiveConfirmed} busy={confirming || loading}/>

              {preview&&<PreviewCard onPeople={filter=>{setQuotaPeopleFilter(filter);setPersonFilter('all');setPersonSearch('');setDetail({title:'Personen der Importvorschau',headers:PEOPLE_HEADERS});}} control={selected.importControl} onFilter={(area,filter)=>{setQuotaPeopleFilter(null);setPersonFilter(filter);setPersonSearch('');setDetail({title:area==='people'?'Personen der Importvorschau':'Zimmer der Importvorschau',headers:area==='people'?PEOPLE_HEADERS:['Person 1','Person 2','Zimmer','Aufenthalt','Importstatus']});}} preview={preview} peopleRows={peopleRows} roomRows={roomRows} onOpen={d=>{if(['Personen der Importvorschau','Zimmer der Importvorschau'].includes(d.title)){setQuotaPeopleFilter(null);setPersonFilter('all');setPersonSearch('');}setDetail(d);}}/>}
              {selected.nationClarifications&&<section id="nation-clarifications" aria-label="Abklärung mit Nation" className="space-y-2 border-t border-[var(--ops-divider)] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><SectionHeader title="Abklärung mit Nation"/><OpsButton disabled={!importAllowed||loading||confirming||savingTask||questionBusy||['APPROVED','IMPORTED','REPLACED','ARCHIVED','CANCELLED'].includes(selected.status)} onClick={()=>openQuestion('OPEN')}>Abklärung dokumentieren</OpsButton></div>
                {selected.nationClarifications.items.filter(i=>i.state==='OPEN').map(item=><div key={item.id} className="space-y-1 border-b border-[var(--ops-divider)] py-2 text-sm">
                  <strong>{item.subject.label}{item.subject.people.length>0?` · ${item.subject.people.length} Personen`:''}</strong><details><summary>Betroffene Personen und Details</summary><p>{item.subject.people.join(' · ')}</p></details>{item.subject.facts?.stay&&<p className="text-xs">Aufenthalt: {item.subject.facts.stay.arrivalDate??'—'} – {item.subject.facts.stay.departureDate??'—'} · Fenster: {item.subject.facts.stay.allowedStart??'—'} – {item.subject.facts.stay.allowedEnd??'—'}</p>}<StatusChip tone={item.relevant===false?'neutral':'warning'}>{['APPROVED','IMPORTED','REPLACED','ARCHIVED','CANCELLED'].includes(selected.status)?'Historisch offen':item.relevant===false?'Andere Teilmeldung · offen':item.covered===false?'Aktuelle Quellen nicht gültig geprüft':item.changed?'Fakten geändert · erneut klären':item.replies.length?'Rückmeldung dokumentiert · Erledigung offen':'Warten auf Rückmeldung'}</StatusChip>{item.required&&<span className="ml-2 text-xs font-bold">{item.relevant===false?'Vor Freigabe der betroffenen Teilmeldung klären':'Vor Freigabe klären'}</span>}
                  <p className="text-xs">{Object.entries(item.subject.coverage?.sourceVersionIds??{}).map(([family,id])=>`${family==='Freestyle'?'Freestyle/Freeski':family==='Snowboard'?'Snowboard':'Nationsmeldung'} · Version ${selected.versions.find(v=>v.id===String(id))?.version??id}`).join(' / ')}</p><p className="text-xs">{{EMAIL:'E-Mail',PHONE:'Telefon',OTHER:'Sonstiges'}[item.contactMethod??'']??item.contactMethod} · {item.contactDate} · {item.user} · Version {selected.versions.find(v=>v.id===item.versionId)?.version??item.versionId}</p><p>{item.comment}</p>{item.totalParts? <p className="text-xs">{item.correctedParts} von {item.totalParts} Hinweisen nachweislich korrigiert{item.subject.automatic===false?' · Manuelle Erledigung erforderlich':''}</p>:item.subject.targetType&&<p className="text-xs">Manuelle Erledigung erforderlich</p>}
                  {item.replies.map((reply,index)=><p key={index} className="text-xs">{reply.comment} · {reply.user} · {new Date(reply.timestamp).toLocaleString('de-AT')}</p>)}
                  <div className="flex flex-wrap gap-2"><OpsButton disabled={!importAllowed||loading||confirming||savingTask||questionBusy||['APPROVED','IMPORTED','REPLACED','ARCHIVED','CANCELLED'].includes(selected.status)} onClick={()=>openQuestion('REPLY',item)}>Rückmeldung dokumentieren</OpsButton><OpsButton disabled={!importAllowed||loading||confirming||savingTask||questionBusy||item.covered===false||['APPROVED','IMPORTED','REPLACED','ARCHIVED','CANCELLED'].includes(selected.status)} onClick={()=>openQuestion('RESOLVE',item)}>Rückfrage erledigen</OpsButton></div>
                </div>)}
                {selected.nationClarifications.items.length>0&&!selected.nationClarifications.items.some(i=>i.state==='OPEN')&&<p className="text-sm">Keine offenen Rückfragen · Ergebnisse in der Historie.</p>}
              </section>}

              </>}
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
    {closingSession&&<EnterpriseDialog open title="Importsession schließen?" size="medium" onClose={()=>{if(!confirming)setClosingSession(null);}} actions={<><OpsButton disabled={confirming} onClick={()=>setClosingSession(null)}>Abbrechen</OpsButton><OpsButton disabled={confirming} onClick={()=>void closeSession()}>Importsession schließen</OpsButton></>}>
      <p className="text-sm">Der aktuelle Importworkflow und alle offenen Prüfungen dieser Nation werden beendet. Die Nationsmeldung verschwindet aus der aktiven Importwarteschlange. Bereits importierte Personen, Zimmer und Genehmigungen bleiben unverändert.</p>
      <p className="mt-3 font-bold">{closingSession.nation}</p>{closeError&&<p role="alert" className="mt-3 text-[var(--ops-error)]">{closeError}</p>}
    </EnterpriseDialog>}
    {question&&selected&&<NationClarificationDialog session={selected} action={question.action} item={question.item}
      onClose={()=>setQuestion(null)} onBusy={setQuestionBusy} onSave={async data=>{
        const saved=await api.documentImportClarification(selected.id,data);
        setSelected(saved);setPreview(saved.preview??null);setSessions(rows=>rows.map(row=>row.id===saved.id?saved:row));
      }}/>}
    <OperationsDecisionDialog canWrite={importAllowed} task={activeTask} saving={savingTask} onClose={() => setActiveTask(null)} onSave={saveTask}/>
    <ImportDecisionDialog decisionId={shownDecisionId} onClose={() => setShownDecisionId(null)} onOpenSession={async sessionId => { setShownDecisionId(null); const session = sessions.find(item => item.id === sessionId); if (session) await selectSession(session); }} />

  </div>;
}

function NewSessionWorkspace({canWrite,files,preview,loading,error,success,onFiles,onPreview,onCancel}:{canWrite:boolean;files:File[];preview:FisImportPreview|null;loading:boolean;error:string|null;success:string|null;onFiles:(files:FileList|null)=>void;onPreview:()=>void;onCancel:()=>void}) { return <>
  <div className="sticky top-0 z-10 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] p-5"><SectionHeader title="Importprüfung"/><h2 className="mt-2 text-2xl font-extrabold">Nationsmeldung prüfen</h2></div>
  <div className="space-y-4 p-5"><Workflow session={null} actionStep="validation" upload={<UploadWorkspace files={files} preview={preview} onFiles={onFiles} onCancel={onCancel}/>} action={<OpsButton onClick={onPreview} disabled={!canWrite||files.length<2||loading}>{loading?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<FileCheck2 className="mr-2 inline h-4 w-4"/>}Dateien prüfen</OpsButton>}/>{error&&<InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}{success&&<InfoPanel tone="success" title="Import abgeschlossen">{success}</InfoPanel>}</div>
</>; }

function UploadWorkspace({files,preview,onFiles,onCancel}:{files:File[];preview:FisImportPreview|null;onFiles:(files:FileList|null)=>void;onCancel:()=>void}) { return <div className="grid items-start gap-3 lg:grid-cols-2"><UploadCard files={files} onChange={onFiles}/><SelectedFiles files={files} preview={preview} onCancel={onCancel}/></div>; }


function SelectedFiles({files,preview,onCancel}:{files:File[];preview:FisImportPreview|null;onCancel:()=>void}) { return <ContentCard surface="elevated" className="p-2"><SectionHeader title="Ausgewählte Dateien"/><div className="mt-2 space-y-1.5">{files.length?files.map(file=><div key={file.name} className="flex items-center justify-between rounded-lg bg-[var(--ops-surface)] px-3 py-1.5 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0"/><span className="truncate">{file.name}</span></span><span className="font-mono text-xs text-[var(--ops-text-muted)]">{(file.size/1024).toFixed(1)} KB</span></div>):<p className="rounded-lg bg-[var(--ops-surface)] px-3 py-2 text-sm font-bold text-[var(--ops-text-muted)]">Noch keine Dateien</p>}</div><div className="mt-2"><OpsButton onClick={onCancel} disabled={!files.length}><RefreshCcw className="mr-2 inline h-4 w-4"/>Auswahl zurücksetzen</OpsButton></div></ContentCard>; }

function visibleWorkflow(session: ImportSession | null): WorkflowStep[] {
  if (!session) return [{ id: 'validation', label: 'Technische Validierung', complete: false, current: true }, { id: 'decision', label: 'Entscheidung (falls erforderlich)', complete: false, current: false }, { id: 'approval', label: 'Freigeben', complete: false, current: false }, { id: 'import', label: 'Importieren', complete: false, current: false }];
  const status = session.status;
  const imported = status === 'IMPORTED';
  const validationComplete = status !== 'DRAFT';
  const pendingDecisions = session.approvals.some(item => item.decision === 'PENDING');
  const approved = ['APPROVED', 'IMPORTED'].includes(status);
  const clarification = ['WAITING_FOR_NATION', 'NATION_CLARIFICATION', 'RECHECK_REQUIRED'].includes(status)||Boolean(session.nationClarifications?.items.some(i=>i.required&&i.state==='OPEN'&&i.relevant!==false));
  return [
    { id: 'validation', label: 'Technische Validierung', complete: validationComplete, current: !validationComplete },
    { id: 'decision', label: 'Entscheidung (falls erforderlich)', complete: validationComplete && !pendingDecisions && !clarification, current: validationComplete && (pendingDecisions || clarification) },
    { id: 'approval', label: 'Freigeben', complete: approved, current: !approved && !pendingDecisions && !clarification && validationComplete },
    { id: 'import', label: 'Importieren', complete: imported, current: status === 'APPROVED' },
  ];
}

function Workflow({session,upload,action,actionStep,secondaryAction}:{session:ImportSession|null;upload:ReactNode;action:ReactNode;actionStep:WorkflowStep['id'];secondaryAction?:ReactNode}) {
  const steps = visibleWorkflow(session).map(step=>actionStep==='validation'?{...step,complete:false,current:step.id==='validation'}:step);
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
    {secondaryAction&&<div className="mt-2 flex items-center justify-between border-t border-[var(--ops-divider)] px-1 pt-2" aria-label="Workflowverwaltung">{secondaryAction}</div>}
  </ContentCard>;
}

function ActiveWorkflowStep({step,session,upload,action}:{step:WorkflowStep;session:ImportSession|null;upload:ReactNode;action:ReactNode}) {
  const pending = session?.approvals.filter(approval=>approval.decision==='PENDING').length ?? 0;
  const description:Record<WorkflowStep['id'],string> = {
    validation: 'Meldungen auf aktuellem Stand prüfen.',
    decision: pending ? `${pending} offene fachliche ${pending===1?'Entscheidung':'Entscheidungen'} prüfen.` : 'Offene fachliche Entscheidungen prüfen.',
    approval: 'Geprüfte Version für den Import freigeben.',
    import: session?.status==='IMPORTED'?'Der geprüfte Umfang ist importiert.':'Freigegebenen Nationsentwurf kontrolliert übernehmen.',
  };
  return <div className="mt-2">
    <section className="rounded-lg border border-[var(--ops-border-strong)] bg-[var(--ops-surface)] px-2 py-1.5" aria-labelledby={`workflow-step-${step.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><StatusChip tone="primary">Aktueller Schritt</StatusChip><h3 id={`workflow-step-${step.id}`} className="font-extrabold">{step.label.replace(' (falls erforderlich)','')}</h3></div><div className="[&_button]:border-[var(--ops-primary)] [&_button]:bg-[var(--ops-tone-primary-surface)]">{action}</div></div>
      <p className="mt-0.5 text-xs text-[var(--ops-text-muted)]">{description[step.id]}</p>
    </section>
    <div className="mt-2">{upload}</div>
  </div>;
}

function primaryActionStep(session:ImportSession, files:File[], preview:FisImportPreview|null):WorkflowStep['id'] {
  if(files.length||!preview||preview.planStale||preview.quotaRulesChanged||!preview.changePlan||preview.errors.length)return 'validation';
  if(session.approvals.some(approval=>approval.decision==='PENDING')) return 'decision';
  if(['APPROVED','IMPORTED'].includes(session.status)) return 'import';
  if(files.length>=2 || session.status==='IMPORTED' || ['DRAFT','WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED'].includes(session.status)) return 'validation';
  return 'approval';
}

export function SessionPrimaryAction({canWrite=true,session,preview,files,loading,confirming,onPreview,onRecheck,onOpenTask,onApprove,onImport,reviewConfirmed}:{canWrite?:boolean;reviewConfirmed:boolean;session:ImportSession;preview:FisImportPreview|null;files:File[];loading:boolean;confirming:boolean;onPreview:()=>void;onRecheck:()=>void;onOpenTask:(task:OperationsTask)=>void;onApprove:()=>void;onImport:()=>void}) {
  const pending=session.approvals.map(approval=>buildOperationsTask(session,approval)).filter(task=>task.approval.decision==='PENDING');
  const needsFiles=['DRAFT','WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED'].includes(session.status);
  const canApprove=!session.nationClarifications?.items.some(i=>i.required&&i.state==='OPEN'&&i.relevant!==false)&&Boolean(preview?.isValid)&&session.approvals.every(a=>a.decision==='APPROVED')&&['PROFESSIONALLY_REVIEWED','READY_FOR_IMPORT','WAITING_FOR_NATION','NATION_CLARIFICATION','NEW_LIST_RECEIVED','EXCEPTION_APPROVED'].includes(session.status);
  if(files.length) return <OpsButton onClick={onPreview} disabled={!canWrite||files.length<2||loading||confirming}>Dateien prüfen</OpsButton>;
  if(!preview||preview.planStale||preview.quotaRulesChanged||!preview.changePlan) return <OpsButton onClick={onRecheck} disabled={!canWrite||loading||confirming}>Prüfung fortsetzen</OpsButton>;
  if(preview.errors.length) return <OpsButton disabled={!canWrite||loading||confirming} onClick={()=>document.getElementById('fis-files-input')?.click()}>Dateien aktualisieren</OpsButton>;
  if(pending.length) return <OpsButton disabled={!canWrite||loading||confirming}  onClick={()=>onOpenTask(pending[0])}>Entscheidungen bearbeiten</OpsButton>;
  if(session.status==='APPROVED') return <OpsButton onClick={onImport} disabled={!canWrite||loading||confirming || preview?.planStale} className="border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]"><CheckCircle className="mr-2 inline h-4 w-4"/>Importieren</OpsButton>;
  if(session.status==='IMPORTED') return <OpsButton onClick={onRecheck} disabled={!canWrite||loading||confirming}>Erneut prüfen</OpsButton>;
  if(session.nationClarifications?.items.some(i=>i.required&&i.state==='OPEN'&&i.relevant!==false)) return <OpsButton disabled={!canWrite||loading||confirming} onClick={()=>document.getElementById('nation-clarifications')?.scrollIntoView({block:'center'})}>Rückfrage klären</OpsButton>;
  if(needsFiles) return <OpsButton onClick={onRecheck} disabled={!canWrite||loading||confirming||Boolean(preview.errors.length)}>Prüfung fortsetzen</OpsButton>;
  return <OpsButton onClick={onApprove} disabled={!canWrite||loading||confirming||!canApprove || !reviewConfirmed}>Freigeben</OpsButton>;

}

function NextAction({session,preview,success}:{session:ImportSession;preview:FisImportPreview|null;success:string|null}) {
  const pending=session.approvals.filter(approval=>approval.decision==='PENDING').length;
  const clarification=['WAITING_FOR_NATION','NATION_CLARIFICATION','RECHECK_REQUIRED'].includes(session.status)||Boolean(session.nationClarifications?.items.some(i=>i.required&&i.state==='OPEN'&&i.relevant!==false));
  if(!preview||preview.planStale||preview.quotaRulesChanged||preview.errors.length)return null;

  if(pending) return <InfoPanel tone="warning" title="Entscheidung erforderlich">{pending} {pending===1?'offene Entscheidung muss':'offene Entscheidungen müssen'} vor der Freigabe abgeschlossen werden.</InfoPanel>;
  if(session.status==='IMPORTED') return <InfoPanel tone="success" title="Import abgeschlossen">{success ?? 'Der geprüfte Umfang ist importiert. Weitere Dateien können hinzugefügt oder aktualisiert werden.'}</InfoPanel>;
  if(session.status==='APPROVED') return <InfoPanel tone="success" title="Freigegeben">Die Importsession ist bereit für den kontrollierten Import.</InfoPanel>;
  if(clarification) return <InfoPanel tone="warning" title="Klärung erforderlich">Die fachliche Klärung oder eine neue Meldeliste ist erforderlich, bevor freigegeben werden kann.</InfoPanel>;
  return <InfoPanel tone="info" title="Prüfung abgeschlossen">Alle Prüfungen und erforderlichen Entscheidungen sind abgeschlossen.</InfoPanel>;
}
function CompletedDecisions({session,onOpen}:{session:ImportSession;onOpen:(task:OperationsTask)=>void}) {
  const completed=session.approvals.filter(approval=>approval.decision==='APPROVED');
  if(!completed.length) return null;
  return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Abgeschlossene Entscheidungen" subtitle="Bestehende Genehmigungen bleiben erledigt und können ausdrücklich geändert werden."/><div className="mt-3 space-y-2">{completed.map(approval=><OperationsTaskRow key={approval.id} task={buildOperationsTask(session,approval)} onOpen={()=>onOpen(buildOperationsTask(session,approval))}/>)}</div></ContentCard>;
}
function SessionHistory({session,onShowDecision}:{session:ImportSession;onShowDecision:(id:string)=>void}) { return <ContentCard surface="elevated" className="p-4"><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-3"><SectionHeader title="Historie" subtitle={`${session.versions?.length ?? 0} Version(en) · bei Bedarf aufklappen`}/><ChevronDown className="h-5 w-5 shrink-0 text-[var(--ops-text-subtle)] transition-transform group-open:rotate-180"/></summary><div className="mt-4 space-y-3">{session.history?.length ? [...session.history].reverse().map(event=>{const content=<><Clock3 className="mt-0.5 h-4 w-4 text-[var(--ops-text-subtle)]"/><div><div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{event.title}</span><span className="font-mono text-xs text-[var(--ops-text-subtle)]">{new Date(event.timestamp).toLocaleString('de-DE')} · {event.user}{event.versionId?` · Version ${session.versions.find(v=>v.id===event.versionId)?.version??event.versionId}`:''}</span></div>{event.description&&<p className="mt-1 text-sm text-[var(--ops-text-muted)]">{event.description}</p>}</div></>;return event.decisionId?<button key={event.id} type="button" onClick={()=>onShowDecision(event.decisionId!)} className="grid w-full grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3 text-left transition hover:text-[var(--ops-primary)]">{content}</button>:<div key={event.id} className="grid grid-cols-[auto_1fr] gap-3 border-b border-[var(--ops-divider)] pb-3">{content}</div>}):<EmptyState title="Noch keine Historieneinträge" description="Versionen, Entscheidungen und Freigaben werden automatisch protokolliert."/>}</div></details></ContentCard>; }
function UploadCard({files,onChange}:{files:File[];onChange:(f:FileList|null)=>void}) { return <ContentCard surface="elevated" className="p-2"><div className="flex flex-wrap items-center justify-between gap-2"><SectionHeader title="Dateien hinzufügen oder aktualisieren"/></div><label htmlFor="fis-files-input" className="mt-2 block cursor-pointer rounded-xl border-2 border-dashed border-[var(--ops-border-strong)] bg-[var(--ops-surface)] p-3 text-center hover:bg-[var(--ops-tone-primary-surface)]"><Upload className="mx-auto h-7 w-7 text-[var(--ops-primary)]"/><p className="mt-1 font-bold">{files.length ? `${files.length} Datei(en) ausgewählt` : 'Dateien auswählen oder ablegen'}</p><p className="mt-0.5 text-xs text-[var(--ops-text-muted)]">{REQUIRED_FILE_HINTS.join(' + ')}</p></label></ContentCard>; }

type FisImportPreviewPersonWithKey = FisImportPreview['people'][number] & { matchKey?: string };
export function PreviewCard({preview,peopleRows,roomRows,onOpen,control,onFilter,onPeople}:{preview:FisImportPreview|null;peopleRows:ReactNode[][];roomRows:ReactNode[][];onOpen:(detail:Detail)=>void;control?:ImportControl;onFilter?:(area:'people'|'rooms',filter:ImportListFilter)=>void;onPeople?:(filter:QuotaPeopleFilter)=>void}) {
 const tile='flex min-h-40 flex-col rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4';
 const openPeople=()=>onOpen({title:'Personen der Importvorschau',rows:peopleRows,headers:PEOPLE_HEADERS});
 const openRooms=()=>onOpen({title:'Zimmer der Importvorschau',rows:roomRows,headers:['Person 1','Person 2','Zimmer','Aufenthalt','Importstatus']});
 const personFilters=(['error','clarification','noRoom','stay','stayUnclear','singleRoom','special'] as const).map(filter=>({filter,count:filter==='error'?(preview?.errors.filter(i=>!i.code.startsWith('ROOM_')).length??0):(preview?.people.filter(p=>personMatchesImportFilter(p,filter,preview,control)).length??0)})).filter(h=>h.count);
 const sportIssues=sportClarifications(control);
 const ez=preview?singleRoomSummary(preview):null;
 const roomFilters=(['error','clarification','partner'] as const).map(filter=>({filter,count:filter==='error'?(preview?.errors.filter(i=>i.code.startsWith('ROOM_')).length??0):(preview?.rooms.filter(r=>roomMatchesImportFilter(r,filter,preview,control)).length??0)})).filter(h=>h.count);

 return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Importvorschau" subtitle={importScopeLabel(preview) || undefined}/><div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
  <div className={tile}><button type="button" onClick={openPeople} className="text-left"><strong>Personen</strong><p>{preview?.people.length??0} Personen{preview?.replacementScope?.kind==='SPORT_FAMILY'&&!preview?.submissionSources ? ' aus diesen Dateien' : ''}</p></button>{personFilters.map(h=><button type="button" key={h.filter} onClick={()=>onFilter?onFilter('people',h.filter):openPeople()} className="mt-2 text-left text-sm text-[var(--ops-primary)]">{h.count} {importListFilters[h.filter]}</button>)}{preview&&!personFilters.some(h=>h.filter==='error'||h.filter==='clarification'||h.filter==='stay'||h.filter==='stayUnclear')&&<span className="mt-auto pt-2 text-sm text-[var(--ops-success)]">OK</span>}</div>
  <div className={tile}><button type="button" onClick={openRooms} className="text-left"><strong>Zimmerzuordnungen</strong><p>{preview?.rooms.length??0} Zimmerangaben</p></button>{roomFilters.map(h=><button type="button" key={h.filter} onClick={()=>onFilter?onFilter('rooms',h.filter):openRooms()} className="mt-2 text-left text-sm text-[var(--ops-primary)]">{h.count} {h.filter==='partner'?'Partner ungeklärt':importListFilters[h.filter]}</button>)}{preview&&!roomFilters.length&&<span className="mt-auto pt-2 text-sm text-[var(--ops-success)]">OK</span>}</div>
  <div className={tile}><button type="button" onClick={()=>onOpen({title:'Officials & EZ-Quote'})} className="text-left"><strong>Officials & EZ-Quote</strong><span className="block">{preview?.quotaOverview?.nations.reduce((sum,n)=>sum+n.ezDecisionsOpen,0)??0} EZ-Kontexte offen</span><span className="block pt-2">{ez&&!ez.complete||preview?.quotaOverview?.nations.some(n=>n.coverageReviewRequired||n.incomplete)?'Abdeckung prüfen':ez?.counts.PENDING?'EZ-Entscheidung offen':'OK'}</span></button>{ez&&ez.counts.PENDING>0&&<button type="button" className="mt-2 text-left text-sm text-[var(--ops-primary)]" onClick={()=>onPeople?.({role:'people',personKeys:ez.personKeys.PENDING})}>{ez.counts.PENDING} EZ-Personen offen</button>}</div>
  <div className={tile}><button type="button" onClick={()=>onOpen({title:'Athleten-/Disziplinquote'})} className="flex flex-col gap-1 text-left"><strong>Athleten-/Disziplinquote</strong>{preview?.athleteQuotaChecks?.map(q=><span key={`${q.nationCode}/${q.topLevelDiscipline}`}>{q.topLevelDiscipline}: {q.athleteQuotaUsed} / {q.athleteQuotaLimit} · Familienquote</span>)}<span>{preview?<AthleteQuotaPreviewStatus preview={preview}/>: 'Noch keine Vorschau'}</span></button>{sportIssues.length>0&&<button type="button" onClick={()=>onOpen({title:'Athleten-/Disziplinquote',focusSport:true})} title={sportIssues.map(row=>`${row.nation} · ${row.name}`).join('; ')} className="mt-2 text-left text-sm font-bold text-[var(--ops-warning)]">{sportIssues.length} {sportIssues.length===1?'Sportliche Prüfung offen':'Wettbewerbspositionen prüfen'}<span className="block text-xs font-normal">{sportIssues.map(row=>`${competitionDisplayName(row.name)} ${row.gender==='M'?'Männer':['F','W'].includes(row.gender??'')?'Frauen':row.gender??''}`).join(' · ')}</span></button>}</div>
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
  if(detail && ['Officials & EZ-Quote','Quota & EZ','Athleten-/Disziplinquote'].includes(detail.title))return <QuotaOverviewDialog preview={preview} control={control} kind={detail.title==='Athleten-/Disziplinquote'?'athlete':'officials'} onPeople={onQuotaPeople} focusSport={detail.focusSport} onClose={onClose}/>;
  const isQuota=detail?.title === 'Officials & EZ-Quote';
  const wide= isQuota || detail?.title === 'Personen der Importvorschau';
  const uncheckable=preview?.people.filter(person=>personMatchesImportFilter(person,'stayUnclear',preview,control))??[];
  const unavailableLabel=uncheckable.every(person=>control?.people.find(row=>row.personKey===person.matchKey)?.stayWindow?.reason==='EVENT_DATES_UNCLEAR')?stayWindowText(control?.people.find(row=>row.personKey===uncheckable[0]?.matchKey)?.stayWindow):'Event-/Aufenthaltsdaten unklar';
  return (
    <Dialog open={Boolean(detail)} onClose={onClose} fullWidth maxWidth={wide ? false : "lg"} sx={wide ? {'& .MuiDialog-paper': {width: {xs: 'calc(100vw - 32px)', sm: '90vw'}, maxWidth: '1600px', maxHeight: 'calc(100dvh - 64px)'}} : undefined}>
      <DialogTitle>{detail?.title}<div className="text-sm font-normal text-[var(--ops-text-muted)]">{detail?.subtitle}</div></DialogTitle>
      <DialogContent dividers sx={{overflowY: 'auto'}}>
        {['Personen der Importvorschau','Zimmer der Importvorschau'].includes(detail?.title??'')&&preview&&<div className="space-y-3"><div className="flex flex-wrap gap-3"><label className="text-sm">Person suchen<input value={search} onChange={e=>onSearch(e.target.value)} className="ml-2 rounded border border-[var(--ops-border)] bg-[var(--ops-background)] p-2"/></label><label className="text-sm">Anzeigen<select value={personFilter} onChange={e=>onFilter(e.target.value as ImportListFilter)} className="ml-2 rounded border border-[var(--ops-border)] bg-[var(--ops-background)] p-2">{Object.entries(importListFilters).map(([key,label])=><option key={key} value={key}>{key==='all'&&detail?.title==='Personen der Importvorschau'?'Alle Personen':label}</option>)}</select></label></div></div>}
        {detail?.title==='Personen der Importvorschau'&&uncheckable.length>0&&<button type="button" className="my-2 text-left text-sm text-[var(--ops-warning)]" onClick={()=>{onQuotaPeople(null);onSearch('');onFilter('stayUnclear');}}>{uncheckable.length} Aufenthalte nicht prüfbar · {unavailableLabel}</button>}
        {personFilter==='error'&&preview&&['Personen der Importvorschau','Zimmer der Importvorschau'].includes(detail?.title??'')&&<ul className="space-y-1 text-sm text-[var(--ops-error)]">{preview.errors.filter(i=>i.code.startsWith('ROOM_')===(detail?.title==='Zimmer der Importvorschau')).map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}
        {detail?.title==='Personen der Importvorschau'&&quotaPeopleFilter&&<div className="mb-2 flex flex-wrap items-center gap-2 text-sm" aria-label="Quoten-Personenfilter"><strong>{quotaPeopleFilter.role==='officials'?'Officials':quotaPeopleFilter.role==='athletes'?'Athleten':'Personen'}{quotaPeopleFilter.nation?` · ${quotaPeopleFilter.nation}`:''}{quotaPeopleFilter.group?` · ${quotaPeopleFilter.group}`:''}{quotaPeopleFilter.multipleGroups?' · Mehrere Event Groups':''}{quotaPeopleFilter.competition?` · ${quotaPeopleFilter.competition}`:''}{quotaPeopleFilter.family?` · ${quotaPeopleFilter.family}`:''}{quotaPeopleFilter.gender?` · ${quotaPeopleFilter.gender==='M'?'Männer':'Frauen'}`:''}</strong><button type="button" className="text-[var(--ops-primary)] underline" onClick={()=>onQuotaPeople(null)}>Filter aufheben</button></div>}
        <div className="space-y-6">{(['Personen der Importvorschau','Zimmer der Importvorschau'].includes(detail?.title??'')?[]:detail?.issues)?.map((issue,i)=><IssueRecord key={`${issue.code}-${i}`} issue={issue} isInformation={!preview?.errors.some(e=>e.code===issue.code)&&!control?.issues.some(i=>i.code===issue.code&&i.kind==='clarification')} isDecision={!preview?.errors.some(e=>e.code===issue.code)&&Boolean(control?.issues.some(i=>i.code===issue.code&&i.kind==='clarification'))}/>)}</div>
        {detail?.rows&&detail.rows.length>0&&<div tabIndex={0} role="region" aria-label={`${detail.title} – Tabelle horizontal scrollbar`} className="mt-3 overflow-x-auto"><table className={`w-full text-sm ${wide ? 'min-w-[1050px]' : ''}`}><thead><tr>{detail.headers?.map(h=><th key={h} className={`border-b border-[var(--ops-divider)] px-3 py-2 whitespace-nowrap text-xs uppercase text-[var(--ops-text-subtle)] ${isQuota && quotaHeaders.indexOf(h) >= 2 && quotaHeaders.indexOf(h) <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead><tbody>{detail.rows.map((r,i)=><tr key={i} className="border-b border-[var(--ops-divider)]">{r.map((c,j)=><td key={j} className={`px-3 py-2 ${isQuota && j >= 2 && j <= 6 ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody></table></div>}
        {detail&&!detail.issues?.length&&!detail.rows?.length&&<EmptyState title="Keine betroffenen Datensätze" description="Für diese Session liegen keine Detailänderungen vor."/>}
      </DialogContent>
    </Dialog>
  );
}
