import { useMemo, useState } from 'react';
import { BookOpen, Calculator } from 'lucide-react';

import { ContentCard, SectionHeader, StatusChip } from '../design-system';
import { computeOfficialQuota, computeSingleRoomEntitlement } from '../services/fisRules';

const REFERENCE_ATHLETES = Array.from({ length: 8 }, (_, index) => index + 1);

export function FisRulesPanel() {
  const [athletes, setAthletes] = useState(1);
  const officialQuota = computeOfficialQuota(athletes);
  const singleRoomQuota = computeSingleRoomEntitlement(officialQuota);
  const referenceRows = useMemo(() => REFERENCE_ATHLETES.map((enteredAthletes) => {
    const officials = computeOfficialQuota(enteredAthletes);
    return { athletes: enteredAthletes, officials, singleRooms: computeSingleRoomEntitlement(officials) };
  }), []);

  const handleAthletesChange = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    setAthletes(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--ops-assignment-canvas)] p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <header>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[var(--ops-primary)]" aria-hidden="true" />
            <h1 className="text-xl font-bold text-[var(--ops-text)]">FIS Rules</h1>
          </div>
          <p className="mt-1 text-sm text-[var(--ops-text-muted)]">Schnellreferenz für Official Quota und Single Room Quota.</p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <RuleCard title="Official Quota" rule="Officials = Entered Athletes + 2">
                Die Anzahl der gemeldeten Athleten bestimmt direkt die Official Quota.
              </RuleCard>
              <RuleCard title="Single Room Quota" rule="1–3 → 1 · 4–6 → 2 · 7+ → 3">
                Maßgeblich ist die berechnete Anzahl der Officials.
              </RuleCard>
            </div>

            <ContentCard className="overflow-hidden">
              <div className="border-b border-[var(--ops-divider)] px-4 py-3">
                <SectionHeader title="Reference Table" subtitle="Quoten für 1 bis 8 gemeldete Athleten" />
              </div>
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--ops-surface-elevated)] text-left text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ops-text-subtle)]">
                  <tr><th className="px-4 py-2.5">Athletes</th><th className="px-4 py-2.5">Officials</th><th className="px-4 py-2.5">Single Rooms</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--ops-divider)] font-mono text-[var(--ops-text)]">
                  {referenceRows.map((row) => <tr key={row.athletes} className="hover:bg-[var(--ops-surface-elevated)]"><td className="px-4 py-2.5">{row.athletes}</td><td className="px-4 py-2.5">{row.officials}</td><td className="px-4 py-2.5">{row.singleRooms}</td></tr>)}
                </tbody>
              </table>
            </ContentCard>
          </div>

          <ContentCard className="h-fit p-4" elevation="md">
            <SectionHeader title="Live Calculator" subtitle="FIS-Quote sofort prüfen" actions={<Calculator className="h-5 w-5 text-[var(--ops-primary)]" aria-hidden="true" />} />
            <label className="mt-5 block text-xs font-bold text-[var(--ops-text-muted)]" htmlFor="entered-athletes">Entered Athletes</label>
            <input id="entered-athletes" type="number" min="0" step="1" value={athletes} onChange={(event) => handleAthletesChange(event.target.value)} className="mt-2 w-full rounded-[var(--ops-radius-md)] border border-[var(--ops-border-strong)] bg-[var(--ops-surface-elevated)] px-3 py-2.5 font-mono text-base font-bold text-[var(--ops-text)] outline-none focus:border-[var(--ops-primary)] focus:shadow-[var(--ops-focus-ring)]" />
            <div className="mt-5 divide-y divide-[var(--ops-divider)] rounded-[var(--ops-radius-lg)] border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)]">
              <Result label="Officials" value={officialQuota} />
              <Result label="Single Room Quota" value={singleRoomQuota} />
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--ops-text-muted)]">Berechnung nach denselben FIS-Regeln wie die Quotenansicht.</p>
          </ContentCard>
        </div>
      </div>
    </div>
  );
}

function RuleCard({ title, rule, children }: { title: string; rule: string; children: string }) {
  return <ContentCard className="p-4"><div className="flex items-center justify-between gap-3"><h2 className="font-bold text-[var(--ops-text)]">{title}</h2><StatusChip tone="info">FIS Rule</StatusChip></div><div className="mt-4 rounded-[var(--ops-radius-md)] bg-[var(--ops-tone-primary-surface)] px-3 py-3 font-mono text-base font-extrabold text-[var(--ops-primary)]">{rule}</div><p className="mt-3 text-sm leading-5 text-[var(--ops-text-muted)]">{children}</p></ContentCard>;
}

function Result({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between px-4 py-3"><span className="text-sm font-semibold text-[var(--ops-text-muted)]">{label}</span><strong className="font-mono text-2xl text-[var(--ops-text)]" aria-live="polite">{value}</strong></div>;
}
