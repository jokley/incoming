import type { Event, HotelRoomInventory } from '../types';

export type RoomPlan = { beds: number; rooms: number; singleRooms: number; doubleRooms: number };

/** The single source of truth for the FIS planning model used by events and analytics. */
export function calculateRoomPlan(beds: number, singleRoomPercentage = 50): RoomPlan {
  const safeBeds = Math.max(0, Math.ceil(beds || 0));
  const percentage = Math.max(0, Math.min(100, singleRoomPercentage ?? 50));
  const rooms = Math.ceil(safeBeds / 1.5);
  const singleRooms = Math.round(rooms * percentage / 100);
  return { beds: safeBeds, rooms, singleRooms, doubleRooms: rooms - singleRooms };
}

export const eventRoomPlan = (event: Event) => calculateRoomPlan(event.personDemand, event.singleRoomPercentage);

export const inventoryCapacity = (items: HotelRoomInventory[] = []) => items.reduce(
  (total, item) => ({ rooms: total.rooms + item.roomCount, beds: total.beds + item.roomCount * item.roomType.maxPersons }),
  { rooms: 0, beds: 0 },
);
