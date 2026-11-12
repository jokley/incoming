import assert from 'node:assert/strict';
import test from 'node:test';
import { createHotelContactRows, summarizeHotelContactRows } from './listEngine.ts';
import type { Athlete, Hotel, RoomBooking } from '../types.ts';

test('hotel summary counts period bookings and contract sums without adding hotel peaks', () => {
  assert.deepEqual(summarizeHotelContactRows([]), {bookings:0,rooms:0,beds:0});
  const rows=[{assignedBookings:3,totalRooms:2,totalBeds:4},{assignedBookings:2,totalRooms:1,totalBeds:2}];
  assert.deepEqual(summarizeHotelContactRows(rows),{bookings:5,rooms:3,beds:6});
  assert.deepEqual(summarizeHotelContactRows(rows.slice(1)),{bookings:2,rooms:1,beds:2});
});

import { createContingentRows } from './listEngine.ts';
import { hotelCapacityOnDay, buildHotelRiskRows, buildCapacityTimeline } from '../services/planningCalculations.ts';
import { exportHotelOverviewExcel, exportContingentsExcel } from './listExports.ts';

const double = { id: 'dz', name: 'DZ', maxPersons: 2 };
const capacityHotel: Hotel = { id: 'a', name: 'Hotel A', roomInventories: [{
  id: 'inv', hotelId: 'a', roomType: double, roomCount: 1,
  availableFrom: '2027-03-11', availableUntil: '2027-03-23',
}] };
const reservation = (id: string, person: string, from: string, until: string, single = false, hotel = capacityHotel): RoomBooking => ({
  id, hotel, roomType: double, roomNumber: 'Zimmer 1', checkInDate: from, checkOutDate: until,
  countsAsSingle: single, occupants: [{ id: person, roomBookingId: id,
    athlete: { id: person, firstname: person, lastname: 'Guest', nationCode: 'AUT', single_room_status: 'NONE' } }],
});

test('daily capacity counts actual intervals, overlap and exclusive checkout', () => {
  const bookings = [reservation('1', 'one', '2027-03-11', '2027-03-16'), reservation('2', 'two', '2027-03-16', '2027-03-23')];
  for (const day of ['2027-03-11', '2027-03-15', '2027-03-16', '2027-03-22']) {
    const row = hotelCapacityOnDay(capacityHotel, bookings, day);
    assert.equal(row.occupiedRooms, 1); assert.equal(row.occupiedBeds, 1); assert.equal(row.freeBeds, 1);
  }
  assert.equal(hotelCapacityOnDay(capacityHotel, bookings, '2027-03-23').occupiedRooms, 0);
  assert.equal(hotelCapacityOnDay(capacityHotel, [...bookings, reservation('3','three','2027-03-15','2027-03-17')], '2027-03-15').occupiedRooms, 2);
  const daily = buildHotelRiskRows([capacityHotel], bookings)[0].daily;
  assert.equal(Math.max(...daily.map(day => day.occupied)), 1);
  const overlapping=[...bookings,reservation('3','three','2027-03-15','2027-03-17')];
  const peak=buildHotelRiskRows([capacityHotel],overlapping)[0].daily;
  assert.equal(Math.max(...peak.map(day=>day.occupied)),2);
  assert.equal(hotelCapacityOnDay(capacityHotel,overlapping,'2027-03-16').occupiedBeds,2);
});

test('single-use DZ distinguishes physical people, blocked beds and assignable beds', () => {
  const single = reservation('1', 'one', '2027-03-11', '2027-03-23', true);
  const row = hotelCapacityOnDay(capacityHotel, [single], '2027-03-15');
  assert.equal(row.occupiedRooms, 1); assert.equal(row.occupiedBeds, 1);
  assert.equal(row.blockedBeds, 1); assert.equal(row.freeBeds, 0); assert.equal(row.singleUseRooms, 1);
  const shared = hotelCapacityOnDay(capacityHotel, [{...single, countsAsSingle:false}], '2027-03-15');
  assert.equal(shared.occupiedBeds, 1); assert.equal(shared.blockedBeds, 0); assert.equal(shared.freeBeds, 1);
  const external = {...capacityHotel, accommodationType:'EXTERNAL' as const};
  const ext = hotelCapacityOnDay(external, [{...single, hotel:external}], '2027-03-15');
  assert.deepEqual([ext.totalRooms, ext.totalBeds, ext.occupiedRooms, ext.occupiedBeds, ext.blockedBeds, ext.freeBeds], [0,0,0,0,0,0]);
});

