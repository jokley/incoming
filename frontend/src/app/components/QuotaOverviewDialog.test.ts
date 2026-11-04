import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer,type ViteDevServer} from 'vite';
import type {QuotaOverview} from '../types';
const fixture=JSON.parse(readFileSync(new URL('../../../../backend/tests/fixtures/quota-overview-ita.synthetic.json',import.meta.url),'utf8')) as QuotaOverview;
let server:ViteDevServer;let Content:React.ElementType;
before(async()=>{server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});Content=(await server.ssrLoadModule('/src/app/components/QuotaOverviewDialog.tsx')).QuotaOverviewContent;});
after(async()=>server?.close());
const html=(overview:QuotaOverview,kind='officials',extra={})=>renderToStaticMarkup(createElement(Content,{overview,kind,...extra}));
const text=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const copy=()=>structuredClone(fixture);

test('officials are grouped in one table with distinct totals, collapsible contexts and existing EZ values',()=>{
 const data=copy(),output=html(data),visible=text(output);
 for(const label of ['14','Officials','0 offene EZ-Kontexte','EZ-Anspruch','EZ-Anfragen','nicht abschließend bewertet','5 Mehrfachzugehörigkeiten','Σ M/W','Berechnungsbasis EZ'])assert.ok(visible.includes(label),label);
 assert.equal((output.match(/<details/g)||[]).length,3);assert.ok(!output.includes(' open=""'));
 assert.ok(!output.includes('Officials ohne reguläre Abdeckung'));
 assert.ok(output.includes('overflow-x-auto')&&output.includes('role="region"')&&output.includes('tabindex="0"'));
 for(const group of data.nations[0].groups)assert.ok(output.includes(group.name.replaceAll('&','&amp;')));
});
test('athlete footer shows all authoritative gender/total limits without large duplicate quota cards',()=>{
 const visible=text(html(copy(),'athlete'));
 for(const label of ['WM-Quotenregel','Revision 3','fixiert','Nation ITA','Freestyle / Freeski','6 / 20','4 / 20','10 / 36','Innerhalb der Quote'])assert.ok(visible.includes(label),label);
 for(const removed of ['Zusätzlich genehmigte Athleten','Reguläres Athletenlimit','Noch ungedeckt','0 / 0 / 0'])assert.ok(!visible.includes(removed),removed);
});
test('partial approval highlights only violated limits and separates approved from uncovered quantities',()=>{
 const data=copy(),row=data.nations[0].athleteFamilies[0];
 Object.assign(row,{athleteQuotaUsed:40,athleteGenderUsed:{M:23,F:17},athleteQuotaStatus:'EXCEEDED',decisionStatus:'PENDING',requiredExtent:{total:4,M:3,F:0},approvedExtent:{total:2,M:1,F:0},uncoveredExtent:{total:2,M:2,F:0}});
 const output=html(data,'athlete'),visible=text(output);
 for(const label of ['23 / 20','17 / 20','40 / 36','+3','+4','Entscheidung offen','1 genehmigt','2 genehmigt','2 offen'])assert.ok(visible.includes(label),label);
 const cells=[...output.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m=>text(m[1]));
 assert.ok(cells[0].includes('+3')&&cells[0].includes('2 offen'));
 assert.ok(cells[1].includes('OK')&&!cells[1].includes('offen'));
 assert.ok(cells[2].includes('+4')&&cells[2].includes('2 genehmigt'));
 row.decisionStatus='APPROVED';row.approvedExtent={total:4,M:3,F:0};row.uncoveredExtent={total:0,M:0,F:0};
 const approved=text(html(data,'athlete'));assert.ok(approved.includes('Überschreitung genehmigt'));assert.ok(!approved.includes('Entscheidung offen'));
});
test('draft and incomplete contexts cannot look quota compliant',()=>{
 const data=copy();data.event.isWorldChampionship=false;data.event.rulesFixed=false;data.nations[0].incomplete=true;
 for(const kind of ['athlete','officials']){const visible=text(html(data,kind));assert.ok(visible.includes('Nicht-WM')&&visible.includes('Entwurf')&&visible.includes(kind==='officials'?'EZ-Bewertung unvollständig':'Fachlich prüfen'));assert.ok(!visible.includes('Innerhalb der Quote'));}
});
test('EZ approvals and exemptions stay visible without inventing officials coverage',()=>{
 const data=copy(),group=data.nations[0].groups[0];
 group.totals.singleRoomsPending=2;group.totals.singleRoomsApproved=1;group.totals.quotaExemptSingleRooms=1;
 const visible=text(html(data));
 for(const label of ['2 EZ offen','Genehmigt','Ausnahmen','nicht abschließend bewertet'])assert.ok(visible.includes(label));
 assert.ok(!visible.includes('Officials überschritten'));
});
test('additional unassigned functions remain visible in the distinct person total',()=>{
 const data=copy();Object.assign(data.nations[0],{peopleTotal:25,otherPeople:1});
 const visible=text(html(data));assert.ok(visible.includes('1 weitere / unzugeordnete Personen'));
});
test('only athlete view shows competition hierarchy; officials keep direct existing-list navigation',()=>{
 const overview=copy(),nation=overview.nations[0].nationCode;
 const halfpipe={id:'1',name:"Men's Snowboard Halfpipe",group:'Snowboard Park & Pipe',gender:'M'};
 const air={...halfpipe,id:'2',name:"Men's Snowboard Big Air"};
 const preview={people:[{matchKey:'athlete',function:'Athlete',gender:'M',nationCode:nation},{matchKey:'staff',function:'NSA Coach',gender:'M',nationCode:nation}]};
 const control={people:[{personKey:'athlete',competitions:[halfpipe,air]},{personKey:'staff',competitions:[halfpipe]}],competitions:[halfpipe,air],issues:[]};
 const before=structuredClone({overview,preview,control});
 for(const kind of ['athlete','officials']){
  const output=html(overview,kind,{preview,control,onPeople:()=>{throw Error('render must not navigate');}});
  assert.equal((output.match(/Sportliche Meldungen · FIS-Zuteilung nicht bestätigt/g)||[]).length,kind==='athlete'?1:0);
  const hierarchy=output.match(/<table[^>]*><caption[^>]*>Sportliche Meldungen[\s\S]*?<\/table>/)?.[0]??'';
  const rows=[...hierarchy.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(row=>text(row[1]).trim());
  if(kind==='athlete')assert.deepEqual(rows,['Wettbewerb Gemeldet / regulär Bewertung','Männer Frauen','Snowboard Park &amp; Pipe 1 eindeutige Athleten · 1 Männer · 0 Frauen','Halfpipe 1 / — 0 / — Bewertung unvollständig','Big Air 1 / — 0 / — Bewertung unvollständig']);
  if(kind==='officials'){
   for(const group of overview.nations[0].groups)assert.ok(output.includes(`aria-label="Officials ${group.name.replaceAll('&','&amp;')} anzeigen"`));
   assert.ok(output.includes('5 Mehrfachzugehörigkeiten'));
   assert.ok(!output.includes('Keine offenen EZ-Entscheidungen'));
   assert.ok(output.includes('Berechnungsbasis EZ'));
   assert.ok(!output.includes('Sportliche Meldungen'));
  }
 }
 assert.deepEqual({overview,preview,control},before);
});


test('personal EZ summary separates one open context from several open people and uses existing people buttons',()=>{
 const overview=copy(),nation=overview.nations[0];nation.ezDecisionsOpen=1;
 const preview={people:[['one','COVERED'],['two','APPROVED_EXTRA'],['three','EXEMPT'],['four','PENDING'],['five','PENDING']].map(([matchKey,status])=>({
  matchKey,nationCode:nation.nationCode,function:'NSA Coach',singleRoomAllocation:{identity:matchKey,status,context:[nation.nationCode,'Ski Cross','M']}})),rooms:[]};
 const output=html(overview,'officials',{preview,onPeople:()=>{throw Error('render must not navigate');}}),visible=text(output);
 for(const label of ['1 offener EZ-Kontext','5 EZ:','1 regulär','1 zusätzlich genehmigt','1 Ausnahme (Grund unklar)','2 noch offen'])assert.ok(visible.includes(label),label);
 for(const label of ['Angeforderte EZ-Personen anzeigen','regulär gedeckt: Personen anzeigen','EZ offen: Personen anzeigen'])assert.ok(output.includes(`aria-label="${label}"`));
 assert.ok(!visible.includes('Zulässige Officials'));
});

test('ITA personal acceptance: 25 officials, 8 requests, 7 covered and 1 exempt across three groups',()=>{
 const overview=copy(),nation=overview.nations[0];nation.officials=25;nation.officialsInMultipleGroups=5;
 nation.groups=[
  {name:'Snowboard Alpine',athletes:14,officials:11,values:[[9,11,3,3,0],[5,7,3,1,0]]},
  {name:'Snowboard Cross',athletes:7,officials:12,values:[[4,6,2,1,1],[3,5,2,1,0]]},
  {name:'Snowboard Park & Pipe',athletes:4,officials:11,values:[[2,4,2,2,0],[2,4,2,0,0]]},
 ].map(group=>{
  const contexts=group.values.map(([athletes,officialQuota,singleRoomsAllowed,singleRoomsRequested,quotaExemptSingleRooms],i)=>({nationCode:'ITA',discipline:group.name,gender:i?'W':'M',athletes,officialQuota,officials:group.officials,singleRoomsAllowed,singleRoomsRequested,quotaExemptSingleRooms,singleRooms:singleRoomsRequested-quotaExemptSingleRooms,singleRoomsPending:0,singleRoomsApproved:0,officialsExceeded:true,singleRoomsExceeded:false}));
  return {name:group.name,athletes:group.athletes,officials:group.officials,contexts,coverageReviewRequired:true,totals:{officialQuota:contexts.reduce((n,c)=>n+c.officialQuota,0),singleRoomsAllowed:contexts.reduce((n,c)=>n+c.singleRoomsAllowed,0),singleRoomsRequested:contexts.reduce((n,c)=>n+c.singleRoomsRequested,0),quotaExemptSingleRooms:contexts.reduce((n,c)=>n+c.quotaExemptSingleRooms,0),singleRoomsPending:0,singleRoomsApproved:0}};
 });
 const people=Array.from({length:25},(_,i)=>({matchKey:`staff-${i}`,nationCode:'ITA',function:'NSA Coach',singleRoomQuotaExemptReason:i===7?'WORLD_CHAMPION':null,singleRoomAllocation:i<8?{identity:`staff-${i}`,status:i===7?'EXEMPT':'COVERED',context:['ITA',nation.groups[i%3].name,'M']}:null}));
 people.push({...people[0],matchKey:'same-person-second-group'});
 const preview={people,rooms:[]};const before=structuredClone({overview,preview});
 const output=html(overview,'officials',{preview,onPeople:()=>{}}),visible=text(output);
 for(const label of ['25 eindeutige Officials','Alle 8 EZ gedeckt:','7 regulär','1 WM-Ausnahme','5 Mehrfachzugehörigkeiten'])assert.ok(visible.includes(label),label);
 assert.ok(!visible.includes('Abdeckung prüfen'));assert.ok(!visible.includes('Officials überschritten'));
 const header=output.match(/<thead>([\s\S]*?)<\/thead>/)?.[1]??'';assert.ok(!header.includes('Berechnungsbasis'));assert.ok(output.includes('Berechnungsbasis EZ'));
 assert.deepEqual({overview,preview},before);
});
test('missing personal evidence is neutral, while existing pending EZ persons remain explicit',()=>{
 const overview=copy();const missing=html(overview,'officials',{preview:{people:[{matchKey:'old',nationCode:'ITA'}],rooms:[]}});
 assert.ok(missing.includes('EZ-Bewertung unvollständig'));assert.ok(missing.includes('data-tone="neutral"'));
 assert.ok(!missing.includes('Quotenverletzung bestätigt'));
 const pending=html(overview,'officials',{preview:{people:[{matchKey:'p',nationCode:'ITA',singleRoomAllocation:{identity:'p',status:'PENDING',context:null}}],rooms:[]}});
 assert.ok(text(pending).includes('1 noch offen'));assert.ok(!pending.includes('EZ abgedeckt'));
});
test('role names alone never produce an EZ exemption or a special tariff',()=>{
 const overview=copy();const preview={people:['NSA President','NSA Secretary General','Unknown role'].map((functionName,i)=>({matchKey:`role-${i}`,function:functionName,nationCode:'ITA',accommodationRateCategory:i===1?'SPECIAL':'STANDARD',singleRoomAllocation:{identity:`role-${i}`,status:'COVERED',context:['ITA','Ski Cross','M']}})),rooms:[]};
 const before=structuredClone(preview),visible=text(html(overview,'officials',{preview}));
 assert.ok(visible.includes('3 regulär'));assert.ok(!visible.includes('WM-Ausnahme'));assert.ok(!visible.includes('allgemeine Ausnahme'));assert.deepEqual(preview,before);
});

test('JPN two title holders use only the single-room exemption; ITA retains reason-specific person navigation',()=>{
 for(const nationCode of ['JPN','ITA']){
  const overview=copy();overview.nations[0].nationCode=nationCode;
  const people=[
   {matchKey:'title-single',nationCode,singleRoomQuotaExemptReason:'WORLD_CHAMPION',roomType:'Single',singleRoomAllocation:{identity:'one',status:'EXEMPT',context:[nationCode,'Snowboard Alpine','W']}},
   {matchKey:'title-double',nationCode,singleRoomQuotaExemptReason:'WORLD_CHAMPION',roomType:'Double shared',singleRoomAllocation:null},
   {matchKey:'general',nationCode,singleRoomQuotaExemptReason:'OTHER',roomType:'Single',singleRoomAllocation:{identity:'two',status:'EXEMPT',context:[nationCode,'Snowboard Alpine','W']}},
  ];
  const preview={people,rooms:[]},before=structuredClone(preview);
  const output=html(overview,'officials',{preview,onPeople:()=>{}}),visible=text(output);
  for(const label of ['Alle 2 EZ gedeckt:','1 WM-Ausnahme','1 allgemeine Ausnahme'])assert.ok(visible.includes(label),label);
  assert.ok(!visible.includes('2 WM-EZ-Ausnahmen'));
  for(const label of ['WM-EZ-Ausnahme: Personen anzeigen','Allgemeine EZ-Ausnahme: Personen anzeigen'])assert.ok(output.includes(`aria-label="${label}"`));
  assert.deepEqual(preview,before);
 }
});

test('EZ sentences explain JPN open and ITA fully covered allocations and preserve each reason action',()=>{
 for(const open of [true,false]){
  const overview=copy(),nation=overview.nations[0];nation.nationCode=open?'JPN':'ITA';nation.groups=nation.groups.slice(0,1);
  const group=nation.groups[0];Object.assign(group.totals,{singleRoomsRequested:8,singleRoomsPending:open?1:0,singleRoomsApproved:0,quotaExemptSingleRooms:1});
  const people=Array.from({length:8},(_,i)=>({matchKey:`p${i}`,nationCode:nation.nationCode,singleRoomQuotaExemptReason:i===6?'WORLD_CHAMPION':null,singleRoomAllocation:{identity:`p${i}`,status:i===6?'EXEMPT':i===7&&open?'PENDING':'COVERED',context:[nation.nationCode,group.name,'W']}}));
  const preview={people:[...people,{matchKey:'title-double',nationCode:nation.nationCode,singleRoomQuotaExemptReason:'WORLD_CHAMPION',roomType:'Double shared',singleRoomAllocation:null}],rooms:[]},before=structuredClone(preview);
  const output=html(overview,'officials',{preview,onPeople:()=>{}}),visible=text(output);
  assert.ok(visible.includes(open?'8 EZ: 6 regulär + 1 WM-Ausnahme, 1 noch offen':'Alle 8 EZ gedeckt: 7 regulär + 1 WM-Ausnahme'),visible);
  if(open)assert.ok(!output.includes('data-tone="success"'));
  assert.ok(output.includes('aria-label="WM-EZ-Ausnahme: Personen anzeigen"'));assert.deepEqual(preview,before);
 }
});

test('general exemption and approved extra are distinct; missing or conflicting evidence never turns green',()=>{
 const overview=copy(),nation=overview.nations[0],group=nation.groups[0];nation.groups=[group];
 Object.assign(group.totals,{singleRoomsRequested:3,singleRoomsPending:0,singleRoomsApproved:1,quotaExemptSingleRooms:1});
 const people=['COVERED','APPROVED_EXTRA','EXEMPT'].map((status,i)=>({matchKey:`p${i}`,nationCode:nation.nationCode,singleRoomQuotaExemptReason:i===2?'OTHER':null,singleRoomAllocation:{identity:`p${i}`,status,context:[nation.nationCode,group.name,'W']}}));
 const preview={people,rooms:[]};const initial=html(overview,'officials',{preview,onPeople:()=>{}});
 assert.ok(text(initial).includes('Alle 3 EZ gedeckt: 1 regulär + 1 zusätzlich genehmigt + 1 allgemeine Ausnahme'));
 for(const action of ['zusätzliche EZ genehmigt','Allgemeine EZ-Ausnahme'])assert.ok(initial.includes(`aria-label="${action}: Personen anzeigen"`));
 people[2].singleRoomQuotaExemptReason=null;
 const missing=html(overview,'officials',{preview});assert.ok(text(missing).includes('Ausnahme (Grund unklar)'));assert.ok(!missing.includes('data-tone="success"'));
 people.push({...people[0],matchKey:'conflicting-source',singleRoomAllocation:{...people[0].singleRoomAllocation,context:[nation.nationCode,'different-group','W']}});
 const conflicting=html(overview,'officials',{preview});assert.ok(text(conflicting).includes('unvollständig'));assert.ok(!conflicting.includes('data-tone="success"'));
});
