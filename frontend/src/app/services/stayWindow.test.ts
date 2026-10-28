import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stayWindowText,stayWindowDetails} from './stayWindow.ts';
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
 assert.equal(rows.length,1);assert.equal(rows[0].stayWindow,stayWindowText(assessment));
 assert.equal(rows[0].eventPeriod,'2027-03-06 – 2027-03-21');
 assert.equal(rows[0].allowedStay,'2027-03-04 – 2027-03-22 (Abreise)');
 assert.equal(rows[0].assessedStay,'2027-03-02 – 2027-03-23');
 for(const key of ['stayWindow','eventPeriod','allowedStay','assessedStay'])assert.ok(personExportColumns.some(([column])=>column===key));
 assert.match(stayWindowDetails(assessment),/2 Nächte davor, 1 danach/);
 // Hotel lists show the server assessment of the selected booking dates.
 const booking={id:'b',hotel:{id:'h',name:'Synthetic'},roomType:{id:'r',name:'EZ'},occupants:[{athlete:{...athlete,stayWindow:{...assessment,outsideNights:1,nightsBefore:0}}}]} as unknown as RoomBooking;
 const booked=createListRows([athlete],[booking]);assert.equal(booked.length,1);assert.equal(booked[0].stayWindow,'1 Nacht außerhalb des Eventfensters');
});
test('unknown dates remain explicit, never a false OK or a new price decision',()=>{
 assert.equal(stayWindowText({...assessment,outsideNights:0}), '');
 assert.equal(stayWindowText({...assessment,outsideNights:null,reason:'EVENT_DATES_UNCLEAR'}),'Eventtermine nicht zuordenbar');
 assert.equal(stayWindowText({...assessment,outsideNights:null,reason:'NO_ROOM'}),'');
 assert.equal(stayWindowText(undefined),'');
});
