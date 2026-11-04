import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from './ui/dialog';
import { ContentCard, DialogFooter, DialogHeader, InfoPanel, OpsButton, PageHeader, SplitPageLayout, SectionHeader } from '../design-system';
import { api, type CleanupPreview } from '../services/api';
import { useActiveEvent, useActiveEventBlocker } from '../events/ActiveEventProvider';

const actions=[
  {scope:'nation',title:'Nationenmeldung löschen',description:'Personen dieser Nation, Importdaten und ihre Zuweisungsbezüge entfernen. Andere Zimmerbewohner bleiben erhalten.'},
  {scope:'assignments',title:'Zimmerzuweisungen löschen',description:'Zuweisungen des ausgewählten Events entfernen. Personen, Tarife und Genehmigungen bleiben erhalten.'},
  {scope:'imports',title:'Unverwendete Importprüfungen löschen',description:'Nur Importdaten ohne verbleibende Personen entfernen. Verwendete Meldungen über die Nationenbereinigung löschen.'},
  {scope:'all',title:'Operative Eventdaten löschen',description:'Alle Personen, Zuweisungen und Importdaten dieses Events entfernen. Vorher wird automatisch ein Sicherheitsbackup erstellt.'},
];
export function AdministrationTestData({embedded=false}:{embedded?:boolean}) {
  const {selectedEvent}=useActiveEvent();
  const [nations,setNations]=useState<string[]>([]),[nation,setNation]=useState('');
  const [selected,setSelected]=useState<(typeof actions)[number]|null>(null);
  const [preview,setPreview]=useState<CleanupPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  useActiveEventBlocker(busy || Boolean(selected),'Bitte die Datenbereinigung zuerst abschließen oder den Dialog schließen.');
  useEffect(()=>{setSelected(null);setPreview(null);setNation('');setError(null);void api.previewCleanup().then(p=>setNations(p.nations)).catch(e=>setError(e instanceof Error?e.message:'Bereinigung nicht verfügbar.'));},[selectedEvent?.id]);
  const open=async(action:(typeof actions)[number])=>{setSelected(action);setPreview(null);setError(null);setBusy(true);try{setPreview(await api.previewCleanup(action.scope,nation));}catch(e){setError(e instanceof Error?e.message:'Löschumfang konnte nicht geprüft werden.');}finally{setBusy(false);}};
  const remove=async()=>{if(!selected||!preview)return;setBusy(true);setError(null);try{await api.resetTestData(selected.scope,nation);window.dispatchEvent(new CustomEvent('admin:data-reset'));window.location.reload();}catch(e){setError(e instanceof Error?e.message:'Keine Daten wurden gelöscht.');}finally{setBusy(false);}};
  return <SplitPageLayout className="overflow-y-auto">
    {!embedded&&<PageHeader eyebrow="Administration" title="Datenbereinigung" subtitle="Operative Daten gezielt und innerhalb des ausgewählten Events entfernen."/>}
    <ContentCard className="space-y-4 p-5"><SectionHeader title="Operative Daten bereinigen" subtitle={selectedEvent?.name || 'Kein Event ausgewählt'}/>
      <InfoPanel tone="info" title="Nachweise bleiben geschützt">Aktivitäts- und Genehmigungsnachweise werden nicht als technische Protokolle gelöscht. Hotels, Kontingente, Bedarfsplanung und Eventkonfiguration bleiben erhalten.</InfoPanel>
      <label className="block text-sm font-bold">Nation<select aria-label="Nation für Bereinigung" value={nation} onChange={e=>setNation(e.target.value)} className="ml-3 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-background)] p-2"><option value="">Bitte wählen</option>{nations.map(n=><option key={n}>{n}</option>)}</select></label>
      <div className="grid gap-4 md:grid-cols-2">{actions.map(action=><ContentCard key={action.scope} className="flex flex-col gap-3 p-4"><h3 className="font-bold">{action.title}</h3><p className="flex-1 text-sm text-[var(--ops-text-muted)]">{action.description}</p><OpsButton disabled={busy||!selectedEvent?.canWrite||(action.scope==='nation'&&!nation)} onClick={()=>void open(action)}>{action.title}</OpsButton></ContentCard>)}</div>
    </ContentCard>
    {error&&!selected&&<InfoPanel tone="error" title="Bereinigung nicht verfügbar">{error}</InfoPanel>}
    <Dialog open={Boolean(selected)} onOpenChange={open=>{if(!open&&!busy){setSelected(null);setError(null);}}}><DialogContent className="max-w-2xl border-[var(--ops-border)] bg-[var(--ops-surface-raised)] p-0">
      <DialogHeader title={selected?.title || 'Daten löschen'} subtitle={`${selectedEvent?.name ?? ''}${selected?.scope==='nation'?` · ${nation}`:''}`}/>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-5">{busy&&!preview&&<p role="status">Löschumfang wird geprüft …</p>}{error&&<InfoPanel tone="error" title="Keine Daten gelöscht">{error}</InfoPanel>}
        {preview&&<CleanupScope preview={preview}/>}{selected?.scope==='all'&&<InfoPanel tone="warning" title="Automatisches Sicherheitsbackup">Die Löschung beginnt erst nach einem erfolgreich erstellten und geprüften Backup. Bei einem Fehler bleibt der Datenbestand unverändert.</InfoPanel>}
      </div><DialogFooter><OpsButton disabled={busy} onClick={()=>{setSelected(null);setError(null);}}>Abbrechen</OpsButton><OpsButton disabled={busy||!preview} onClick={()=>void remove()} className="text-[var(--ops-danger)]">{busy?'Wird ausgeführt …':'Löschen'}</OpsButton></DialogFooter>
    </DialogContent></Dialog>
  </SplitPageLayout>;
}
export function CleanupScope({preview}:{preview:CleanupPreview}) {
  const c=preview.counts;
  return <div className="space-y-3 text-sm"><p>Diese Aktion kann nicht rückgängig gemacht werden.</p><ul className="list-inside list-disc"><li>{c.people} Personen · {c.memberships} Competition-Zuordnungen</li><li>{c.bookings} Buchungen · {c.occupants} Belegungen · {c.legacyAssignments} Legacy-Zuweisungen betroffen</li><li>{c.sessions} Import-Sessions · {c.versions} Versionen · {c.approvals} Genehmigungen</li><li>{c.workflowEvents} zugehörige Historieneinträge</li></ul>{c.sharedRoomsRetained>0&&<p>{c.sharedRoomsRetained} gemeinsam genutzte Zimmer bleiben für die anderen Bewohner erhalten.</p>}<p><strong>Bleibt erhalten:</strong> {preview.preserved.join(', ')}. Andere Events bleiben unverändert.</p></div>;
}
