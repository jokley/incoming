import { type CSSProperties, useMemo, useState } from 'react';
import { CheckCircle, Download, FileCheck2, FileText, Loader2, RefreshCcw, Upload } from 'lucide-react';

import { api } from '../services/api';
import { FisImportIssue, FisImportPreview } from '../types';
import { ContentCard, EmptyState, InfoPanel, OpsButton, PageHeader, SectionHeader, StatusChip } from '../design-system';
import { MetricCard } from '../design-system/components/cards';
import { ImportQueue } from './ImportQueue';

const REQUIRED_FILE_HINTS = [
  'ENTRIES-LIST',
  'ENTRIES-ROOM-LIST-DETAILED',
];

const importCenterTheme = {
  '--ops-background': '#0B1220', '--ops-surface': '#172234', '--ops-surface-raised': '#1D2A3D',
  '--ops-surface-elevated': '#223149', '--ops-surface-overlay': '#2A3B54', '--ops-border': 'rgba(240,246,252,.08)',
  '--ops-border-strong': 'rgba(240,246,252,.16)', '--ops-divider': 'rgba(240,246,252,.07)', '--ops-primary': '#60AFFF',
  '--ops-primary-emphasis': '#79C0FF', '--ops-success': '#3FB950', '--ops-warning': '#D29922', '--ops-error': '#F85149',
  '--ops-info': '#58A6FF', '--ops-text': '#F0F6FC', '--ops-text-muted': '#C9D1D9', '--ops-text-subtle': '#8B949E',
  '--ops-tone-neutral-border': 'rgba(240,246,252,.12)', '--ops-tone-neutral-surface': 'rgba(201,209,217,.10)', '--ops-tone-neutral-text': '#F0F6FC',
  '--ops-tone-primary-border': 'rgba(88,166,255,.45)', '--ops-tone-primary-surface': 'rgba(56,139,253,.18)', '--ops-tone-primary-text': '#DDF4FF',
  '--ops-tone-success-border': 'rgba(63,185,80,.50)', '--ops-tone-success-surface': 'rgba(46,160,67,.18)', '--ops-tone-success-text': '#D2FEDB',
  '--ops-tone-warning-border': 'rgba(210,153,34,.52)', '--ops-tone-warning-surface': 'rgba(187,128,9,.20)', '--ops-tone-warning-text': '#FFF8C5',
  '--ops-tone-error-border': 'rgba(248,81,73,.52)', '--ops-tone-error-surface': 'rgba(218,54,51,.20)', '--ops-tone-error-text': '#FFDCD7',
  '--ops-tone-info-border': 'rgba(88,166,255,.45)', '--ops-tone-info-surface': 'rgba(56,139,253,.16)', '--ops-tone-info-text': '#DDF4FF',
} as CSSProperties;

const workflowSteps = ['Datei', 'Preview', 'Prüfung', 'Import', 'Auswirkungen', 'Nachbearbeitung'];

