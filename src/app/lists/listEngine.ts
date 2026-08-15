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
}

export interface ListFilters {
  search: string;
  selection: string;
  discipline: string;
  assignedOnly: boolean;
}

const value = (entry?: string | null) => entry?.trim() || '—';
const iso = (entry?: string | null) => entry?.slice(0, 10) || '';
const roomLabel = (entry?: string | null) => value(entry).replace(/^Slot\s+(\d+)$/i, 'Zimmer $1');

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
      room: roomLabel(booking?.roomNumber),
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
    };
  });
}

export function filterListRows(rows: ListRow[], kind: ListKind, filters: ListFilters) {
  const query = filters.search.trim().toLocaleLowerCase('de');
  return rows.filter((row) => {
    if (filters.assignedOnly && !row.assigned) return false;
    if (filters.selection && (kind === 'hotels' ? row.hotel : row.nation) !== filters.selection) return false;
    if (filters.discipline && row.discipline !== filters.discipline) return false;
    return !query || Object.values(row).some((item) => String(item).toLocaleLowerCase('de').includes(query));
  });
}

export function groupListRows(rows: ListRow[], kind: ListKind) {
  const groups = new Map<string, ListRow[]>();
  rows.forEach((row) => {
    const primary = kind === 'hotels' ? row.hotel : row.nation;
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary)!.push(row);
  });
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([label, entries]) => ({
    label,
    count: entries.length,
    rows: entries.sort((a, b) => {
      const section = kind === 'hotels'
        ? a.room.localeCompare(b.room, 'de', { numeric: true })
        : a.discipline.localeCompare(b.discipline, 'de');
      return section || a.name.localeCompare(b.name, 'de');
    }),
  }));
}
