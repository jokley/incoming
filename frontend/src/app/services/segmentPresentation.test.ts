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
const {DispositionQueueCard}=await server.ssrLoadModule('/src/app/components/assignment/DispositionQueueCard.tsx');
const {SplitPreview}=await server.ssrLoadModule('/src/app/components/assignment/SplitAssignmentDialog.tsx');
const {ExternalStayPreview}=await server.ssrLoadModule('/src/app/components/assignment/ExternalStayDialog.tsx');
await server.close();

const span=(start:number,end:number)=>({checkInDate:`2027-03-${start}`,checkOutDate:`2027-03-${end}`});
const segment=(id:string,start:number,end:number,hotel:string)=>({bookingId:id,...span(start,end),hotelId:id,
  hotelName:hotel,roomTypeId:'double',roomTypeName:'Double',roomNumber:'Zimmer 01',countsAsSingle:false,conflictCodes:[]});
const value=(extra:Partial<AccommodationCoverage>={}):AccommodationCoverage=>({overallInterval:span(14,27),
  segments:[],coveredIntervals:[],openIntervals:[span(14,27)],conflicts:[],coverageStatus:'UNASSIGNED',...extra});
function render(coverage:AccommodationCoverage) {
  const person={athleteId:'1',name:'One Person',accommodationCoverage:coverage} as RoomBookingUnitOccupant;
  return renderToStaticMarkup(createElement(PersonAccommodationPanel,{people:[person],hotels:[],canEdit:true,onChanged:async()=>{},onShowDisposition:()=>{},onSplit:()=>{}}));
}

test('unassigned full stay and each middle-booking gap have actionable controls',()=>{
  assert.match(render(value()),/Nicht zugewiesen/);
  const html=render(value({coverageStatus:'PARTIALLY_ASSIGNED',segments:[segment('1',18,22,'Hotel A')],openIntervals:[span(14,18),span(22,27)]}));
  assert.match(html,/Teilweise zugewiesen/);
  assert.equal((html.match(/>In Disposition anzeigen</g) ?? []).length,2);
  assert.match(html,/14.03–18.03/); assert.match(html,/22.03–27.03/);
  assert.match(html,/Hotel A/);
});
test('updated backend responses render multiple segments, edits, removals and restored gaps',()=>{
  const complete=value({coverageStatus:'FULLY_ASSIGNED',segments:[segment('1',14,20,'Hotel A'),segment('2',20,27,'Hotel B')],openIntervals:[]});
  const html=render(complete);
  assert.match(html,/Zugewiesen/); assert.match(html,/Hotel A/); assert.match(html,/Hotel B/);
  assert.equal((html.match(/>In Disposition anzeigen</g) ?? []).length,0);
  const edited=render({...complete,coverageStatus:'PARTIALLY_ASSIGNED',segments:[segment('1',14,19,'Hotel A'),complete.segments[1]],openIntervals:[span(19,20)]});
  assert.match(edited,/19.03–20.03/);
  const removed=render({...complete,coverageStatus:'PARTIALLY_ASSIGNED',segments:[complete.segments[0]],openIntervals:[span(20,27)]});
  assert.doesNotMatch(removed,/Hotel B/); assert.match(removed,/20.03–27.03/);
});
test('conflict is visible, add/edit disabled, removal remains available',()=>{
  const html=render(value({coverageStatus:'CONFLICT',segments:[segment('1',14,20,'Hotel A')],conflicts:[{code:'BOOKING_OVERLAP',bookingIds:['1','2']}]}));
  assert.match(html,/Prüfen/); assert.match(html,/Klärung gesperrt/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Bearbeiten</);
  assert.match(html,/<button[^>]*disabled=""[^>]*>In Disposition anzeigen</);
  assert.doesNotMatch(html.match(/<button[^>]*>Entfernen</)?.[0] ?? 'missing',/\sdisabled(?:=|\s|>)/);
});

test('split action belongs only to assigned periods and no activation controls remain',()=>{
  assert.doesNotMatch(render(value()),/>Zuweisung teilen</);
  const html=render(value({coverageStatus:'PARTIALLY_ASSIGNED',segments:[segment('1',14,20,'Hotel A')]}));
  assert.match(html,/>Bearbeiten</);assert.match(html,/>Zuweisung teilen</);assert.match(html,/>Entfernen</);
  assert.doesNotMatch(html,/AKTIVE ZUWEISUNG|Neue Zuweisung/);
});
test('queue cards expose their dates and direct destination actions',()=>{
  const unit={unitId:'need:1',occupants:[{athleteId:'1',name:'One Person',firstname:'One'}],openPeriod:span(20,27),previous:['14.03–20.03 · Adler'],canAssign:true};
  const html=renderToStaticMarkup(createElement(DispositionQueueCard,{unit,hotelName:'Taube',selected:false,canEditAssignments:true,pending:false,onSelect:()=>{},onDragStart:()=>{},onDragEnd:()=>{},onQuickAssign:()=>{}}));
  assert.match(html,/20.03–27.03/);assert.match(html,/draggable="true"/);assert.match(html,/Person hier zuweisen/);assert.match(html,/Ziel: Taube/);
  assert.doesNotMatch(html,/AKTIVE|Rest zuweisen/);
});
test('split preview displays canonical merged gap and unchanged occupant continuation',()=>{
  const plan={booking:{hotel:{name:'Adler'}},retainedSegments:[{bookingId:'1',...span(14,20),athleteIds:['1','2']},{bookingId:'-1',...span(20,22),athleteIds:['2']}],people:[
    {personId:'1',name:'Nicholas',selected:true,affectedOpenIntervals:[span(20,27)],accommodationCoverage:value()},
    {personId:'2',name:'Justin',selected:false,affectedOpenIntervals:[],accommodationCoverage:value()},
  ]};
  const html=renderToStaticMarkup(createElement(SplitPreview,{plan}));
  assert.match(html,/Bestehender Teil/);assert.match(html,/20.03–27.03/);assert.match(html,/20.03–22.03/);assert.match(html,/durchgehend erhalten/);
  assert.doesNotMatch(html,/Hotel auswählen|Kontingent|Quote/);
});

