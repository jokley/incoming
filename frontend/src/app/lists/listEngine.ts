import { buildHotelRiskRows } from '../services/planningCalculations.ts';
import {stayWindowDeviationText,stayWindowHotelNote} from '../services/stayWindow.ts';
import { personAccommodation } from '../services/personAccommodation.ts';
import { accommodationSurcharge } from '../services/accommodationSurcharge.ts';
import type { Athlete, Hotel, RoomBooking } from '../types';
import type { OfficialQuotaUsage } from '../services/fisRules';
import { evaluateAllQuotaGroups, isEvaluatedAsSingle, quotaAssignmentsFromBookings, singleRoomSpecialStatusLabel } from '../services/quotaEvaluation.ts';
import { athleteWorkCategory, type WorkCategory } from '../services/workflowStatus.ts';
import { competitionDisplayList, competitionMembershipList, previewEventGroupLabel } from '../services/competitionPresentation.ts';

export type ListKind = 'none' | 'hotels' | 'nations' | 'disciplines' | 'roles' | 'contingents';

export type ListSegment = Pick<ListRow, 'bookingId' | 'hotelId' | 'hotel' | 'contingent' | 'room' | 'roomType' | 'arrival' | 'departure' | 'roommate' | 'quotaEvaluation' | 'stayWindow' | 'hotelStayNote' | 'eventPeriod' | 'allowedStay' | 'assessedStay' | 'surcharge' | 'specialRateSurcharge' | 'approvedExtraSingleSurcharge'> & { countsAsSingle: boolean };

export interface ListRow {
  id: string;
  segments: ListSegment[];
  hotelId: string;
  bookingId: string;
  hotel: string;
  contingent: string;
  room: string;
  roomType: string;
  name: string;
  nation: string;
  discipline: string;
  eventGroups?: string;
  competitionNames?: string;
  role: string;
  stayWindow?: string;
  hotelStayNote?:string;
  eventPeriod?:string;
  allowedStay?:string;
  assessedStay?:string;
  arrival: string;
  departure: string;
  firstMeal: string;
  lastMeal: string;
  specialMeal: string;
  lateCheckout: string;
  surcharge: string;
  specialRateSurcharge: string;
  approvedExtraSingleSurcharge: string;
  accommodationRequirement?: string;
  accommodationStatus?: string;
  singleRoomSpecialStatus: string;
  quotaEvaluation: 'EZ' | 'DZ' | '—';
  roommate: string;
  athleteRemark: string;
  internalNote: string;
  assigned: boolean;
  workCategory: WorkCategory;
  importChanged: boolean;
  roomChanged: boolean;
  singleRoomPending: boolean;
}

export interface ListFilters {
  search: string;
  athleteRemark: string;
  internalNote: string;
  selection: string;
  discipline: string;
  nation: string;
  role: string;
  hotel: string;
  status: '' | WorkCategory;
  hint: '' | 'internal' | 'athlete' | 'import' | 'room-change' | 'single-room' | 'surcharge' | 'without-room' | 'no-room';
  movement: '' | 'arrival' | 'departure';
  period: '' | 'today' | 'tomorrow' | 'week';
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
}

export interface HotelContactRow {
  id: string;
  hotel: string;
  location: string;
  contactPerson: string;
  phone: string;
  email: string;
  comment: string;
  region: string;
  hasHalfBoard: boolean;
  hasSR: boolean;
  contingents: number;
  totalRooms: number;
  totalBeds: number;
  inventoryPeriods: string;
  assignedBookings: number;
  assignedPersons: number;
  peakRooms: number | null;
  peakPersons: number | null;
  peakBlockedBeds: number | null;
}

export function summarizeHotelContactRows(rows: ReadonlyArray<Pick<HotelContactRow, 'assignedBookings' | 'totalRooms' | 'totalBeds'>>) {
  // Peaks and distinct people per hotel must not be summed across hotel changes.
  return rows.reduce((sum,row)=>({bookings:sum.bookings+row.assignedBookings,
    rooms:sum.rooms+row.totalRooms,beds:sum.beds+row.totalBeds}),{bookings:0,rooms:0,beds:0});
}

