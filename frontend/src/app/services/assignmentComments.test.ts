import test from 'node:test';
import assert from 'node:assert/strict';
import { contingentComments, visibleAssignmentComment } from './assignmentComments.ts';
import type { AssignmentGridHotel } from '../types.ts';

test('empty comments produce no display content; long text remains available to tooltip',()=>{
  for(const value of [null,undefined,'','  \n ']) assert.equal(visibleAssignmentComment(value),null);
  assert.equal(visibleAssignmentComment(' Hotel instructions '),'Hotel instructions');
  const long='Long comment\n'.repeat(100);
  assert.equal(visibleAssignmentComment(long),long.trim());
});
test('contingent comments retain exact inventory scope and remain distinct from hotel comment',()=>{
  const hotel:AssignmentGridHotel={hotelId:'h',hotelName:'Hotel',slots:[],comment:'Hotel note',inventoryComments:[
    {id:'1',roomTypeId:'single',availableFrom:'2027-03-01',availableUntil:'2027-03-10',comment:'Single note'},
    {id:'2',roomTypeId:'double',availableFrom:'2027-03-11',availableUntil:'2027-03-20',comment:'Double note'},
    {id:'3',roomTypeId:'single',availableFrom:'2027-03-01',availableUntil:'2027-03-10',comment:' '},
  ]};
  assert.deepEqual(contingentComments(hotel,'single').map(item=>item.id),['1']);
  assert.deepEqual(contingentComments(hotel,'double').map(item=>item.comment),['Double note']);
  assert.deepEqual(contingentComments(undefined),[]);
  assert.equal(visibleAssignmentComment(hotel.comment),'Hotel note');
});
