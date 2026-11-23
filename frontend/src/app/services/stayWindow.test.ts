import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stayWindowText,stayWindowDetails,stayWindowDeviationText} from './stayWindow.ts';
import {personMatchesImportFilter} from './importHints.ts';
import {createListRows} from '../lists/listEngine.ts';
import {personExportColumns} from '../lists/listExports.ts';
import type {Athlete,FisImportPreview,ImportControl,StayWindow,RoomBooking} from '../types.ts';
const assessment=JSON.parse(readFileSync(new URL('../../../../backend/tests/fixtures/stay-window.synthetic.json',import.meta.url),'utf8')) as StayWindow;

test('one server result supplies import, people, hotel list and export without splitting a person',()=>{
 const athlete={id:'1',firstname:'Synthetic',lastname:'CAN',nationCode:'CAN',arrivalDate:'2027-03-02',departureDate:'2027-03-23',stayWindow:assessment} as Athlete;
 const person={...athlete,matchKey:'1'} as unknown as FisImportPreview['people'][number];
 const preview={people:[person],rooms:[],errors:[]} as unknown as FisImportPreview;
 const control={people:[{personKey:'1',stayWindow:assessment}],issues:[],competitions:[]} as unknown as ImportControl;
 assert.equal(personMatchesImportFilter(person,'stay',preview,control),true);
 assert.equal(stayWindowText(athlete.stayWindow),'3 Nächte außerhalb des Eventfensters');
 const rows=createListRows([athlete],[]);
 assert.equal(rows.length,1);assert.equal(rows[0].stayWindow,stayWindowDeviationText(assessment));
 assert.equal(rows[0].eventPeriod,'2027-03-06 – 2027-03-21');
 assert.equal(rows[0].allowedStay,'2027-03-04 – 2027-03-22 (Abreise)');
 assert.equal(rows[0].assessedStay,'2027-03-02 – 2027-03-23');
 for(const key of ['stayWindow','eventPeriod','allowedStay','assessedStay'])assert.ok(personExportColumns.some(([column])=>column===key));
 assert.match(stayWindowDetails(assessment),/2 Nächte davor, 1 danach/);
 // Hotel lists show the server assessment of the selected booking dates.
 const booking={id:'b',hotel:{id:'h',name:'Synthetic'},roomType:{id:'r',name:'EZ'},occupants:[{athlete:{...athlete,stayWindow:{...assessment,outsideNights:1,nightsBefore:0}}}]} as unknown as RoomBooking;
 const booked=createListRows([athlete],[booking]);assert.equal(booked.length,1);assert.equal(booked[0].stayWindow,'+1 Nacht nach Unterkunftsfenster');
});
test('unknown dates remain explicit, never a false OK or a new price decision',()=>{
 assert.equal(stayWindowText({...assessment,outsideNights:0}), '');
 assert.equal(stayWindowText({...assessment,outsideNights:null,reason:'EVENT_DATES_UNCLEAR'}),'Eventtermine nicht zuordenbar');
 assert.equal(stayWindowText({...assessment,outsideNights:null,reason:'NO_ROOM'}),'');
 assert.equal(stayWindowText(undefined),'');
});

test('unknown import dates can be aggregated, and hotel guidance exists only for actual additional nights',async()=>{
 const {stayWindowRowText,stayWindowNights,stayWindowHotelNote}=await import('./stayWindow.ts');
 const unknown={...assessment,outsideNights:null,reason:'EVENT_DATES_UNCLEAR'};
 assert.equal(stayWindowRowText(unknown),'');
 assert.equal(stayWindowText(unknown),'Eventtermine nicht zuordenbar');
 assert.equal(stayWindowNights(assessment),'2 davor / 1 danach');
 const message='3 Nächte außerhalb des vorgesehenen Unterkunftszeitraums. Für Übernachtungen außerhalb des vorgesehenen Unterkunftszeitraums kann das Hotel den regulären Hotelpreis verrechnen.';
 assert.equal(stayWindowHotelNote(assessment),message);
 for(const value of [undefined,unknown,{...assessment,outsideNights:0},{...assessment,reason:'NO_ROOM'}])assert.equal(stayWindowHotelNote(value),'');
 const athlete={id:'1',firstname:'Synthetic',lastname:'ISR',stayWindow:assessment} as Athlete;
 const rows=createListRows([athlete],[]);assert.equal(rows.length,1);assert.equal(rows[0].hotelStayNote,message);
 assert.ok(personExportColumns.some(([key])=>key==='hotelStayNote'));
 assert.ok(stayWindowDetails(assessment).includes(message));
});

