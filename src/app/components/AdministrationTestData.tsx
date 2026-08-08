import { useState } from 'react';
import { AlertTriangle, Check, Database, FlaskConical } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { ContentCard, DialogFooter, DialogHeader, EmptyState, InfoPanel, OpsButton, PageHeader, PageLayout, SectionHeader, StatusChip } from '../design-system';
import { api } from '../services/api';

type Scope = 'imports' | 'operations' | 'all';
const preserved = ['Hotels', 'Hotelkontingente', 'Zimmertypen', 'Events', 'Nationen', 'Benutzer', 'Rollen', 'Systemeinstellungen'];
const actions: Array<{ scope: Scope; title: string; description: string; deletes: string[] }> = [
  { scope: 'imports', title: 'Importdaten zurücksetzen', description: 'Entfernt den vollständigen Importverlauf und alle Entscheidungen.', deletes: ['Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen'] },
  { scope: 'operations', title: 'Athleten & Disposition zurücksetzen', description: 'Leert operative Personen- und Belegungsdaten.', deletes: ['Athleten', 'Assignments', 'Zimmerpartner', 'Prüfmarkierungen', 'Dispositionsstatus'] },
  { scope: 'all', title: 'Alle dynamischen Daten zurücksetzen', description: 'Stellt den Ausgangszustand her, ohne Stammdaten anzutasten.', deletes: ['Import Sessions', 'Import Versionen', 'Import Historie', 'Genehmigungen', 'Rücksprachen', 'Athleten', 'Assignments', 'Zimmerpartner', 'Prüfmarkierungen', 'Quotenstatus', 'Dispositionsstatus', 'temporäre Analysen', 'generierte Listen', 'Workflow-Status'] },
];

export function AdministrationTestData() {
  const [selected, setSelected] = useState<(typeof actions)[number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const reset = async () => {
    if (!selected) return;
    setSaving(true); setMessage(null);
    try {
      await api.resetTestData(selected.scope);
      window.dispatchEvent(new CustomEvent('admin:data-reset', { detail: { scope: selected.scope } }));
      setMessage({ tone: 'success', text: `${selected.title} wurde erfolgreich ausgeführt. Alle abhängigen Listen werden beim nächsten Aufruf neu geladen.` });
      setSelected(null);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Der Reset ist fehlgeschlagen.' });
    } finally { setSaving(false); }
  };

  return <PageLayout>
    <PageHeader eyebrow="Administration" title="Testdaten" subtitle="Dynamische Daten kontrolliert zurücksetzen und reproduzierbare Tests vorbereiten." meta={<StatusChip tone="warning">Nur für Administratoren</StatusChip>} />
    {message && <InfoPanel tone={message.tone} title={message.tone === 'success' ? 'Reset abgeschlossen' : 'Reset fehlgeschlagen'}>{message.text}</InfoPanel>}
    <ContentCard className="p-5">
      <SectionHeader title="Daten zurücksetzen" subtitle="Stammdaten bleiben bei jeder Aktion vollständig erhalten." />
      <div className="mt-5 grid gap-4 lg:grid-cols-3">{actions.map(action => <ContentCard key={action.scope} surface="elevated" elevation="none" className="flex flex-col p-4">
        <div className="flex items-start justify-between gap-3"><Database className="h-5 w-5 text-[var(--ops-text-subtle)]" /><StatusChip tone={action.scope === 'all' ? 'error' : 'warning'}>{action.deletes.length} Datenbereiche</StatusChip></div>
        <h3 className="mt-4 font-bold text-[var(--ops-text)]">{action.title}</h3><p className="mt-2 flex-1 text-sm text-[var(--ops-text-muted)]">{action.description}</p>
        <OpsButton className="mt-5 border-[var(--ops-tone-error-border)] bg-[var(--ops-tone-error-surface)]" onClick={() => setSelected(action)}>Reset vorbereiten</OpsButton>
      </ContentCard>)}</div>
    </ContentCard>
    <ContentCard className="p-5"><SectionHeader title="Szenarien" subtitle="Vorbereitung für zukünftige Testwerkzeuge" /><div className="mt-5"><EmptyState title="Szenario-Generator folgt" description="Geplante Szenarien umfassen neue Nationen, Quotenverletzungen, Meldelisten, Dispositionsänderungen und organisatorische Freigaben." action={<FlaskConical className="mx-auto h-6 w-6 text-[var(--ops-text-subtle)]" />} /></div></ContentCard>
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
