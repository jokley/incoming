import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography, TextField } from '@mui/material';
import { ArrowDownToLine, Database, HardDrive, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import { api, DatabaseBackup, DatabaseStatus, RestoreJob } from '../services/api';

const bytes = (n?: number | null) => n == null ? '–' : `${(n / (n >= 1e9 ? 1e9 : 1e6)).toLocaleString('de-AT', { maximumFractionDigits: 1 })} ${n >= 1e9 ? 'GB' : 'MB'}`;
const rawErrorMessage = (error: unknown, fallback: string) => typeof error === 'object' && error && 'message' in error && typeof error.message === 'string' ? error.message : fallback;
const errorMessage = (error: unknown, fallback: string) => rawErrorMessage(error,'') === 'FORBIDDEN' ? 'Keine Berechtigung für diese Aktion (HTTP 403).' : rawErrorMessage(error,'') === 'UNAUTHENTICATED' ? 'Sitzung abgelaufen. Bitte erneut anmelden.' : rawErrorMessage(error,fallback);
const loadError = (error: unknown, fallback: string) => rawErrorMessage(error, '') === 'FORBIDDEN' ? 'Keine Berechtigung für diese Informationen (HTTP 403).' : fallback;
const date = (value?: string | number) => value == null ? 'Noch kein Backup' : new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'short' }).format(typeof value === 'number' ? new Date(value * 1000) : new Date(value));
const categories = [
  { key: 'automatic', title: 'Automatische Backups' },
  { key: 'manual', title: 'Manuelle Backups' },
  { key: 'pre-restore', title: 'Vor Wiederherstellung' },
] as const;