export function DataImport() {
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<FisImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const readyForPreview = files.length >= 2;
  const previewBlocked = useMemo(() => !preview || !preview.isValid, [preview]);
  const quotaWarnings = useMemo(
    () => preview?.warnings.filter((issue) => issue.code.startsWith('QUOTA_')) ?? [],
    [preview]
  );
  const otherWarnings = useMemo(
    () => preview?.warnings.filter((issue) => !issue.code.startsWith('QUOTA_')) ?? [],
    [preview]
  );

  const handleFilesSelected = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return;
    const nextFiles = Array.from(incoming).filter(
      (file) => file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
    );
    if (nextFiles.length === 0) {
      setError('Bitte Excel-Dateien (.xlsx, .xls) hochladen.');
      return;
    }

    const unique = new Map<string, File>();
    nextFiles.forEach((file) => unique.set(file.name.toLowerCase(), file));
    setFiles(Array.from(unique.values()));
    setPreview(null);
    setSuccess(null);
    setError(null);
  };

  const cancelImport = () => {
    setFiles([]);
    setPreview(null);
    setError(null);
    setSuccess(null);
    const input = document.getElementById('fis-files-input') as HTMLInputElement | null;
    if (input) input.value = '';
  };

  const runPreview = async () => {
    if (!readyForPreview) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setPreview(null);
    try {
      const result = await api.previewFisImport(files);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!preview?.previewToken) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await api.confirmFisImport(preview.previewToken);
      setSuccess(
        `Import erfolgreich: ${result.summary.peopleCreated} neu, ${result.summary.peopleUpdated} aktualisiert, ${result.summary.fisRoomsImported} FIS-Zimmer importiert.`
      );
      setPreview(null);
      setFiles([]);
      const input = document.getElementById('fis-files-input') as HTMLInputElement | null;
      if (input) input.value = '';
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen');
    } finally {
      setConfirming(false);
    }
  };

  const currentStep = success ? 4 : preview ? 2 : files.length ? 1 : 0;
  const kpis = preview ? [
    ['Personen', preview.summary.people.total, 'Importumfang', 'neutral'],
    ['Neue Personen', preview.summary.people.wouldCreate, 'werden angelegt', 'success'],
    ['Updates', preview.summary.people.wouldUpdate, 'werden aktualisiert', 'info'],
    ['Warnungen', preview.summary.validation.warningCount, 'zu prüfen', 'warning'],
    ['Fehler', preview.summary.validation.errorCount, preview.isValid ? 'nicht blockierend' : 'blockierend', 'error'],
    ['Disziplin', preview.detectedDiscipline || '—', preview.detectedDiscipline ? 'automatisch erkannt' : 'nicht erkannt', 'primary'],
  ] as const : [];

  return (
    <div style={importCenterTheme} className="-m-6 min-h-screen bg-[var(--ops-background)] p-6 text-[var(--ops-text)]">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <PageHeader eyebrow="Operations Center" title="Import Center" subtitle="Import Sessions für FIS Excel-Dateien mit Staging, Validierung und Änderungsanalyse." meta={<StatusChip tone={preview?.isValid ? 'success' : preview ? 'error' : 'neutral'}>{preview ? (preview.isValid ? 'Session importbereit' : 'Prüfung erforderlich') : 'Keine aktive Session'}</StatusChip>} />

        <ImportQueue />

        {preview && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{kpis.map(([label, value, helper, tone]) => <MetricCard key={label} label={label} value={value} helper={helper} tone={tone} />)}</div>}

        <ContentCard className="p-5" surface="elevated"><SectionHeader title="Workflow" subtitle="Orientierung im FIS-Importprozess" /><ol className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-6">{workflowSteps.map((step, index) => <li key={step} className="relative"><div className={`rounded-lg border p-3 ${index <= currentStep ? 'border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)]'}`}><span className="font-mono text-xs text-[var(--ops-text-subtle)]">0{index + 1}</span><div className="mt-1 text-sm font-bold">{step}</div></div>{index < workflowSteps.length - 1 && <span className="absolute -right-2 top-1/2 hidden text-[var(--ops-text-subtle)] md:block">→</span>}</li>)}</ol></ContentCard>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.65fr)]">
          <div className="space-y-6">
            <UnifiedUploadCard files={files} onChange={handleFilesSelected} />
            <ContentCard className="p-5" surface="raised"><SectionHeader title="Import Session Aktionen" subtitle="Erst Session-Preview prüfen, dann den validierten Import bestätigen." /><div className="mt-4 flex flex-wrap gap-3"><OpsButton onClick={runPreview} disabled={!readyForPreview || loading} className="inline-flex items-center gap-2 border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)]">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}Session-Preview prüfen</OpsButton><OpsButton onClick={confirmImport} disabled={previewBlocked || confirming} className="inline-flex items-center gap-2 border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)]">{confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}Session importieren</OpsButton><OpsButton onClick={cancelImport} disabled={!files.length && !preview} className="inline-flex items-center gap-2"><RefreshCcw className="h-4 w-4" />Session abbrechen</OpsButton></div>{error && <div className="mt-4"><InfoPanel tone="error" title="Aktion fehlgeschlagen">{error}</InfoPanel></div>}{success && <div className="mt-4"><InfoPanel tone="success" title="Import Session abgeschlossen">{success}</InfoPanel></div>}</ContentCard>
            {preview && <PreviewContent preview={preview} quotaWarnings={quotaWarnings} otherWarnings={otherWarnings} />}
          </div>
          <aside className="space-y-6 xl:sticky xl:top-6"><InfoPanel tone="info" title="Ein gemeinsamer Upload für beide Dateien"><ul className="list-inside list-disc space-y-2"><li>Beide FIS-Dateien in dieselbe Upload-Zone ziehen.</li><li>ENTRIES-LIST und ENTRIES-ROOM-LIST-DETAILED werden automatisch erkannt.</li><li>Vor dem Import alle Prüfhinweise kontrollieren.</li></ul></InfoPanel><MockFilesCard /></aside>
        </div>
      </div>
    </div>
  );
}

