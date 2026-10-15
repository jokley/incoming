import { useState } from 'react';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { MoreHorizontal } from 'lucide-react';

export function SegmentActionMenu({label,busy,canChange,canSplit,onSplit,onRemove}:{label:string;busy:boolean;canChange:boolean;canSplit:boolean;onSplit?:()=>void;onRemove:()=>void}) {
  const [anchor,setAnchor]=useState<HTMLElement|null>(null);
  const act=(callback:()=>void)=>{setAnchor(null);callback();};
  return <>
    <IconButton size="small" disabled={busy} aria-label={`Aktionen · ${label}`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={event=>setAnchor(event.currentTarget)}><MoreHorizontal size={16}/></IconButton>
    <Menu anchorEl={anchor} open={!!anchor} onClose={()=>setAnchor(null)}>
      {onSplit && <MenuItem disabled={!canChange || !canSplit} onClick={()=>act(onSplit)}>Hotelwechsel / Aufenthalt teilen</MenuItem>}
      <MenuItem sx={{color:'error.main'}} onClick={()=>act(onRemove)}>Zuweisung entfernen</MenuItem>
    </Menu>
  </>;
}
