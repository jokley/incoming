import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Database, Download, FlaskConical } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { ContentCard, DialogFooter, DialogHeader, InfoPanel, OpsButton, PageHeader, PageLayout, SectionHeader, StatusChip } from '../design-system';
import { api } from '../services/api';

type Scope = 'imports' | 'athletes' | 'assignments' | 'all';
const preserved = ['Hotels', 'Hotelkontingente', 'Zimmertypen', 'Events', 'Nationen', 'Benutzer', 'Rollen', 'Systemeinstellungen'];
const actions: Array<{ scope: Scope; title: string; description: string; deletes: string[] }> = [
  { scope: 'imports', title: 'Imports', description: 'Entfernt alle Imports und deren Verlauf.', deletes: ['Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen'] },
  { scope: 'athletes', title: 'Athleten', description: 'Entfernt alle importierten Athleten und Officials.', deletes: ['Athleten', 'Zimmerpartner', 'Prüfmarkierungen', 'Zimmerbelegungen'] },
  { scope: 'assignments', title: 'Zuweisungen', description: 'Entfernt alle Zimmerzuweisungen.', deletes: ['Zimmerbelegungen', 'Assignments', 'Dispositionsstatus'] },
  { scope: 'all', title: 'Alles zurücksetzen', description: 'Stellt den Ausgangszustand für alle Testdaten wieder her.', deletes: ['Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen', 'Rücksprachen', 'Athleten', 'Assignments', 'Zimmerpartner', 'Prüfmarkierungen', 'Quotenstatus', 'Dispositionsstatus', 'temporäre Analysen', 'generierte Listen', 'Workflow-Status'] },
];

