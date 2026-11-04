import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true,entries:[],include:[]},appType:'custom'});
const {DispositionQueueCard}=await server.ssrLoadModule('/src/app/components/assignment/DispositionQueueCard.tsx');
const {OccupantCard}=await server.ssrLoadModule('/src/app/components/assignment/OccupantCard.tsx');
await server.close();
for(const fn of ['Athlete','NSA Guest','NSA Technician']) {
 test(`queue and assigned-room person rows expose ${fn} compactly`,()=>{
  const person={athleteId:'1',firstname:'One',name:'One Person',function:fn};
  const html=renderToStaticMarkup(createElement(DispositionQueueCard,{unit:{unitId:'need',occupants:[person],openPeriod:{checkInDate:'2027-03-14',checkOutDate:'2027-03-21'},canAssign:true,previous:[]},selected:false,onSelect:()=>{},onDragStart:()=>{},onDragEnd:()=>{},onQuickAssign:()=>{},canEditAssignments:true,pending:false,hotelName:'Hotel'}));
  assert.match(html,new RegExp(fn));assert.match(html,/Person hier zuweisen/);assert.match(html,/draggable="true"/);
  const room=renderToStaticMarkup(createElement(OccupantCard,{person,status:'assigned'}));assert.match(room,new RegExp(fn));
 });
}