test('queue hierarchy separates pair identities, primary pair action and quiet split entry',()=>{
  const unit={unitId:'need:1,2',occupants:[{athleteId:'1',name:'James JOHNSTONE',firstname:'James'},{athleteId:'2',name:'William MCCARTHY',firstname:'William'}],openPeriod:span(20,27),previous:['14.03–20.03 · Adler'],canAssign:true};
  const props={unit,hotelName:'Taube',selected:false,canEditAssignments:true,pending:false,onSelect:()=>{},onDragStart:()=>{},onDragEnd:()=>{},onQuickAssign:()=>{},onSplit:()=>{}};
  const html=renderToStaticMarkup(createElement(DispositionQueueCard,{...props,splitOptions:[{bookingId:'1',label:'14.03–20.03 · Adler'}]}));
  assert.match(html,/James JOHNSTONE/);assert.match(html,/William MCCARTHY/);
  assert.match(html,/Beide hier zuweisen/);assert.match(html,/James hier zuweisen/);assert.match(html,/William hier zuweisen/);
  assert.match(html,/Bisher:/);assert.match(html,/14.03–20.03 · Adler/);
  assert.match(html,/Zuweisung teilen<\/button>/);assert.match(html,/title="14.03–20.03 · Adler"/);
  assert.doesNotMatch(html,/AKTIVE ZUWEISUNG|activeTarget/);
  const open=renderToStaticMarkup(createElement(DispositionQueueCard,{...props,splitOptions:[]}));
  assert.doesNotMatch(open,/>Zuweisung teilen</);
  const conflict=renderToStaticMarkup(createElement(DispositionQueueCard,{...props,unit:{...unit,canAssign:false},splitOptions:[{bookingId:'1',label:'Adler'}]}));
  assert.match(conflict,/Prüfen/);assert.doesNotMatch(conflict,/>Zuweisung teilen</);
});

test('queue split entry stays hidden for read-only operators',()=>{
  const unit={unitId:'need:1',occupants:[{athleteId:'1',name:'One Person',firstname:'One'}],openPeriod:span(20,27),previous:['14.03–20.03 · Adler'],canAssign:true};
  const html=renderToStaticMarkup(createElement(DispositionQueueCard,{unit,selected:false,canEditAssignments:false,pending:false,onSelect:()=>{},onDragStart:()=>{},onDragEnd:()=>{},onQuickAssign:()=>{},onSplit:()=>{},splitOptions:[{bookingId:'1',label:'Adler'}]}));
  assert.doesNotMatch(html,/Zuweisung teilen/);
});


test('external preview renders canonical middle gaps and compact external history',()=>{
  const coverage=value({coverageStatus:'PARTIALLY_ASSIGNED',segments:[{...segment('10',18,22,'Kühtai'),roomTypeId:null,roomTypeName:null,roomNumber:null,accommodationType:'EXTERNAL'}],openIntervals:[span(14,18),span(22,27)]});
  const html=renderToStaticMarkup(createElement(ExternalStayPreview,{plan:{hotelName:'Kühtai',...span(18,22),people:[{personId:'1',name:'One Person',accommodationCoverage:coverage}]}}));
  assert.match(html,/Extern zugewiesen/);assert.match(html,/18.03–22.03/);assert.match(html,/14.03–18.03/);assert.match(html,/22.03–27.03/);
  assert.match(render(coverage),/Kühtai · Extern/);
});
test('open queue exposes Aufenthalt teilen without an existing booking',()=>{
  const unit={unitId:'need:1',occupants:[{athleteId:'1',name:'One Person',firstname:'One'}],openPeriod:span(14,27),previous:[],canAssign:true};
  const props={unit,selected:false,canEditAssignments:true,pending:false,onSelect:()=>{},onDragStart:()=>{},onDragEnd:()=>{},onQuickAssign:()=>{},onExternal:()=>{}};
  const html=renderToStaticMarkup(createElement(DispositionQueueCard,props));
  assert.match(html,/Aufenthalt teilen/);assert.doesNotMatch(html,/Zuweisung teilen/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(DispositionQueueCard,{...props,canEditAssignments:false})),/Aufenthalt teilen/);
});
