import { useState } from 'react';
import { Download, FlaskConical } from 'lucide-react';
import { ContentCard, InfoPanel, OpsButton } from '../design-system';
import { api } from '../services/api';

export function AdministrationTests() {
  const [generating, setGenerating] = useState(false);
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

  return <div className="space-y-5">
    {message && <InfoPanel tone={message.tone} title={message.tone === 'success' ? 'Generierung abgeschlossen' : 'Generierung fehlgeschlagen'}>{message.text}</InfoPanel>}
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
        action={<OpsButton disabled><FlaskConical className="mr-2 h-4 w-4" />Simulation generieren</OpsButton>}
      />
    </div>
  </div>;
}

function TestCard({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action: React.ReactNode }) {
  return <ContentCard surface="elevated" elevation="none" className="flex min-h-56 flex-col p-5">
    <div className="text-[var(--ops-text-subtle)]">{icon}</div>
    <h3 className="mt-4 text-lg font-extrabold text-[var(--ops-text)]">{title}</h3>
    <p className="mt-2 flex-1 text-sm leading-6 text-[var(--ops-text-muted)]">{description}</p>
    <div className="mt-5">{action}</div>
  </ContentCard>;
}