const value = (entry?: string | null) => entry?.trim() || '—';
const iso = (entry?: string | null) => entry?.slice(0, 10) || '';
const roomLabel = (entry?: string | null) => value(entry).replace(/^Slot\s+(\d+)$/i, 'Zimmer $1');
const roomTypeCode = (name?: string | null) => name?.toUpperCase().match(/(?:^|\s|\/)(EZ|DZ|APP)(?=\s|\/|:|$)/)?.[1] || 'ZI';

/** Read-only hotel master-data projection for the event contact directory. */
export function createHotelContactRows(hotels: Hotel[], bookings: RoomBooking[] = []): HotelContactRow[] {
  const risks=buildHotelRiskRows(hotels,bookings);
  return hotels.map(hotel => {
    const inventories = hotel.accommodationType==='EXTERNAL'?[]:hotel.roomInventories || [];
    const assigned=[...new Map(bookings.filter(b=>b.hotel.id===hotel.id).map(b=>[b.id,b])).values()];
    const daily=risks.find(row=>row.hotel.id===hotel.id)?.daily || [];
    const peak=(key:'occupiedRooms'|'occupiedBeds'|'blockedBeds')=>hotel.accommodationType==='EXTERNAL'?null
      : daily.reduce((max,day)=>Math.max(max,day[key]),0);
    return { id: hotel.id, hotel: hotel.name, location: value(hotel.location), region: value(hotel.region), contactPerson: value(hotel.contactPerson), phone: value(hotel.phone), email: value(hotel.email), comment: value(hotel.comment), hasHalfBoard: inventories.some(inventory => inventory.hasHalfBoard), hasSR: inventories.some(inventory => inventory.hasSR), contingents: inventories.length,
      // Agreement sums describe inventory entries, never simultaneous room supply.
      totalRooms:inventories.reduce((sum,i)=>sum+i.roomCount,0),
      totalBeds:inventories.reduce((sum,i)=>sum+i.roomCount*i.roomType.maxPersons,0),
      inventoryPeriods:[...new Set([...inventories].sort((a,b)=>a.availableFrom.localeCompare(b.availableFrom)||a.id.localeCompare(b.id))
        .map(i=>`${i.roomType.name}: ${iso(i.availableFrom)}–${iso(i.availableUntil)}`))].join(' · ') || '—',
      assignedBookings:assigned.length,assignedPersons:new Set(assigned.flatMap(b=>b.occupants.map(o=>o.athlete.id))).size,
      peakRooms:peak('occupiedRooms'),peakPersons:peak('occupiedBeds'),peakBlockedBeds:peak('blockedBeds'),
    };
  }).sort((a,b)=>a.hotel.localeCompare(b.hotel,'de'));
}