test('compact deviation labels retain unknown assignment and exclusive checkout evidence',async()=>{
 const {stayWindowDeviationText}=await import('./stayWindow.ts');
 assert.equal(stayWindowDeviationText({...assessment,nightsBefore:0,nightsAfter:0,outsideNights:0}),'');
 assert.equal(stayWindowDeviationText({...assessment,nightsBefore:2,nightsAfter:0,outsideNights:2}),'+2 Nächte vor Unterkunftsfenster');
 assert.equal(stayWindowDeviationText({...assessment,nightsBefore:0,nightsAfter:1,outsideNights:1}),'+1 Nacht nach Unterkunftsfenster');
 assert.equal(stayWindowDeviationText(assessment),'+2 Nächte vor · +1 Nacht nach Unterkunftsfenster');
 assert.equal(stayWindowDeviationText({...assessment,outsideNights:null,reason:'EVENT_DATES_UNCLEAR'}),'Eventtermine nicht zuordenbar');
});

import {groupListRows} from '../lists/listEngine.ts';
import {exportExcel} from '../lists/listExports.ts';
test('person summary uses the server union while hotel rows and XLSX retain segment deviations',async()=>{
 const union={...assessment,arrivalDate:'2027-03-02',departureDate:'2027-03-06',nightsBefore:2,nightsAfter:0,outsideNights:2};
 const athlete={id:'1',firstname:'Synthetic',lastname:'Overlap',nationCode:'AUT',stayWindow:union} as Athlete;
 const booking=(id:string,hotel:string,start:string,before:number)=>({id,hotel:{id:hotel,name:hotel},roomType:{id:'dz',name:'DZ',maxPersons:2},
  checkInDate:start,checkOutDate:before===2?'2027-03-05':'2027-03-06',occupants:[{athlete:{...athlete,stayWindow:{...union,arrivalDate:start,nightsBefore:before,outsideNights:before}}}]} as RoomBooking);
 const rows=createListRows([athlete],[booking('a','Hotel A','2027-03-02',2),booking('b','Hotel B','2027-03-03',1)]);
 assert.equal(rows[0].stayWindow,'+2 Nächte vor Unterkunftsfenster');
 assert.deepEqual(groupListRows(rows,'hotels').map(g=>g.rows[0].stayWindow),['+2 Nächte vor Unterkunftsfenster','+1 Nacht vor Unterkunftsfenster']);
 const blobs:Blob[]=[];const originalDocument=globalThis.document,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 globalThis.document={createElement:()=>({click(){},href:'',download:''})} as unknown as Document;
 URL.createObjectURL=blob=>{blobs.push(blob as Blob);return 'blob:test';};URL.revokeObjectURL=()=>{};
 try {
  exportExcel(rows,'none');exportExcel(rows,'hotels');
  const cells=async(blob:Blob)=>{
   const text=await blob.text(),sheet=text.slice(text.indexOf('<worksheet'),text.indexOf('</worksheet>'));
   return [...sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map(match=>[...match[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(cell=>cell[1]));
  };
  const person=await cells(blobs[0]),hotel=await cells(blobs[1]);const column=person[0].indexOf('Zusatznächte');
  assert.equal(person[1][column],rows[0].stayWindow);
  assert.deepEqual(hotel.slice(1).map(row=>row[column]),['+2 Nächte vor Unterkunftsfenster','+1 Nacht vor Unterkunftsfenster']);
 }finally{globalThis.document=originalDocument;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
});

test('segment without a server assessment never inherits an unrelated person window',()=>{
 const athlete={id:'1',firstname:'Synthetic',lastname:'Unknown',stayWindow:assessment} as Athlete;
 const booking={id:'b',hotel:{id:'h',name:'Hotel'},roomType:{id:'dz',name:'DZ',maxPersons:2},checkInDate:'2027-03-10',checkOutDate:'2027-03-12',occupants:[{athlete:{id:'1'}}]} as RoomBooking;
 assert.equal(createListRows([athlete],[booking])[0].segments[0].stayWindow,'Bewertung nicht verfügbar');
});
