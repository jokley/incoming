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

test('queue shows applicable advance approval without changing requests or asserting active cost', () => {
  const person={athleteId:'paid',name:'Approved Person',firstname:'Approved',nationCode:'AUT',
    function:'Official',gender:'M',roomType:'Double shared',quotaDisciplines:['Ski Cross'],single_room_status:'APPROVED_EXTRA',
    approvedQuotaContexts:[{nationCode:'AUT',discipline:'Ski Cross',gender:'W'}]};
  const render=(people:unknown[])=>renderToStaticMarkup(createElement(DispositionQueueCard,{unit:{unitId:'need',occupants:people,openPeriod:{checkInDate:'2027-03-14',checkOutDate:'2027-03-21'},canAssign:true,previous:[]},selected:false,onSelect:()=>{},onDragStart:()=>{},onDragEnd:()=>{},onQuickAssign:()=>{},canEditAssignments:true,pending:false}));
  const html=render([person]);
  assert.match(html,/>Mehrpreis genehmigt</);
  assert.match(html,/Zimmerwunsch: DZ/);
  assert.match(html,/kein aktiver EZ-Mehrpreis/);
  assert.ok(!html.includes('>Mehrpreis<'));
  for(const change of [
    {approvedQuotaContexts:[]}, {approvedQuotaContexts:undefined,approvedQuotaDisciplines:['Ski Cross']},
    {approvedQuotaContexts:[{nationCode:'ITA',discipline:'Ski Cross',gender:'W'}]},
    {quotaDisciplines:['Snowboard Cross']}, {function:'Athlete'},
    {singleRoomQuotaExemptReason:'OTHER'}, {single_room_status:'IN_QUOTA'},
  ]) assert.ok(!render([{...person,...change}]).includes('>Mehrpreis genehmigt<'),JSON.stringify(change));
  const champion=render([{...person,roomType:'Single',singleRoomQuotaExemptReason:'WORLD_CHAMPION'}]);
  assert.match(champion,/lucide-crown/); assert.match(champion,/Weltmeister/);
  assert.match(champion,/Zimmerwunsch: EZ/); assert.ok(!champion.includes('>Mehrpreis genehmigt<'));
  assert.ok(!render([{...person,singleRoomQuotaExemptReason:'OTHER'}]).includes('lucide-crown'));
  const pair=render([person,{...person,athleteId:'other'}]);
  assert.match(pair,/Zimmerwunsch für beide: DZ/);
  for(const unwanted of ['EZ angefordert','Innerhalb Quote','Kostenfrei genehmigt','Entscheidung offen']) assert.ok(!html.includes(unwanted));
});
