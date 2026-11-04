import assert from 'node:assert/strict';
import test from 'node:test';
import { createHotelContactRows, summarizeHotelContactRows } from './listEngine.ts';
import type { Athlete, Hotel, RoomBooking } from '../types.ts';

test('hotel summary totals remain numeric across empty and filtered lists', () => {
  assert.deepEqual(summarizeHotelContactRows([]), { occupied: 0, free: 0 });
  const rows = [{ occupiedBeds: 3, freeBeds: 7 }, { occupiedBeds: 2, freeBeds: 4 }];
  assert.deepEqual(summarizeHotelContactRows(rows), { occupied: 5, free: 11 });
  assert.deepEqual(summarizeHotelContactRows(rows.slice(1)), { occupied: 2, free: 4 });
});

test('hotel summary uses inventory and occupants without legacy hotel capacity fields', () => {
  const roomType = { id: 'double', name: 'DZ', maxPersons: 2 };
  const hotel: Hotel = {
    id: '1', name: 'Hotel', roomInventories: [{
      id: 'inventory', hotelId: '1', roomType, roomCount: 3,
      availableFrom: '2027-03-01', availableUntil: '2027-03-10',
    }],
  };
  const athlete: Athlete = { id: 'person', firstname: 'Test', lastname: 'Person', nationCode: 'AUT', single_room_status: 'NONE' };
  const booking: RoomBooking = {
    id: 'booking', hotel: { id: hotel.id, name: hotel.name }, roomType,
    countsAsSingle: false, occupants: [{ id: 'occupant', roomBookingId: 'booking', athlete }],
  };
  assert.deepEqual(summarizeHotelContactRows(createHotelContactRows([hotel], [booking])), { occupied: 1, free: 5 });
});
