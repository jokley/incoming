import { BedSingle, CircleOff, CircleCheck } from 'lucide-react';

export type SingleRoomStatus = 'NONE' | 'IN_QUOTA' | 'APPROVED_EXTRA' | 'PENDING_APPROVAL';

const statusPresentation = {
  NONE: { label: 'Kein Einzelzimmeranspruch', Icon: CircleOff, className: 'border-slate-500/30 bg-slate-500/10 text-slate-400' },
  IN_QUOTA: { label: 'Einzelzimmer · innerhalb Quote', Icon: BedSingle, className: 'border-blue-400/30 bg-blue-400/10 text-blue-300' },
  APPROVED_EXTRA: { label: 'Einzelzimmer · Mehrpreis genehmigt', Icon: CircleCheck, className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' },
  PENDING_APPROVAL: { label: 'Einzelzimmer · Genehmigung offen', Icon: BedSingle, className: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
} satisfies Record<SingleRoomStatus, { label: string; Icon: typeof BedSingle; className: string }>;

/** Canonical presentation of a person's persisted single-room status. */
export function SingleRoomStatusBadge({ status, importWorkflow = false, className = '' }: { status?: SingleRoomStatus | null; importWorkflow?: boolean; className?: string }) {
  const normalizedStatus = status ?? 'NONE';
  if (normalizedStatus === 'PENDING_APPROVAL' && !importWorkflow) return null;

  const presentation = statusPresentation[normalizedStatus];
  const Icon = presentation.Icon;
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${presentation.className} ${className}`}>
    <Icon className="h-3 w-3" aria-hidden="true" />
    {presentation.label}
  </span>;
}