export function AdministrationTestData() {
  const [selected, setSelected] = useState<(typeof actions)[number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [scenarios, setScenarios] = useState<Array<{ number: string; title: string; description: string; versions: number }>>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  useEffect(() => {
    const resetMessage = sessionStorage.getItem('admin-reset-success');
    if (resetMessage) {
      sessionStorage.removeItem('admin-reset-success');
      setMessage({ tone: 'success', text: resetMessage });
    }
    api.getScenarios().then(setScenarios).catch(() => setMessage({ tone: 'error', text: 'Szenarien konnten nicht geladen werden.' }));
  }, []);

  const generate = async (number: string) => {
    setGenerating(number); setMessage(null);
    try {
      await api.generateScenario(number);
      setMessage({ tone: 'success', text: `Szenario ${number} wurde reproduzierbar erzeugt und heruntergeladen.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Generierung fehlgeschlagen.' });
    } finally { setGenerating(null); }
  };
  const generateComplete = async () => {
    setGenerating('complete'); setMessage(null);
    try {
      await api.generateCompleteScenarios();
      setMessage({ tone: 'success', text: 'Der komplette Testordner wurde erzeugt und heruntergeladen.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Generierung fehlgeschlagen.' });
    } finally { setGenerating(null); }
  };
  const reset = async () => {
    if (!selected) return;
    setSaving(true); setMessage(null);
    try {
      await api.resetTestData(selected.scope);
      window.dispatchEvent(new CustomEvent('admin:data-reset', { detail: { scope: selected.scope } }));
      sessionStorage.setItem('admin-reset-success', `${selected.title} wurde erfolgreich ausgeführt. Alle Caches und Ansichten wurden neu geladen.`);
      window.location.reload();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Der Reset ist fehlgeschlagen.' });
    } finally { setSaving(false); }
  };

  return <PageLayout>
    <PageHeader eyebrow="Administration" title="Testdaten" subtitle="Dynamische Daten kontrolliert zurücksetzen und reproduzierbare Tests vorbereiten." meta={<StatusChip tone="warning">Nur für Administratoren</StatusChip>} />
    {message && <InfoPanel tone={message.tone} title={message.tone === 'success' ? 'Reset abgeschlossen' : 'Reset fehlgeschlagen'}>{message.text}</InfoPanel>}
    <ContentCard className="p-5">
      <SectionHeader title="Daten zurücksetzen" subtitle="Stammdaten bleiben bei jeder Aktion vollständig erhalten." />
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{actions.map(action => <ContentCard key={action.scope} surface="elevated" elevation="none" className={`flex flex-col p-5 ${action.scope === 'all' ? 'border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)]' : ''}`}>
        <div className="flex items-start justify-between gap-3"><Database className="h-5 w-5 text-[var(--ops-text-subtle)]" /><StatusChip tone={action.scope === 'all' ? 'error' : 'warning'}>{action.deletes.length} Datenbereiche</StatusChip></div>
        <h3 className="mt-4 font-bold text-[var(--ops-text)]">{action.title}</h3><p className="mt-2 flex-1 text-sm text-[var(--ops-text-muted)]">{action.description}</p>
        <OpsButton className={`mt-5 font-bold text-white shadow-md ${action.scope === 'all' ? 'border-red-400 bg-red-700 hover:bg-red-600' : 'border-[var(--ops-primary)] bg-[var(--ops-primary)] hover:brightness-110'}`} onClick={() => setSelected(action)}>{action.title}</OpsButton>
      </ContentCard>)}</div>
    </ContentCard>
    <ContentCard className="p-5">
      <SectionHeader title="Szenarien" subtitle="Deterministische FIS-Dateipaare mit dokumentiertem Soll-Ergebnis" />
      <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-[var(--ops-primary)] bg-[var(--ops-surface-elevated)] p-4">
        <div><h3 className="font-bold">Kompletter Testordner</h3><p className="text-sm text-[var(--ops-text-muted)]">Alle Szenarien und Versionen in chronologischer Reihenfolge.</p></div>
        <OpsButton disabled={generating !== null} onClick={generateComplete}><Download className="mr-2 h-4 w-4" />Komplett herunterladen</OpsButton>
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-[var(--ops-border)]">
        <div className="hidden grid-cols-[72px_1fr_110px_150px] gap-4 bg-[var(--ops-surface-subtle)] px-4 py-3 text-xs font-bold uppercase tracking-wide text-[var(--ops-text-subtle)] md:grid">
          <span>Nr.</span><span>Szenario</span><span>Versionen</span><span className="sr-only">Aktion</span>
        </div>
        {scenarios.map(scenario => <div key={scenario.number} className="grid gap-3 border-t border-[var(--ops-border)] p-4 first:border-t-0 md:grid-cols-[72px_1fr_110px_150px] md:items-center">
          <span className="font-mono text-sm font-bold text-[var(--ops-primary)]">{scenario.number}</span>
          <div><h3 className="font-bold text-[var(--ops-text)]">{scenario.title}</h3><p className="mt-1 text-sm text-[var(--ops-text-muted)]">{scenario.description}</p></div>
          <StatusChip tone="neutral">{scenario.versions} {scenario.versions === 1 ? 'Version' : 'Versionen'}</StatusChip>
          <OpsButton disabled={generating !== null} onClick={() => generate(scenario.number)}>
            {generating === scenario.number ? <FlaskConical className="mr-2 h-4 w-4 animate-pulse" /> : <Download className="mr-2 h-4 w-4" />}
            {generating === scenario.number ? 'Generiert …' : 'Generieren'}
          </OpsButton>
        </div>)}
      </div>
      <p className="mt-4 text-xs text-[var(--ops-text-subtle)]">Jeder Download enthält pro Version <strong>entries.xlsx</strong> und <strong>entries-room-list-detailed.xlsx</strong> sowie eine <strong>expected.json</strong>.</p>
    </ContentCard>
    <Dialog open={Boolean(selected)} onOpenChange={open => !open && !saving && setSelected(null)}><DialogContent className="max-w-3xl overflow-hidden p-0">
      {selected && <><DialogHeader title={selected.title} subtitle="Diese Aktion kann nicht rückgängig gemacht werden." /><div className="max-h-[65vh] overflow-y-auto p-5">
        <InfoPanel tone="error" title="Endgültig löschen"><span className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />Prüfen Sie den Umfang sorgfältig und bestätigen Sie erst danach.</span></InfoPanel>
        <div className="mt-5 grid gap-5 md:grid-cols-2"><DataList title="Folgende Daten werden gelöscht:" items={selected.deletes} /><DataList title="Folgende Daten bleiben erhalten:" items={preserved} /></div>
      </div><DialogFooter><OpsButton disabled={saving} onClick={() => setSelected(null)}>Abbrechen</OpsButton><OpsButton disabled={saving} className="border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)]" onClick={reset}>{saving ? 'Reset wird ausgeführt …' : 'Endgültig zurücksetzen'}</OpsButton></DialogFooter></>}
    </DialogContent></Dialog>
  </PageLayout>;
}

function DataList({ title, items }: { title: string; items: string[] }) {
  return <div><h4 className="font-bold">{title}</h4><ul className="mt-3 space-y-2">{items.map(item => <li key={item} className="flex gap-2 text-sm text-[var(--ops-text-muted)]"><Check className="h-4 w-4 shrink-0 text-[var(--ops-success)]" />{item}</li>)}</ul></div>;
}
