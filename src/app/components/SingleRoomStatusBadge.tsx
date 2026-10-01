import { BedSingle } from 'lucide-react';
import { semanticToneClasses } from '../design-system/components/primitives';
import { singleRoomBadgeLabels } from '../services/quotaEvaluation';

export type SingleRoomStatus = 'NONE' | 'IN_QUOTA' | 'APPROVED_EXTRA' | 'PENDING_APPROVAL';

export const singleRoomStatusPresentation = {
  NONE: { label: '', Icon: BedSingle, className: '' },
  IN_QUOTA: { label: 'Einzelzimmer', Icon: BedSingle, className: semanticToneClasses.info },
  APPROVED_EXTRA: { label: 'Einzelzimmer – Mehrpreis', Icon: BedSingle, className: semanticToneClasses.warning },
  PENDING_APPROVAL: { label: 'Einzelzimmer – Prüfung', Icon: BedSingle, className: semanticToneClasses.warning },
} satisfies Record<SingleRoomStatus, { label: string; Icon: typeof BedSingle; className: string }>;

/** Canonical presentation of a person's persisted single-room import status. */
export function SingleRoomStatusBadge({ status, className = '' }: { status?: SingleRoomStatus | null; importWorkflow?: boolean; className?: string }) {
  const normalizedStatus = status ?? 'NONE';
  if (normalizedStatus === 'NONE') return null;

  const presentation = singleRoomStatusPresentation[normalizedStatus];
  const Icon = presentation.Icon;
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${presentation.className} ${className}`}>
    <Icon className="h-3 w-3" aria-hidden="true" />
    {presentation.label}
  </span>;
}

/** Assignment presentation keeps operational single use independent from surcharge. */
export function SingleRoomAssignmentBadges({ status, countsAsSingle = false, className = '' }: { status?: SingleRoomStatus | null; countsAsSingle?: boolean; className?: string }) {
  const labels = singleRoomBadgeLabels(countsAsSingle, status);
  if (!labels.length) return null;

  return <span className="inline-flex flex-wrap gap-1">
    {labels.includes('Einzelzimmer') && <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.info} ${className}`}>
      <BedSingle className="h-3 w-3" aria-hidden="true" />
      Einzelzimmer
    </span>}
    {labels.includes('EZ genehmigt') && <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.success} ${className}`}>
      <BedSingle className="h-3 w-3" aria-hidden="true" />
      EZ genehmigt
    </span>}
    {labels.includes('Mehrpreis') && <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${semanticToneClasses.warning} ${className}`}>
      <BedSingle className="h-3 w-3" aria-hidden="true" />
      Mehrpreis
    </span>}
  </span>;
}
