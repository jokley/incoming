import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { AccommodationCoverage, RoomBookingUnitOccupant } from '../types.ts';

// Load TSX with the project's existing Vite toolchain; no browser/server port.
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},
  optimizeDeps:{noDiscovery:true,entries:[],include:[]},appType:'custom'});
const {PersonAccommodationPanel}=await server.ssrLoadModule('/src/app/components/assignment/PersonAccommodationPanel.tsx');
await server.close();

const span=(start:number,end:number)=>({checkInDate:`2027-03-${start}`,checkOutDate:`2027-03-${end}`});
const segment=(id:string,start:number,end:number,hotel:string)=>({bookingId:id,...span(start,end),hotelId:id,
  hotelName:hotel,roomTypeId:'double',roomTypeName:'Double',roomNumber:'Zimmer 01',countsAsSingle:false,conflictCodes:[]});
const value=(extra:Partial<AccommodationCoverage>={}):AccommodationCoverage=>({overallInterval:span(14,27),
  segments:[],coveredIntervals:[],openIntervals:[span(14,27)],conflicts:[],coverageStatus:'UNASSIGNED',...extra});
function render(coverage:AccommodationCoverage) {
  const person={athleteId:'1',name:'One Person',accommodationCoverage:coverage} as RoomBookingUnitOccupant;
  return renderToStaticMarkup(createElement(PersonAccommodationPanel,{people:[person],hotels:[],canEdit:true,onChanged:async()=>{}}));
}

test('unassigned full stay and each middle-booking gap have actionable controls',()=>{
  assert.match(render(value()),/Nicht zugewiesen/);
  const html=render(value({coverageStatus:'PARTIALLY_ASSIGNED',segments:[segment('1',18,22,'Hotel A')],openIntervals:[span(14,18),span(22,27)]}));
  assert.match(html,/Teilweise zugewiesen/);
  assert.equal((html.match(/>Neue Zuweisung</g) ?? []).length,2);
  assert.match(html,/14.03–18.03/); assert.match(html,/22.03–27.03/);
  assert.match(html,/Hotel A/);
});
test('updated backend responses render multiple segments, edits, removals and restored gaps',()=>{
  const complete=value({coverageStatus:'FULLY_ASSIGNED',segments:[segment('1',14,20,'Hotel A'),segment('2',20,27,'Hotel B')],openIntervals:[]});
  const html=render(complete);
  assert.match(html,/Vollständig zugewiesen/); assert.match(html,/Hotel A/); assert.match(html,/Hotel B/);
  assert.equal((html.match(/>Neue Zuweisung</g) ?? []).length,0);
  const edited=render({...complete,coverageStatus:'PARTIALLY_ASSIGNED',segments:[segment('1',14,19,'Hotel A'),complete.segments[1]],openIntervals:[span(19,20)]});
  assert.match(edited,/19.03–20.03/);
  const removed=render({...complete,coverageStatus:'PARTIALLY_ASSIGNED',segments:[complete.segments[0]],openIntervals:[span(20,27)]});
  assert.doesNotMatch(removed,/Hotel B/); assert.match(removed,/20.03–27.03/);
});
test('conflict is visible, add/edit disabled, removal remains available',()=>{
  const html=render(value({coverageStatus:'CONFLICT',segments:[segment('1',14,20,'Hotel A')],conflicts:[{code:'BOOKING_OVERLAP',bookingIds:['1','2']}]}));
  assert.match(html,/Aufenthalt prüfen/); assert.match(html,/BOOKING_OVERLAP/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Bearbeiten</);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Neue Zuweisung</);
  assert.doesNotMatch(html.match(/<button[^>]*>Entfernen</)?.[0] ?? 'missing',/\sdisabled(?:=|\s|>)/);
});
