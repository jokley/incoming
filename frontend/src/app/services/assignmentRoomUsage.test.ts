import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssignmentSlot } from '../types.ts';
import {slotPersonCount} from './assignmentRoomUsage.ts';
test('partitioning a shared physical room preserves displayed person consumption',()=>{
  const booking=(ids:string[])=>({occupants:ids.map(athleteId=>({athleteId}))});
  const before={bookings:[booking(['1','2'])]} as AssignmentSlot;
  const after={bookings:[booking(['1','2']),booking(['2'])]} as AssignmentSlot;
  assert.equal(slotPersonCount(before),2);assert.equal(slotPersonCount(after),2);
});

import {bookingFreeCapacity,slotOperationalUsed} from './assignmentRoomUsage.ts';
test('DZ single use retains physical occupancy and blocks operational capacity',()=>{
  const booking={capacity:2,countsAsSingle:true,occupants:[{athleteId:'1'}]};
  const slot={capacity:2,bookings:[booking]} as AssignmentSlot;
  assert.equal(slotPersonCount(slot),1);
  assert.equal(bookingFreeCapacity(booking),0);
  assert.equal(slotOperationalUsed(slot),2);
});
test('normal DZ with one occupant retains one assignable bed',()=>{
  const booking={capacity:2,countsAsSingle:false,occupants:[{athleteId:'1'}]};
  assert.equal(bookingFreeCapacity(booking),1);
  assert.equal(slotOperationalUsed({capacity:2,bookings:[booking]} as AssignmentSlot),1);
});
