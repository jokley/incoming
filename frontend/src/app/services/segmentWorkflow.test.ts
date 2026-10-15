import test from 'node:test';
import assert from 'node:assert/strict';
import type { AccommodationCoverage, RoomBookingUnit } from '../types.ts';
import { accommodationView, segmentDateDefaults, datesWithinInterval, unitCoverageComplete } from './segmentWorkflow.ts';

const interval=(start:number,end:number)=>({checkInDate:`2027-03-${start}`,checkOutDate:`2027-03-${end}`});
const coverage=(value:Partial<AccommodationCoverage>={}):AccommodationCoverage=>({overallInterval:interval(14,27),segments:[],coveredIntervals:[],openIntervals:[interval(14,27)],conflicts:[],coverageStatus:'UNASSIGNED',...value});
const unit=(value:AccommodationCoverage):RoomBookingUnit=>({checkInDate:'2027-03-14',checkOutDate:'2027-03-27',isFullyAssigned:true,occupants:[{athleteId:'1',accommodationCoverage:value}]} as RoomBookingUnit);

test('normal full-stay defaults and drag/drop remain available for unassigned people',()=>{
  const value=coverage();
  assert.deepEqual(segmentDateDefaults(value.openIntervals[0]),interval(14,27));
  assert.equal(unitCoverageComplete(unit(value)),false);
});
test('backend partial and middle-stay responses expose every gap without frontend subtraction',()=>{
  const value=coverage({coverageStatus:'PARTIALLY_ASSIGNED',openIntervals:[interval(14,18),interval(22,27)]});
  const view=accommodationView(value);
  assert.equal(view.label,'Teilweise zugewiesen');
  assert.equal(view.openIntervals,value.openIntervals);
  assert.deepEqual(segmentDateDefaults(view.openIntervals[0]),interval(14,18));
  assert.deepEqual(segmentDateDefaults(view.openIntervals[1]),interval(22,27));
  assert.equal(view.canAdd,true);
});
test('dates can be shortened or shifted only within selected backend interval',()=>{
  assert.equal(datesWithinInterval('2027-03-18','2027-03-22',interval(14,27)),true);
  assert.equal(datesWithinInterval('2027-03-13','2027-03-22',interval(14,27)),false);
  assert.equal(datesWithinInterval('2027-03-18','2027-03-28',interval(14,27)),false);
  assert.equal(datesWithinInterval('2027-03-20','2027-03-20',interval(14,27)),false);
});
test('mutation refreshes use new segments, gaps and status exactly as returned',()=>{
  const first=coverage({coverageStatus:'PARTIALLY_ASSIGNED',openIntervals:[interval(20,27)]});
  const complete=coverage({coverageStatus:'FULLY_ASSIGNED',openIntervals:[],segments:[{bookingId:'1',...interval(14,20)},{bookingId:'2',...interval(20,27)}] as AccommodationCoverage['segments']});
  assert.equal(accommodationView(complete).segments,complete.segments);
  assert.equal(accommodationView(complete).label,'Zugewiesen');
  assert.equal(unitCoverageComplete(unit(complete)),true);
  assert.equal(accommodationView(first).openIntervals,first.openIntervals); // Remove/shorten response restores work.
  assert.equal(unitCoverageComplete(unit(first)),false);
});
test('conflicts remain visible and prevent ambiguous additions',()=>{
  const value=coverage({coverageStatus:'CONFLICT',conflicts:[{code:'BOOKING_OVERLAP',bookingIds:['1','2']}]});
  assert.equal(accommodationView(value).label,'Prüfen');
  assert.equal(accommodationView(value).conflicts,value.conflicts);
  assert.equal(accommodationView(value).canAdd,false);
  assert.equal(unitCoverageComplete(unit(value)),false);
});