function PreviewContent({ preview, quotaWarnings, otherWarnings }: { preview: FisImportPreview; quotaWarnings: FisImportIssue[]; otherWarnings: FisImportIssue[] }) {
  return <div className="space-y-6"><SectionHeader title="Import Session Preview" subtitle="Änderungen und bestehende Validierungen dieser Session im Überblick" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="Neue Personen" value={preview.summary.people.wouldCreate} helper="Anlegen" tone="success" /><MetricCard label="Aktualisierte Personen" value={preview.summary.people.wouldUpdate} helper="Aktualisieren" tone="info" /><MetricCard label="Zimmerbedarf" value={preview.summary.rooms.total} helper={`${preview.summary.rooms.singles} Einzel · ${preview.summary.rooms.shared} geteilt`} /><MetricCard label="Ersetzte FIS-Zimmer" value={preview.summary.rooms.wouldReplaceFisRooms} helper="Bestehender Bestand" tone="warning" /><MetricCard label="Warnungen" value={preview.summary.validation.warningCount} helper="Prüfung" tone="warning" /><MetricCard label="Fehler" value={preview.summary.validation.errorCount} helper="Validierung" tone="error" /><MetricCard label="Quota-Hinweise" value={quotaWarnings.length} helper="Bestehende Quota-Prüfung" tone="warning" /><MetricCard label="Disziplin" value={preview.detectedDiscipline || '—'} helper="Erkannt" tone="primary" /></div><SectionHeader title="Prüfung" subtitle="Blockierende Fehler, Quoten und weitere Hinweise" /><IssueList title="Blockierende Fehler" issues={preview.errors} emptyText="Keine blockierenden Fehler gefunden." tone="red" /><QuotaValidationPanel warnings={quotaWarnings} people={preview.people} /><IssueList title="Weitere Hinweise" issues={otherWarnings} emptyText="Keine weiteren Warnungen gefunden." tone="yellow" /><AffectedRowsPanel issues={preview.errors} /><div className="grid gap-4 lg:grid-cols-2"><PreviewTable title="Personen" rows={preview.people.slice(0, 12).map(p => [`${p.firstname} ${p.lastname}`, p.nationCode, p.discipline || '-', p.function || '-', p.operation])} headers={['Name', 'Nation', 'Disziplin', 'Funktion', 'Aktion']} footer={preview.people.length > 12 ? `+ ${preview.people.length - 12} weitere Personen` : undefined} /><PreviewTable title="Zimmer" rows={preview.rooms.slice(0, 12).map(r => [r.person1Name, r.person2Name || '-', r.roomType, [r.checkInDate, r.checkOutDate].filter(Boolean).join(' → ') || '-'])} headers={['Person 1', 'Person 2', 'Zimmer', 'Aufenthalt']} footer={preview.rooms.length > 12 ? `+ ${preview.rooms.length - 12} weitere Zimmer` : undefined} /></div><ContentCard className="p-5" surface="raised"><SectionHeader title="Auswirkungen des Imports" subtitle="Grundlage für die operative Nachbearbeitung" /><div className="mt-4"><EmptyState title="Auswirkungsanalyse nach Import Session" description="Nach dem Import werden hier alle betroffenen Zimmerzuweisungen, Zimmerpartner, Quoten und Änderungen angezeigt." /></div><div className="mt-5 border-t border-[var(--ops-divider)] pt-5"><SectionHeader title="Nächste Schritte" subtitle="Vorbereitete Aktionen für den künftigen Session-Lebenszyklus" /><ul className="mt-4 grid gap-2 sm:grid-cols-2">{['Rücksprache Nation erforderlich', 'Import Session freigeben', 'Import Session ersetzen', 'Import Session archivieren'].map(step => <li key={step} className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-4 py-3 text-sm text-[var(--ops-text-muted)]">• {step}</li>)}</ul></div></ContentCard></div>;
}

function MockFilesCard() {
  return (
    <ContentCard className="p-5" surface="raised">
      <div className="mb-4">
        <SectionHeader title="Vorlagen" />
        <p className="mt-2 text-sm text-[var(--ops-text-muted)]">
          Lade alle aktuellen Mock-Dateien gesammelt als ZIP herunter, passe sie in Excel an und lade sie danach wieder hoch.
        </p>
      </div>
      <a
        href="/api/import/fis/mock-files/download-all"
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--ops-tone-primary-border)] bg-[var(--ops-tone-primary-surface)] px-4 py-3 text-sm font-bold text-[var(--ops-tone-primary-text)] transition-colors hover:border-[var(--ops-border-strong)]"
      >
        <Download className="w-4 h-4" />
        Alle Mock-Dateien herunterladen
      </a>
    </ContentCard>
  );
}

