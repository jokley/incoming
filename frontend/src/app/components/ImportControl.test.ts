import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true,entries:[],include:[]},appType:'custom'});
const {PersonControlDetails,CompetitionDistribution}=await server.ssrLoadModule('/src/app/components/ImportControl.tsx');
await server.close();
const person={matchKey:'a',firstname:'Synthetic',lastname:'Person',function:'NSA Coach',gender:'W',forGender:'W',rowNumber:2,roomType:'Double shared',accommodationRequirement:'REQUIRED',accommodationRequirementSource:'MANUAL',accommodationRateCategory:'STANDARD',singleRoomQuotaExemptReason:'WORLD_CHAMPION',singleRoomExemptionSource:'MANUAL_SET'};
const competition={id:'1',name:'Halfpipe Men',group:'Snowboard Park & Pipe',gender:'M'};
const control={people:[{personKey:'a',competitions:[competition],quotaContexts:[{nation:'X',group:competition.group,gender:'M'}]}],issues:[{kind:'clarification',code:'PARTNER',message:'Partner nicht zugeordnet',personKeys:['a'],source:'Room List',row:5},{kind:'info',code:'EMPTY',message:'Leere Room List',personKeys:[],source:'Room List',row:8}],competitions:[{...competition,people:1,athletes:0}]};
const preview={people:[person],rooms:[{rowNumber:5,person1Key:'a',person1Name:'Synthetic Person',roomType:'Double shared',sharedWithRawName:'Source partner'}],warnings:[]};
test('hierarchy counts unique athletes per group and competition, combining genders and excluding staff',()=>{
 const male={...competition,name:"Men's Snowboard Halfpipe"},female={...competition,id:'2',name:"Women's Snowboard Halfpipe",gender:'W'},air={...competition,id:'3',name:"Men's Snowboard Big Air"};
 const people=[{...person,matchKey:'m',function:'Athlete',gender:'M',nationCode:'CAN'},{...person,matchKey:'f',function:'Athlete',gender:'W',nationCode:'CAN'},person,{...person,matchKey:'other',function:'Athlete',gender:'M',nationCode:'USA'}];
 const view={...control,competitions:[male,female,air],people:[{personKey:'m',competitions:[male,air]},{personKey:'f',competitions:[female]},{personKey:'a',competitions:[male]},{personKey:'other',competitions:[air]}]};
 const html=renderToStaticMarkup(createElement(CompetitionDistribution,{control:view,preview:{...preview,people},nation:'CAN'}));
 const rows=[...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(m=>m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
 assert.deepEqual(rows,['Disziplin / Wettbewerb Männer Frauen Gesamt','Snowboard Park &amp; Pipe 1 1 2','Halfpipe 1 1 2','Big Air 1 0 1']);
});
test('compact person dialog has one closed source section and no note workflow',()=>{
 const html=renderToStaticMarkup(createElement(PersonControlDetails,{person,preview,control}));
 for(const label of ['Funktion','Geschlecht','Halfpipe Men','Zimmerpartner','Source partner','Partner nicht zugeordnet','Room List','Zeile 5','EZ-Status','Weltmeister-EZ-Ausnahme'])assert.ok(html.includes(label),label);
 assert.equal((html.match(/<details/g)||[]).length,1);
 assert.ok(!html.includes(' open=""'));
 for(const label of ['textarea','Notiz speichern','Versionshistorie','Existing historical note','Kein Nachweis eines sportlichen Startrechts'])assert.ok(!html.includes(label),label);
});
