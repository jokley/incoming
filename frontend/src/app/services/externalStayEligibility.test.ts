import test from 'node:test';
import assert from 'node:assert/strict';
import { externalStayEligibility } from './externalStayEligibility.ts';
import type { RoomBookingUnitOccupant } from '../types.ts';
const person=(id:string,externalCount=0)=>({athleteId:id,accommodationCoverage:{segments:Array.from({length:externalCount},()=>({accommodationType:'EXTERNAL'}))}} as RoomBookingUnitOccupant);

test('pair without external accommodation allows both or either individual',()=>{
  const result=externalStayEligibility([person('A'),person('B')]);
  assert.deepEqual(result.eligibleIds,['A','B']);assert.equal(result.canCreateTogether,true);assert.equal(result.defaultSelection,'all');
});
test('existing external excludes its person and both; defaults to eligible partner',()=>{
  const result=externalStayEligibility([person('A',1),person('B')]);
  assert.deepEqual(result.eligibleIds,['B']);assert.equal(result.canCreateTogether,false);assert.equal(result.defaultSelection,'B');assert.equal(result.canCreate,true);assert.ok(result.existingIds.has('A'));
});
test('both external disable new creation',()=>{
  const result=externalStayEligibility([person('A',1),person('B',1)]);
  assert.equal(result.canCreate,false);assert.equal(result.defaultSelection,'');assert.equal(result.canCreateTogether,false);
});
test('solo supports create only without an existing external stay',()=>{
  assert.equal(externalStayEligibility([person('A')]).defaultSelection,'A');
  assert.equal(externalStayEligibility([person('A',1)]).canCreate,false);
});
test('historical duplicates remain intact and block new creation',()=>{
  const people=[person('A',3)];const before=structuredClone(people);
  assert.equal(externalStayEligibility(people).canCreate,false);assert.deepEqual(people,before);
});