function UnifiedUploadCard({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: FileList | File[] | null | undefined) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  return (
    <ContentCard className="p-5" surface="raised">
      <SectionHeader title="Neue Import Session" subtitle="Excel-Dateien auswählen – die spätere Session-Zuordnung ist bereits vorbereitet." />
      <div
        className={`mt-4 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${dragActive ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)]' : 'border-[var(--ops-border-strong)] bg-[var(--ops-surface)]'}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          onChange(event.dataTransfer.files);
        }}
      >
        <input
          id="fis-files-input"
          type="file"
          accept=".xlsx,.xls"
          multiple
          onChange={(event) => onChange(event.target.files)}
          className="hidden"
        />
        <label htmlFor="fis-files-input" className="cursor-pointer block">
          <Upload className="mx-auto mb-4 h-12 w-12 text-[var(--ops-primary)]" />
          <p className="mb-2 text-lg font-bold text-[var(--ops-text)]">
            {files.length > 0 ? `${files.length} Datei(en) ausgewählt` : 'Dateien auswählen oder hierher ziehen'}
          </p>
          <p className="text-sm text-[var(--ops-text-muted)]">
            Erwartet werden: {REQUIRED_FILE_HINTS.join(' + ')}
          </p>
        </label>
      </div>

      {files.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] p-4">
          <p className="mb-2 text-sm font-bold text-[var(--ops-text)]">Ausgewählte Dateien</p>
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.name} className="flex items-center justify-between gap-3 text-sm text-[var(--ops-text)]">
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-[var(--ops-primary)]" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-[var(--ops-text-muted)]">{(file.size / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ContentCard>
  );
}

function IssueList({
  title,
  issues,
  emptyText,
  tone,
}: {
  title: string;
  issues: FisImportIssue[];
  emptyText: string;
  tone: 'red' | 'yellow';
}) {
  const styles = tone === 'red'
    ? 'bg-[var(--ops-tone-error-surface)] border-[var(--ops-tone-error-border)] text-[var(--ops-tone-error-text)]'
    : 'bg-[var(--ops-tone-warning-surface)] border-[var(--ops-tone-warning-border)] text-[var(--ops-tone-warning-text)]';

  return (
    <div className={`rounded-lg border p-6 ${styles}`}>
      <h3 className="text-lg font-semibold mb-3">{title}</h3>
      {issues.length === 0 ? (
        <p className="text-sm">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {issues.map((issue, index) => (
            <IssueCard key={`${issue.code}-${index}`} issue={issue} tone={tone} />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueCard({ issue, tone }: { issue: FisImportIssue; tone: 'red' | 'yellow' }) {
  const details = issue.details ?? {};
  const row = formatDetailValue(details.row);
  const sourceFile = detectIssueFile(issue.code);
  const rowLabel = row ? `${sourceFile}, Zeile ${row}` : sourceFile;
  const hint = buildIssueHint(issue);
  const syntax = buildIssueSyntax(issue);
  const cardStyles = tone === 'red' ? 'border-[var(--ops-tone-error-border)] bg-[var(--ops-surface)]' : 'border-[var(--ops-tone-warning-border)] bg-[var(--ops-surface)]';

  return (
    <div className={`rounded-lg border p-4 ${cardStyles}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded border border-current/20 bg-[var(--ops-surface-elevated)] px-2 py-1 font-mono text-xs font-semibold">{issue.code}</span>
        {rowLabel && <span className="text-xs opacity-80">{rowLabel}</span>}
      </div>
      <p className="mt-2 text-sm font-medium">{issue.message}</p>
      {syntax && (
        <div className="mt-3">
          <p className="text-xs font-medium opacity-80 mb-1">Suche in Excel nach:</p>
          <pre className="text-xs bg-slate-900 text-slate-100 rounded-md px-3 py-2 overflow-x-auto whitespace-pre-wrap">{syntax}</pre>
        </div>
      )}
      {hint && <p className="mt-3 text-sm">{hint}</p>}
    </div>
  );
}

function detectIssueFile(code: string): string {
  if (code.startsWith('ENTRY_')) return 'ENTRIES-LIST';
  if (code.startsWith('ROOM_')) return 'ENTRIES-ROOM-LIST-DETAILED';
  if (code.startsWith('QUOTA_')) return 'FIS Quota Check';
  return 'Import Preview';
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function buildIssueSyntax(issue: FisImportIssue): string {
  const details = issue.details ?? {};
  if (issue.code === 'ROOM_PERSON_NOT_FOUND') {
    return [
      'Sheet: ENTRIES-ROOM-LIST-DETAILED',
      `row=${formatDetailValue(details.row)}`,
      `Lastname="${formatDetailValue(details.lastname)}"`,
      `Firstname="${formatDetailValue(details.firstname)}"`,
      `Nationcode="${formatDetailValue(details.nationCode)}"`,
    ].filter(Boolean).join('\n');
  }
  if (issue.code === 'ROOM_PARTNER_NOT_FOUND') {
    return [
      'Sheet: ENTRIES-ROOM-LIST-DETAILED',
      `row=${formatDetailValue(details.row)}`,
      `Shared with Name="${formatDetailValue(details.sharedWithName)}"`,
      `Shared with Nationcode="${formatDetailValue(details.sharedWithNationcode)}"`,
    ].filter(Boolean).join('\n');
  }
  if (issue.code.startsWith('ENTRY_INVALID_') || issue.code.startsWith('ROOM_INVALID_')) {
    return [
      `Sheet: ${detectIssueFile(issue.code)}`,
      `row=${formatDetailValue(details.row)}`,
      `value="${formatDetailValue(details.value)}"`,
    ].filter(Boolean).join('\n');
  }
  return '';
}

function buildIssueHint(issue: FisImportIssue): string {
  const details = issue.details ?? {};
  if (issue.code === 'ROOM_PERSON_NOT_FOUND') {
    const lastname = formatDetailValue(details.lastname);
    const firstname = formatDetailValue(details.firstname);
    const nationCode = formatDetailValue(details.nationCode);
    return `Prüfe, ob diese Person in beiden Dateien exakt gleich geschrieben ist. Suche nach "${firstname} ${lastname}" mit Nation "${nationCode}" oder nach vertauschten Vor-/Nachnamen.`;
  }
  if (issue.code === 'ROOM_PARTNER_NOT_FOUND') {
    return 'Prüfe den Wert in "Shared with Name". Er muss exakt zu einer Person aus ENTRIES-LIST passen, idealerweise mit passendem Nationcode.';
  }
  if (issue.code.startsWith('ENTRY_INVALID_') || issue.code.startsWith('ROOM_INVALID_')) {
    return 'Prüfe, ob die Zelle leer sein sollte oder ein echtes Datum enthält. Unterstützt werden normale Excel-Daten und Formate wie DD.MM.YYYY.';
  }
  return '';
}

function PreviewTable({
  title,
  headers,
  rows,
  footer,
  rowClassName,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  footer?: string;
  rowClassName?: (row: string[], rowIndex: number) => string;
}) {
  return (
    <ContentCard className="overflow-hidden" surface="raised">
      <div className="border-b border-[var(--ops-divider)] px-5 py-4"><SectionHeader title={title} /></div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ops-divider)] bg-[var(--ops-surface-elevated)]">
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--ops-text-subtle)]">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={`border-b border-[var(--ops-divider)] last:border-b-0 ${rowClassName ? rowClassName(row, rowIndex) : ''}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 text-[var(--ops-text)]">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <p className="border-t border-[var(--ops-divider)] px-5 py-3 text-xs text-[var(--ops-text-muted)]">{footer}</p>}
    </ContentCard>
  );
}

