import type { Athlete, Event, Hotel, HotelRoomInventory, RoomBooking } from '../types.ts';
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

export type DemandSource = 'event' | 'live';
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
export function buildCapacityTimeline(data: { hotels: Hotel[]; events: Event[]; athletes: Athlete[]; bookings: RoomBooking[] }): CapacityDay[] {
  data={...data,hotels:data.hotels.filter(h=>h.accommodationType!=='EXTERNAL'),bookings:data.bookings.filter(b=>b.hotel?.accommodationType!=='EXTERNAL')};
  const dates = [...data.events.flatMap(event => [dayKey(event.startDate), dayKey(event.endDate)]), ...data.hotels.flatMap(hotel => (hotel.roomInventories || []).flatMap(item => [dayKey(item.availableFrom), dayKey(item.availableUntil)])), ...data.athletes.flatMap(athlete => (athlete.stays?.length ? athlete.stays : [athlete]).flatMap(stay => [dayKey(stay.arrivalDate), dayKey(stay.departureDate)])), ...data.bookings.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)])].filter(Boolean).sort();
  return (dates.length ? daysBetween(dates[0], dates.at(-1)!) : []).map(date => {
    const inventory = data.hotels.flatMap(hotel => hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);
    const plans = data.events.filter(event => dayKey(event.startDate) <= date && dayKey(event.endDate) >= date).map(eventRoomPlan);
    const bedSupply = inventory.reduce((sum, item) => sum + item.roomCount * item.roomType.maxPersons, 0);
    const supply = calculateRoomPlan(bedSupply), plannedBeds = plans.reduce((sum, plan) => sum + plan.beds, 0), plannedRooms = plans.reduce((sum, plan) => sum + plan.rooms, 0);
    const livePlan = calculateRoomPlan(data.athletes.filter(athlete => athlete.accommodationRequirement!=='NO_ROOM' && (athlete.stays?.length ? athlete.stays : [{ arrivalDate: athlete.arrivalDate, departureDate: athlete.departureDate }]).some(stay => onDay(stay.arrivalDate, stay.departureDate, date))).length);
    const activeBookings = data.bookings.filter(booking => onDay(booking.checkInDate, booking.checkOutDate, date));
    const hotels = new Map(data.hotels.map(hotel=>[hotel.id,hotel]));
    activeBookings.forEach(booking=>{ if (!hotels.has(booking.hotel.id)) hotels.set(booking.hotel.id,booking.hotel); });
    const actual = [...hotels.values()].map(hotel=>hotelCapacityOnDay(hotel,activeBookings,date));
    const assignedRooms = actual.reduce((sum,row)=>sum+row.occupiedRooms,0), assignedBeds = actual.reduce((sum,row)=>sum+row.occupiedBeds,0), assignedEz = physicalSingleRoomUsageFromBookings(activeBookings), assignedDz = Math.max(0, assignedBeds - assignedEz);
    const roomSupply = inventory.reduce((sum,item)=>sum+item.roomCount,0);
    const plannedEz = plans.reduce((sum, plan) => sum + plan.singleRooms, 0), plannedDz = plans.reduce((sum, plan) => sum + plan.doubleRooms, 0), freeRooms = actual.reduce((sum,row)=>sum+row.freeRooms,0), freeEz = freeRooms / 2, freeDz = freeRooms - freeEz;
    return { date, label: new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }), roomSupply, bedSupply, ezSupply: assignedEz + freeEz, dzSupply: assignedDz + freeDz, plannedRooms, plannedBeds, plannedEz, plannedDz, demandRooms: livePlan.rooms, demandBeds: livePlan.beds, demandEz: livePlan.singleRooms, demandDz: livePlan.doubleRooms, assignedRooms, assignedBeds, assignedEz, assignedDz, freeRooms, freeBeds: actual.reduce((sum,row)=>sum+row.freeBeds,0), freeEz, freeDz, eventRoomReserve: roomSupply - plannedRooms, eventBedReserve: bedSupply - plannedBeds, eventEzReserve: supply.singleRooms - plannedEz, eventDzReserve: supply.doubleRooms - plannedDz, liveRoomReserve: roomSupply - livePlan.rooms, liveBedReserve: bedSupply - livePlan.beds, liveEzReserve: supply.singleRooms - livePlan.singleRooms, liveDzReserve: supply.doubleRooms - livePlan.doubleRooms };
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
