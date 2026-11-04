import {IconButton,Switch,Tooltip} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {ezQuotaLabel,ezQuotaTooltip,ezQuotaTooltipStyle} from '../../services/ezQuotaPresentation';

export function EzQuotaControl({checked,disabled,onChange,reason}:{checked:boolean;disabled:boolean;onChange:(checked:boolean)=>void;reason?:string}) {
  return <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] px-3 py-2">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold text-[var(--ops-text)]">{ezQuotaLabel}</span>
        <Tooltip title={ezQuotaTooltip} arrow slotProps={{tooltip:{sx:ezQuotaTooltipStyle},arrow:{sx:{color:ezQuotaTooltipStyle.backgroundColor}}}}>
          <IconButton size="small" aria-label="Information zur EZ-Quotenbewertung"><InfoOutlinedIcon fontSize="inherit"/></IconButton>
        </Tooltip>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={(_,value)=>onChange(value)} slotProps={{input:{'aria-label':ezQuotaLabel}}}/>
    </div>
    {reason && <p className="mt-0.5 text-[11px] leading-snug text-[var(--ops-text-muted)]">{reason}</p>}
  </div>;
}
