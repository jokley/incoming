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

test('five shared SS/BA entrants and an EZ champion exemption do not imply sporting permission',()=>{
 const ss={...competition,id:'ss',name:"Men's Snowboard Slopestyle"};
 const ba={...competition,id:'ba',name:"Men's Snowboard Big Air"};
 const people=Array.from({length:5},(_,index)=>({...person,matchKey:`m${index}`,function:'Athlete',gender:'M',nationCode:'CAN',singleRoomQuotaExemptReason:index===0?'WORLD_CHAMPION':null}));
 const view={...control,competitions:[ss,ba],people:people.map(p=>({personKey:p.matchKey,competitions:[ss,ba]}))};
 const html=renderToStaticMarkup(createElement(CompetitionDistribution,{control:view,preview:{...preview,people},nation:'CAN'}));
 const rows=[...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(m=>m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
 assert.deepEqual(rows,['Disziplin / Wettbewerb Männer Frauen Gesamt','Snowboard Park &amp; Pipe 5 0 5','Slopestyle 5 0 5','Big Air 5 0 5']);
 assert.ok(html.includes('FIS-Zuteilung nicht bestätigt')&&html.includes('keine Startfreigabe'));
 for(const unproven of ['5 erlaubt','+1 Weltmeister','Titel vorhanden','Innerhalb'])assert.ok(!html.includes(unproven),unproven);
});

test('server-projected personal title and unresolved BA extra remain distinct and link to exact people',()=>{
 const base={nation:'CAN',reported:5,regularMax:4,aboveRegular:1,championStarters:0,unverifiedAdditional:1,personKeys:['m0','m1','m2','m3','m4'],champions:[],sharedPoolReported:5,allocationConfirmed:false};
 const ss={...competition,id:'ss',name:"Men's Snowboard Slopestyle",sportEntries:[{...base,championStarters:1,unverifiedAdditional:0,champions:[{personKey:'m0',source:'https://example.test/result'}]}]};
 const ba={...competition,id:'ba',name:"Men's Snowboard Big Air",sportEntries:[base]};
 const people=base.personKeys.map(matchKey=>({...person,matchKey,function:'Athlete',gender:'M',nationCode:'CAN'}));
 const view={...control,competitions:[ss,ba],people:people.map(p=>({personKey:p.matchKey,competitions:[ss,ba]}))};
 const html=renderToStaticMarkup(createElement(CompetitionDistribution,{control:view,preview:{...preview,people},nation:'CAN',onPeople:()=>{throw Error('render must not navigate');}}));
 assert.ok(html.includes('5 inkl. WM')&&html.includes('5 / 4 · Zusatzrecht prüfen'));
 assert.equal((html.match(/data-tone="success"/g)||[]).length,1);
 assert.equal((html.match(/data-tone="warning"/g)||[]).length,1);
 assert.ok(html.includes('Gemeinsamer Slopestyle-/Big-Air-Pool: 5 eindeutige Männer.'));
 assert.ok(html.includes('endgültige FIS-Zuteilung nicht bestätigt'));
 assert.ok(html.includes('Slopestyle: 5 Athleten anzeigen')&&html.includes('Big Air: 5 Athleten anzeigen'));
});
