import type { Athlete, Hotel, RoomBooking } from '../types';

export type ListKind = 'hotels' | 'nations' | 'contingents';

export interface ListRow {
  id: string;
  hotelId: string;
  bookingId: string;
  hotel: string;
  contingent: string;
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

export interface ContingentRow {
  id: string;
  hotelId: string;
  hotel: string;
  roomType: string;
  region: string;
  contactPerson: string;
  phone: string;
  email: string;
  comment: string;
  availableFrom: string;
  availableUntil: string;
  totalRooms: number;
  totalBeds: number;
  freeRooms: number;
  freeBeds: number;
  occupiedRooms: number;
  occupiedBeds: number;
  occupancy: number;
  hasHalfBoard: boolean;
  hasSR: boolean;
}

export interface ContingentFilters {
  search: string;
  hotel: string;
  roomType: string;
  region: string;
  halfBoard: boolean;
  skiRoom: boolean;
  availability: '' | 'available' | 'occupied';
}

export interface HotelContactRow {
  id: string;
  hotel: string;
  location: string;
  contactPerson: string;
  phone: string;
  email: string;
}

const value = (entry?: string | null) => entry?.trim() || '—';
const iso = (entry?: string | null) => entry?.slice(0, 10) || '';
const roomLabel = (entry?: string | null) => value(entry).replace(/^Slot\s+(\d+)$/i, 'Zimmer $1');

/** Read-only hotel master-data projection for the event contact directory. */
export function createHotelContactRows(hotels: Hotel[]): HotelContactRow[] {
  return hotels.map(hotel => ({ id: hotel.id, hotel: hotel.name, location: value(hotel.location), contactPerson: value(hotel.contactPerson), phone: value(hotel.phone), email: value(hotel.email) }))
    .sort((a, b) => a.hotel.localeCompare(b.hotel, 'de'));
}

/** Creates the one shared, read-only projection consumed by every list and export. */
export function createListRows(athletes: Athlete[], bookings: RoomBooking[], hotels: Hotel[] = []): ListRow[] {
  const hotelById = new Map(hotels.map(hotel => [hotel.id, hotel]));
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
    const inventory = booking && hotelById.get(booking.hotel.id)?.roomInventories?.find(item =>
      item.roomType.id === booking.roomType.id
      && (!booking.checkInDate || item.availableUntil >= booking.checkInDate.slice(0, 10))
      && (!booking.checkOutDate || item.availableFrom <= booking.checkOutDate.slice(0, 10)));
    return {
      id: athlete.id,
      hotelId: booking?.hotel.id || '',
      bookingId: booking?.id || '',
      hotel: value(booking?.hotel.name),
      contingent: booking ? `${booking.hotel.name} → ${inventory?.roomType.name || booking.roomType.name}${inventory ? ` · ${iso(inventory.availableFrom)}–${iso(inventory.availableUntil)}` : ''}` : '—',
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
    const selection = kind === 'hotels' ? row.hotel : kind === 'nations' ? row.nation : row.contingent;
    if (filters.selection && selection !== filters.selection) return false;
    if (filters.discipline && row.discipline !== filters.discipline) return false;
    return !query || Object.values(row).some((item) => String(item).toLocaleLowerCase('de').includes(query));
  });
}

export function groupListRows(rows: ListRow[], kind: ListKind) {
  const groups = new Map<string, ListRow[]>();
  rows.forEach((row) => {
    const primary = kind === 'hotels' ? row.hotel : kind === 'nations' ? row.nation : row.contingent;
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary)!.push(row);
  });
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([label, entries]) => ({
    label,
    count: entries.length,
    rows: entries.sort((a, b) => {
      const section = kind === 'hotels' || kind === 'contingents'
        ? a.room.localeCompare(b.room, 'de', { numeric: true })
        : a.discipline.localeCompare(b.discipline, 'de');
      return section || a.name.localeCompare(b.name, 'de');
    }),
  }));
}

/** Mirrors the capacity calculation used by the hotel detail for every inventory. */
export function createContingentRows(hotels: Hotel[], bookings: RoomBooking[]): ContingentRow[] {
  return hotels.flatMap((hotel) => (hotel.roomInventories || []).map((inventory) => {
    const matching = bookings.filter(booking => booking.hotel.id === hotel.id && booking.roomType.id === inventory.roomType.id);
    const totalRooms = inventory.roomCount;
    const totalBeds = totalRooms * inventory.roomType.maxPersons;
    const occupiedRooms = matching.length;
    const occupiedBeds = matching.reduce((sum, booking) => sum + Math.max(booking.occupants.length, booking.countsAsSingle ? 1 : 0), 0);
    return {
      id: inventory.id,
      hotelId: hotel.id,
      hotel: hotel.name,
      roomType: inventory.roomType.name,
      region: hotel.region || '—',
      contactPerson: value(hotel.contactPerson),
      phone: value(hotel.phone),
      email: value(hotel.email),
      comment: value(inventory.comment),
      availableFrom: iso(inventory.availableFrom),
      availableUntil: iso(inventory.availableUntil),
      totalRooms,
      totalBeds,
      freeRooms: Math.max(0, totalRooms - occupiedRooms),
      freeBeds: Math.max(0, totalBeds - occupiedBeds),
      occupiedRooms,
      occupiedBeds,
      occupancy: totalRooms ? Math.min(100, occupiedRooms / totalRooms * 100) : 0,
      hasHalfBoard: Boolean(inventory.hasHalfBoard),
      hasSR: Boolean(inventory.hasSR),
    };
  })).sort((a, b) => a.hotel.localeCompare(b.hotel, 'de') || a.roomType.localeCompare(b.roomType, 'de') || a.availableFrom.localeCompare(b.availableFrom));
}

export function filterContingentRows(rows: ContingentRow[], filters: ContingentFilters) {
  const query = filters.search.trim().toLocaleLowerCase('de');
  return rows.filter(row => {
    if (filters.hotel && row.hotel !== filters.hotel) return false;
    if (filters.roomType && row.roomType !== filters.roomType) return false;
    if (filters.region && row.region !== filters.region) return false;
    if (filters.halfBoard && !row.hasHalfBoard) return false;
    if (filters.skiRoom && !row.hasSR) return false;
    if (filters.availability === 'available' && row.freeRooms === 0) return false;
    if (filters.availability === 'occupied' && row.occupiedRooms === 0) return false;
    return !query || [row.hotel, row.roomType, row.region, row.comment].some(value => value.toLocaleLowerCase('de').includes(query));
  });
}
