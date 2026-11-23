import { requiresAccommodation } from './accommodationRequirement.ts';
import type { Athlete, Event, Hotel, HotelRoomInventory, RoomBooking } from '../types.ts';
import { explicitRoomRequest } from './assignmentPresentation.ts';
import { bookingFreeCapacity } from './assignmentRoomUsage.ts';
import { physicalSingleRoomUsageFromBookings } from './quotaEvaluation.ts';

export type RoomPlan = { beds: number; rooms: number; singleRooms: number; doubleRooms: number };

/** The single source of truth for the FIS planning model used by events and analytics. */
export function calculateRoomPlan(beds: number): RoomPlan {
  const safeBeds = Math.max(0, Math.ceil(beds || 0));
  const rooms = Math.ceil(safeBeds / 1.5);
  const singleRooms = rooms / 2;
  return { beds: safeBeds, rooms, singleRooms, doubleRooms: rooms - singleRooms };
}

export const eventRoomPlan = (event: Event) => calculateRoomPlan(event.personDemand);

export const inventoryCapacity = (items: HotelRoomInventory[] = []) => calculateRoomPlan(items.reduce(
  (beds, item) => beds + item.roomCount * item.roomType.maxPersons,
  0,
));

export type DemandSource = 'event' | 'excel' | 'import' | 'live';
export type CapacityDay = {
  date: string; label: string; roomSupply: number; assignedRooms: number; freeRooms: number; plannedRooms: number; demandRooms: number;
  bedSupply: number; assignedBeds: number; freeBeds: number; plannedBeds: number; demandBeds: number;
  ezSupply: number; assignedEz: number; freeEz: number; plannedEz: number; demandEz: number;
  dzSupply: number; assignedDz: number; freeDz: number; plannedDz: number; demandDz: number;
  excelRoomSupply?: number; excelBedSupply?: number;
  eventRoomReserve: number; eventBedReserve: number; eventEzReserve: number; eventDzReserve: number;
  liveRoomReserve: number; liveBedReserve: number; liveEzReserve: number; liveDzReserve: number;
};

