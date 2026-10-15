import test from 'node:test';
import assert from 'node:assert/strict';
import type { AccommodationCoverage, AssignmentGridHotel, RoomBookingUnit, RoomBookingUnitOccupant } from '../types.ts';
import { dispositionItems, itemContainsPeople } from './dispositionItems.ts';
const period=(start:number,end:number)=>({checkInDate:`2027-03-${String(start).padStart(2,'0')}`,checkOutDate:`2027-03-${String(end).padStart(2,'0')}`});
const segment=(start:number,end:number)=>({...period(start,end),bookingId:'10',hotelId:'1',hotelName:'Adler',roomTypeId:'2',roomTypeName:'DZ',roomNumber:'Zimmer 01',countsAsSingle:false,conflictCodes:[]});
const person=(id:string,opens=[period(14,21)],segments:AccommodationCoverage['segments']=[segment(4,14)],status:AccommodationCoverage['coverageStatus']='PARTIALLY_ASSIGNED')=>({athleteId:id,name:`Person ${id}`,firstname:id,accommodationCoverage:{overallInterval:period(4,21),segments,openIntervals:opens,coveredIntervals:[],conflicts:[],coverageStatus:status}} as RoomBookingUnitOccupant);
const unit=(people:RoomBookingUnitOccupant[],id='unit')=>({unitId:id,occupants:people,roomType:'DZ',assignmentWarnings:[],checkInDate:'2027-03-04',checkOutDate:'2027-03-21'} as RoomBookingUnit);
const hotel=()=>[{slots:[{bookings:[{bookingId:'10',checkOutDate:'2027-03-14',occupants:[{athleteId:'1'},{athleteId:'2'}]}]}]}] as AssignmentGridHotel[];

test('normal unassigned full stay is one directly actionable dated item',()=>{
  const items=dispositionItems([unit([person('1',[period(4,21)],[],'UNASSIGNED')])],[]);
  assert.equal(items.length,1);assert.deepEqual(items[0].openPeriod,period(4,21));assert.equal(items[0].canAssign,true);
  assert.equal(items[0].previous.length,0);
});
test('multiple gaps are separate items and backend dates are retained without subtraction',()=>{
  const source=person('1',[period(4,8),period(14,21)],[segment(8,14)]);
  const items=dispositionItems([unit([source])],[]);
  assert.deepEqual(items.map(i=>i.openPeriod),source.accommodationCoverage!.openIntervals);
  assert.ok(items.every(i=>i.previous[0].includes('Adler')));
  assert.equal(new Set(items.map(i=>i.unitId)).size,2);
});
test('split shared booking preserves pair without permanent roommate preference or same source unit',()=>{
  const units=[unit([person('1')],'first'),unit([person('2')],'second')];
  const items=dispositionItems(units,hotel());
  assert.equal(items.length,1);assert.deepEqual(items[0].occupants.map(p=>p.athleteId),['1','2']);
  assert.deepEqual(dispositionItems(structuredClone(units),structuredClone(hotel())),items);
  assert.equal(itemContainsPeople(items[0],['2'],period(14,21)),true);
});
test('different open dates cannot be paired and individual work remains',()=>{
  const items=dispositionItems([unit([person('1'),person('2',[period(15,21)])])],hotel());
  assert.equal(items.length,2);assert.ok(items.every(i=>i.occupants.length===1));
});
test('fully assigned people have no work item; conflicts have review items without drag',()=>{
  const items=dispositionItems([unit([person('1',[],[],'FULLY_ASSIGNED'),person('2',[period(14,21)],[],'CONFLICT')])],[]);
  assert.equal(items.length,1);assert.equal(items[0].canAssign,false);
});
test('paired items and individual remaining gaps never duplicate a person/period',()=>{
  const items=dispositionItems([unit([person('1',[period(4,8),period(14,21)]),person('2')])],hotel());
  assert.equal(items.length,2);assert.equal(items.filter(i=>i.occupants.length===2).length,1);
  assert.equal(items.filter(i=>i.occupants.length===1)[0].checkInDate,'2027-03-04');
});