export function DatabaseBackups({ embedded = false }: { embedded?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<DatabaseStatus | null>(null); const [backups, setBackups] = useState<DatabaseBackup[]>([]); const [local, setLocal] = useState<DatabaseBackup | null>(null); const [selected, setSelected] = useState<DatabaseBackup | null>(null);
  const [busy, setBusy] = useState<'load' | 'backup' | 'import' | 'restore' | 'reload' | null>('load'); const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [backupsError, setBackupsError] = useState<string | null>(null);
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const activeJob = Boolean(job && !['IDLE','SUCCEEDED'].includes(job.state));
  const capabilities = status?.capabilities;
  const canRestore = capabilities?.restore === true && !activeJob;
  const load = useCallback(async () => {
    await Promise.allSettled([
      api.getDatabaseStatus().then(value => { setStatus(value); setStatusError(null); })
        .catch(error => { setStatus(null); setStatusError(loadError(error, 'Datenbankinformationen sind derzeit nicht verfügbar (Servicefehler).')); }),
      api.getRestoreStatus().then(setJob).catch(() => setJob({state:'UNAVAILABLE',message:'Restorekoordination nicht erreichbar. Keine Wiederherstellung starten.'})),
      api.getDatabaseBackups().then(value => { setBackups(value); setBackupsError(null); })
        .catch(error => { setBackups([]); setBackupsError(loadError(error, 'Die Backupliste ist derzeit nicht verfügbar (Servicefehler).')); }),
    ]);
    setBusy(value => value === 'load' ? null : value);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!job || ['IDLE','SUCCEEDED','RECOVERY_REQUIRED','UNAVAILABLE'].includes(job.state)) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try { const value=await api.getRestoreStatus(); if (!cancelled) setJob(value); }
      catch { if (!cancelled) setNotice({severity:'error',text:'Status derzeit nicht erreichbar. Nicht erneut starten; der Job läuft unabhängig weiter.'}); }
      finally { if (!cancelled) timer=window.setTimeout(poll,2000); }
    };
    timer=window.setTimeout(poll,2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [job?.state]);
  const create = async () => { setBusy('backup'); setNotice(null); try { await api.createDatabaseBackup(); setNotice({ severity: 'success', text: 'Das Backup wird erstellt.' }); window.setTimeout(load, 1800); } catch (error) { setNotice({ severity: 'error', text: errorMessage(error, 'Das Backup konnte nicht gestartet werden.') }); } finally { setBusy(null); } };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setBusy('import'); setNotice(null); try { const imported = await api.importDatabaseBackup(file); setLocal(imported); setSelected(imported); setNotice({ severity: 'success', text: 'Das lokale Backup wurde geprüft. Für die Wiederherstellung wird der Wartungsbetrieb automatisch koordiniert.' }); } catch (e) { setNotice({ severity: 'error', text: errorMessage(e, 'Die Datei ist kein gültiges PostgreSQL-Custom-Backup.') }); } finally { setBusy(null); } };
  const restore = async () => {
    if (!selected || !canRestore || confirmation !== 'RESTORE DATABASE') return;
    setBusy('restore');
    setNotice(null);
    try {
      const started = await api.restoreDatabaseBackup(selected, confirmation);
      setJob(started);
      setSelected(null);
      setConfirmation('');
      setBusy(null);
      setNotice({severity:'success',text:'Restoreauftrag angenommen. Wartung und Sicherheitsbackup werden automatisch koordiniert.'});
    } catch (e) {
      setNotice({ severity: 'error', text: errorMessage(e, 'Auftrag nicht bestätigt. Restorestatus prüfen; nicht erneut starten.') });
      try { const current = await api.getRestoreStatus(); setJob(current); if (!['IDLE','SUCCEEDED'].includes(current.state)) setSelected(null); } catch { /* Retain the warning; the independent job may still be running. */ }
      setBusy(null);
    }
  };
  const download = (row: DatabaseBackup) => { if (!row.localFile) { if (!row.category) return; void api.downloadDatabaseBackup(row.filename, row.category).catch(error => setNotice({ severity: 'error', text: errorMessage(error, 'Das Backup konnte nicht heruntergeladen werden.') })); return; } const url = URL.createObjectURL(row.localFile); const anchor = document.createElement('a'); anchor.href = url; anchor.download = row.filename; anchor.click(); URL.revokeObjectURL(url); };
  const cards = [['Wartungsmodus', status ? status.maintenanceMode ? 'Aktiv – Änderungen gesperrt' : 'Inaktiv' : '–'], ['Sicherungsstatus', status?.backupStatus === 'success' ? 'Letzte Sicherung erfolgreich' : status?.backupStatus === 'error' ? 'Letzte Sicherung fehlgeschlagen' : 'Kein Sicherungsnachweis'], ['PostgreSQL Status', status?.databaseStatus === 'available' ? 'Erreichbar' : '–'], ['PostgreSQL Version', status?.postgresVersion ?? '–'], ['Alembic Version', status?.alembicVersion ?? '–'], ['Datenbankgröße', bytes(status?.databaseSize)], ['Letztes erfolgreiches Backup', status?.lastBackup?.status === 'success' ? date(status.lastBackup.created) : 'Nicht nachgewiesen'], ['Größe des letzten Backups', bytes(status?.backupSize)]];
  return <Box sx={{ height: '100%', overflowY: 'auto', pb: 3 }}>
    {!embedded && <Box sx={{ mb: 3 }}><Typography variant="overline" color="primary" fontWeight={700}>Administration</Typography><Typography variant="h4" fontWeight={750}>Datenbank &amp; Backups</Typography><Typography color="text.secondary">Datenbankstatus prüfen und Backups sicher verwalten.</Typography></Box>}
    {job && job.state !== 'IDLE' && <Alert severity={job.state === 'RECOVERY_REQUIRED' || job.state === 'UNAVAILABLE' ? 'error' : job.state === 'SUCCEEDED' ? 'success' : 'info'} sx={{mb:2}}>
      <Typography>Restore: {({QUEUED:'Auftrag angenommen',DRAINING:'Laufende Vorgänge abwarten',SAFETY_BACKUP:'Sicherheitsbackup prüfen',RESTORING:'Wiederherstellung',VERIFYING:'Betriebsprüfung',SUCCEEDED:'Erfolgreich',RECOVERY_REQUIRED:'Recovery erforderlich',UNAVAILABLE:'Status nicht verfügbar'} as Record<string,string>)[job.state] ?? job.state} · Auftrag {job.operationId ?? '–'}</Typography>
      <Typography>{job.message ?? 'Die Anwendung koordiniert Wartung, Sicherheitsbackup und Wiederherstellung. Nicht erneut starten.'}</Typography>
      {job.safetyBackup && <Typography>Sicherheitsbackup: {job.safetyBackup}</Typography>}
      {job.state === 'RECOVERY_REQUIRED' && <Typography>Der Betrieb bleibt gesperrt. Autorisierten VPS-Betreiber zur Betriebsprüfung und Recovery hinzuziehen.</Typography>}
      {['RECOVERY_REQUIRED','UNAVAILABLE'].includes(job.state) && <Button onClick={() => void api.getRestoreStatus().then(setJob).catch(() => setNotice({severity:'error',text:'Restorestatus weiterhin nicht erreichbar. Betriebsprüfung erforderlich.'}))}>Status erneut prüfen</Button>}
      {job.state === 'SUCCEEDED' && <Button onClick={() => window.location.assign('/')}>Anwendung neu laden</Button>}
    </Alert>}
    {notice && <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={busy === 'reload' ? undefined : () => setNotice(null)}><Typography component="div">{notice.text}</Typography>{busy === 'reload' && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 1 }}><CircularProgress size={18} color="inherit" /><Typography component="div">Datenbankinformationen werden aktualisiert...</Typography></Box>}</Alert>}
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 3 }}><Typography variant="h6" fontWeight={700} mb={2}>Datenbankstatus</Typography>{statusError && <Alert severity="error" sx={{ mb: 2 }}>{statusError}</Alert>}<Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', xl: 'repeat(4,1fr)' }, gap: 1.5 }}>{cards.map(([label, value]) => <Box key={label} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography fontWeight={650}>{value}</Typography></Box>)}</Box></Paper>
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 3 }}><Typography variant="h6" fontWeight={700} mb={2}>Aktionen</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>HTTP-Erreichbarkeit ist kein Sicherungsnachweis. Maßgeblich sind erfolgreiche Backups und eine separat geprüfte Wiederherstellbarkeit. Backups enthalten die gesamte Datenbank mit allen Events. Restore koordiniert Wartung automatisch. Operative Event- und Nationendaten werden gezielt in der Datenbereinigung verwaltet; dafür ist kein manueller Wartungsmodus erforderlich.</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}><Button variant="contained" startIcon={busy === 'backup' ? <CircularProgress size={18} color="inherit" /> : <HardDrive size={18} />} disabled={Boolean(busy) || !capabilities?.create} onClick={create}>Backup jetzt erstellen</Button><Button variant="outlined" startIcon={busy === 'import' ? <CircularProgress size={18} /> : <Upload size={18} />} disabled={Boolean(busy) || !capabilities?.upload} onClick={() => input.current?.click()}>Backup importieren</Button><input ref={input} hidden type="file" onChange={upload} /></Box></Paper>
    {backupsError && <Alert severity="error" sx={{ mb: 2 }}>{backupsError}</Alert>}
    {categories.map(category => { const rows = backups.filter(backup => backup.category === category.key); return <Paper key={category.key} variant="outlined" sx={{ mb: 2, borderRadius: 3, overflow: 'hidden' }}><Box sx={{ p: 2.5, pb: 1 }}><Typography variant="h6" fontWeight={700}>{category.title}</Typography></Box><TableContainer><Table><TableHead><TableRow><TableCell>Datum</TableCell><TableCell>Größe</TableCell><TableCell align="right">Aktionen</TableCell></TableRow></TableHead><TableBody>{rows.map(row => <TableRow key={`${category.key}-${row.filename}`} hover><TableCell><Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}><Database size={18} /><Typography variant="body2" fontWeight={650}>{date(row.modified)}</Typography></Box></TableCell><TableCell>{bytes(row.size)}</TableCell><TableCell align="right"><Tooltip title="Herunterladen"><IconButton aria-label={`${row.filename} herunterladen`} disabled={!capabilities?.download} onClick={() => download(row)}><ArrowDownToLine size={19} /></IconButton></Tooltip><Tooltip title="Wiederherstellung vorbereiten"><IconButton aria-label={`${row.filename} Wiederherstellung vorbereiten`} disabled={Boolean(busy)} onClick={() => { setConfirmation(''); setSelected(row); }}><RotateCcw size={19} /></IconButton></Tooltip></TableCell></TableRow>)}{!rows.length && busy !== 'load' && !backupsError && <TableRow><TableCell colSpan={3} align="center" sx={{ py: 3, color: 'text.secondary' }}>Noch kein Backup vorhanden.</TableCell></TableRow>}</TableBody></Table></TableContainer></Paper>; })}
    <Dialog open={Boolean(selected)} onClose={() => busy !== 'restore' && setSelected(null)} maxWidth="sm" fullWidth><DialogTitle>Wiederherstellung vorbereiten</DialogTitle><DialogContent><RestoreInformation filename={selected?.filename} canRestore={canRestore} /><Typography variant="body2" sx={{mt:2}}>Datum: {date(selected?.modified)} · Größe: {bytes(selected?.size)} · Typ: {selected?.category ?? 'Upload'}</Typography><TextField fullWidth label="RESTORE DATABASE zur Bestätigung eingeben" value={confirmation} onChange={event => setConfirmation(event.target.value)} sx={{mt:2}} autoComplete="off" />{busy === 'restore' && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 3 }}><CircularProgress size={22} /><Typography color="text.secondary">Backup wird wiederhergestellt …</Typography></Box>}</DialogContent><DialogActions><Button disabled={busy === 'restore'} onClick={() => setSelected(null)}>Abbrechen</Button><Button variant="contained" disabled={busy === 'restore' || !canRestore || confirmation !== 'RESTORE DATABASE'} startIcon={<RefreshCw size={18} />} onClick={restore}>Wiederherstellen</Button></DialogActions></Dialog>
  </Box>;
}

export function RestoreInformation({ filename, canRestore }: { filename?: string; canRestore: boolean }) {
  return <><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{filename}</Typography>
    <Alert severity="warning">Die Wiederherstellung betrifft die gesamte Datenbank einschließlich aller Championship-Events. Änderungen seit dem Sicherungszeitpunkt können verloren gehen.</Alert>
    <Typography sx={{mt:2}}>Die Anwendung sperrt neue Zugriffe automatisch, wartet laufende Vorgänge ab und prüft ein aktuelles Sicherheitsbackup, bevor die Sicherung wiederhergestellt wird. Keine manuelle Wartungsvariable erforderlich.</Typography>
    {!canRestore && <Alert severity="info" sx={{mt:2}}>Wiederherstellung derzeit nicht freigegeben: Berechtigung und Restorestatus prüfen.</Alert>}</>;
}
