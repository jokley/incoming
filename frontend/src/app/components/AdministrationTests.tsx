import { useState } from 'react';
import { Download, FlaskConical, Trash2 } from 'lucide-react';
import { ContentCard, InfoPanel, OpsButton } from '../design-system';
import { api } from '../services/api';

export function AdministrationTests() {
  const [generating, setGenerating] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.createSimulation>> | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const generateComplete = async () => {
    setGenerating(true); setMessage(null);
    try {
      await api.generateCompleteScenarios();
      setMessage({ tone: 'success', text: 'Der komplette Testordner wurde erzeugt und heruntergeladen.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Generierung fehlgeschlagen.' });
    } finally { setGenerating(false); }
  };

  const createSimulation = async () => {
    if (!window.confirm('Vorhandene Simulationsdaten werden ersetzt. Simulation jetzt starten?')) return;
    setSimulationRunning(true); setMessage(null); setSummary(null);
    try {
      const result = await api.createSimulation();
      setSummary(result);
      setMessage({ tone: 'success', text: 'Die reproduzierbare Simulation wurde vollständig erzeugt.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Simulation fehlgeschlagen.' });
    } finally { setSimulationRunning(false); }
  };

  const deleteSimulation = async () => {
    if (!window.confirm('Ausschließlich gekennzeichnete Simulationsdaten werden gelöscht. Fortfahren?')) return;
    setSimulationRunning(true); setMessage(null);
    try {
      const result = await api.deleteSimulation();
      setSummary(null);
      setMessage({ tone: 'success', text: `${result.deleted.people} Personen und ${result.deleted.roomAssignments} Zimmerzuweisungen wurden gelöscht.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Löschen fehlgeschlagen.' });
    } finally { setSimulationRunning(false); }
  };

  return <div className="space-y-5">
    {message && <InfoPanel tone={message.tone} title={message.tone === 'success' ? 'Generierung abgeschlossen' : 'Generierung fehlgeschlagen'}>{message.text}</InfoPanel>}
    {summary && <ContentCard surface="elevated" elevation="none" className="p-5">
      <h3 className="text-base font-extrabold text-[var(--ops-text)]">Zusammenfassung der Simulation</h3>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryValue label="Personen" value={summary.peopleCreated} />
        <SummaryValue label="Hotels" value={summary.hotelsUsed} />
        <SummaryValue label="Zimmerzuweisungen" value={summary.roomAssignmentsCreated} />
        <SummaryValue label="Nicht zugewiesen" value={summary.peopleUnassigned} />
        <SummaryValue label="Laufzeit" value={`${(summary.durationMs / 1000).toFixed(1)} s`} />
      </dl>
    </ContentCard>}
    <div className="grid gap-5 lg:grid-cols-2">
      <TestCard
        icon={<Download className="h-5 w-5" />}
        title="Regressionstest"
        description="Erstellt alle standardisierten Import-Testfälle inklusive Referenzdaten zur automatischen Validierung."
        action={<OpsButton disabled={generating} onClick={generateComplete}><Download className="mr-2 h-4 w-4" />{generating ? 'Wird generiert …' : 'Testordner generieren'}</OpsButton>}
      />
      <TestCard
        icon={<FlaskConical className="h-5 w-5" />}
        title="Simulation"
        description="Erzeugt eine reproduzierbare Testdatenbasis für Funktions-, Integrations- und Performance-Tests."
        action={<div className="flex flex-wrap gap-3">
          <OpsButton disabled={simulationRunning} onClick={createSimulation}><FlaskConical className="mr-2 h-4 w-4" />{simulationRunning ? 'Bitte warten …' : 'Simulation generieren'}</OpsButton>
          <OpsButton className="text-[var(--ops-danger)]" disabled={simulationRunning} onClick={deleteSimulation}><Trash2 className="mr-2 h-4 w-4" />Simulation löschen</OpsButton>
        </div>}
      />
    </div>
  </div>;
}

function SummaryValue({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--ops-text-subtle)]">{label}</dt><dd className="mt-1 text-xl font-extrabold text-[var(--ops-text)]">{value}</dd></div>;
}

function TestCard({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action: React.ReactNode }) {
  return <ContentCard surface="elevated" elevation="none" className="flex min-h-56 flex-col p-5">
    <div className="text-[var(--ops-text-subtle)]">{icon}</div>
    <h3 className="mt-4 text-lg font-extrabold text-[var(--ops-text)]">{title}</h3>
    <p className="mt-2 flex-1 text-sm leading-6 text-[var(--ops-text-muted)]">{description}</p>
    <div className="mt-5">{action}</div>
  </ContentCard>;
}
