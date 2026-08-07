import { type CSSProperties, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { AlertTriangle, CheckCircle, ChevronRight, FileCheck2, FileText, Loader2, RefreshCcw, Upload, Users } from 'lucide-react';

import { api } from '../services/api';
import type { FisImportIssue, FisImportPreview } from '../types';
import type { ImportSession } from '../data/importSessions';
import { mockImportSessions } from '../data/importSessions';
import { ContentCard, EmptyState, InfoPanel, OpsButton, PageHeader, PageLayout, SectionHeader, StatusChip } from '../design-system';
import { MetricCard } from '../design-system/components/cards';
import { ImportQueue } from './ImportQueue';

const REQUIRED_FILE_HINTS = ['ENTRIES-LIST', 'ENTRIES-ROOM-LIST-DETAILED'];
const workflowSteps = ['Datei', 'Preview', 'Prüfung', 'Import', 'Auswirkungen', 'Nachbearbeitung'];
const theme = { '--ops-background':'#111d2e','--ops-surface':'#1a2a40','--ops-surface-raised':'#21334c','--ops-surface-elevated':'#2a3e59','--ops-surface-overlay':'#344b67','--ops-border':'#4b6380','--ops-divider':'#405773','--ops-text-muted':'#b7c4d4' } as CSSProperties;
type Detail = { title: string; subtitle?: string; issues?: FisImportIssue[]; rows?: string[][]; headers?: string[] };

export function DataImport() {
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ImportSession>(mockImportSessions[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<FisImportPreview | null>(null);
  const [loading, setLoading] = useState(false), [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const quotaWarnings = useMemo(() => preview?.warnings.filter(i => i.code.startsWith('QUOTA_')) ?? [], [preview]);
  const otherWarnings = useMemo(() => preview?.warnings.filter(i => !i.code.startsWith('QUOTA_')) ?? [], [preview]);
  const currentStep = success ? 4 : preview ? 2 : files.length ? 1 : 0;

  const selectSession = (session: ImportSession) => { setSelected(session); detailScrollRef.current?.scrollTo({ top: 0 }); };
  const handleFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return; const accepted = Array.from(incoming).filter(f => /\.xlsx?$/i.test(f.name));
    if (!accepted.length) { setError('Bitte Excel-Dateien (.xlsx, .xls) hochladen.'); return; }
    setFiles([...new Map(accepted.map(f => [f.name.toLowerCase(), f])).values()]); setPreview(null); setSuccess(null); setError(null);
  };
  const cancel = () => { setFiles([]); setPreview(null); setError(null); setSuccess(null); const input = document.getElementById('fis-files-input') as HTMLInputElement | null; if (input) input.value = ''; };
  const runPreview = async () => { if (files.length < 2) return; setLoading(true); setError(null); setSuccess(null); setPreview(null); try { setPreview(await api.previewFisImport(files)); } catch (e) { setError(e instanceof Error ? e.message : 'Preview fehlgeschlagen'); } finally { setLoading(false); } };
  const confirm = async () => { if (!preview?.previewToken) return; setConfirming(true); setError(null); try { const result = await api.confirmFisImport(preview.previewToken); setSuccess(`Import erfolgreich: ${result.summary.peopleCreated} neu, ${result.summary.peopleUpdated} aktualisiert, ${result.summary.fisRoomsImported} FIS-Zimmer importiert.`); setPreview(null); setFiles([]); setTimeout(() => window.location.reload(), 2000); } catch (e) { setError(e instanceof Error ? e.message : 'Import fehlgeschlagen'); } finally { setConfirming(false); } };

  const openIssues = (title: string, issues: FisImportIssue[]) => setDetail({ title, subtitle: `${issues.length} betroffene Prüfhinweise`, issues });
  const peopleRows = preview?.people.map(p => [`${p.firstname} ${p.lastname}`, p.nationCode, p.discipline || '—', p.function || '—', p.operation]) ?? [];
  const roomRows = preview?.rooms.map(r => [r.person1Name, r.person2Name || '—', r.roomType, [r.checkInDate, r.checkOutDate].filter(Boolean).join(' → ') || '—']) ?? [];

  return <div style={theme} className="-m-6 h-[calc(100vh-0px)] min-h-[720px] bg-[var(--ops-background)] p-6 text-[var(--ops-text)]">
    <PageLayout className="flex h-full min-h-0 flex-col gap-5 space-y-0">
      <PageHeader eyebrow="Operations Center" title="Import Center" subtitle="FIS-Import Sessions prüfen, entscheiden und kontrolliert abschließen." meta={<><StatusChip tone={selected.errors ? 'error' : selected.warnings ? 'warning' : 'success'}>{selected.status}</StatusChip><span className="text-sm text-[var(--ops-text-muted)]">{selected.id} · {selected.nation} · {selected.discipline}</span></>} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 xl:flex-row">
        <ImportQueue selectedId={selected.id} onSelect={selectSession} />
        <ContentCard surface="raised" className="min-h-0 flex-1 overflow-hidden">
          <div ref={detailScrollRef} className="h-full overflow-y-auto">
            <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ops-divider)] bg-[var(--ops-surface-raised)] p-5">
              <div><SectionHeader title="Session" /><h2 className="mt-2 text-2xl font-extrabold">{selected.nation} · {selected.discipline}</h2><p className="text-sm text-[var(--ops-text-muted)]">{selected.uploadedAt} · {selected.uploadedBy} · Version {selected.version}</p></div>
              <div className="flex gap-2"><OpsButton onClick={runPreview} disabled={files.length < 2 || loading}>{loading ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 inline h-4 w-4" />}Preview prüfen</OpsButton><OpsButton onClick={confirm} disabled={!preview?.isValid || confirming} className="border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]"><CheckCircle className="mr-2 inline h-4 w-4" />Importieren</OpsButton></div>
            </div>
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><MetricCard label="Status" value={selected.status} helper="Aktueller Schritt" tone="primary" /><MetricCard label="Personen" value={preview?.summary.people.total ?? '—'} helper="Importumfang" /><MetricCard label="Neu" value={preview?.summary.people.wouldCreate ?? '—'} helper="Athleten & Officials" tone="success" /><MetricCard label="Warnungen" value={preview?.summary.validation.warningCount ?? selected.warnings} helper="zu prüfen" tone="warning" /><MetricCard label="Fehler" value={preview?.summary.validation.errorCount ?? selected.errors} helper="blockierend" tone="error" /></div>
              <Workflow current={currentStep} />
              <div className="grid items-start gap-5 lg:grid-cols-2">
                <UploadCard files={files} onChange={handleFiles} />
                <ContentCard surface="elevated" className="p-4"><SectionHeader title="Uploadinformationen" subtitle="Dateien und Session-Aktionen" /><div className="mt-4 space-y-2">{files.length ? files.map(f => <div key={f.name} className="flex items-center justify-between rounded-lg bg-[var(--ops-surface)] p-3 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0"/><span className="truncate">{f.name}</span></span><span className="font-mono text-xs text-[var(--ops-text-muted)]">{(f.size/1024).toFixed(1)} KB</span></div>) : <EmptyState title="Noch keine Dateien" description="Beide FIS-Dateien gemeinsam hochladen." />}</div><div className="mt-3"><OpsButton onClick={cancel} disabled={!files.length && !preview}><RefreshCcw className="mr-2 inline h-4 w-4"/>Upload zurücksetzen</OpsButton></div></ContentCard>
              </div>
              {error && <InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel>}{success && <InfoPanel tone="success" title="Import abgeschlossen">{success}</InfoPanel>}
              <div className="grid items-start gap-5 lg:grid-cols-2"><ProblemList preview={preview} fallback={selected} quota={quotaWarnings} others={otherWarnings} onOpen={openIssues}/><ImpactList preview={preview} peopleRows={peopleRows} roomRows={roomRows} onOpen={setDetail}/></div>
              <ContentCard surface="elevated" className="p-4"><SectionHeader title="Preview" subtitle="Details werden erst auf Auswahl geöffnet"/><div className="mt-4 grid gap-3 sm:grid-cols-2"><SummaryRow label="Personen-Vorschau" count={peopleRows.length} onClick={() => setDetail({title:'Personen-Vorschau', rows:peopleRows, headers:['Name','Nation','Disziplin','Funktion','Aktion']})}/><SummaryRow label="Zimmer-Vorschau" count={roomRows.length} onClick={() => setDetail({title:'Zimmer-Vorschau', rows:roomRows, headers:['Person 1','Person 2','Zimmer','Aufenthalt']})}/></div></ContentCard>
            </div>
          </div>
        </ContentCard>
      </div>
    </PageLayout>
    <DetailDialog detail={detail} onClose={() => setDetail(null)} />
  </div>;
}

function Workflow({current}:{current:number}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Workflow"/><ol className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-6">{workflowSteps.map((s,i)=><li key={s} className={`rounded-lg border p-2.5 ${i<=current?'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]':'border-[var(--ops-border)] bg-[var(--ops-surface)]'}`}><span className="font-mono text-[10px] text-[var(--ops-text-subtle)]">0{i+1}</span><div className="text-xs font-bold">{s}</div></li>)}</ol></ContentCard>; }
function UploadCard({files,onChange}:{files:File[];onChange:(f:FileList|null)=>void}) { return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Neue Import Session" subtitle="Beide Dateien in einem Schritt auswählen"/><label className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-[var(--ops-border-strong)] bg-[var(--ops-surface)] p-6 text-center hover:bg-[var(--ops-tone-primary-surface)]"><input id="fis-files-input" type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={e=>onChange(e.target.files)}/><Upload className="mx-auto h-8 w-8 text-[var(--ops-primary)]"/><p className="mt-2 font-bold">{files.length ? `${files.length} Datei(en) ausgewählt` : 'Dateien auswählen oder ablegen'}</p><p className="mt-1 text-xs text-[var(--ops-text-muted)]">{REQUIRED_FILE_HINTS.join(' + ')}</p></label></ContentCard>; }
function ProblemList({preview,fallback,quota,others,onOpen}:{preview:FisImportPreview|null;fallback:ImportSession;quota:FisImportIssue[];others:FisImportIssue[];onOpen:(t:string,i:FisImportIssue[])=>void}) { const entries=[['Blockierende Fehler',preview?.errors??[],fallback.errors],['Quotenüberschreitungen',quota,preview?quota.length:Math.min(fallback.warnings,1)],['Weitere Hinweise',others,preview?others.length:Math.max(0,fallback.warnings-1)]] as const; return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Prüfergebnis" subtitle="Probleme kompakt nach Kategorie"/><div className="mt-4 space-y-2">{entries.map(([label,issues,count])=><SummaryRow key={label} label={label} count={count} tone={label==='Blockierende Fehler'?'error':'warning'} disabled={!preview || !issues.length} onClick={()=>onOpen(label,[...issues])}/>)}{entries.every(e=>e[2]===0)&&<InfoPanel tone="success" title="Keine Probleme">Die Session ist bereit für den Import.</InfoPanel>}</div></ContentCard>; }
function ImpactList({preview,peopleRows,roomRows,onOpen}:{preview:FisImportPreview|null;peopleRows:string[][];roomRows:string[][];onOpen:(d:Detail)=>void}) { const items=[['Neue Athleten',preview?.summary.people.wouldCreate??0,peopleRows],['Aktualisierte Athleten',preview?.summary.people.wouldUpdate??0,peopleRows],['Zimmerpartner geändert',0,roomRows],['Zimmerbedarf geändert',preview?.summary.rooms.wouldReplaceFisRooms??0,roomRows],['Quoten betroffen',preview?.warnings.filter(i=>i.code.startsWith('QUOTA_')).length??0,[]],['Aufenthaltsdaten geändert',0,roomRows]] as const; return <ContentCard surface="elevated" className="p-4"><SectionHeader title="Auswirkungen des Imports" subtitle="Zusammenfassung statt vollständiger Tabellen"/><div className="mt-4 space-y-2">{items.map(([label,count,rows])=><SummaryRow key={label} label={label} count={count} disabled={!preview||!count} onClick={()=>onOpen({title:label,subtitle:`${count} Änderungen`,rows:[...rows],headers:rows===roomRows?['Person 1','Person 2','Zimmer','Aufenthalt']:['Name','Nation','Disziplin','Funktion','Aktion']})}/>)}</div></ContentCard>; }
function SummaryRow({label,count,tone='neutral',disabled,onClick}:{label:string;count:number;tone?:'neutral'|'warning'|'error';disabled?:boolean;onClick:()=>void}) { return <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center justify-between rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2.5 text-left transition hover:border-[var(--ops-border-strong)] hover:bg-[var(--ops-surface-overlay)] disabled:cursor-default disabled:opacity-70"><span className="flex items-center gap-2 text-sm font-bold">{tone==='error'?<AlertTriangle className="h-4 w-4 text-[var(--ops-error)]"/>:<Users className="h-4 w-4 text-[var(--ops-text-subtle)]"/>}{label}</span><span className="flex items-center gap-2"><StatusChip tone={tone}>{count}</StatusChip><ChevronRight className="h-4 w-4 text-[var(--ops-text-subtle)]"/></span></button>; }
function DetailDialog({detail,onClose}:{detail:Detail|null;onClose:()=>void}) { return <Dialog open={Boolean(detail)} onClose={onClose} fullWidth maxWidth="lg"><DialogTitle>{detail?.title}<div className="text-sm font-normal text-[var(--ops-text-muted)]">{detail?.subtitle}</div></DialogTitle><DialogContent dividers>{detail?.issues?.map((issue,i)=><div key={`${issue.code}-${i}`} className="mb-3 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4"><div className="flex gap-2"><StatusChip tone={issue.code.startsWith('QUOTA_')?'warning':'error'}>{issue.code}</StatusChip><span className="text-sm font-bold">{issue.message}</span></div>{issue.details&&<pre className="mt-3 overflow-auto rounded bg-[var(--ops-background)] p-3 text-xs">{JSON.stringify(issue.details,null,2)}</pre>}</div>)}{detail?.rows&&detail.rows.length>0&&<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{detail.headers?.map(h=><th key={h} className="border-b border-[var(--ops-divider)] px-3 py-2 text-left text-xs uppercase text-[var(--ops-text-subtle)]">{h}</th>)}</tr></thead><tbody>{detail.rows.slice(0,50).map((r,i)=><tr key={i} className="border-b border-[var(--ops-divider)]">{r.map((c,j)=><td key={j} className="px-3 py-2">{c}</td>)}</tr>)}</tbody></table></div>}{detail&&!detail.issues?.length&&!detail.rows?.length&&<EmptyState title="Keine betroffenen Datensätze" description="Für diese Session liegen keine Detailänderungen vor."/>}</DialogContent></Dialog>; }
