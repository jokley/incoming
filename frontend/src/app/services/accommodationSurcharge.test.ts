import test from 'node:test';
import assert from 'node:assert/strict';
import { accommodationSurcharge } from './accommodationSurcharge.ts';
import { createListRows } from '../lists/listEngine.ts';
import { evaluateAllQuotaGroups, quotaAssignmentsFromBookings } from './quotaEvaluation.ts';
import type { OfficialQuotaUsage } from './fisRules.ts';
import type { Athlete, RoomBooking } from '../types.ts';

const person=(extra:Partial<Athlete>={})=>({id:'1',firstname:'One',lastname:'Person',nationCode:'AUS',function:'Athlete',single_room_status:'NONE',...extra} as Athlete);
const approvedPerson=(extra:Partial<Athlete>={})=>person({gender:'M',single_room_status:'APPROVED_EXTRA',competitions:[{quotaDiscipline:'Ski Cross'}] as Athlete['competitions'],approvedQuotaContexts:[{nationCode:'AUS',discipline:'Ski Cross',gender:'M'}],...extra});
const booking=(athlete:Athlete,id='booking',countsAsSingle=true):RoomBooking=>({id,countsAsSingle,hotel:{id:'hotel',name:'Hotel',accommodationType:'STANDARD'},roomType:{id:'double',name:'DZ',maxPersons:2},roomNumber:id,checkInDate:'2027-03-14',checkOutDate:'2027-03-20',occupants:[{athlete}]} as unknown as RoomBooking);
const quotaUsage=(people:Athlete[]):OfficialQuotaUsage=>({nationCode:'AUS',discipline:'Ski Cross',gender:'M',singleRoomsAllowed:0,singleRoomAllocations:people.map(athlete=>({personId:athlete.id,status:athlete.singleRoomQuotaExemptReason?'EXEMPT':'APPROVED_EXTRA',context:['AUS','Ski Cross','M']}))} as OfficialQuotaUsage);
test('SPECIAL shows Ja in the shared overview/export rows without single-room approval',()=>{
 const p=person({accommodationRateCategory:'SPECIAL'});const before=structuredClone(p);
 assert.equal(createListRows([p],[])[0].surcharge,'Ja');
 assert.equal(createListRows([p],[])[0].specialRateSurcharge,'Ja');
 assert.equal(createListRows([p],[])[0].approvedExtraSingleSurcharge,'Nein');
 assert.deepEqual(accommodationSurcharge(p),{applicable:true,hasAccommodationSurcharge:true,surchargeReasons:['SPECIAL_RATE']});
 assert.deepEqual(p,before);assert.equal(p.single_room_status,'NONE');
});
test('current APPROVED_EXTRA context and countsAsSingle activate the list surcharge',()=>{
 const active=approvedPerson();const room=booking(active);const usage=[quotaUsage([active])];
 const row=createListRows([active],[room],[],usage)[0];
 assert.equal(row.surcharge,'Ja');assert.equal(row.approvedExtraSingleSurcharge,'Ja');
 assert.deepEqual(row.segments.map(segment=>segment.approvedExtraSingleSurcharge),['Ja']);
 assert.deepEqual(accommodationSurcharge(active,true).surchargeReasons,['APPROVED_EXTRA_SINGLE']);
 const dispositionIds=new Set(evaluateAllQuotaGroups(usage,quotaAssignmentsFromBookings([room])).flatMap(group=>group.people.filter(entry=>entry.additionalCost).map(entry=>entry.personId)));
 assert.equal(dispositionIds.has(active.id),row.approvedExtraSingleSurcharge==='Ja');
});
test('historical approval without current context and non-single use stay inactive',()=>{
 const historical=approvedPerson({approvedQuotaContexts:[]});
 const historicalRow=createListRows([historical],[booking(historical)],[],[quotaUsage([historical])])[0];
 assert.equal(historicalRow.singleRoomSpecialStatus,'Mehrpreis genehmigt');
 assert.equal(historicalRow.approvedExtraSingleSurcharge,'Nein');assert.equal(historicalRow.surcharge,'Nein');
 const double=approvedPerson({id:'double'});
 const doubleRow=createListRows([double],[booking(double,'double-booking',false)],[],[quotaUsage([double])])[0];
 assert.equal(doubleRow.approvedExtraSingleSurcharge,'Nein');assert.equal(doubleRow.surcharge,'Nein');
});
test('STANDARD without approval remains Nein, including absent metadata',()=>{
 assert.equal(createListRows([person({accommodationRateCategory:'STANDARD'})],[])[0].surcharge,'Nein');
 assert.equal(createListRows([person()],[])[0].surcharge,'Nein');
 assert.deepEqual(accommodationSurcharge(null),{applicable:true,hasAccommodationSurcharge:false,surchargeReasons:[]});
});
test('both reasons remain separately represented without changing approval state',()=>{
 const p=approvedPerson({accommodationRateCategory:'SPECIAL'});
 const row=createListRows([p],[booking(p)],[],[quotaUsage([p])])[0];
 assert.deepEqual(accommodationSurcharge(p,true).surchargeReasons,['SPECIAL_RATE','APPROVED_EXTRA_SINGLE']);
 assert.equal(row.specialRateSurcharge,'Ja');assert.equal(row.approvedExtraSingleSurcharge,'Ja');assert.equal(row.surcharge,'Ja');
 assert.equal(p.single_room_status,'APPROVED_EXTRA');
});

test('quota exemptions and NO_ROOM never activate an accommodation surcharge',()=>{
 for(const reason of ['WORLD_CHAMPION','OTHER'] as const){
  const p=approvedPerson({id:reason,singleRoomQuotaExemptReason:reason});
  const row=createListRows([p],[booking(p,reason)],[],[quotaUsage([p])])[0];
  assert.equal(row.approvedExtraSingleSurcharge,'Nein');assert.equal(row.surcharge,'Nein');
 }
 const noRoom=approvedPerson({id:'no-room',accommodationRequirement:'NO_ROOM',accommodationRateCategory:'SPECIAL'});
 const row=createListRows([noRoom],[booking(noRoom,'no-room')],[],[quotaUsage([noRoom])])[0];
 assert.equal(row.surcharge,'—');assert.equal(row.specialRateSurcharge,'—');assert.equal(row.approvedExtraSingleSurcharge,'—');
});

test('multiple memberships and booking segments produce one person summary and segment-specific surcharge',()=>{
 const p=approvedPerson({competitions:[{quotaDiscipline:'Ski Cross'},{quotaDiscipline:'Ski Cross'}] as Athlete['competitions']});
 const rooms=[booking(p,'single',true),booking(p,'double',false)];
 const usage=[quotaUsage([p])];
 const row=createListRows([p],rooms,[],usage)[0];
 assert.equal(evaluateAllQuotaGroups(usage,quotaAssignmentsFromBookings(rooms)).flatMap(group=>group.people).length,1);
 assert.equal(row.approvedExtraSingleSurcharge,'Ja');assert.equal(row.surcharge,'Ja');
 assert.deepEqual(row.segments.map(segment=>[segment.bookingId,segment.countsAsSingle,segment.approvedExtraSingleSurcharge,segment.surcharge]),[
  ['double',false,'Nein','Nein'],['single',true,'Ja','Ja'],
 ]);
});