function AffectedRowsPanel({ issues }: { issues: FisImportIssue[] }) {
  const roomIssues = issues.filter((issue) => issue.code.startsWith('ROOM_'));
  if (roomIssues.length === 0) return null;
  const rows = roomIssues.map((issue) => {
    const details = issue.details ?? {};
    return [
      formatDetailValue(details.row) || '-',
      formatDetailValue(details.lastname) || '-',
      formatDetailValue(details.firstname) || '-',
      formatDetailValue(details.nationCode) || formatDetailValue(details.sharedWithNationcode) || '-',
      issue.code,
    ];
  });
  return (
    <PreviewTable
      title="Betroffene Zeilen"
      headers={['Excel-Zeile', 'Lastname', 'Firstname', 'Nation', 'Fehler']}
      rows={rows}
      footer="Diese Zeilen konnten nicht eindeutig gematcht werden und wurden deshalb nicht in die Zimmer-Vorschau übernommen."
    />
  );
}

function QuotaValidationPanel({
  warnings,
  people,
}: {
  warnings: FisImportIssue[];
  people: FisImportPreview['people'];
}) {
  if (warnings.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--ops-tone-success-border)] bg-[var(--ops-tone-success-surface)] p-6 text-[var(--ops-tone-success-text)]">
        <h3 className="mb-2 text-lg font-semibold">Quoten</h3>
        <p className="text-sm">Keine Quota-Warnungen gefunden.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-[var(--ops-tone-warning-border)] bg-[var(--ops-tone-warning-surface)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ops-tone-warning-text)]">Quoten</h3>
      {warnings.map((warning, index) => (
        <QuotaWarningCard key={`${warning.code}-${index}`} warning={warning} people={people} />
      ))}
    </div>
  );
}

