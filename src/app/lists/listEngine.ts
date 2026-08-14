import type { Athlete, RoomBooking } from '../types';

export type ListKind = 'hotels' | 'nations';

export interface ListRow {
  id: string;
  hotelId: string;
  bookingId: string;
  hotel: string;
  room: string;
  roomType: string;
  name: string;
  nation: string;
  discipline: string;
  role: string;
  arrival: string;
  departure: string;
  firstMeal: string;
  lastMeal: string;
  specialMeal: string;
  lateCheckout: string;
  surcharge: string;
  roommate: string;
  remark: string;
  assigned: boolean;
  active: boolean;
}

export interface ListFilters {
  search: string;
  selection: string;
  discipline: string;
  assignedOnly: boolean;
  activeOnly: boolean;
}

const value = (entry?: string | null) => entry?.trim() || '—';
const iso = (entry?: string | null) => entry?.slice(0, 10) || '';

/** Creates the one shared, read-only projection consumed by every list and export. */
export function createListRows(athletes: Athlete[], bookings: RoomBooking[]): ListRow[] {
  const assignments = new Map<string, { booking: RoomBooking; roommate: string }>();
  bookings.forEach((booking) => booking.occupants.forEach((occupant) => {
    const roommate = booking.occupants
      .filter((candidate) => candidate.athlete.id !== occupant.athlete.id)
      .map((candidate) => `${candidate.athlete.firstname} ${candidate.athlete.lastname}`.trim())
      .join(', ');
    assignments.set(occupant.athlete.id, { booking, roommate });
  }));

  return athletes.map((athlete) => {
    const assignment = assignments.get(athlete.id);
    const booking = assignment?.booking;
    return {
      id: athlete.id,
      hotelId: booking?.hotel.id || '',
      bookingId: booking?.id || '',
      hotel: value(booking?.hotel.name),
      room: value(booking?.roomNumber),
      roomType: value(booking?.roomType.name || athlete.roomType),
      name: `${athlete.lastname}, ${athlete.firstname}`,
      nation: value(athlete.nationCode),
      discipline: value(athlete.discipline || athlete.disciplines?.join(', ')),
      role: value(athlete.function),
      arrival: iso(booking?.checkInDate || athlete.arrivalDate),
      departure: iso(booking?.checkOutDate || athlete.departureDate),
      firstMeal: value(athlete.firstMeal),
      lastMeal: value(athlete.lastMeal),
      specialMeal: value(athlete.specialMeal),
      lateCheckout: athlete.lateCheckout ? 'Ja' : 'Nein',
      surcharge: athlete.single_room_status === 'APPROVED_EXTRA' ? 'Ja' : 'Nein',
      roommate: value(assignment?.roommate || athlete.sharedWithName),
      remark: value(athlete.additionalItems),
      assigned: Boolean(booking),
      active: !athlete.missingFromLatestAthletesImport && !athlete.missingFromLatestRoomlistImport,
    };
  });
}

export function filterListRows(rows: ListRow[], kind: ListKind, filters: ListFilters) {
  const query = filters.search.trim().toLocaleLowerCase('de');
  return rows.filter((row) => {
    if (filters.assignedOnly && !row.assigned) return false;
    if (filters.activeOnly && !row.active) return false;
    if (filters.selection && (kind === 'hotels' ? row.hotel : row.nation) !== filters.selection) return false;
    if (filters.discipline && row.discipline !== filters.discipline) return false;
    return !query || Object.values(row).some((item) => String(item).toLocaleLowerCase('de').includes(query));
  });
}

export function groupListRows(rows: ListRow[], kind: ListKind) {
  const groups = new Map<string, Map<string, ListRow[]>>();
  rows.forEach((row) => {
    const primary = kind === 'hotels' ? row.hotel : row.nation;
    const secondary = kind === 'hotels' ? `${row.room} · ${row.roomType}` : row.discipline;
    if (!groups.has(primary)) groups.set(primary, new Map());
    const children = groups.get(primary)!;
    if (!children.has(secondary)) children.set(secondary, []);
    children.get(secondary)!.push(row);
  });
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([label, children]) => ({
    label,
    count: [...children.values()].reduce((sum, entries) => sum + entries.length, 0),
    children: [...children].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([childLabel, entries]) => ({
      label: childLabel,
      rows: entries.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    })),
  }));
}
