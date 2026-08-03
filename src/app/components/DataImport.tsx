import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Download, FileText, Loader2, Upload } from 'lucide-react';

import { api } from '../services/api';
import { FisImportIssue, FisImportPreview } from '../types';

const REQUIRED_FILE_HINTS = [
  'ENTRIES-LIST',
  'ENTRIES-ROOM-LIST-DETAILED',
];

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">FIS Daten Import</h2>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-md font-semibold text-blue-900 mb-2">Ein gemeinsamer Upload für beide Dateien</h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>Ziehe einfach beide FIS-Dateien in dieselbe Upload-Zone.</li>
          <li>Die Software erkennt automatisch <strong>ENTRIES-LIST</strong> und <strong>ENTRIES-ROOM-LIST-DETAILED</strong>.</li>
          <li>Erst Preview prüfen, dann Import bestätigen.</li>
        </ul>
      </div>

      <MockFilesCard />

      <UnifiedUploadCard files={files} onChange={handleFilesSelected} />

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={runPreview}
            disabled={!readyForPreview || loading}
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Upload className="w-5 h-5 mr-2" />}
            Preview prüfen
          </button>

          <button
            onClick={confirmImport}
            disabled={previewBlocked || confirming}
            className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {confirming ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <CheckCircle className="w-5 h-5 mr-2" />}
            Import bestätigen
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-red-600" />
            <div>
              <p className="font-medium text-red-900">Aktion fehlgeschlagen</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <div>
              <p className="font-medium text-green-900">Import abgeschlossen</p>
              <p className="text-sm text-green-700">{success}</p>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Preview Ergebnis</h3>
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <PreviewMetric label="Personen gesamt" value={preview.summary.people.total} />
              <PreviewMetric label="Neu" value={preview.summary.people.wouldCreate} />
              <PreviewMetric label="Updates" value={preview.summary.people.wouldUpdate} />
              <PreviewMetric label="FIS-Zimmer" value={preview.summary.rooms.total} />
              <PreviewMetric label="Warnings" value={preview.summary.validation.warningCount} />
              <PreviewMetric label="Fehler" value={preview.summary.validation.errorCount} />
            </div>
            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <span className="font-medium">Erkannte Disziplin:</span>{' '}
              {preview.detectedDiscipline || 'nicht erkannt'}
            </div>
          </div>

          <IssueList title="Blockierende Fehler" issues={preview.errors} emptyText="Keine blockierenden Fehler gefunden." tone="red" />
          <QuotaValidationPanel warnings={quotaWarnings} people={preview.people} />
          <IssueList title="Weitere Warnungen" issues={otherWarnings} emptyText="Keine weiteren Warnungen gefunden." tone="yellow" />
          <AffectedRowsPanel issues={preview.errors} />

          <div className="grid gap-4 lg:grid-cols-2">
            <PreviewTable
              title="Personen"
              rows={preview.people.slice(0, 12).map((person) => [
                `${person.firstname} ${person.lastname}`,
                person.nationCode,
                person.discipline || '-',
                person.function || '-',
                person.operation,
              ])}
              headers={['Name', 'Nation', 'Disziplin', 'Funktion', 'Aktion']}
              footer={preview.people.length > 12 ? `+ ${preview.people.length - 12} weitere Personen` : undefined}
            />
            <PreviewTable
              title="Zimmer"
              rows={preview.rooms.slice(0, 12).map((room) => [
                room.person1Name,
                room.person2Name || '-',
                room.roomType,
                [room.checkInDate, room.checkOutDate].filter(Boolean).join(' → ') || '-',
              ])}
              headers={['Person 1', 'Person 2', 'Zimmer', 'Aufenthalt']}
              footer={preview.rooms.length > 12 ? `+ ${preview.rooms.length - 12} weitere Zimmer` : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MockFilesCard() {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Mock-Dateien herunterladen</h3>
        <p className="text-sm text-gray-500">
          Lade alle aktuellen Mock-Dateien gesammelt als ZIP herunter, passe sie in Excel an und lade sie danach wieder hoch.
        </p>
      </div>
      <a
        href="/api/import/fis/mock-files/download-all"
        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100"
      >
        <Download className="w-4 h-4" />
        Alle Mock-Dateien herunterladen
      </a>
    </div>
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
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-1">FIS Dateien hochladen</h3>
      <p className="text-sm text-gray-500 mb-4">Eine Dropzone für beide Dateien. Die Zuordnung passiert automatisch.</p>
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
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
          <Upload className="w-14 h-14 mx-auto text-gray-400 mb-4" />
          <p className="text-lg font-medium text-gray-700 mb-2">
            {files.length > 0 ? `${files.length} Datei(en) ausgewählt` : 'Dateien auswählen oder hierher ziehen'}
          </p>
          <p className="text-sm text-gray-500">
            Erwartet werden: {REQUIRED_FILE_HINTS.join(' + ')}
          </p>
        </label>
      </div>

      {files.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Ausgewählte Dateien</p>
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.name} className="flex items-center justify-between gap-3 text-sm text-gray-700">
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 shrink-0 text-gray-500" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="text-xs text-gray-500 shrink-0">{(file.size / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
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
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-yellow-50 border-yellow-200 text-yellow-800';

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
  const cardStyles = tone === 'red' ? 'border-red-200 bg-white/70' : 'border-yellow-200 bg-white/60';

  return (
    <div className={`rounded-lg border p-4 ${cardStyles}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-xs font-semibold px-2 py-1 rounded bg-white border border-current/20">{issue.code}</span>
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
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              {headers.map((header) => (
                <th key={header} className="text-left py-2 pr-4 font-medium text-gray-600">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={`border-b border-gray-100 last:border-b-0 ${rowClassName ? rowClassName(row, rowIndex) : ''}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`} className="py-2 pr-4 text-gray-900">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <p className="text-xs text-gray-500 mt-3">{footer}</p>}
    </div>
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
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6">
        <h3 className="text-lg font-semibold text-yellow-900 mb-2">Warnungen & Quoten</h3>
        <p className="text-sm text-yellow-800">Keine Warnungen gefunden.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 space-y-4">
      <h3 className="text-lg font-semibold text-yellow-900">Warnungen & Quoten</h3>
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
    <div className="rounded-lg border border-yellow-300 bg-white p-5 space-y-4">
      <div>
        <h4 className="text-base font-semibold text-yellow-900">{title}</h4>
        <p className="text-sm text-yellow-800 mt-1">{buildQuotaUserMessage(warning)}</p>
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
        rowClassName={(row) => row[6] !== 'OK' ? 'bg-red-50' : ''}
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
    <div className={`rounded-lg border p-3 ${highlight ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className={`text-xs ${highlight ? 'text-red-700' : 'text-gray-500'}`}>{label}</div>
      <div className={`text-lg font-semibold ${highlight ? 'text-red-900' : 'text-gray-900'}`}>{value}</div>
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
