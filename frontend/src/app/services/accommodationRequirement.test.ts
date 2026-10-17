import test from 'node:test';
import assert from 'node:assert/strict';
import type { Athlete, RoomBookingUnit, RoomBookingUnitOccupant } from '../types.ts';
import { personAccommodation } from './personAccommodation.ts';
import { athleteWorkCategory } from './workflowStatus.ts';
import { accommodationSurcharge } from './accommodationSurcharge.ts';
import { createListRows, filterListRows, type ListFilters } from '../lists/listEngine.ts';
import { dispositionItems } from './dispositionItems.ts';
import { externalStayEligibility } from './externalStayEligibility.ts';
import { buildCapacityTimeline } from './planningCalculations.ts';
import { personExportColumns } from '../lists/listExports.ts';
const interval={checkInDate:'2027-03-04',checkOutDate:'2027-03-21'};
const coverage={overallInterval:interval,segments:[],coveredIntervals:[],openIntervals:[],conflicts:[],coverageStatus:'NO_ROOM' as const};
const person={id:'1',firstname:'No',lastname:'Room',nationCode:'AUS',function:'Athlete',arrivalDate:interval.checkInDate,departureDate:interval.checkOutDate,accommodationRequirement:'NO_ROOM',accommodationRequirementSource:'MANUAL',accommodationRateCategory:'SPECIAL',single_room_status:'APPROVED_EXTRA',accommodationCoverage:coverage} as Athlete;
const occupant={athleteId:'1',name:'No Room',firstname:'No',lastname:'Room',nationCode:'AUS',accommodationRequirement:'NO_ROOM',accommodationCoverage:coverage,statusBadges:[],hasPendingReview:false} as RoomBookingUnitOccupant;
const filters={search:'',athleteRemark:'',internalNote:'',selection:'',discipline:'',nation:'',role:'',hotel:'',status:'',hint:'',movement:'',period:'',assignedOnly:false} as ListFilters;
test('NO_ROOM remains a person but is not open or assigned accommodation',()=>{
 const view=personAccommodation(person);assert.equal(view.status,'NO_ROOM');assert.equal(view.label,'Kein Zimmer benötigt');assert.equal(view.roomLabel,'No room');assert.equal(view.hotelLabel,'—');
 assert.equal(athleteWorkCategory(person),'no-room');
});
test('NO_ROOM + SPECIAL retains metadata but surcharge is not applicable',()=>{
 const before=structuredClone(person),surcharge=accommodationSurcharge(person);
 assert.equal(surcharge.applicable,false);assert.deepEqual(surcharge.surchargeReasons,['SPECIAL_RATE']);
 const rows=createListRows([person],[]);assert.equal(rows.length,1);assert.equal(rows[0].room,'No room');assert.equal(rows[0].surcharge,'—');assert.equal(rows[0].singleRoomPending,false);
 assert.deepEqual(person,before);assert.equal(person.single_room_status,'APPROVED_EXTRA');
});
test('overview and export distinguish NO_ROOM from open demand',()=>{
 const required={...person,id:'2',accommodationRequirement:'REQUIRED',accommodationCoverage:{...coverage,coverageStatus:'UNASSIGNED',openIntervals:[interval]}} as Athlete;
 const rows=createListRows([person,required],[]);assert.equal(filterListRows(rows,'none',{...filters,hint:'without-room'}).length,1);
 assert.deepEqual(filterListRows(rows,'none',{...filters,hint:'no-room'}).map(r=>r.id),['1']);
 assert.equal(rows[0].accommodationStatus,'Kein Zimmer benötigt');assert(personExportColumns.some(([key])=>key==='accommodationStatus'));
});
test('NO_ROOM is excluded before pair construction; remaining person keeps exact backend interval',()=>{
 const remaining={...occupant,athleteId:'2',accommodationRequirement:'REQUIRED',accommodationCoverage:{...coverage,coverageStatus:'UNASSIGNED',openIntervals:[interval]}} as RoomBookingUnitOccupant;
 const units=[{unitId:'pair',occupants:[occupant,remaining],assignmentWarnings:[]} as RoomBookingUnit];
 const before=structuredClone(units),items=dispositionItems(units,[]);
 assert.equal(items.length,1);assert.deepEqual(items[0].occupants.map(p=>p.athleteId),['2']);assert.deepEqual(items[0].openPeriod,interval);assert.deepEqual(units,before);
 assert.equal(externalStayEligibility([occupant]).canCreate,false);
});
test('live demand excludes NO_ROOM while general person input and travel dates remain intact',()=>{
 const inputs={hotels:[],events:[],athletes:[person],bookings:[]};const timeline=buildCapacityTimeline(inputs);
 assert(timeline.length>0);assert(timeline.every(d=>d.demandBeds===0&&d.demandRooms===0));assert.equal(inputs.athletes.length,1);
});
test('historical NO_ROOM booking conflict remains a conflict',()=>{
 const invalid={...person,accommodationCoverage:{...coverage,coverageStatus:'CONFLICT',conflicts:[{code:'NO_ROOM_HAS_BOOKINGS',bookingIds:['1']}]}} as Athlete;
 assert.equal(personAccommodation(invalid).status,'CONFLICT');assert.equal(athleteWorkCategory(invalid),'conflict');
});
