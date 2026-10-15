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
