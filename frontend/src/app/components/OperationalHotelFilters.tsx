import { clsx } from 'clsx';

export type OperationalHotelFilter = 'all' | 'critical' | 'under75' | 'over75' | 'full' | 'freeSingle' | 'freeDouble';
export type OperationalHotelState = { name:string; occupancy:number; totalCapacity:number; freeCapacity:number; hasFreeSingle:boolean; hasFreeDouble:boolean };

export const OPERATIONAL_HOTEL_FILTERS:ReadonlyArray<{value:OperationalHotelFilter;label:string}> = [
  {value:'all',label:'Alle'}, {value:'under75',label:'< 75 %'},
  {value:'over75',label:'≥ 75 %'}, {value:'full',label:'Voll'},
  {value:'freeSingle',label:'Freie EZ'}, {value:'freeDouble',label:'Freie DZ'},
];

export function matchesOperationalHotelFilter(state:OperationalHotelState,filter:OperationalHotelFilter){if(filter==='all')return true;if(filter==='critical')return state.totalCapacity>0&&(state.occupancy>=90||state.freeCapacity<=2);if(filter==='under75')return state.occupancy<75;if(filter==='over75')return state.occupancy>=75;if(filter==='full')return state.totalCapacity>0&&state.freeCapacity===0;if(filter==='freeSingle')return state.hasFreeSingle;return state.hasFreeDouble;}
export function compareOperationalHotels(a:OperationalHotelState,b:OperationalHotelState){const rank=(state:OperationalHotelState)=>state.totalCapacity>0&&state.freeCapacity===0?0:state.occupancy>=75?1:2;return rank(a)-rank(b)||b.occupancy-a.occupancy||a.name.localeCompare(b.name,'de');}

export function OperationalHotelFilters({value,onChange,className}:{value:OperationalHotelFilter;onChange:(value:OperationalHotelFilter)=>void;className?:string}){return <div className={clsx('flex flex-wrap gap-1.5',className)} aria-label="Operative Hotelfilter">{OPERATIONAL_HOTEL_FILTERS.map(option=><button key={option.value} type="button" aria-pressed={value===option.value} onClick={()=>onChange(option.value)} className={clsx('rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ops-focus-ring)]',value===option.value?'border-[var(--ops-primary)] bg-[var(--ops-primary)] text-white':'border-[var(--ops-border)] bg-[var(--ops-surface-elevated)] text-[var(--ops-text-muted)] hover:border-[var(--ops-border-strong)] hover:text-[var(--ops-text)]')}>{option.label}</button>)}</div>;}
