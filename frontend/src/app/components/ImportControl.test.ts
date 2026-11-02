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
 assert.deepEqual(rows,['Wettbewerb Gemeldet / regulär Bewertung','Männer Frauen','Snowboard Park &amp; Pipe 2 eindeutige Athleten · 1 Männer · 1 Frauen','Halfpipe 1 / — 1 / — Bewertung unvollständig','Big Air 1 / — 0 / — Bewertung unvollständig']);
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
 assert.deepEqual(rows,['Wettbewerb Gemeldet / regulär Bewertung','Männer Frauen','Snowboard Park &amp; Pipe 5 eindeutige Athleten · 5 Männer · 0 Frauen','Slopestyle 5 / — 0 / — Bewertung unvollständig','Big Air 5 / — 0 / — Bewertung unvollständig']);
 assert.ok(html.includes('FIS-Zuteilung nicht bestätigt')&&html.includes('Keine FIS-Startfreigabe'));
 for(const unproven of ['5 erlaubt','+1 Weltmeister','Titel vorhanden','Innerhalb'])assert.ok(!html.includes(unproven),unproven);
});

test('server-projected personal title and unresolved BA extra remain distinct and link to exact people',()=>{
 const base={nation:'CAN',reported:5,regularMax:4,aboveRegular:1,championStarters:0,unverifiedAdditional:1,personKeys:['m0','m1','m2','m3','m4'],champions:[],sharedPoolReported:5,allocationConfirmed:false,status:'REVIEW_REQUIRED'};
 const ss={...competition,id:'ss',name:"Men's Snowboard Slopestyle",sportEntries:[{...base,status:'TITLE_COVERED',championStarters:1,unverifiedAdditional:0,champions:[{personKey:'m0',source:'https://example.test/result'}]}]};
 const ba={...competition,id:'ba',name:"Men's Snowboard Big Air",sportEntries:[base]};
 const people=base.personKeys.map(matchKey=>({...person,matchKey,function:'Athlete',gender:'M',nationCode:'CAN'}));
 const view={...control,competitions:[ss,ba],people:people.map(p=>({personKey:p.matchKey,competitions:[ss,ba]}))};
 const html=renderToStaticMarkup(createElement(CompetitionDistribution,{control:view,preview:{...preview,people},nation:'CAN',onPeople:()=>{throw Error('render must not navigate');}}));
 assert.ok(html.includes('5</button> / 4')&&html.includes('4 regulär + 1 WM')&&html.includes('1 zusätzliche Meldung klären'));
 assert.equal((html.match(/data-tone="success"/g)||[]).length,1);
 assert.equal((html.match(/data-tone="warning"/g)||[]).length,1);
 assert.ok(html.includes('Gemeinsamer Slopestyle-/Big-Air-Pool: 5 eindeutige Personen dieses Geschlechts'));
 assert.ok(html.includes('Endgültige FIS-Zuteilung nicht bestätigt'));
 assert.ok(html.includes('Slopestyle: 5 Athleten anzeigen')&&html.includes('Big Air: 5 Athleten anzeigen'));
});

test('one row uses one status for both genders and keeps unchecked disciplines neutral',()=>{
 const base={nation:'ITA',reported:1,regularMax:4,aboveRegular:0,championStarters:0,unverifiedAdditional:0,personKeys:['m'],champions:[],sharedPoolReported:null,allocationConfirmed:false,status:'NUMERIC_OK'};
 const male={...competition,id:'m',name:"Men's Snowboard Halfpipe",sportEntries:[base]};
 const female={...competition,id:'w',name:"Women's Snowboard Halfpipe",gender:'W',sportEntries:[{...base,personKeys:['w']}]};
 const people=['m','w'].map((matchKey,i)=>({...person,matchKey,function:'Athlete',gender:i?'W':'M',nationCode:'ITA'}));
 const props={nation:'ITA',control:{...control,competitions:[male,female],people:people.map((p,i)=>({personKey:p.matchKey,competitions:[i?female:male]}))},preview:{...preview,people}};
 const html=renderToStaticMarkup(createElement(CompetitionDistribution,props));
 assert.equal((html.match(/data-tone="success"/g)||[]).length,1);assert.equal((html.match(/1 \/ 4/g)||[]).length,2);assert.ok(html.includes('Innerhalb der Grenze'));
 delete female.sportEntries;
 const partial=renderToStaticMarkup(createElement(CompetitionDistribution,props));assert.ok(partial.includes('Bewertung unvollständig'));assert.ok(!partial.includes('Innerhalb der Grenze'));
});

