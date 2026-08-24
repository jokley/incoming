import { useState, type ReactNode } from 'react';
import { ArchiveRestore, Database, FlaskConical, ShieldCheck } from 'lucide-react';
import { AdministrationTestData } from './AdministrationTestData';
import { AdministrationTests } from './AdministrationTests';
import { DatabaseBackups } from './DatabaseBackups';
import { ContentCard, PageHeader, SplitPageLayout, StatusChip } from '../design-system';

const sections = [
  { id: 'database', label: 'Datenbank', icon: Database },
  { id: 'backups', label: 'Backups', icon: ArchiveRestore },
  { id: 'tests', label: 'Tests', icon: FlaskConical },
] as const;
type Section = (typeof sections)[number]['id'];

export function Administration() {
  const [active, setActive] = useState<Section>('database');
  return <SplitPageLayout><PageHeader eyebrow="Systemverwaltung" title="Administration" subtitle="Datenbank, Backups und Tests zentral verwalten." meta={<StatusChip tone="neutral"><ShieldCheck className="mr-1 inline" size={13}/>Geschützter Bereich</StatusChip>}/>
    <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row">
      <ContentCard surface="raised" className="flex flex-col overflow-hidden xl:w-[22rem] xl:shrink-0"><div className="border-b border-[var(--ops-divider)] p-4"><h2 className="text-sm font-extrabold">Bereiche</h2><p className="mt-1 text-xs text-[var(--ops-text-muted)]">Administrativen Arbeitsbereich wählen</p></div><nav className="space-y-2 p-3" aria-label="Administrationsbereiche">{sections.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setActive(id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm font-bold transition ${active === id ? 'border-[var(--ops-primary)] bg-[var(--ops-tone-primary-surface)] text-[var(--ops-tone-primary-text)]' : 'border-[var(--ops-border)] bg-[var(--ops-surface)] text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-elevated)]'}`}><Icon size={18}/>{label}</button>)}</nav></ContentCard>
      <ContentCard surface="raised" className="overflow-hidden xl:min-h-0 xl:flex-1"><div className="border-b border-[var(--ops-divider)] p-5"><h2 className="text-xl font-extrabold">{sections.find(item => item.id === active)?.label}</h2><p className="mt-1 text-sm text-[var(--ops-text-muted)]">Detailinformationen und Aktionen</p></div><div className="p-5 xl:h-[calc(100%-5rem)] xl:overflow-y-auto">{active === 'database' && <AdminSection title="Datenverwaltung" description="Aktivitäten, Imports, Athleten und Zuweisungen verwalten."><AdministrationTestData embedded/></AdminSection>}{active === 'backups' && <AdminSection title="Datenbank & Backups" description="PostgreSQL-Status, Sicherungen und Wiederherstellung."><DatabaseBackups embedded/></AdminSection>}{active === 'tests' && <AdminSection title="Testwerkzeuge" description="Standardisierte Testfälle generieren und Simulationen vorbereiten."><AdministrationTests/></AdminSection>}</div></ContentCard>
    </div>
  </SplitPageLayout>;
}

function AdminSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section><h3 className="text-lg font-extrabold">{title}</h3><p className="mb-5 mt-1 text-sm text-[var(--ops-text-muted)]">{description}</p>{children}</section>;
}
