import { Tooltip } from '@mui/material';
import { visibleAssignmentComment } from '../../services/assignmentComments';

export function AssignmentComment({label,comment}:{label:string;comment?:string|null}) {
  const text=visibleAssignmentComment(comment);
  if (!text) return null;
  return <aside className="min-w-0 text-xs text-[var(--ops-text-muted)]">
    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide">{label}</div>
    <Tooltip title={<span className="whitespace-pre-wrap break-words">{text}</span>}>
      <p tabIndex={0} className="line-clamp-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</p>
    </Tooltip>
  </aside>;
}
