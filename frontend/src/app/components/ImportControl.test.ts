import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true,entries:[],include:[]},appType:'custom'});
const {PersonControlDetails,ControlIssues,CompetitionDistribution}=await server.ssrLoadModule('/src/app/components/ImportControl.tsx');
await server.close();
const person={matchKey:'a',firstname:'Synthetic',lastname:'Person',function:'NSA Coach',gender:'W',forGender:'W',rowNumber:2,roomType:'Double shared',accommodationRequirement:'REQUIRED',accommodationRequirementSource:'MANUAL',accommodationRateCategory:'STANDARD',singleRoomQuotaExemptReason:'WORLD_CHAMPION',singleRoomExemptionSource:'MANUAL_SET'};
const competition={id:'1',name:'Halfpipe Men',group:'Snowboard Park & Pipe',gender:'M'};
const control={people:[{personKey:'a',competitions:[competition],quotaContexts:[{nation:'X',group:competition.group,gender:'M'}]}],issues:[{kind:'clarification',code:'PARTNER',message:'Partner nicht zugeordnet',personKeys:['a'],source:'Room List',row:5},{kind:'info',code:'EMPTY',message:'Leere Room List',personKeys:[],source:'Room List',row:8}],competitions:[{...competition,people:1,athletes:0}]};
const preview={people:[person],rooms:[{rowNumber:5,person1Key:'a',person1Name:'Synthetic Person',roomType:'Double shared',sharedWithRawName:'Source partner'}],warnings:[]};
test('details distinguish source roommate evidence, actual quota gender and WC accommodation exemption',()=>{
 const html=renderToStaticMarkup(createElement(PersonControlDetails,{person,preview,control}));
 for(const text of ['Halfpipe Men','Snowboard Park &amp; Pipe · M','For_gender','Manuell festgelegt','Source partner','Angegeben, nicht eindeutig zugeordnet','Keine eindeutige Titel-/Disziplinreferenz','Kein Nachweis eines sportlichen Startrechts'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Synthetic Person · eindeutig zugeordnet'));
});
test('clarifications link only known people without introducing a block',()=>{
 const html=renderToStaticMarkup(createElement(ControlIssues,{control,preview,filter:'all',onPerson:()=>{throw Error('render must not act');}}));
 assert.match(html,/Klärungsbedarf/);assert.match(html,/Informationen/);assert.match(html,/Keine zusätzliche Importsperre/);
 assert.equal((html.match(/→ Details/g)||[]).length,1);assert.match(html,/Zeile 8/);
});
test('competition distribution distinguishes memberships and unique persons including staff',()=>{
 const extra={...competition,id:'2',name:'Big Air Men',people:1,athletes:0};
 const html=renderToStaticMarkup(createElement(CompetitionDistribution,{control:{...control,people:[{...control.people[0],competitions:[competition,extra]}],competitions:[...control.competitions,extra]}}));
 assert.match(html,/1 eindeutige Personen · 2 Competition-Zuordnungen/);assert.match(html,/Big Air Men: 0 Athleten · 1 Personen inkl. Staff/);assert.match(html,/keine neue sportliche Quotenprüfung/);
});
