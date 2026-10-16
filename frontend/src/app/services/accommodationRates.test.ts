import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true,entries:[],include:[]},appType:'custom'});
const {AccommodationRateChip,AccommodationRateField}=await server.ssrLoadModule('/src/app/components/AccommodationRate.tsx');
const {QuotaPersonGroups}=await server.ssrLoadModule('/src/app/components/assignment/QuotaPersonGroups.tsx');
const {PersonAccommodationPanel}=await server.ssrLoadModule('/src/app/components/assignment/PersonAccommodationPanel.tsx');
await server.close();
const render=(component:any,props:any)=>renderToStaticMarkup(createElement(component,props));
test('only SPECIAL receives a tariff chip',()=>{
 assert.match(render(AccommodationRateChip,{category:'SPECIAL'}),/Sondertarif/);
 assert.equal(render(AccommodationRateChip,{category:'STANDARD'}),'');
 assert.equal(render(AccommodationRateChip,{}),'');
});
test('person and import selector exposes independent tariff semantics',()=>{
 const html=render(AccommodationRateField,{value:'SPECIAL',onChange:()=>{}});
 assert.match(html,/Unterkunftstarif/);assert.match(html,/Sondertarif/);
 assert.match(html,/unabhängig von EZ\/DZ und EZ-Genehmigung/);
 const review=render(AccommodationRateField,{value:'STANDARD',compact:true,label:'Unterkunftstarif One Guest',onChange:()=>{}});
 assert.match(review,/Unterkunftstarif One Guest/);assert.match(review,/Standard/);
});
test('quota details show canonical raw Function groups and tariff count',()=>{
 const html=render(QuotaPersonGroups,{row:{specialRateCount:1,functionGroups:[{function:'NSA Guest',count:2,people:[{personId:'1',name:'One Guest',isAssigned:true,accommodationRateCategory:'SPECIAL'},{personId:'2',name:'Other Guest',isAssigned:false,accommodationRateCategory:'STANDARD'}]}]}});
 assert.match(html,/Personengruppen/);assert.match(html,/NSA Guest/);assert.match(html,/Sondertarif: 1/);
 assert.equal((html.match(/One Guest/g)||[]).length,1);assert.match(html,/Offen/);assert.match(html,/Zugewiesen/);
 assert.doesNotMatch(html,/SPECIAL_GUEST|EXTRA_OFFICIAL|Mehrpreis/);
});
test('assignment person detail shows person-owned tariff',()=>{
 const interval={checkInDate:'2027-03-04',checkOutDate:'2027-03-21'};
 const html=render(PersonAccommodationPanel,{people:[{athleteId:'1',name:'One Guest',accommodationRateCategory:'SPECIAL',accommodationCoverage:{overallInterval:interval,segments:[],coveredIntervals:[],openIntervals:[interval],conflicts:[],coverageStatus:'UNASSIGNED'}}],canEdit:true,onChanged:async()=>{}});
 assert.match(html,/Unterkunftstarif/);assert.match(html,/Sondertarif/);assert.match(html,/Offen/);
});
