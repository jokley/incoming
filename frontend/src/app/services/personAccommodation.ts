import { requirementLabel, requiresAccommodation } from './accommodationRequirement.ts';
import type { Athlete } from '../types.ts';

export function personAccommodation(athlete:Athlete) {
  const coverage=athlete.accommodationCoverage;
  const segments=coverage?.segments;
  const unresolved = athlete.accommodationRequirement === 'UNRESOLVED';
  const status=unresolved ? 'CONFLICT' : !requiresAccommodation(athlete) && coverage?.coverageStatus!=='CONFLICT' ? 'NO_ROOM' : coverage?.coverageStatus ?? (athlete.assignment?.hasAssignment ? 'FULLY_ASSIGNED' : 'UNASSIGNED');
  const labels={NO_ROOM:'Kein Zimmer benötigt',UNASSIGNED:'Nicht zugewiesen',PARTIALLY_ASSIGNED:'Teilweise zugewiesen',FULLY_ASSIGNED:'Zugewiesen',CONFLICT:'Aufenthalt prüfen / Konflikt'};
  const hotelNames=segments ? Array.from(new Set(segments.map(s=>s.hotelName).filter(Boolean))) : [athlete.assignment?.hotelName].filter(Boolean);
  return {status,label:unresolved ? requirementLabel('UNRESOLVED') : status==='NO_ROOM' && athlete.accommodationRequirement==='NO_DISPO' ? requirementLabel('NO_DISPO') : labels[status],tone:status==='FULLY_ASSIGNED' ? 'success' as const : status==='PARTIALLY_ASSIGNED' || status==='CONFLICT' ? 'warning' as const : 'neutral' as const,
    hotelLabel:status==='NO_ROOM' ? '—' : hotelNames.join(' · ') || '—',
    roomLabel:unresolved ? requirementLabel('UNRESOLVED') : status==='NO_ROOM' ? (athlete.accommodationRequirement==='NO_DISPO' ? 'Nicht einplanen' : 'No room') : segments && segments.length>1 ? `${segments.length} Segmente` : (segments?.[0]?.accommodationType==='EXTERNAL' ? 'Extern' : segments?.[0]?.roomTypeName) || athlete.assignment?.roomTypeName || athlete.roomType || '—',
    details:segments?.map(s=>`${s.checkInDate ?? '—'}–${s.checkOutDate ?? '—'} · ${s.hotelName ?? '—'} · ${s.accommodationType==='EXTERNAL' ? 'Extern' : `${s.roomTypeName ?? '—'} · ${s.roomNumber ?? '—'}`}`).join('\n') ?? '',
    segments:segments ?? [],
  };
}
