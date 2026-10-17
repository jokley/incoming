import test from 'node:test';
import assert from 'node:assert/strict';
import {compareHotelFit,matchesHotelFit,queueDemandSummary,hotelFitLabel,type HotelFit} from './assignmentSuitability.ts';
import type {DispositionItem} from './dispositionItems.ts';
const fit=(state:HotelFit['state'],alreadyUsed=false):HotelFit=>({state,alreadyUsed,count:1,total:2,conservative:state==='FIT_PARTIAL'});
test('fit filters and sorting keep already-used independent of capacity',()=>{
 assert.equal(matchesHotelFit(fit('NO_FIT',true),'used'),true);
 assert.equal(matchesHotelFit(fit('FIT_PARTIAL'),'fit'),false);
 assert.equal(matchesHotelFit(fit('FIT_ALL'),'fit'),true);
 assert.equal(matchesHotelFit(undefined,'all'),true);
 assert.ok(compareHotelFit(fit('FIT_ALL'),fit('FIT_PARTIAL'))<0);
 assert.ok(compareHotelFit(fit('FIT_PARTIAL'),fit('NO_FIT'))<0);
});
test('summary counts distinct open people, raw UI types, excludes NO_ROOM',()=>{
 const person=(athleteId:string,fn:string,accommodationRequirement='REQUIRED')=>({athleteId,function:fn,accommodationRequirement});
 const item=(occupants:unknown[],roomCategoryLabel='dz')=>({canAssign:true,occupants,roomCategoryLabel,checkInDate:'2027-03-03',checkOutDate:'2027-03-14'}) as DispositionItem;
 const items=[item([person('1','Athlete')],'ez'),item([person('1','Athlete')],'ez'),item([person('2','NSA Guest'),person('3','NSA Technician'),person('4','Athlete','NO_ROOM')])];
 assert.deepEqual(queueDemandSummary(items),{people:3,athletes:1,officials:2,ez:1,dz:2,start:'2027-03-03',end:'2027-03-14'});
 assert.equal(queueDemandSummary(items.slice(0,1)).people,1);
});
test('partial feasibility is honestly labelled as a lower bound',()=>{
 assert.match(hotelFitLabel(fit('FIT_PARTIAL')),/mind\. 1 \/ 2/);
 assert.match(hotelFitLabel(fit('FIT_ALL')),/Passt komplett/);
});