function QuotaWarningCard({
  warning,
  people,
}: {
  warning: FisImportIssue;
  people: FisImportPreview['people'];
}) {
  const details = warning.details ?? {};
  const nationCode = formatDetailValue(details.nationCode);
  const discipline = formatDetailValue(details.discipline);
  const gender = formatDetailValue(details.gender);
  const athletesEntered = Number(details.athletesEntered ?? 0);
  const officialQuota = Number(details.officialQuota ?? 0);
  const importedOfficials = Number(details.importedOfficials ?? 0);
  const singleRoomsAllowed = Number(details.singleRoomsAllowed ?? 0);
  const importedSingleRooms = Number(details.importedSingleRooms ?? 0);

  const matchingOfficials = people
    .filter((person) => {
      const functionValue = normalizeText(person.function);
      const personGender = normalizeGender(person.gender || person.forGender || '');
      return functionValue !== 'athlete' && person.nationCode === nationCode && (!gender || personGender === gender.toUpperCase());
    })
    .sort((left, right) => left.rowNumber - right.rowNumber);

  const singleRoomOfficials = matchingOfficials.filter((person) => normalizeText(person.roomType) === 'single');
  const highlightedRows = new Set<number>();
  if (warning.code === 'QUOTA_OFFICIALS_EXCEEDED') {
    matchingOfficials.slice(officialQuota).forEach((person) => highlightedRows.add(person.rowNumber));
  }
  if (warning.code === 'QUOTA_SINGLE_ROOMS_EXCEEDED') {
    singleRoomOfficials.slice(singleRoomsAllowed).forEach((person) => highlightedRows.add(person.rowNumber));
  }

  const rows = matchingOfficials.map((person) => {
    const personGender = normalizeGender(person.gender || person.forGender || '');
    const isSingle = normalizeText(person.roomType) === 'single';
    const status = highlightedRows.has(person.rowNumber)
      ? (warning.code === 'QUOTA_SINGLE_ROOMS_EXCEEDED' ? 'Bitte Zimmerwunsch prüfen' : 'Über Quota')
      : 'OK';
    return [
      String(person.rowNumber),
      `${person.firstname} ${person.lastname}`,
      person.function || '-',
      personGender || '-',
      person.roomType || '-',
      isSingle ? 'EZ' : 'geteilt/kein EZ',
      status,
    ];
  });

  const title = warning.code === 'QUOTA_OFFICIALS_EXCEEDED'
    ? `Zu viele Officials für ${nationCode}${gender ? ` ${gender}` : ''}${discipline ? ` · ${discipline}` : ''}`
    : `Zu viele Einzelzimmer für Officials ${nationCode}${gender ? ` ${gender}` : ''}${discipline ? ` · ${discipline}` : ''}`;

  return (
    <div className="space-y-4 rounded-lg border border-[var(--ops-tone-warning-border)] bg-[var(--ops-surface)] p-5">
      <div>
        <h4 className="text-base font-semibold text-[var(--ops-tone-warning-text)]">{title}</h4>
        <p className="mt-1 text-sm text-[var(--ops-text-muted)]">{buildQuotaUserMessage(warning)}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-5 text-sm">
        <QuotaMetric label="Athleten" value={athletesEntered} />
        <QuotaMetric label="Officials erlaubt" value={officialQuota || '-'} />
        <QuotaMetric label="Officials importiert" value={importedOfficials || '-'} highlight={warning.code === 'QUOTA_OFFICIALS_EXCEEDED'} />
        <QuotaMetric label="EZ erlaubt" value={singleRoomsAllowed || '-'} />
        <QuotaMetric label="EZ importiert" value={importedSingleRooms || '-'} highlight={warning.code === 'QUOTA_SINGLE_ROOMS_EXCEEDED'} />
      </div>
      <PreviewTable
        title="Betroffene Personen"
        headers={['Excel-Zeile', 'Name', 'Funktion', 'Geschlecht', 'Zimmerwunsch', 'EZ', 'Status']}
        rows={rows}
        footer="Rot markierte Zeilen verursachen aktuell die Quota-Warnung und sollten angepasst werden."
        rowClassName={(row) => row[6] !== 'OK' ? 'bg-[var(--ops-tone-error-surface)]' : ''}
      />
    </div>
  );
}