test('hotel changes and all twelve nights outside the event survive in analytics and list projections', () => {
  const hotelB = {...capacityHotel, id:'b', name:'Hotel B', roomInventories:capacityHotel.roomInventories!.map(i=>({...i,id:'b-inv',hotelId:'b'}))};
  const bookings = [reservation('1','one','2027-03-11','2027-03-16'), reservation('2','one','2027-03-16','2027-03-23',true,hotelB)];
  const timeline = buildCapacityTimeline({hotels:[capacityHotel,hotelB], events:[{startDate:'2027-03-15',endDate:'2027-03-20',personDemand:0}] as never,athletes:[],bookings});
  assert.equal(timeline.filter(day=>day.assignedBeds===1).length,12);
  assert.equal(Math.max(...timeline.map(day=>day.assignedRooms)),1);
  assert.equal(timeline.find(day=>day.date==='2027-03-16')!.freeBeds,2);
  const contacts=createHotelContactRows([capacityHotel,hotelB],bookings);
  assert.deepEqual(contacts.map(row=>[row.assignedBookings,row.assignedPersons,row.peakRooms,row.peakPersons]),[[1,1,1,1],[1,1,1,1]]);
  assert.equal(contacts[1].peakBlockedBeds,1);

});

test('inventory dates affect supply without clipping actual bookings or duplicating inventory usage', () => {
  const hotel = {...capacityHotel,roomInventories:[...capacityHotel.roomInventories!,{...capacityHotel.roomInventories![0],id:'later',availableFrom:'2027-03-16',availableUntil:'2027-03-20'}]};
  const bookings = [reservation('1','one','2027-03-10','2027-03-24',true)];
  assert.equal(hotelCapacityOnDay(hotel,bookings,'2027-03-10').occupiedBeds,1);
  assert.equal(hotelCapacityOnDay(hotel,bookings,'2027-03-10').totalRooms,0);
  const dailyRows=hotel.roomInventories.map(inventory=>hotelCapacityOnDay(hotel,bookings,'2027-03-17',inventory));
  assert.equal(dailyRows.reduce((sum,row)=>sum+row.occupiedRooms,0),1);
  assert.equal(dailyRows.reduce((sum,row)=>sum+row.freeBeds,0),2);
  const rows = createContingentRows([hotel]);
  assert.deepEqual(rows.map(row=>[row.availableFrom,row.availableUntil,row.totalRooms,row.totalBeds]),[
    ['2027-03-11','2027-03-23',1,2],['2027-03-16','2027-03-20',1,2],
  ]);
  assert.equal(hotelCapacityOnDay(hotel,bookings,'2027-03-17').totalRooms,2);
});

test('distinct people, bookings and room-type capacity remain separate', () => {
  const ez={id:'ez',name:'EZ',maxPersons:1};
  const hotel={...capacityHotel,roomInventories:[...capacityHotel.roomInventories!,{
    ...capacityHotel.roomInventories![0],id:'ez-inv',roomType:ez,roomCount:2,
  }]};
  const booking=reservation('1','one','2027-03-11','2027-03-23');
  const bookings=[booking,{...reservation('2','two','2027-03-11','2027-03-23'),roomNumber:'Zimmer 2'}];
  const before=JSON.stringify(bookings);
  const row=hotelCapacityOnDay(hotel,bookings,'2027-03-15');
  assert.equal(row.occupiedRooms,2); assert.equal(row.occupiedBeds,2);
  assert.equal(row.freeRooms,2); assert.equal(row.freeBeds,2); // EZ remains available despite excess DZ use.
  const duplicate=hotelCapacityOnDay(hotel,[booking,booking],'2027-03-15');
  assert.equal(duplicate.occupiedRooms,1);assert.equal(duplicate.occupiedBeds,1);
  assert.equal(JSON.stringify(bookings),before);
  assert.deepEqual(createHotelContactRows([hotel],bookings),createHotelContactRows([hotel],[...bookings].reverse()));
});

