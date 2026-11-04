import test from 'node:test';
import assert from 'node:assert/strict';
import { filterQueuePersonType, matchesQueuePersonType, queueFunctionLabel } from './queuePersonType.ts';
import { dispositionItems } from './dispositionItems.ts';
import type { RoomBookingUnit, RoomBookingUnitOccupant } from '../types.ts';
const interval={checkInDate:'2027-03-14',checkOutDate:'2027-03-21'};
const person=(id:string,fn?:string)=>({athleteId:id,name:`Person ${id}`,firstname:id,function:fn,accommodationCoverage:{overallInterval:interval,openIntervals:[interval],segments:[],coveredIntervals:[],conflicts:[],coverageStatus:'UNASSIGNED'}} as RoomBookingUnitOccupant);
const unit=(occupants:RoomBookingUnitOccupant[],id='one')=>({unitId:id,occupants,occupantCount:occupants.length,assignmentWarnings:[]} as RoomBookingUnit);
const people=[person('1','Athlete'),person('2','NSA Guest'),person('3','NSA Technician'),person('4')];
test('queue displays raw Function labels and missing functions are not presented as athletes',()=>{
 assert.deepEqual(people.map(queueFunctionLabel),['Athlete','NSA Guest','NSA Technician','Official']);
});
test('Athleten selects Athlete only and Officials includes every other function',()=>{
 assert.deepEqual(people.filter(p=>matchesQueuePersonType(p,'athletes')).map(p=>p.athleteId),['1']);
 assert.deepEqual(people.filter(p=>matchesQueuePersonType(p,'officials')).map(p=>p.athleteId),['2','3','4']);
 assert.equal(people.filter(p=>matchesQueuePersonType(p,'')).length,4);
});
test('queue filter retains canonical dates/identity and never changes source membership or quota inputs',()=>{
 const units=people.map((p,i)=>unit([p],String(i)));const before=structuredClone(units);
 const items=dispositionItems(units,[]);const athletes=filterQueuePersonType(items,'athletes');
 assert.equal(athletes.length,1);assert.strictEqual(athletes[0],items[0]);
 assert.deepEqual(athletes[0].openPeriod,interval);assert.deepEqual(units,before);
 assert.strictEqual(filterQueuePersonType(items,''),items);
});
test('mixed pairs show only matching occupants without changing pairing or assignment dates',()=>{
 const items=dispositionItems([unit(people.slice(0,2))],[]);assert.equal(items[0].occupants.length,2);
 const athletes=filterQueuePersonType(items,'athletes')[0],officials=filterQueuePersonType(items,'officials')[0];
 assert.deepEqual(athletes.occupants.map(p=>p.athleteId),['1']);assert.equal(athletes.occupantCount,1);
 assert.deepEqual(officials.occupants.map(p=>p.athleteId),['2']);
 assert.equal(athletes.unitId,items[0].unitId);assert.deepEqual(athletes.openPeriod,interval);
 assert.equal(items[0].occupants.length,2);
});
