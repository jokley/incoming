import type { SingleRoomStatus, SingleRoomQuotaExemptReason } from '../types';
import { BedSingle, Stamp } from 'lucide-react';
import { semanticToneClasses } from '../design-system/components/primitives';
import { singleRoomBadgeLabels, type PersonQuotaEvaluation } from '../services/quotaEvaluation';

export type { SingleRoomStatus } from '../types';

export const singleRoomStatusPresentation = {
  NONE: { label: '', Icon: BedSingle, className: '' },
  IN_QUOTA: { label: 'Einzelzimmer', Icon: BedSingle, className: semanticToneClasses.info },
  APPROVED_EXTRA: { label: 'Mehrpreis genehmigt', Icon: Stamp, className: semanticToneClasses.warning },
  PENDING_APPROVAL: { label: '+EZ offen', Icon: BedSingle, className: semanticToneClasses.warning },
} satisfies Record<SingleRoomStatus, { label: string; Icon: typeof BedSingle; className: string }>;

/** Canonical presentation of a person's persisted single-room import status. */
export function SingleRoomStatusBadge({ status, className = '' }: { status?: SingleRoomStatus | null; importWorkflow?: boolean; className?: string }) {
  const normalizedStatus = status ?? 'NONE';
  if (normalizedStatus === 'NONE') return null;

  const presentation = singleRoomStatusPresentation[normalizedStatus];
  const Icon = presentation.Icon;
  return <span title={normalizedStatus === 'APPROVED_EXTRA' ? 'Gespeicherte Importentscheidung: zusätzliches EZ mit Mehrpreis genehmigt. Aktuelle Nutzung und Anwendbarkeit werden separat bewertet.' : undefined} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${presentation.className} ${className}`}>
    <Icon className="h-3 w-3" aria-hidden="true" />
    {presentation.label}
  </span>;
}

/** Assignment presentation keeps operational single use independent from surcharge. */
export function SingleRoomAssignmentBadges({ status, countsAsSingle = false, exemptReason, activeSurcharge = false, allocationStatus, approvalApplicable, className = '' }: { status?: SingleRoomStatus | null; countsAsSingle?: boolean; exemptReason?: SingleRoomQuotaExemptReason; activeSurcharge?: boolean; allocationStatus?: PersonQuotaEvaluation['allocationStatus']; approvalApplicable?: boolean; className?: string }) {
  const labels = singleRoomBadgeLabels(countsAsSingle, status, exemptReason, activeSurcharge, allocationStatus, approvalApplicable);
  if (!labels.length) return null;

  return <span className="inline-flex flex-wrap gap-1">
    {labels.includes('👑 WM') && <span title={countsAsSingle ? 'Kostenfreie Weltmeisterausnahme – kein EZ-Quotenverbrauch' : 'Weltmeisterausnahme hinterlegt; derzeit keine EZ-Nutzung in dieser Buchung'} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.success} ${className}`}>👑 WM</span>}
    {labels.includes('EZ ✓') && <span title={countsAsSingle ? 'Gültige kostenfreie EZ-Ausnahme – kein Quotenverbrauch' : 'EZ-Ausnahme hinterlegt; derzeit keine EZ-Nutzung in dieser Buchung'} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.success} ${className}`}>EZ ✓</span>}
    {labels.includes('EZ genehmigt') && <span title="Einzelzimmer mit genehmigtem Mehrpreis" className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.success} ${className}`}><Stamp className="h-3 w-3" aria-hidden="true" />EZ</span>}
    {labels.includes('Einzelzimmer') && <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.info} ${className}`}><BedSingle className="h-3 w-3" aria-hidden="true" />Einzelzimmer</span>}
    {[
      { label: 'EZ in Quote', title: 'Diese aktive EZ-Nutzung ist durch die reguläre Quote abgedeckt.', tone: semanticToneClasses.success },
      { label: 'Entscheidung offen', title: 'Aktive EZ-Nutzung ohne reguläre Deckung oder gültige Ausnahme; noch kein genehmigter EZ-Mehrpreis.', tone: semanticToneClasses.warning },
      { label: 'EZ-Genehmigung inaktiv', title: 'Genehmigung bleibt erhalten; diese Buchung nutzt sie nicht als EZ. Kein aktiver EZ-Mehrpreis aus dieser Buchung.', tone: semanticToneClasses.info },
      { label: 'EZ-Genehmigung hinterlegt', title: 'Gespeicherte Genehmigung; aktuelle Anwendbarkeit und Mehrpreis ergeben sich aus der Quotenbewertung.', tone: semanticToneClasses.info },
      { label: 'EZ-Genehmigung prüfen', title: 'Historische Genehmigung deckt den aktuellen Quotenkontext nicht. Die aktuelle EZ-Nutzung wird unabhängig bewertet.', tone: semanticToneClasses.warning },
    ].filter(item => labels.includes(item.label)).map(item => <span key={item.label} title={item.title} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${item.tone} ${className}`}>{item.label}</span>)}
    {labels.includes('Mehrpreis') && <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.warning} ${className}`}>
      <BedSingle className="h-3 w-3" aria-hidden="true" />
      Mehrpreis
    </span>}
  </span>;
}