test('new individual sports use the same server status and neutral team rows have no four-place limit',()=>{
 for(const name of ['Moguls','Dual Moguls','Aerials','Ski Cross','Snowboard Cross','Freeski Halfpipe']){
  const member={...person,matchKey:'m',function:'Athlete',gender:'M',nationCode:'X'};
  const entry={nation:'X',reported:4,regularMax:4,status:'NUMERIC_OK',personKeys:['m'],champions:[],sharedPoolReported:null};
  const male={...competition,name:`Men's ${name}`,sportEntries:[entry]};
  const female={...male,id:'w',name:`Women's ${name}`,gender:'W',sportEntries:[{...entry,reported:0,personKeys:[]}]};
  const props={nation:'X',control:{...control,competitions:[male,female],people:[{personKey:'m',competitions:[male]}]},preview:{...preview,people:[member,member]}};
  const html=renderToStaticMarkup(createElement(CompetitionDistribution,props));
  assert.ok(html.includes('4 / 4')&&html.includes('0 / 4')&&html.includes('Innerhalb der Grenze'),name);
  entry.status='TEAM_RULE';entry.regularMax=null;
  const team=renderToStaticMarkup(createElement(CompetitionDistribution,props));
  assert.ok(team.includes('Teamwettbewerb – gesonderte Regel')&&!team.includes('data-tone="success"'),name);
 }
});

test('a shared pool excess remains a review even when each competition is within four',()=>{
 const member={...person,matchKey:'m',function:'Athlete',gender:'M',nationCode:'X'};
 const row={...competition,name:"Men's Snowboard Slopestyle",sportEntries:[{nation:'X',reported:4,regularMax:4,status:'REVIEW_REQUIRED',personKeys:['m'],poolPersonKeys:['m','pool-other'],sharedPoolReported:8,sharedPoolRegularMax:4,sharedPoolUnverifiedAdditional:4,champions:[]}]};
 const html=renderToStaticMarkup(createElement(CompetitionDistribution,{nation:'X',onPeople:()=>{},control:{...control,competitions:[row],people:[{personKey:'m',competitions:[row]}]},preview:{...preview,people:[member]}}));
 assert.ok(html.includes('4</button> / 4')&&html.includes('gemeinsamen Pool klären – Personen anzeigen'));
 assert.ok(html.includes('8 eindeutige Personen dieses Geschlechts / 4 regulär'));
 assert.ok(!html.includes('data-tone="success"'));
});

test('sport rows explain server evidence without a legend, including partial title and pool coverage',()=>{
 const p={...person,matchKey:'m',function:'Athlete',gender:'M',nationCode:'X'};
 const base={nation:'X',reported:6,regularMax:4,aboveRegular:2,championStarters:0,unverifiedAdditional:2,personKeys:['m'],champions:[],sharedPoolReported:null,status:'REVIEW_REQUIRED'};
 const render=(entry:any)=>{const row={...competition,name:"Men's Halfpipe",sportEntries:[entry]};return renderToStaticMarkup(createElement(CompetitionDistribution,{nation:'X',onPeople:()=>{},control:{...control,competitions:[row],people:[{personKey:'m',competitions:[row]}]},preview:{...preview,people:[p]}}));};
 const cases=[
  [base,'2 zusätzliche Meldungen klären','warning'],
  [{...base,championStarters:1,champions:[{personKey:'m',source:'https://example.test/result'}],unverifiedAdditional:1},'4 regulär + 1 WM','warning'],
  [{...base,status:'NUMERIC_OK',aboveRegular:0,unverifiedAdditional:0,sharedPoolReported:8,sharedPoolRegularMax:4,sharedPoolUnverifiedAdditional:4,poolPersonKeys:['m','another']},'Gemeinsamer Pool: 4 zusätzliche Personen klären','warning'],
  [{...base,status:'INCOMPLETE',regularMax:null},'Bewertung unvollständig','neutral'],
  [{...base,status:'TITLE_COVERED',championStarters:1,unverifiedAdditional:0,champions:[]},'Bewertung unvollständig','neutral'],
 ];
 for(const [entry,label,tone] of cases){const original=structuredClone(entry),html=render(entry);assert.ok(html.includes(label as string));assert.ok(html.includes(`data-tone="${tone}"`));assert.ok(!html.includes('data-tone="success"'));assert.deepEqual(entry,original);}
 const covered=render({...base,status:'TITLE_COVERED',reported:5,aboveRegular:1,unverifiedAdditional:0,championStarters:2,champions:[{personKey:'m',source:'https://example.test/result'},{personKey:'other',source:'https://example.test/result'}]});
 assert.ok(covered.includes('4 regulär + 1 WM')&&!covered.includes('4 regulär + 2 WM'));
 assert.ok(covered.includes('verifiziertes Weltmeisterrecht – Personen anzeigen'));
});