test('hotel and contingent XLSX exports retain period semantics without residual daily fields', async () => {
  const bookings = [reservation('1','one','2027-03-11','2027-03-16',true),reservation('2','two','2027-03-16','2027-03-23')];
  const blobs: Blob[] = [];
  const originalDocument = globalThis.document, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  globalThis.document = {createElement:()=>({click(){},href:'',download:''})} as unknown as Document;
  URL.createObjectURL = blob => { blobs.push(blob as Blob); return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    exportHotelOverviewExcel(createHotelContactRows([capacityHotel],bookings));
    exportContingentsExcel(createContingentRows([capacityHotel]));
    for (const blob of blobs) {
      const text = await blob.text();
      const sheet = text.slice(text.indexOf('<worksheet'),text.indexOf('</worksheet>')+12);
      const rows = [...sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map(match=>[...match[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(cell=>cell[1]));
      const fields = Object.fromEntries(rows[0].map((key,index)=>[key,rows[1][index]]));
      for(const key of ['Stichtag','Belegte Zimmer','Untergebrachte Personen','Zuweisbare Betten','Freie Zimmer','Auslastung %']) assert.equal(key in fields,false,key);
      if('Buchungen (gesamt)' in fields){
        assert.equal(fields['Buchungen (gesamt)'],'2');assert.equal(fields['Personen (eindeutig im Hotel)'],'2');
        assert.equal(fields['Spitze belegte Zimmer'],'1');assert.equal(fields['Spitze Personen'],'1');
        assert.equal(fields['Spitze zusätzlich blockierte Betten'],'1');
      }else{
        assert.equal(fields['Vereinbarte Zimmer'],'1');assert.equal(fields.Von,'2027-03-11');assert.equal(fields.Bis,'2027-03-23');
      }
    }
  } finally { globalThis.document=originalDocument; URL.createObjectURL=originalCreate; URL.revokeObjectURL=originalRevoke; }
});

import {createListRows, filterListRows, type ListFilters} from './listEngine.ts';
import {exportExcel} from './listExports.ts';
test('all three XLSX exports handle large filtered datasets without argument-limit errors',async()=>{
 const blobs:Blob[]=[];
 const originalDocument=globalThis.document,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 globalThis.document={createElement:()=>({click(){},href:'',download:''})} as unknown as Document;
 URL.createObjectURL=blob=>{blobs.push(blob as Blob);return 'blob:test';};URL.revokeObjectURL=()=>{};
 try {
  const people=Array.from({length:200},(_,i)=>({id:String(i),firstname:`Person ${i}`,lastname:'Synthetic',nationCode:i%2?'AUT':'SUI',single_room_status:'NONE',internalNote:'Note & <data> '.repeat(300)} as Athlete));
  const rows=createListRows(people,[]);
  const filters={search:'',athleteRemark:'',internalNote:'',selection:'',discipline:'',nation:'AUT',role:'',hotel:'',status:'',hint:'',movement:'',period:'',assignedOnly:false} as ListFilters;
  const filtered=filterListRows(rows,'none',filters);
  exportExcel(filtered,'none');
  const [hotel]=createHotelContactRows([capacityHotel],[]);
  exportHotelOverviewExcel(Array.from({length:200},(_,i)=>({...hotel,id:String(i),comment:'Long note '.repeat(300)})));
  const [contingent]=createContingentRows([capacityHotel]);
  exportContingentsExcel(Array.from({length:200},(_,i)=>({...contingent,id:String(i),comment:'Long note '.repeat(300)})));
  assert.equal(blobs.length,3);
  for(const blob of blobs){const text=await blob.text();assert.ok(blob.size>500000);assert.match(text,/xl\/worksheets\/sheet1.xml/);assert.doesNotMatch(text,/<c r="[A-Z]+"/);assert.match(text,/<c r="A1"/);}
  const text=await blobs[0].text();assert.match(text,/Person 199/);assert.doesNotMatch(text,/>Person 198</);
  exportExcel([],'hotels');exportHotelOverviewExcel([]);exportContingentsExcel([]);
  assert.equal(blobs.length,6);
 }finally{globalThis.document=originalDocument;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
});

test('period rows preserve separated inventory intervals, distinct people and true daily peaks',()=>{
 const inventories=[{...capacityHotel.roomInventories![0],availableFrom:'2027-03-11',availableUntil:'2027-03-15'},
  {...capacityHotel.roomInventories![0],id:'later',availableFrom:'2027-03-18',availableUntil:'2027-03-23'}];
 const hotel={...capacityHotel,roomInventories:inventories};
 const bookings=[reservation('1','one','2027-03-11','2027-03-15',true),reservation('2','one','2027-03-18','2027-03-23')];
 const [row]=createHotelContactRows([hotel],bookings);
 assert.equal(row.totalRooms,2);assert.equal(row.totalBeds,4); // Contract sum, not concurrent inventory.
 assert.equal(row.assignedBookings,2);assert.equal(row.assignedPersons,1);
 assert.equal(row.peakRooms,1);assert.equal(row.peakPersons,1);assert.equal(row.peakBlockedBeds,1);
 assert.match(row.inventoryPeriods,/2027-03-11–2027-03-15/);assert.match(row.inventoryPeriods,/2027-03-18–2027-03-23/);
 assert.doesNotMatch(row.inventoryPeriods,/2027-03-11–2027-03-23/);
 for(const key of ['capacityDate','freeRooms','freeBeds','occupiedRooms','occupancy']) assert.equal(key in row,false);
 const overlapping=[...bookings,reservation('3','two','2027-03-12','2027-03-14')];
 const [peak]=createHotelContactRows([hotel],overlapping);
 assert.equal(peak.assignedBookings,3);assert.equal(peak.assignedPersons,2);assert.equal(peak.peakRooms,2);assert.equal(peak.peakPersons,2);
 const contingentRows=createContingentRows([hotel]);
 assert.equal(contingentRows.length,2);
 for(const row of contingentRows) for(const key of ['capacityDate','freeRooms','freeBeds','occupiedRooms','occupiedBeds','occupancy']) assert.equal(key in row,false);
});

test('external hotel assignments remain visible without internal capacity peaks',()=>{
 const hotel={...capacityHotel,accommodationType:'EXTERNAL' as const};
 const [row]=createHotelContactRows([hotel],[reservation('ext','one','2027-03-11','2027-03-23',false,hotel)]);
 assert.equal(row.assignedBookings,1);assert.equal(row.assignedPersons,1);
 assert.equal(row.totalRooms,0);assert.equal(row.totalBeds,0);
 assert.equal(row.peakRooms,null);assert.equal(row.peakPersons,null);assert.equal(row.peakBlockedBeds,null);
 assert.deepEqual(createContingentRows([hotel]),[]);
});