/** Creates the one shared, read-only projection consumed by every list and export. */
export function createListRows(athletes: Athlete[], bookings: RoomBooking[], hotels: Hotel[] = [], quotaUsage: OfficialQuotaUsage[] = []): ListRow[] {
  const activeApprovedExtraPersonIds = new Set(evaluateAllQuotaGroups(quotaUsage, quotaAssignmentsFromBookings(bookings))
    .flatMap(group => group.people.filter(person => person.additionalCost).map(person => person.personId)));
  const inventoriesByHotelAndRoomType = new Map<string, NonNullable<Hotel['roomInventories']>>();
  hotels.forEach(hotel => (hotel.roomInventories || []).forEach(inventory => {
    const key = `${hotel.id}/${inventory.roomType.id}`;
    const entries = inventoriesByHotelAndRoomType.get(key) || [];
    entries.push(inventory);
    inventoriesByHotelAndRoomType.set(key, entries);
  }));
  const assignments = new Map<string, Array<{ booking: RoomBooking; roommate: string }>>();
  const counters = new Map<string, number>();
  const displayRoomByBooking = new Map<string, string>();
  const sortedBookings = [...bookings].sort((a,b) => iso(a.checkInDate).localeCompare(iso(b.checkInDate))
    || iso(a.checkOutDate).localeCompare(iso(b.checkOutDate)) || a.hotel.name.localeCompare(b.hotel.name,'de') || a.id.localeCompare(b.id));
  sortedBookings.forEach(booking => {
    if(booking.hotel.accommodationType==='EXTERNAL'){displayRoomByBooking.set(booking.id,'Extern');return;}
    const code = roomTypeCode(booking.roomType?.name);
    const key = `${booking.hotel.id}/${code}`;
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    const supplied = booking.roomNumber?.replace(/^(?:Zimmer|Slot)\s*/i, '').trim();
    displayRoomByBooking.set(booking.id, `${code} ${supplied || String(next).padStart(2, '0')}`);
  });
  sortedBookings.forEach((booking) => booking.occupants.forEach((occupant) => {
    const roommate = booking.occupants
      .filter((candidate) => candidate.athlete.id !== occupant.athlete.id)
      .map((candidate) => `${candidate.athlete.firstname} ${candidate.athlete.lastname}`.trim())
      .join(', ');
    const entries = assignments.get(occupant.athlete.id) || [];
    if (!entries.some(entry => entry.booking.id === booking.id)) entries.push({ booking, roommate });
    assignments.set(occupant.athlete.id, entries);
  }));

  return athletes.map((athlete) => {
    const personAssignments = assignments.get(athlete.id) || [];
    const segments: ListSegment[] = personAssignments.map(({booking,roommate}) => {
      const segmentSurcharge = accommodationSurcharge(athlete,
        Boolean(booking.countsAsSingle) && activeApprovedExtraPersonIds.has(athlete.id));
      const surchargeLabel = (reason?: 'SPECIAL_RATE' | 'APPROVED_EXTRA_SINGLE') => !segmentSurcharge.applicable ? '—'
        : reason ? (segmentSurcharge.surchargeReasons.includes(reason) ? 'Ja' : 'Nein')
          : segmentSurcharge.hasAccommodationSurcharge ? 'Ja' : 'Nein';
      const assessment=booking.occupants.find(o=>o.athlete.id===athlete.id)?.athlete.stayWindow;
      const inventory=inventoriesByHotelAndRoomType.get(`${booking.hotel.id}/${booking.roomType?.id}`)?.find(item =>
        (!booking.checkInDate || item.availableUntil >= iso(booking.checkInDate)) && (!booking.checkOutDate || item.availableFrom <= iso(booking.checkOutDate)));
      return {bookingId:booking.id,hotelId:booking.hotel.id,hotel:value(booking.hotel.name),
        contingent:`${booking.hotel.name} → ${inventory?.roomType.name || (booking.hotel.accommodationType==='EXTERNAL'?'Extern':booking.roomType?.name)}${inventory ? ` · ${iso(inventory.availableFrom)}–${iso(inventory.availableUntil)}` : ''}`,
        room:displayRoomByBooking.get(booking.id) || roomLabel(booking.roomNumber),
        roomType:value(booking.hotel.accommodationType==='EXTERNAL'?'Extern':booking.roomType?.name || athlete.roomType),
        arrival:iso(booking.checkInDate || athlete.arrivalDate),departure:iso(booking.checkOutDate || athlete.departureDate),
        countsAsSingle:Boolean(booking.countsAsSingle),quotaEvaluation:isEvaluatedAsSingle(booking)?'EZ':'DZ',roommate:value(roommate || athlete.sharedWithName),
        surcharge:surchargeLabel(),specialRateSurcharge:surchargeLabel('SPECIAL_RATE'),approvedExtraSingleSurcharge:surchargeLabel('APPROVED_EXTRA_SINGLE'),
        stayWindow:assessment?stayWindowDeviationText(assessment):'Bewertung nicht verfügbar',hotelStayNote:stayWindowHotelNote(assessment),
        eventPeriod:assessment?.eventStart?`${assessment.eventStart} – ${assessment.eventEnd}`:'',
        allowedStay:assessment?.allowedStart?`${assessment.allowedStart} – ${assessment.allowedEnd} (Abreise)`:'',
        assessedStay:assessment?.intervals?.map(i=>`${i.checkInDate} – ${i.checkOutDate}`).join(' · ') || (assessment?.arrivalDate?`${assessment.arrivalDate} – ${assessment.departureDate}`:''),
      };
    });
    const firstSegment = segments[0];
    const personSurcharge = accommodationSurcharge(athlete,
      segments.some(segment => segment.approvedExtraSingleSurcharge === 'Ja'));
    const surchargeLabel = (reason?: 'SPECIAL_RATE' | 'APPROVED_EXTRA_SINGLE') => !personSurcharge.applicable ? '—'
      : reason ? (personSurcharge.surchargeReasons.includes(reason) ? 'Ja' : 'Nein')
        : personSurcharge.hasAccommodationSurcharge ? 'Ja' : 'Nein';
    const assessment=segments.length===1?personAssignments[0].booking.occupants.find(o=>o.athlete.id===athlete.id)?.athlete.stayWindow??athlete.stayWindow:athlete.stayWindow;
    return {
      id: athlete.id,
      segments,
      hotelId: firstSegment?.hotelId || '',
      bookingId: firstSegment?.bookingId || '',
      hotel: firstSegment?.hotel || '—',
      contingent: firstSegment?.contingent || '—',
      accommodationRequirement: athlete.accommodationRequirement || 'REQUIRED',
      accommodationStatus: personAccommodation(athlete).label,
      room: firstSegment?.room || (athlete.accommodationRequirement==='NO_ROOM'?'No room':'—'),
      roomType: firstSegment?.roomType || value(athlete.roomType),
      name: `${athlete.lastname}, ${athlete.firstname}`,
      nation: value(athlete.nationCode),
      discipline: value(competitionDisplayList(athlete.disciplines, athlete.discipline)),
      eventGroups: previewEventGroupLabel(athlete.quotaDisciplines),
      competitionNames: competitionMembershipList(athlete.competitions),
      role: value(athlete.function),
      stayWindow: stayWindowDeviationText(assessment),
      hotelStayNote:stayWindowHotelNote(assessment),
      eventPeriod: assessment?.eventStart?`${assessment.eventStart} – ${assessment.eventEnd}`:'',
      allowedStay: assessment?.allowedStart?`${assessment.allowedStart} – ${assessment.allowedEnd} (Abreise)`:'',
      assessedStay: assessment?.intervals?.map(i=>`${i.checkInDate} – ${i.checkOutDate}`).join(' · ') || (assessment?.arrivalDate?`${assessment.arrivalDate} – ${assessment.departureDate}`:''),
      arrival: firstSegment?.arrival || iso(athlete.arrivalDate),
      departure: firstSegment?.departure || iso(athlete.departureDate),
      firstMeal: value(athlete.firstMeal),
      lastMeal: value(athlete.lastMeal),
      specialMeal: value(athlete.specialMeal),
      lateCheckout: athlete.lateCheckout ? 'Ja' : 'Nein',
      surcharge: surchargeLabel(),
      specialRateSurcharge: surchargeLabel('SPECIAL_RATE'),
      approvedExtraSingleSurcharge: surchargeLabel('APPROVED_EXTRA_SINGLE'),
      singleRoomSpecialStatus: singleRoomSpecialStatusLabel(
        athlete.single_room_status, athlete.singleRoomQuotaExemptReason),
      quotaEvaluation: firstSegment?.quotaEvaluation || '—',
      roommate: firstSegment?.roommate || value(athlete.sharedWithName),
      athleteRemark: value(athlete.additionalItems),
      internalNote: value(athlete.internalNote),
      assigned: Boolean(firstSegment),
      workCategory: athleteWorkCategory(athlete),
      importChanged: Boolean(athlete.importChangeTypes?.length || athlete.hasPendingRoomlistReview),
      roomChanged: Boolean(athlete.importChangeTypes?.some(type => type === 'ROOMMATE_CHANGED' || type === 'HOTEL_CHANGED' || type === 'ROOM_DEMAND_CHANGED')),
      singleRoomPending: athlete.accommodationRequirement !== 'NO_ROOM' && athlete.single_room_status === 'PENDING_APPROVAL',
    };
  });
}

