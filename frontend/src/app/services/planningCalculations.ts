import type { Athlete, Event, Hotel, HotelRoomInventory, RoomBooking } from '../types';
import { calculateQuotaUsage, quotaAssignmentsFromBookings } from './quotaEvaluation';

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

/** Shared capacity projection consumed by both Analytics and the Dashboard. */
export function buildCapacityTimeline(data: { hotels: Hotel[]; events: Event[]; athletes: Athlete[]; bookings: RoomBooking[] }): CapacityDay[] {
  const dates = [...data.events.flatMap(event => [dayKey(event.startDate), dayKey(event.endDate)]), ...data.hotels.flatMap(hotel => (hotel.roomInventories || []).flatMap(item => [dayKey(item.availableFrom), dayKey(item.availableUntil)])), ...data.athletes.flatMap(athlete => (athlete.stays?.length ? athlete.stays : [athlete]).flatMap(stay => [dayKey(stay.arrivalDate), dayKey(stay.departureDate)])), ...data.bookings.flatMap(booking => [dayKey(booking.checkInDate), dayKey(booking.checkOutDate)])].filter(Boolean).sort();
  return (dates.length ? daysBetween(dates[0], dates.at(-1)!) : []).map(date => {
    const inventory = data.hotels.flatMap(hotel => hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);
    const plans = data.events.filter(event => dayKey(event.startDate) <= date && dayKey(event.endDate) >= date).map(eventRoomPlan);
    const bedSupply = inventory.reduce((sum, item) => sum + item.roomCount * item.roomType.maxPersons, 0);
    const supply = calculateRoomPlan(bedSupply), plannedBeds = plans.reduce((sum, plan) => sum + plan.beds, 0), plannedRooms = plans.reduce((sum, plan) => sum + plan.rooms, 0);
    const livePlan = calculateRoomPlan(data.athletes.filter(athlete => (athlete.stays?.length ? athlete.stays : [{ arrivalDate: athlete.arrivalDate, departureDate: athlete.departureDate }]).some(stay => onDay(stay.arrivalDate, stay.departureDate, date))).length);
    const activeBookings = data.bookings.filter(booking => (!booking.checkInDate || dayKey(booking.checkInDate) <= date) && (!booking.checkOutDate || dayKey(booking.checkOutDate) > date));
    const assignedRooms = activeBookings.length, assignedBeds = activeBookings.reduce((sum, booking) => sum + booking.occupants.length, 0), assignedEz = calculateQuotaUsage(quotaAssignmentsFromBookings(activeBookings)), assignedDz = Math.max(0, assignedBeds - assignedEz);
    const plannedEz = plans.reduce((sum, plan) => sum + plan.singleRooms, 0), plannedDz = plans.reduce((sum, plan) => sum + plan.doubleRooms, 0), freeRooms = Math.max(supply.rooms - assignedRooms, 0), freeEz = freeRooms / 2, freeDz = freeRooms - freeEz;
    return { date, label: new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }), roomSupply: supply.rooms, bedSupply, ezSupply: assignedEz + freeEz, dzSupply: assignedDz + freeDz, plannedRooms, plannedBeds, plannedEz, plannedDz, demandRooms: livePlan.rooms, demandBeds: livePlan.beds, demandEz: livePlan.singleRooms, demandDz: livePlan.doubleRooms, assignedRooms, assignedBeds, assignedEz, assignedDz, freeRooms, freeBeds: Math.max(bedSupply - assignedBeds, 0), freeEz, freeDz, eventRoomReserve: supply.rooms - plannedRooms, eventBedReserve: bedSupply - plannedBeds, eventEzReserve: supply.singleRooms - plannedEz, eventDzReserve: supply.doubleRooms - plannedDz, liveRoomReserve: supply.rooms - livePlan.rooms, liveBedReserve: bedSupply - livePlan.beds, liveEzReserve: supply.singleRooms - livePlan.singleRooms, liveDzReserve: supply.doubleRooms - livePlan.doubleRooms };
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
  return hotels.map(hotel => {
    const hotelBookings = bookings.filter(booking => booking.hotel.id === hotel.id);
    const daily = days.map(date => {
      const inventories = (hotel.roomInventories || []).filter(item => dayKey(item.availableFrom) <= date && dayKey(item.availableUntil) >= date);
      const rooms = inventories.reduce((sum, item) => sum + item.roomCount, 0);
      const singleRooms = inventories.filter(item => item.roomType.maxPersons === 1 || /(^|\W)EZ(\W|$)/i.test(item.roomType.name)).reduce((sum, item) => sum + item.roomCount, 0);
      const activeBookings = hotelBookings.filter(booking => (!booking.checkInDate || dayKey(booking.checkInDate) <= date) && (!booking.checkOutDate || dayKey(booking.checkOutDate) > date));
      const occupiedSingle = activeBookings.filter(booking => booking.roomType.maxPersons === 1 || /(^|\W)EZ(\W|$)/i.test(booking.roomType.name)).length;
      return { date, rooms, occupied: activeBookings.length, reserve: rooms - activeBookings.length, singleReserve: singleRooms - occupiedSingle };
    }).filter(day => day.rooms > 0 || day.occupied > 0);
    const worst = daily.reduce((lowest, day) => day.reserve < (lowest?.reserve ?? Number.POSITIVE_INFINITY) ? day : lowest, daily[0]);
    const firstCritical = daily.find(day => day.rooms === 0 ? day.occupied > 0 : day.reserve / day.rooms <= .1);
    return { hotel, daily, worst, firstCritical, criticalDays: daily.filter(day => day.rooms === 0 ? day.occupied > 0 : day.reserve / day.rooms <= .1).length };
  });
}
