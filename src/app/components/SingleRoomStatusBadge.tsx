import { BedSingle, CircleOff, CircleCheck } from 'lucide-react';

export type SingleRoomStatus = 'NONE' | 'IN_QUOTA' | 'APPROVED_EXTRA' | 'PENDING_APPROVAL';

const statusPresentation = {
  NONE: { label: 'Kein Einzelzimmeranspruch', Icon: CircleOff, className: 'border-slate-400/50 bg-slate-400/15 text-slate-200' },
  IN_QUOTA: { label: 'Einzelzimmer · innerhalb Quote', Icon: BedSingle, className: 'border-blue-300/55 bg-blue-400/20 text-blue-200' },
  APPROVED_EXTRA: { label: 'Einzelzimmer · Mehrpreis genehmigt', Icon: CircleCheck, className: 'border-emerald-300/55 bg-emerald-400/20 text-emerald-200' },
  PENDING_APPROVAL: { label: 'Einzelzimmer · Genehmigung offen', Icon: BedSingle, className: 'border-amber-300/55 bg-amber-400/20 text-amber-100' },
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
