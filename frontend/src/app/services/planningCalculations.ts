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
  eventRoomReserve: number; eventBedReserve: number; eventEzReserve: number; eventDzReserve: number;
  liveRoomReserve: number; liveBedReserve: number; liveEzReserve: number; liveDzReserve: number;
};

const dayKey = (value?: string | null) => value?.slice(0, 10) || '';
const onDay = (from?: string | null, until?: string | null, date = '') => Boolean(from && until && dayKey(from) <= date && dayKey(until) > date);
const daysBetween = (from: string, until: string) => { const result: string[] = []; for (let date = new Date(`${from}T00:00:00Z`), end = new Date(`${until}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) result.push(date.toISOString().slice(0, 10)); return result; };

const inventoryOnDay = (items: HotelRoomInventory[], date: string) =>
  items.filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);

// Use the same contract category in room comparisons and hotel risk.
export function inventoryRoomCategory(type?: HotelRoomInventory['roomType'] | null) {
  if (type?.maxPersons === 1 || /(^|\W)EZ(\W|$)/i.test(type?.name ?? '')) return 'EZ';
  if (type?.maxPersons === 2) return 'DZ';
}

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
    const supply = inventoryOnDay(items, date);
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
export function buildCapacityTimeline(data: { hotels: Hotel[]; events: Event[]; athletes: Athlete[]; bookings: RoomBooking[] }, concrete?: ReturnType<typeof concreteRoomDemand>, source?: DemandSource): CapacityDay[] {
  data={...data,hotels:data.hotels.filter(h=>h.accommodationType!=='EXTERNAL'),bookings:data.bookings.filter(b=>b.hotel?.accommodationType!=='EXTERNAL')};
  const projected = new Map(concrete?.days.map(day => [day.date, day]));
  const dates = [...projected.keys(), ...data.events.flatMap(event => [dayKey(event.startDate), dayKey(event.endDate)]), ...data.hotels.flatMap(hotel => (hotel.roomInventories || []).flatMap(item => [dayKey(item.availableFrom), dayKey(item.availableUntil)])), ...data.athletes.flatMap(athlete => (athlete.stays?.length ? athlete.stays : [athlete]).flatMap(stay => [dayKey(stay.arrivalDate), dayKey(stay.departureDate)])), ...data.bookings.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)])].filter(Boolean).sort();
  return (dates.length ? daysBetween(dates[0], dates.at(-1)!) : []).map(date => {
    const inventory = inventoryOnDay(data.hotels.flatMap(hotel => hotel.roomInventories || []), date);
    const plans = data.events.filter(event => dayKey(event.startDate) <= date && dayKey(event.endDate) >= date).map(eventRoomPlan);
    const bedSupply = inventory.reduce((sum, item) => sum + item.roomCount * item.roomType.maxPersons, 0);
    const plannedBeds = plans.reduce((sum, plan) => sum + plan.beds, 0), plannedRooms = plans.reduce((sum, plan) => sum + plan.rooms, 0);
    const activeBookings = data.bookings.filter(booking => onDay(booking.checkInDate, booking.checkOutDate, date));
    const hotels = new Map(data.hotels.map(hotel=>[hotel.id,hotel]));
    activeBookings.forEach(booking=>{ if (!hotels.has(booking.hotel.id)) hotels.set(booking.hotel.id,booking.hotel); });
    const actual = [...hotels.values()].map(hotel=>hotelCapacityOnDay(hotel,activeBookings,date));
    const assignedRooms = actual.reduce((sum,row)=>sum+row.occupiedRooms,0);
    const assignedBeds = actual.reduce((sum,row)=>sum+row.occupiedBeds,0);
    const byCategory = (category: 'EZ' | 'DZ') => ({
      supply: inventory.reduce((sum, item) => sum + (inventoryRoomCategory(item.roomType) === category ? item.roomCount : 0), 0),
      booked: new Set(activeBookings.filter(booking => inventoryRoomCategory(booking.roomType) === category).map(booking => booking.id)).size,
    });
    const ez = byCategory('EZ'), dz = byCategory('DZ');
    const roomSupply = inventory.reduce((sum,item)=>sum+item.roomCount,0);
    const plannedEz = plans.reduce((sum, plan) => sum + plan.singleRooms, 0);
    const plannedDz = plans.reduce((sum, plan) => sum + plan.doubleRooms, 0);
    const exact = projected.get(date);
    const planned = { rooms: plannedRooms, beds: plannedBeds, singleRooms: plannedEz, doubleRooms: plannedDz };
    // The dashboard retains its existing person forecast; Analytics Live uses bookings.
    const demand = concrete ? { rooms: exact?.rooms ?? 0, beds: exact?.beds ?? 0,
      singleRooms: exact?.ez ?? 0, doubleRooms: exact?.dz ?? 0 }
      : source === 'live' ? { rooms: assignedRooms, beds: assignedBeds, singleRooms: ez.booked, doubleRooms: dz.booked }
      : source === 'event' ? planned
      : calculateRoomPlan(data.athletes.filter(athlete => requiresAccommodation(athlete) && (athlete.stays?.length ? athlete.stays : [{ arrivalDate: athlete.arrivalDate, departureDate: athlete.departureDate }]).some(stay => onDay(stay.arrivalDate, stay.departureDate, date))).length);
    const reserve = (plan: RoomPlan) => ({
      rooms: roomSupply - plan.rooms, beds: bedSupply - plan.beds,
      ez: ez.supply - plan.singleRooms, dz: dz.supply - plan.doubleRooms,
    });
    const eventReserve = reserve(planned), demandReserve = reserve(demand);
    const assignedEz = source === undefined ? physicalSingleRoomUsageFromBookings(activeBookings) : ez.booked;
    const assignedDz = source === undefined ? Math.max(0, assignedBeds - assignedEz) : dz.booked;
    return {
      date, label: new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }),
      roomSupply, bedSupply, ezSupply: ez.supply, dzSupply: dz.supply,
      assignedRooms, assignedBeds, assignedEz, assignedDz,
      freeRooms: actual.reduce((sum,row)=>sum+row.freeRooms,0), freeBeds: actual.reduce((sum,row)=>sum+row.freeBeds,0),
      freeEz: Math.max(0, ez.supply - ez.booked), freeDz: Math.max(0, dz.supply - dz.booked),
      plannedRooms, plannedBeds, plannedEz, plannedDz,
      demandRooms: demand.rooms, demandBeds: demand.beds, demandEz: demand.singleRooms, demandDz: demand.doubleRooms,
      eventRoomReserve: eventReserve.rooms, eventBedReserve: eventReserve.beds,
      eventEzReserve: eventReserve.ez, eventDzReserve: eventReserve.dz,
      liveRoomReserve: demandReserve.rooms, liveBedReserve: demandReserve.beds,
      liveEzReserve: demandReserve.ez, liveDzReserve: demandReserve.dz,
    };
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
      const inventories = inventoryOnDay(hotel.roomInventories || [], date);
      const singleRooms = inventories.filter(item => inventoryRoomCategory(item.roomType) === 'EZ').reduce((sum, item) => sum + item.roomCount, 0);
      const occupiedSingle = hotelBookings.filter(b => onDay(b.checkInDate,b.checkOutDate,date)
        && inventoryRoomCategory(b.roomType) === 'EZ').length;
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
export type ExcelDemand = { nation: string; people: DemandPerson[]; rooms: DemandRoom[]; excludedIds: string[]; provisional: boolean; conflict?: string; importStatus?: string; roomStatus?: 'available' | 'zero' | 'missing' | 'conflict' };

type DemandStay = { start: string; end: string; type: string; partner?: string; unclear?: boolean; secondary?: boolean };
type DemandRecord = { key: string; stays: DemandStay[]; provisional?: boolean };

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
    return [{ key: id ? 'person:' + id : prefix + key, stays,
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
    return { key: 'person:' + person.id, provisional: Boolean(person.sharedWithName && !partner),
      stays: (person.stays?.length ? person.stays : [person]).map(period => stay(period.arrivalDate, period.departureDate, person.roomType, partner)) };
  });
}

export function concreteRoomDemand(records: DemandRecord[]) {
  const people = new Map(records.map(person => [person.key, person]));
  const dates = records.flatMap(person => person.stays.filter(validStay).flatMap(period => [period.start, period.end])).sort();
  const provisional = records.some(person => person.provisional || !person.stays.length || person.stays.some(period => !validStay(period)));
  const unknownDates = records.filter(person => !person.stays.some(validStay)).length;
  const days = (dates.length ? daysBetween(dates[0], dates.at(-1)!) : []).map(date => {
    const open = new Map([...people].flatMap(([key, person]) => {
      const periods = person.stays.filter(period => onDay(period.start, period.end, date));
      return periods.length ? [[key, periods] as const] : [];
    }));
    const consumed = new Set<string>();
    let ez = 0;
    let dz = 0;
    let unknown = 0;
    let unclear = false;
    for (const [key, periods] of open) {
      if (consumed.has(key)) continue;
      const period = periods[0];
      if (periods.some(item => item.type !== period.type || item.partner !== period.partner)) { unknown++; continue; }
      if (single(period.type)) { ez++; continue; }
      if (!double(period.type)) { unknown++; continue; }
      const partner = period.partner && period.partner !== key ? open.get(period.partner) : undefined;
      if (partner?.length && partner.every(item => double(item.type) && item.partner === key)) {
        consumed.add(period.partner!);
      } else if (period.type === 'double shared' || period.partner || period.unclear) {
        unclear = true;
      }
      dz++;
    }
    return { date, ez, dz, rooms: ez + dz, beds: open.size,
      unknown, provisional: provisional || unclear || unknown > 0 };
  });
  return { days, unknownDates, unknownRooms: days.reduce((max, day) => Math.max(max, day.unknown), 0), provisional: provisional || days.some(day => day.provisional) };
}

/** Keep actual booking nights and people aligned with the existing room categories. */
export function bookedNationDemand(bookings: RoomBooking[]) {
  const nations = new Map<string, Map<string, RoomBooking>>();
  for (const booking of bookings) {
    for (const { athlete } of booking.occupants) {
      if (!athlete.nationCode) continue;
      const rooms = nations.get(athlete.nationCode) ?? new Map();
      rooms.set(booking.id, booking);
      nations.set(athlete.nationCode, rooms);
    }
  }
  return [...nations].map(([nation, rooms]) => {
    const bookings = [...rooms.values()];
    const people = (rows: RoomBooking[]) => new Set(rows.flatMap(booking => booking.occupants
      .filter(({ athlete }) => athlete.nationCode === nation).map(({ athlete }) => athlete.id))).size;
    const dated = bookings.filter(booking => onDay(booking.checkInDate, booking.checkOutDate, dayKey(booking.checkInDate)));
    const dates = dated.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)]).sort();
    const days = (dates.length ? daysBetween(dates[0], dates.at(-1)!) : []).map(date => {
      const active = bookings.filter(booking => onDay(booking.checkInDate, booking.checkOutDate, date));
      // Shared rooms are apportioned by recorded occupants across nations.
      const share = (booking: RoomBooking) => booking.occupants.filter(({ athlete }) => athlete.nationCode === nation).length / booking.occupants.length;
      return {
        date, beds: people(active),
        ez: active.filter(booking => inventoryRoomCategory(booking.roomType) === 'EZ').reduce((sum, booking) => sum + share(booking), 0),
        dz: active.filter(booking => inventoryRoomCategory(booking.roomType) === 'DZ').reduce((sum, booking) => sum + share(booking), 0),
      };
    });
    return { nation, count: people(bookings), datedCount: people(dated), days,
      provisional: dated.length !== bookings.length || bookings.some(booking => !inventoryRoomCategory(booking.roomType)) };
  });
}
