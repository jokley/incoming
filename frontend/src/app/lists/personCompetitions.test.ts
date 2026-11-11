import assert from 'node:assert/strict';
import test from 'node:test';
import {createListRows, groupListRows, filterListRows, type ListFilters} from './listEngine.ts';
import {exportExcel} from './listExports.ts';
import type {Athlete, RoomBooking} from '../types.ts';

test('person list adds true competition labels without changing canonical filter and export discipline',()=>{
 const person={id:'1',firstname:'Synthetic',lastname:'Person',nationCode:'ITA',single_room_status:'NONE',quotaDisciplines:['Freestyle'],
  discipline:'Legacy',disciplines:["Men's Moguls","Men's Dual Moguls"],competitions:[{name:"Men's Moguls"},{name:"Men's Dual Moguls"},{name:"Men's Moguls"}]} as Athlete;
 const [row,official]=createListRows([person,{...person,id:'2',function:'NSA Coach',disciplines:[],competitions:[]}],[]);
 assert.equal(row.eventGroups,'Freestyle');assert.equal(row.competitionNames,'Moguls · Dual Moguls');
 assert.equal(row.discipline,'Moguls • Dual Moguls');
 assert.equal(official.eventGroups,'Freestyle');assert.equal(official.competitionNames,'');
});

const guest={id:'guest',firstname:'One',lastname:'Guest',nationCode:'AUT',accommodationCoverage:{coverageStatus:'FULLY_ASSIGNED',segments:[],openIntervals:[],conflicts:[]}} as unknown as Athlete;
const booking=(id:string,hotel:string,start:string,single:boolean):RoomBooking=>({id,hotel:{id:hotel,name:hotel,accommodationType:hotel==='Extern'?'EXTERNAL':'STANDARD'},roomType:hotel==='Extern'?null:{id:'dz',name:'DZ',maxPersons:2},roomNumber:id,checkInDate:start,checkOutDate:'2027-03-20',countsAsSingle:single,occupants:[{athlete:guest}]} as unknown as RoomBooking);
test('person rows retain ordered segments, independent single-use flags and person coverage',()=>{
 const [row]=createListRows([guest],[booking('b','Hotel B','2027-03-15',false),booking('a','Hotel A','2027-03-10',true)]);
 assert.equal(row.id,guest.id);assert.equal(row.accommodationStatus,'Zugewiesen');
 assert.deepEqual(row.segments.map(s=>[s.bookingId,s.hotel,s.arrival,s.departure,s.roomType,s.countsAsSingle]),[
  ['a','Hotel A','2027-03-10','2027-03-20','DZ',true],['b','Hotel B','2027-03-15','2027-03-20','DZ',false],
 ]);
 assert.equal(createListRows([guest],[]).length,1);
 assert.deepEqual(createListRows([{...guest,accommodationRequirement:'NO_ROOM'}],[])[0].segments,[]);
 const external=createListRows([guest],[booking('e','Extern','2027-03-10',false)])[0];
 assert.equal(external.segments[0].room,'Extern');assert.equal(external.segments[0].roomType,'Extern');
});
test('hotel groups project the correct bookings and count distinct people',()=>{
 const rows=createListRows([guest],[booking('b','Hotel B','2027-03-15',false),booking('a','Hotel A','2027-03-10',true),booking('c','Hotel A','2027-03-17',false)]);
 const groups=groupListRows(rows,'hotels');
 assert.deepEqual(groups.map(g=>[g.label,g.count,g.rows.map(r=>r.bookingId)]),[['Hotel A',1,['a','c']],['Hotel B',1,['b']]]);
 assert.deepEqual(groups.flatMap(g=>g.rows).map(r=>r.segments.length),[1,1,1]);
 assert.equal(groupListRows(rows,'nations')[0].rows.length,1);
});

test('segment order is independent of API order, including date and hotel ties',()=>{
 const input=[booking('z','Hotel B','2027-03-10',false),booking('b','Hotel A','2027-03-10',true),booking('a','Hotel A','2027-03-10',false)];
 const before=JSON.stringify(input);
 assert.deepEqual(createListRows([guest],input)[0].segments.map(s=>s.bookingId),['a','b','z']);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(createListRows([guest],[...input].reverse())[0].segments,createListRows([guest],input)[0].segments);
});