export function filterListRows(rows: ListRow[], kind: ListKind, filters: ListFilters) {
  const query = filters.search.trim().toLocaleLowerCase('de');
  return (kind==='hotels'||kind==='contingents'?segmentListRows(rows):rows).filter((row) => {
    if (filters.assignedOnly && !row.assigned) return false;
    const selection = kind === 'hotels' ? row.hotel : kind === 'nations' ? row.nation : kind === 'disciplines' ? row.discipline : kind === 'roles' ? row.role : row.contingent;
    if (filters.selection && selection !== filters.selection) return false;
    if (filters.discipline && row.discipline !== filters.discipline) return false;
    if (filters.nation && row.nation !== filters.nation) return false;
    if (filters.role && row.role !== filters.role) return false;
    if (filters.hotel && row.hotel !== filters.hotel && !row.segments.some(segment=>segment.hotel===filters.hotel)) return false;
    if (filters.status && row.workCategory !== filters.status) return false;
    if (filters.hint === 'internal' && row.internalNote === '—') return false;
    if (filters.hint === 'athlete' && row.athleteRemark === '—') return false;
    if (filters.hint === 'import' && !row.importChanged) return false;
    if (filters.hint === 'room-change' && !row.roomChanged) return false;
    if (filters.hint === 'single-room' && row.quotaEvaluation !== 'EZ' && !row.segments.some(segment=>segment.countsAsSingle) && !row.singleRoomPending) return false;
    if (filters.hint === 'surcharge' && row.surcharge !== 'Ja') return false;
    if (filters.hint === 'without-room' && (row.assigned || row.accommodationRequirement==='NO_ROOM')) return false;
    if (filters.hint === 'no-room' && row.accommodationRequirement!=='NO_ROOM') return false;
    if (filters.movement) {
      const base = new Date(); base.setUTCHours(0, 0, 0, 0);
      const tomorrow = new Date(base); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const week = new Date(base); week.setUTCDate(week.getUTCDate() + 7);
      const dates=(row.segments.length?row.segments:[row]).map(segment=>filters.movement==='arrival'?segment.arrival:segment.departure);
      if (!dates.some(date=>{
        if (!date) return false;
        const day=new Date(`${date}T00:00:00Z`);
        if (filters.period==='today') return day.getTime()===base.getTime();
        if (filters.period==='tomorrow') return day.getTime()===tomorrow.getTime();
        if (filters.period==='week') return day>=base && day<week;
        return true;
      })) return false;
    }
    if (filters.athleteRemark && !row.athleteRemark.toLocaleLowerCase('de').includes(filters.athleteRemark.trim().toLocaleLowerCase('de'))) return false;
    if (filters.internalNote && !row.internalNote.toLocaleLowerCase('de').includes(filters.internalNote.trim().toLocaleLowerCase('de'))) return false;
    return !query || [...Object.values(row),...row.segments.flatMap(segment=>Object.values(segment))].some((item) => String(item).toLocaleLowerCase('de').includes(query));
  });
}