const dayKey = (value?: string | null) => value?.slice(0, 10) || '';
const onDay = (from?: string | null, until?: string | null, date = '') => Boolean(from && until && dayKey(from) <= date && dayKey(until) > date);
const daysBetween = (from: string, until: string) => { const result: string[] = []; for (let date = new Date(`${from}T00:00:00Z`), end = new Date(`${until}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) result.push(date.toISOString().slice(0, 10)); return result; };

export type HotelDayCapacity = {
  capacityDate: string; totalRooms: number; totalBeds: number; occupiedRooms: number;
  /** Physically accommodated people, excluding empty beds blocked by single use. */
  occupiedBeds: number; blockedBeds: number; singleUseRooms: number;
  freeRooms: number; freeBeds: number; occupancy: number;
};

/** Actual daily occupancy, shared by hotel management, lists, exports and analytics.
 * Inventory end dates retain the existing inclusive contract; booking checkout is exclusive.
 * A booking has no inventory FK. For inventory rows, attribute it once to an active
 * inventory of its room type (prefer full stay coverage); keep overflow visible.
 * This read-only attribution never changes assignments or decides availability.
 */
export function hotelCapacityOnDay(hotel: Hotel, bookings: RoomBooking[], date: string, inventory?: HotelRoomInventory): HotelDayCapacity {
  const empty: HotelDayCapacity = { capacityDate: date, totalRooms: 0, totalBeds: 0, occupiedRooms: 0,
    occupiedBeds: 0, blockedBeds: 0, singleUseRooms: 0, freeRooms: 0, freeBeds: 0, occupancy: 0 };
  if (hotel.accommodationType === 'EXTERNAL') return empty;
  const inventories = [...(hotel.roomInventories || [])].sort((a,b)=>a.id.localeCompare(b.id));
  const active = [...new Map(bookings.filter(b=>b.hotel.id===hotel.id && b.hotel.accommodationType!=='EXTERNAL'
    && onDay(b.checkInDate,b.checkOutDate,date)).map(b=>[b.id,b])).values()]
    .sort((a,b)=>dayKey(a.checkInDate).localeCompare(dayKey(b.checkInDate)) || a.id.localeCompare(b.id));
  const byInventory = new Map<string, RoomBooking[]>();
  if (inventory) for (const booking of active) {
    const candidates = inventories.filter(i=>i.roomType.id===booking.roomType?.id
      && dayKey(i.availableFrom)<=date && dayKey(i.availableUntil)>=date);
    candidates.sort((a,b)=>Number(dayKey(b.availableFrom)<=dayKey(booking.checkInDate) && dayKey(b.availableUntil)>=dayKey(booking.checkOutDate))
      - Number(dayKey(a.availableFrom)<=dayKey(booking.checkInDate) && dayKey(a.availableUntil)>=dayKey(booking.checkOutDate)));
    const target = candidates.find(i=>(byInventory.get(i.id)?.length || 0)<i.roomCount)
      || candidates.at(-1) || inventories.find(i=>i.roomType.id===booking.roomType?.id);
    if (target) byInventory.set(target.id,[...(byInventory.get(target.id)||[]),booking]);
  }
  const summarize = (items: HotelRoomInventory[], rows: RoomBooking[]): HotelDayCapacity => {
    const supply = items.filter(i=>dayKey(i.availableFrom)<=date && dayKey(i.availableUntil)>=date);
    const totalRooms = supply.reduce((sum,i)=>sum+i.roomCount,0);
    const totalBeds = supply.reduce((sum,i)=>sum+i.roomCount*i.roomType.maxPersons,0);
    const occupiedBeds = new Set(rows.flatMap(b=>b.occupants.map(o=>o.athlete.id))).size;
    const blockedBeds = rows.reduce((sum,b)=>sum+(b.countsAsSingle ? Math.max(0,(b.roomType?.maxPersons || 0)-b.occupants.length) : 0),0);
    // Reuse the disposition's single-use rule; a spare physical bed can be blocked.
    const usedBeds = rows.reduce((sum,b)=>{
      const capacity=b.roomType?.maxPersons ?? b.occupants.length;
      return sum+capacity-bookingFreeCapacity({...b,capacity});
    },0);
    return { capacityDate:date,totalRooms,totalBeds,occupiedRooms:rows.length,occupiedBeds,blockedBeds,
      singleUseRooms:rows.filter(b=>b.countsAsSingle).length,freeRooms:Math.max(0,totalRooms-rows.length),
      freeBeds:Math.max(0,totalBeds-usedBeds),occupancy:totalRooms?Math.min(100,rows.length/totalRooms*100):0 };
  };
  if (inventory) return summarize([inventory],byInventory.get(inventory.id)||[]);
  // Clamp free capacity per room type, so overbooking one type cannot consume another's spare beds.
  const types = new Set([...inventories.map(i=>i.roomType.id),...active.map(b=>b.roomType?.id)]);
  const totals = [...types].map(type=>summarize(inventories.filter(i=>i.roomType.id===type),active.filter(b=>b.roomType?.id===type)));
  return { ...summarize(inventories,active),freeRooms:totals.reduce((sum,row)=>sum+row.freeRooms,0),freeBeds:totals.reduce((sum,row)=>sum+row.freeBeds,0) };
}

/** Shared capacity projection consumed by both Analytics and the Dashboard. */
export function buildCapacityTimeline(data: { hotels: Hotel[]; events: Event[]; athletes: Athlete[]; bookings: RoomBooking[] }, concrete?: ReturnType<typeof concreteRoomDemand>): CapacityDay[] {
  data={...data,hotels:data.hotels.filter(h=>h.accommodationType!=='EXTERNAL'),bookings:data.bookings.filter(b=>b.hotel?.accommodationType!=='EXTERNAL')};
  const projected = new Map(concrete?.days.map(day => [day.date, day]));
  const dates = [...projected.keys(), ...data.events.flatMap(event => [dayKey(event.startDate), dayKey(event.endDate)]), ...data.hotels.flatMap(hotel => (hotel.roomInventories || []).flatMap(item => [dayKey(item.availableFrom), dayKey(item.availableUntil)])), ...data.athletes.flatMap(athlete => (athlete.stays?.length ? athlete.stays : [athlete]).flatMap(stay => [dayKey(stay.arrivalDate), dayKey(stay.departureDate)])), ...data.bookings.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)])].filter(Boolean).sort();
  return (dates.length ? daysBetween(dates[0], dates.at(-1)!) : []).map(date => {
    const inventory = data.hotels.flatMap(hotel => hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);
    const plans = data.events.filter(event => dayKey(event.startDate) <= date && dayKey(event.endDate) >= date).map(eventRoomPlan);
    const bedSupply = inventory.reduce((sum, item) => sum + item.roomCount * item.roomType.maxPersons, 0);
    const supply = calculateRoomPlan(bedSupply), plannedBeds = plans.reduce((sum, plan) => sum + plan.beds, 0), plannedRooms = plans.reduce((sum, plan) => sum + plan.rooms, 0);
    const livePlan = calculateRoomPlan(data.athletes.filter(athlete => requiresAccommodation(athlete) && (athlete.stays?.length ? athlete.stays : [{ arrivalDate: athlete.arrivalDate, departureDate: athlete.departureDate }]).some(stay => onDay(stay.arrivalDate, stay.departureDate, date))).length);
    const activeBookings = data.bookings.filter(booking => onDay(booking.checkInDate, booking.checkOutDate, date));
    const hotels = new Map(data.hotels.map(hotel=>[hotel.id,hotel]));
    activeBookings.forEach(booking=>{ if (!hotels.has(booking.hotel.id)) hotels.set(booking.hotel.id,booking.hotel); });
    const actual = [...hotels.values()].map(hotel=>hotelCapacityOnDay(hotel,activeBookings,date));
    const assignedRooms = actual.reduce((sum,row)=>sum+row.occupiedRooms,0), assignedBeds = actual.reduce((sum,row)=>sum+row.occupiedBeds,0), assignedEz = physicalSingleRoomUsageFromBookings(activeBookings), assignedDz = Math.max(0, assignedBeds - assignedEz);
    const roomSupply = inventory.reduce((sum,item)=>sum+item.roomCount,0);
    const plannedEz = plans.reduce((sum, plan) => sum + plan.singleRooms, 0), plannedDz = plans.reduce((sum, plan) => sum + plan.doubleRooms, 0), freeRooms = actual.reduce((sum,row)=>sum+row.freeRooms,0), freeEz = freeRooms / 2, freeDz = freeRooms - freeEz;
    const exact = projected.get(date);
    const actualEz = inventory.filter(item => item.roomType.maxPersons === 1).reduce((sum, item) => sum + item.roomCount, 0);
    const actualDz = inventory.filter(item => item.roomType.maxPersons === 2).reduce((sum, item) => sum + item.roomCount, 0);
    const outside = exact?.outside;
    const remainingRooms = outside ? Math.max(0, roomSupply - outside.rooms) : roomSupply;
    const remainingBeds = outside ? Math.max(0, bedSupply - outside.beds) : bedSupply;
    const remainingEz = outside ? Math.max(0, actualEz - outside.ez) : actualEz;
    const remainingDz = outside ? Math.max(0, actualDz - outside.dz) : actualDz;
    const ezReserve = remainingEz - (exact?.ez ?? 0), dzReserve = remainingDz - (exact?.dz ?? 0);
    const day = { date, label: new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }), roomSupply, bedSupply, ezSupply: assignedEz + freeEz, dzSupply: assignedDz + freeDz, plannedRooms, plannedBeds, plannedEz, plannedDz, demandRooms: livePlan.rooms, demandBeds: livePlan.beds, demandEz: livePlan.singleRooms, demandDz: livePlan.doubleRooms, assignedRooms, assignedBeds, assignedEz, assignedDz, freeRooms, freeBeds: actual.reduce((sum,row)=>sum+row.freeBeds,0), freeEz, freeDz, eventRoomReserve: roomSupply - plannedRooms, eventBedReserve: bedSupply - plannedBeds, eventEzReserve: supply.singleRooms - plannedEz, eventDzReserve: supply.doubleRooms - plannedDz, liveRoomReserve: roomSupply - livePlan.rooms, liveBedReserve: bedSupply - livePlan.beds, liveEzReserve: supply.singleRooms - livePlan.singleRooms, liveDzReserve: supply.doubleRooms - livePlan.doubleRooms };
    if (!concrete) return day;
    const bookedEz = activeBookings.filter(booking => booking.roomType?.maxPersons === 1).length;
    const bookedDz = activeBookings.filter(booking => booking.roomType?.maxPersons === 2).length;
    return { ...day, ezSupply: actualEz, dzSupply: actualDz, assignedEz: bookedEz, assignedDz: bookedDz,
      freeEz: Math.max(0, actualEz - bookedEz), freeDz: Math.max(0, actualDz - bookedDz),
      demandRooms: exact?.rooms ?? 0, demandBeds: exact?.beds ?? 0, demandEz: exact?.ez ?? 0, demandDz: exact?.dz ?? 0,
      excelRoomSupply: remainingRooms, excelBedSupply: remainingBeds,
      liveRoomReserve: remainingRooms - (exact?.rooms ?? 0), liveBedReserve: remainingBeds - (exact?.beds ?? 0) - (exact?.blocked ?? 0),
      liveEzReserve: ezReserve, liveDzReserve: dzReserve };

  });
}

export function capacitySummary(timeline: CapacityDay[], source: DemandSource) {
  const demandKey = source === 'event' ? 'plannedRooms' : 'demandRooms';
  const peak = timeline.reduce((best, day) => day[demandKey] > (best?.[demandKey] ?? -1) ? day : best, timeline[0]);
  const reserveKey = source === 'event' ? 'eventRoomReserve' : 'liveRoomReserve';
  const riskDays = timeline.filter(day => day[reserveKey] < 0);
  const critical = timeline.reduce((lowest, day) => day[reserveKey] < (lowest?.[reserveKey] ?? Number.POSITIVE_INFINITY) ? day : lowest, timeline[0]);
  return { peak, critical, firstRisk: riskDays[0], riskDays };
}

/** Shared per-hotel risk projection; a hotel is critical at 90% occupancy or above. */
export function buildHotelRiskRows(hotels: Hotel[], bookings: RoomBooking[]) {
  const dates = [...hotels.flatMap(hotel => (hotel.roomInventories || []).flatMap(item => [dayKey(item.availableFrom), dayKey(item.availableUntil)])), ...bookings.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)])].filter(Boolean).sort();
  const days = dates.length ? daysBetween(dates[0], dates.at(-1)!) : [];
  return hotels.filter(h=>h.accommodationType!=='EXTERNAL').map(hotel => {
    const hotelBookings = bookings.filter(booking => booking.hotel.id === hotel.id);
    const daily = days.map(date => {
      const capacity = hotelCapacityOnDay(hotel, hotelBookings, date);
      const inventories = (hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);
      const singleRooms = inventories.filter(item => item.roomType.maxPersons === 1 || /(^|\W)EZ(\W|$)/i.test(item.roomType.name)).reduce((sum, item) => sum + item.roomCount, 0);
      const occupiedSingle = hotelBookings.filter(b => onDay(b.checkInDate,b.checkOutDate,date)
        && (b.roomType?.maxPersons === 1 || /(^|\W)EZ(\W|$)/i.test(b.roomType?.name || ''))).length;
      return { ...capacity, date, rooms: capacity.totalRooms, occupied: capacity.occupiedRooms,
        reserve: capacity.totalRooms - capacity.occupiedRooms, singleReserve: singleRooms - occupiedSingle };
    }).filter(day => day.rooms > 0 || day.occupied > 0);
    const worst = daily.reduce((lowest, day) => day.reserve < (lowest?.reserve ?? Number.POSITIVE_INFINITY) ? day : lowest, daily[0]);
    const firstCritical = daily.find(day => day.rooms === 0 ? day.occupied > 0 : day.reserve / day.rooms <= .1);
    return { hotel, daily, worst, firstCritical, criticalDays: daily.filter(day => day.rooms === 0 ? day.occupied > 0 : day.reserve / day.rooms <= .1).length };
  });
}

type DemandPerson = Pick<import('../types.ts').FisImportPreviewPerson,
  'existingAthleteId' | 'matchKey' | 'arrivalDate' | 'departureDate' | 'roomType' | 'sharedWithName' |
  'accommodationRequirement' | 'accommodationRequirementReviewRequired'>;
type DemandRoom = Pick<import('../types.ts').FisImportPreviewRoom,
  'person1Key' | 'person2Key' | 'roomType' | 'checkInDate' | 'checkOutDate' | 'sharedWithRawName'>;
export type ExcelDemand = { nation: string; people: DemandPerson[]; rooms: DemandRoom[]; excludedIds: string[]; provisional: boolean; conflict?: string };

type DemandStay = { start: string; end: string; type: string; partner?: string; unclear?: boolean; secondary?: boolean };
type DemandRecord = { key: string; id?: string; stays: DemandStay[]; provisional?: boolean };

function stay(start?: string | null, end?: string | null, type?: string | null, partner?: string | null): DemandStay {
  return { start: dayKey(start), end: dayKey(end), type: type?.trim().toLowerCase() ?? '', partner: partner || undefined };
}
const single = (type: string) => explicitRoomRequest(type) === 'EZ';
const double = (type: string) => explicitRoomRequest(type) === 'DZ';
const validStay = (s: DemandStay) => Boolean(s.start && s.end && s.start < s.end);

export function excelDemandRecords(people: DemandPerson[], rooms: DemandRoom[], excludedIds: Iterable<string>, prefix = ''): DemandRecord[] {
  const excluded = new Set(excludedIds);
  const byPerson = new Map<string, DemandStay[]>();
  for (const room of rooms) {
    for (const [person, partner] of [[room.person1Key, room.person2Key], [room.person2Key, room.person1Key]]) {
      if (!person) continue;
      const period = stay(room.checkInDate, room.checkOutDate, room.roomType, partner && prefix + partner);
      period.unclear = Boolean(!partner && room.sharedWithRawName);
      period.secondary = person === room.person2Key;
      const periods = byPerson.get(person) ?? [];
      periods.push(period);
      byPerson.set(person, periods);
    }
  }
  const keys = new Map(people.flatMap(person => person.matchKey && person.existingAthleteId != null
    ? [[prefix + person.matchKey, 'person:' + person.existingAthleteId]] : []));
  return people.flatMap((person, index) => {
    const id = person.existingAthleteId == null ? undefined : String(person.existingAthleteId);
    const key = person.matchKey ?? String(index);
    if (!requiresAccommodation(person) || excluded.has(id ?? 'preview:' + key)) return [];
    const entry = stay(person.arrivalDate, person.departureDate, person.roomType);
    const periods = byPerson.get(key)?.map(period => {
      if (!period.secondary || !validStay(entry) || !validStay(period) ||
          (entry.start <= period.start && entry.end >= period.end)) return period;
      // A row reported by the other occupant cannot enlarge this person's stay.
      return { ...period, start: entry.start > period.start ? entry.start : period.start,
        end: entry.end < period.end ? entry.end : period.end, unclear: true };
    });
    const dated = periods?.filter(validStay);
    // Room List intervals preserve source gaps. Undated rows remain uncertainty.
    const stays = dated?.length ? dated.filter(period => period.type !== 'no room')
      : [{ ...entry, type: periods?.[0]?.secondary ? entry.type : periods?.[0]?.type || entry.type,
        unclear: Boolean(periods?.length || person.sharedWithName) }];
    return [{ key: id ? 'person:' + id : prefix + key, id, stays,
      provisional: Boolean(person.accommodationRequirementReviewRequired || periods?.some(period => period.unclear || !validStay(period))) }];
  }).map(record => ({
    ...record,
    stays: record.stays.map(period => period.partner ? { ...period, partner: keys.get(period.partner) ?? period.partner } : period),
  }));
}

export function importedDemandRecords(athletes: Athlete[], excludedIds: string[]): DemandRecord[] {
  const excluded = new Set(excludedIds);
  const name = (value: string) => value.toLocaleLowerCase().replace(/,/g, ' ').trim().replace(/\s+/g, ' ');
  return athletes.filter(person => requiresAccommodation(person) && !excluded.has(String(person.id))).map(person => {
    const matches = person.sharedWithName ? athletes.filter(other => other.id !== person.id && other.nationCode === person.nationCode &&
      [name(other.firstname + ' ' + other.lastname), name(other.lastname + ' ' + other.firstname)].includes(name(person.sharedWithName!))) : [];
    const partner = matches.length === 1 ? 'person:' + matches[0].id : undefined;
    return { key: 'person:' + person.id, id: String(person.id), provisional: Boolean(person.sharedWithName && !partner),
      stays: (person.stays?.length ? person.stays : [person]).map(period => stay(period.arrivalDate, period.departureDate, person.roomType, partner)) };
  });
}

export function concreteRoomDemand(records: DemandRecord[], bookings: RoomBooking[], options: {
  bookingPersonIds?: Iterable<string>; separateOutsideBookings?: boolean;
} = {}) {
  const people = new Map(records.map(person => [person.key, person]));
  const ids = options.bookingPersonIds ? new Set(options.bookingPersonIds) : null;
  const relevant = [...new Map(bookings.map(booking => [booking.id, booking])).values()]
    .filter(booking => !ids || booking.occupants.some(o => ids.has(String(o.athlete.id))));
  const dates = [...records.flatMap(person => person.stays.filter(validStay).flatMap(period => [period.start, period.end])),
    ...relevant.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)])].filter(Boolean).sort();
  const provisional = records.some(person => person.provisional || !person.stays.length || person.stays.some(period => !validStay(period)));
  const unknownDates = records.filter(person => !person.stays.some(validStay)).length;
  const days = (dates.length ? daysBetween(dates[0], dates.at(-1)!) : []).map(date => {
    const active = relevant.filter(booking => onDay(booking.checkInDate, booking.checkOutDate, date));
    const covered = new Set(active.flatMap(booking => booking.occupants.map(o => String(o.athlete.id))));
    const standard = active.filter(booking => booking.hotel.accommodationType !== 'EXTERNAL');
    const sourceIds = options.separateOutsideBookings ? new Set([...people.values()].flatMap(person =>
      person.id && person.stays.some(period => onDay(period.start, period.end, date)) ? [person.id] : [])) : null;
    const belongsToSource = (id: string) => sourceIds === null || sourceIds.has(id);
    const occupantIds = (booking: RoomBooking) => booking.occupants.map(o => String(o.athlete.id));
    const sourceBookings = standard.filter(booking => sourceIds === null || occupantIds(booking).some(belongsToSource));
    const outsideBookings = standard.filter(booking => sourceIds !== null && !occupantIds(booking).some(belongsToSource));
    const bookedPeople = new Set(sourceBookings.flatMap(occupantIds).filter(belongsToSource));
    const roomsWithSpace = new Map(sourceBookings.filter(booking => booking.roomType?.maxPersons === 2 &&
      booking.occupants.length === 1 && bookingFreeCapacity({ ...booking, capacity: 2 }) === 1).map(booking => [String(booking.occupants[0].athlete.id), booking.id]));
    const usedSpace = new Set<string>();
    const open = new Map([...people].filter(([, person]) => !person.id || !covered.has(person.id)).flatMap(([key, person]) => {
      const periods = person.stays.filter(period => onDay(period.start, period.end, date));
      return periods.length ? [[key, periods] as const] : [];
    }));
    const consumed = new Set<string>();
    let ez = sourceBookings.filter(booking => booking.roomType?.maxPersons === 1).length;
    let dz = sourceBookings.filter(booking => booking.roomType?.maxPersons === 2).length;
    const otherRooms = sourceBookings.length - ez - dz;
    let unknown = 0;
    let unclear = false;
    for (const [key, periods] of open) {
      if (consumed.has(key)) continue;
      const period = periods[0];
      if (periods.some(item => item.type !== period.type || item.partner !== period.partner)) { unknown++; continue; }
      if (single(period.type)) { ez++; continue; }
      if (!double(period.type)) { unknown++; continue; }
      const partner = period.partner && period.partner !== key ? open.get(period.partner) : undefined;
      const bookedPartner = period.partner && people.get(period.partner);
      const join = bookedPartner && bookedPartner.id && roomsWithSpace.get(bookedPartner.id);
      if (join && bookedPartner && !usedSpace.has(join) && bookedPartner.stays.some(item =>
        double(item.type) && item.partner === key && onDay(item.start, item.end, date))) {
        usedSpace.add(join);
        continue;
      }
      if (partner?.length && partner.every(item => double(item.type) && item.partner === key)) {
        consumed.add(period.partner!);
      } else if (period.type === 'double shared' || period.partner || period.unclear) {
        unclear = true;
      }
      dz++;
    }
    const blockedBeds = (rows: RoomBooking[]) => rows.reduce((sum, booking) => sum + (booking.countsAsSingle ?
      Math.max(0, (booking.roomType?.maxPersons ?? 0) - booking.occupants.length) : 0), 0);
    const outside = sourceIds === null ? undefined : {
      rooms: outsideBookings.length,
      ez: outsideBookings.filter(booking => booking.roomType?.maxPersons === 1).length,
      dz: outsideBookings.filter(booking => booking.roomType?.maxPersons === 2).length,
      beds: new Set(standard.flatMap(occupantIds).filter(id => !belongsToSource(id))).size + blockedBeds(outsideBookings),
    };
    return { date, ez, dz, rooms: ez + dz + otherRooms, otherRooms,
      beds: bookedPeople.size + open.size, blocked: blockedBeds(sourceBookings), outside,
      unknown, provisional: provisional || unclear || unknown > 0 || otherRooms > 0 };
  });
  return { days, unknownDates, unknownRooms: days.reduce((max, day) => Math.max(max, day.unknown), 0), provisional: provisional || days.some(day => day.provisional) };
}