function QuotaMetric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)]'}`}>
      <div className={`text-xs ${highlight ? 'text-[var(--ops-tone-error-text)]' : 'text-[var(--ops-text-muted)]'}`}>{label}</div>
      <div className="text-lg font-semibold text-[var(--ops-text)]">{value}</div>
    </div>
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizeGender(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (normalized.startsWith('m')) return 'M';
  if (normalized.startsWith('w') || normalized.startsWith('f')) return 'W';
  if (normalized === 'a') return 'A';
  return normalized.toUpperCase();
}

function buildQuotaUserMessage(issue: FisImportIssue): string {
  const details = issue.details ?? {};
  const nationCode = formatDetailValue(details.nationCode);
  const gender = formatDetailValue(details.gender);
  const importedOfficials = Number(details.importedOfficials ?? 0);
  const officialQuota = Number(details.officialQuota ?? 0);
  const importedSingleRooms = Number(details.importedSingleRooms ?? 0);
  const singleRoomsAllowed = Number(details.singleRoomsAllowed ?? 0);

  if (issue.code === 'QUOTA_OFFICIALS_EXCEEDED') {
    return `Für ${nationCode}${gender ? ` ${gender}` : ''} sind aktuell ${importedOfficials} Officials im Import, erlaubt sind ${officialQuota}. Bitte reduziere betroffene Officials oder prüfe ihre Zuordnung.`;
  }
  if (issue.code === 'QUOTA_SINGLE_ROOMS_EXCEEDED') {
    return `Für ${nationCode}${gender ? ` ${gender}` : ''} sind aktuell ${importedSingleRooms} Einzelzimmer für Officials vorgesehen, erlaubt sind ${singleRoomsAllowed}. Bitte prüfe die rot markierten Einzelzimmer-Wünsche.`;
  }
  return issue.message;
}
