import test from 'node:test';
import assert from 'node:assert/strict';
import type { Athlete, AccommodationCoverage } from '../types.ts';
import { personAccommodation } from './personAccommodation.ts';
const segment=(id:string,hotel:string)=>({bookingId:id,hotelId:id,hotelName:hotel,roomTypeName:'DZ / DU',roomTypeId:'2',roomNumber:'Zimmer 01',checkInDate:'2027-03-14',checkOutDate:'2027-03-20',countsAsSingle:false,conflictCodes:[]});
const athlete=(status:AccommodationCoverage['coverageStatus'],segments:AccommodationCoverage['segments']=[]):Athlete=>({id:'1',accommodationCoverage:{coverageStatus:status,segments,overallInterval:{checkInDate:'2027-03-14',checkOutDate:'2027-03-27'},openIntervals:[],conflicts:[],coveredIntervals:[]}} as unknown as Athlete);
test('one person has compact single/multiple segment labels and complete tooltip',()=>{
  const value=athlete('FULLY_ASSIGNED',[segment('1','Adler'),segment('2','Silvretta')]);
  assert.equal(personAccommodation(value).hotelLabel,'Adler · Silvretta');
  assert.equal(personAccommodation(value).roomLabel,'2 Segmente');
  assert.match(personAccommodation(value).details,/Zimmer 01/);
  assert.equal(personAccommodation(value).segments.length,2);
  assert.equal(value.id,'1');
  assert.equal(personAccommodation(athlete('FULLY_ASSIGNED',[segment('1','Adler')])).roomLabel,'DZ / DU');
  assert.equal(personAccommodation(athlete('FULLY_ASSIGNED',[segment('1','Adler'),segment('2','Adler')])).hotelLabel,'Adler');
});
test('four canonical statuses supersede legacy has-any-booking and preserve fallback',()=>{
  for(const [status,label,tone] of [['UNASSIGNED','Nicht zugewiesen','neutral'],['PARTIALLY_ASSIGNED','Teilweise zugewiesen','warning'],['FULLY_ASSIGNED','Zugewiesen','success'],['CONFLICT','Aufenthalt prüfen / Konflikt','warning']] as const) {
    const value=athlete(status);value.assignment={hasAssignment:true} as Athlete['assignment'];
    assert.equal(personAccommodation(value).label,label);assert.equal(personAccommodation(value).tone,tone);
  }
  assert.equal(personAccommodation({assignment:{hasAssignment:true,hotelName:'Legacy'}} as Athlete).hotelLabel,'Legacy');
});