export function segmentListRows(rows: ListRow[]): ListRow[] {
  return rows.flatMap(row=>row.segments.length?row.segments.map(segment=>({...row,...segment,segments:[segment]})):[row]);
}

export function groupListRows(rows: ListRow[], kind: ListKind) {
  const groups = new Map<string, ListRow[]>();
  (kind==='hotels'||kind==='contingents'?segmentListRows(rows):rows).forEach((row) => {
    const primary = kind === 'none' ? 'Alle Personen' : kind === 'hotels' ? row.hotel : kind === 'nations' ? row.nation : kind === 'disciplines' ? row.discipline : kind === 'roles' ? row.role : row.contingent;
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary)!.push(row);
  });
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([label, entries]) => ({
    label,
    count: new Set(entries.map(row=>row.id)).size,
    rows: entries.sort((a, b) => {
      const section = kind === 'hotels' || kind === 'contingents'
        ? a.room.localeCompare(b.room, 'de', { numeric: true })
        : a.discipline.localeCompare(b.discipline, 'de');
      return section || a.name.localeCompare(b.name, 'de');
    }),
  }));
}

/** Agreed inventory entries with their actual intervals; assignments have no inventory FK. */
export function createContingentRows(hotels: Hotel[]): ContingentRow[] {
  return hotels.filter(h=>h.accommodationType!=='EXTERNAL').flatMap((hotel) => (hotel.roomInventories || []).map((inventory) => {
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
      totalRooms:inventory.roomCount,
      totalBeds:inventory.roomCount*inventory.roomType.maxPersons,
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
    return !query || [row.hotel, row.roomType, row.region, row.comment].some(value => value.toLocaleLowerCase('de').includes(query));
  });
}
