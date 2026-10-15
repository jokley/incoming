import type { Athlete } from '../types.ts';

export function personAccommodation(athlete:Athlete) {
  const coverage=athlete.accommodationCoverage;
  const segments=coverage?.segments;
  const status=coverage?.coverageStatus ?? (athlete.assignment?.hasAssignment ? 'FULLY_ASSIGNED' : 'UNASSIGNED');
  const labels={UNASSIGNED:'Nicht zugewiesen',PARTIALLY_ASSIGNED:'Teilweise zugewiesen',FULLY_ASSIGNED:'Zugewiesen',CONFLICT:'Aufenthalt prüfen / Konflikt'};
  const hotelNames=segments ? Array.from(new Set(segments.map(s=>s.hotelName).filter(Boolean))) : [athlete.assignment?.hotelName].filter(Boolean);
  return {status,label:labels[status],tone:status==='FULLY_ASSIGNED' ? 'success' as const : status==='PARTIALLY_ASSIGNED' || status==='CONFLICT' ? 'warning' as const : 'neutral' as const,
    hotelLabel:hotelNames.join(' · ') || '—',
    roomLabel:segments && segments.length>1 ? `${segments.length} Segmente` : segments?.[0]?.roomTypeName || athlete.assignment?.roomTypeName || athlete.roomType || '—',
    details:segments?.map(s=>`${s.checkInDate ?? '—'}–${s.checkOutDate ?? '—'} · ${s.hotelName ?? '—'} · ${s.roomTypeName ?? '—'} · ${s.roomNumber ?? '—'}`).join('\n') ?? '',
    segments:segments ?? [],
  };
}
