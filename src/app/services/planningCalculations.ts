import type { Event, HotelRoomInventory } from '../types';

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
