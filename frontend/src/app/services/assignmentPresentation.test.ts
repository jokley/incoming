import test from 'node:test';
import assert from 'node:assert/strict';
import {queueRoomRequest,stableRoomSlots} from './assignmentPresentation.ts';
import type {AssignmentSlot,RoomBookingUnit} from '../types.ts';
const unit={roomType:'Double shared',roomTypeLabel:'double',roomCategoryLabel:'dz'} as RoomBookingUnit;
test('Athlete and Official use their person request, not the group room type',()=>{
 assert.equal(queueRoomRequest({roomType:'Single'},unit),'EZ');
 assert.equal(queueRoomRequest({roomType:'Double shared'},{...unit,roomType:'Single',roomTypeLabel:'single',roomCategoryLabel:'ez'}),'DZ');
});
test('EZ/DZ labels retain backend request normalization including double single',()=>{
 for(const value of ['Single','Double single','EZ / DU','SR'])assert.equal(queueRoomRequest({roomType:value},unit),'EZ');
 for(const value of ['Double','Double shared','DZ / DU'])assert.equal(queueRoomRequest({roomType:value},unit),'DZ');
 assert.equal(queueRoomRequest({roomType:'Apartment'},unit),'Apartment');
 assert.equal(queueRoomRequest({roomType:null},unit),'DZ');
});
const slots=()=>[4,2,5,1,3].map(n=>({slotId:`hotel:room:${n}`,roomNumber:`Zimmer ${n}`,slotIndex:n,bookings:[]} as unknown as AssignmentSlot));
const ids=(input:AssignmentSlot[])=>stableRoomSlots(input).map(s=>s.slotId);
test('room 04 retains its position when occupancy changes, is removed or partitioned',()=>{
 const initial=slots(),order=ids(initial);
 const modified=initial.map(s=>s.slotIndex===4 ? {...s,bookings:[{bookingId:'new',checkInDate:'2027-03-14',occupants:[{athleteId:'1'}]}]} : s) as AssignmentSlot[];
 assert.deepEqual(ids(modified),order);
 assert.equal(ids(modified).indexOf('hotel:room:4'),3);
 assert.deepEqual(ids(modified.map(s=>({...s,bookings:[]}))),order);
 assert.deepEqual(ids(modified.map(s=>({...s,bookings:[...s.bookings,...s.bookings]}))),order);
 assert.deepEqual(initial.map(s=>s.slotIndex),[4,2,5,1,3]);
});
test('explicit stable slot index takes priority over display names',()=>{
 const records=[{slotId:'a',roomNumber:'Zimmer 1',slotIndex:2},{slotId:'b',roomNumber:'Zimmer 10',slotIndex:1}];
 assert.deepEqual(stableRoomSlots(records).map(s=>s.slotId),['b','a']);
});
test('natural room-number ordering and identity fallback',()=>{
 const records=[10,3,1,2].map(n=>({slotId:`id-${n}`,roomNumber:`Zimmer ${n}`}));
 assert.deepEqual(stableRoomSlots(records).map(s=>s.roomNumber),['Zimmer 1','Zimmer 2','Zimmer 3','Zimmer 10']);
 assert.deepEqual(stableRoomSlots([{slotId:'slot-10',roomNumber:null},{slotId:'slot-2',roomNumber:null}]).map(s=>s.slotId),['slot-2','slot-10']);
});
test('free virtual slots keep their identity after assigning another slot',()=>{
 const records=slots();const initial=ids(records);
 assert.deepEqual(ids([...records].reverse().map(s=>({...s,bookings:s.slotIndex===4 ? [{bookingId:'x'}] : []})) as AssignmentSlot[]),initial);
});