test('hotel and text filters find later segments and retain the complete person timeline',()=>{
 const rows=createListRows([guest],[booking('a','Hotel A','2027-03-10',false),booking('b','Hotel B','2027-03-15',true)]);
 const filters:ListFilters={search:'',athleteRemark:'',internalNote:'',selection:'',discipline:'',nation:'',role:'',hotel:'Hotel B',status:'',hint:'',movement:'',period:'',assignedOnly:false};
 assert.equal(filterListRows(rows,'none',filters)[0].segments.length,2);
 assert.deepEqual(filterListRows(rows,'hotels',filters).map(row=>row.bookingId),['b']);
 assert.equal(filterListRows(rows,'none',{...filters,hotel:'',search:'Hotel B'})[0].segments.length,2);
 assert.equal(filterListRows(rows,'none',{...filters,hotel:'',hint:'single-room'}).length,1);
 const today=new Date().toISOString().slice(0,10);
 const current=createListRows([guest],[booking('a','Hotel A','2020-01-01',false),booking('b','Hotel B',today,true)]);
 assert.equal(filterListRows(current,'none',{...filters,hotel:'',movement:'arrival',period:'today'})[0].segments.length,2);
 assert.deepEqual(filterListRows(current,'hotels',{...filters,hotel:'',movement:'arrival',period:'today'}).map(row=>row.bookingId),['b']);
});

test('Excel retains all segment values in one person row or separate hotel rows',async()=>{
 const rows=createListRows([guest],[booking('b','Hotel B','2027-03-15',false),booking('a','Hotel A','2027-03-10',true)]);
 const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const originalCreate=URL.createObjectURL;
 const originalTimeout=globalThis.setTimeout;
 let blob:Blob|undefined;
 try {
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({click(){}})}});
  URL.createObjectURL=(value)=>{blob=value as Blob;return 'blob:test';};
  globalThis.setTimeout=(()=>0) as unknown as typeof setTimeout;
  exportExcel(rows,'nations');
  const personXml=await blob!.text();
  assert.match(personXml,/Hotel A\nHotel B/);assert.match(personXml,/2027-03-10\n2027-03-15/);
  assert.match(personXml,/DZ a\nDZ b/);assert.match(personXml,/DZ\nDZ/);
  assert.match(personXml,/2027-03-20\n2027-03-20/);assert.match(personXml,/Ja\nNein/);
  assert.equal((personXml.match(/<row r=/g)||[]).length,2);
  exportExcel(rows,'hotels');
  const hotelXml=await blob!.text();
  assert.equal((hotelXml.match(/<row r=/g)||[]).length,3);
  assert.match(hotelXml,/Hotel A/);assert.match(hotelXml,/Hotel B/);
 } finally {
  if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');
  URL.createObjectURL=originalCreate;globalThis.setTimeout=originalTimeout;
 }
});

test('Excel contains separate special-rate and approved-extra surcharge columns with segment values',async()=>{
 const approved={...guest,gender:'M',single_room_status:'APPROVED_EXTRA',accommodationRateCategory:'SPECIAL',competitions:[{quotaDiscipline:'Ski Cross'}],approvedQuotaContexts:[{nationCode:'AUT',discipline:'Ski Cross',gender:'M'}]} as unknown as Athlete;
 const rooms=[booking('single','Hotel B','2027-03-15',true),booking('double','Hotel A','2027-03-10',false)].map(room=>({...room,occupants:[{athlete:approved}]})) as RoomBooking[];
 const quota=[{nationCode:'AUT',discipline:'Ski Cross',gender:'M',singleRoomsAllowed:0,singleRoomAllocations:[{personId:approved.id,status:'APPROVED_EXTRA',context:['AUT','Ski Cross','M']}]}] as never;
 const rows=createListRows([approved],rooms,[],quota);
 const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');const originalCreate=URL.createObjectURL;const originalTimeout=globalThis.setTimeout;let blob:Blob|undefined;
 try{
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({click(){}})}});URL.createObjectURL=(value)=>{blob=value as Blob;return 'blob:test';};globalThis.setTimeout=(()=>0) as unknown as typeof setTimeout;
  exportExcel(rows,'nations');const xml=await blob!.text();
  assert.match(xml,/Sondertarif/);assert.match(xml,/Genehmigtes zusätzliches EZ/);assert.match(xml,/Nein\nJa/);assert.match(xml,/<c r="AA"/);
  exportExcel(rows,'hotels');const hotelXml=await blob!.text();assert.match(hotelXml,/Genehmigtes zusätzliches EZ/);assert.match(hotelXml,/Hotel A/);assert.match(hotelXml,/Hotel B/);
 }finally{if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');URL.createObjectURL=originalCreate;globalThis.setTimeout=originalTimeout;}
});
