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

test('officials show context triples in one table with distinct totals and collapsed coverage details',()=>{
 const data=copy(),output=html(data),visible=text(output);
 for(const label of ['14','Officials','0 offene EZ-Kontexte','Erlaubt','Angefragt','nicht abschließend bewertet','5 Mehrfachzugehörigkeiten','Berechnungsbasis EZ'])assert.ok(visible.includes(label),label);
 assert.equal((output.match(/<details/g)||[]).length,data.nations[0].groups.length+1);assert.ok(!output.includes(' open=""'));
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
 for(const label of ['Ausnahmen','nicht abschließend bewertet','Angefragt','Abweichung'])assert.ok(visible.includes(label));
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


test('optional area headers preserve every official context, aggregate and gender cell',()=>{
 const data=copy(),before=structuredClone(data);
 const control={quotaGroups:data.nations[0].groups.map(g=>({name:g.name,family:'Freestyle'}))};
 const flat=html(data,'officials',{control}),off=html(data,'officials',{control,grouped:false});
 assert.equal(off,flat);
 const grouped=html(data,'officials',{control,grouped:true});
 const cells=(value:string)=>[...value.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m=>m[1]);
 assert.deepEqual(cells(grouped),cells(flat));
 assert.equal((grouped.match(/scope="rowgroup"/g)||[]).length,data.nations[0].groups.length+1);
 assert.match(grouped,/Freestyle \/ Freeski/);
 assert.deepEqual(data,before);
 const unknown=html(data,'officials',{grouped:true});assert.match(unknown,/Nicht zugeordnet/);
});

test('live quota view exposes contextless pending people instead of an empty or fulfilled overall result',async()=>{
 const Panel=(await server.ssrLoadModule('/src/app/components/Assignments.tsx')).QuotasPanel;
 const props={rows:[],allUnits:[],assignedUnits:[],onSelect:()=>{},filterNation:'',onFilterNation:()=>{},filterDiscipline:'',onFilterDiscipline:()=>{},filterGender:'',onFilterGender:()=>{},nationOptions:[],disciplineOptions:[],genderOptions:[],refreshing:false};
 const person={personId:'42',name:'Synthetic Official',nationCode:'AUT',status:'PENDING',context:null,reason:'Kein gültiger Quotenkontext zuordenbar'};
 const output=renderToStaticMarkup(createElement(Panel,{...props,unallocated:[person]}));
 const visible=text(output);
 for(const label of ['1 offene EZ-Klärungsfälle','Synthetic Official','Person 42',person.reason,'Handlungsbedarf'])assert.ok(visible.includes(label),label);
 assert.ok(!visible.includes('Keine Quoten verfügbar')&&!visible.includes('Quote erfüllt'));
 const flat=renderToStaticMarkup(createElement(Panel,props));
 assert.equal(renderToStaticMarkup(createElement(Panel,{...props,unallocated:[]})),flat);
});

test('person work summary uses supplied totals and hides stale success during evaluation',async()=>{
 const {PersonWorkSummary,PersonStatusIcons,PersonDispositionContext}=await server.ssrLoadModule('/src/app/components/assignment/PersonDispositionStatus.tsx');
 const summary={peopleTotal:7,accommodationPeopleRequired:7,fullyAssigned:4,unassigned:1,partiallyAssigned:1,accommodationConflicts:1,roomPreferenceMismatches:2,pendingSingleRoomPeople:3,contextlessPendingSingleRoomPeople:1};
 const props={summary,scope:'Eventgesamt · Personen',family:'',onFamily:()=>{},onCategory:()=>{},onRetry:()=>{}};
 const ready=renderToStaticMarkup(createElement(PersonWorkSummary,{...props,ready:true,loading:false}));
 assert.match(text(ready),/Vollständig 4 \/ 7/);assert.match(text(ready),/EZ ungeklärt 3/);
 const waiting=renderToStaticMarkup(createElement(PersonWorkSummary,{...props,ready:false,loading:true}));
 assert.ok(!text(waiting).includes('4 / 7'));assert.match(text(waiting),/wird aktualisiert/);
 const person={personId:'1',name:'Synthetic',accommodation:{coverageStatus:'FULLY_ASSIGNED'},roomPreference:{status:'MISMATCH',hasMismatch:true},singleRoom:{status:'PENDING',reason:'Kein gültiger Quotenkontext zuordenbar'}};
 const icons=(valid:boolean)=>renderToStaticMarkup(createElement(PersonDispositionContext.Provider,{value:{people:new Map([['1',person]]),ready:valid,onOpen:()=>{}}},createElement(PersonStatusIcons,{personId:'1'})));
 assert.equal((icons(true).match(/<button/g)||[]).length,2);
 assert.ok(icons(true).includes('EZ-Klärung erforderlich')&&icons(true).includes('Zimmerwunsch abweichend'));
 assert.ok(!icons(false).includes('text-[var(--ops-success)]'));
});


test('person details distinguish reported request, actual accommodation and single-room coverage',async()=>{
 const {PersonStatusDetails}=await server.ssrLoadModule('/src/app/components/assignment/PersonDispositionStatus.tsx');
 const person={personId:'1',nationCode:'AUT',personalGender:'W',matchesContextFilters:true,
  accommodation:{coverageStatus:'FULLY_ASSIGNED',overallInterval:{checkInDate:'2027-03-11',checkOutDate:'2027-03-23'},coveredIntervals:[],openIntervals:[],conflicts:[]},
  roomPreference:{reportedValue:'Double shared',status:'MATCH',segments:[]},
  singleRoom:{status:'NO_SINGLE_USE',eligibleContexts:[]}};
 for(const [raw,label] of [['Double shared','Doppelzimmer (geteilt)'],['Single','Einzelzimmer'],['Double','Doppelzimmer'],['Twin','Zweibettzimmer'],['Custom request','Custom request'],['','Nicht angegeben']]){
  person.roomPreference.reportedValue=raw;
  const output=text(renderToStaticMarkup(createElement(PersonStatusDetails,{person,onDetails:()=>{},onBooking:()=>{},onDecision:()=>{}})));
  assert.ok(output.includes(`Gemeldeter Zimmerwunsch: ${label}`));
  assert.ok(output.includes('Tatsächliche Unterbringung'));
  assert.ok(output.includes('EZ-Deckung'));
  assert.ok(output.includes('Keine EZ-Nutzung'));
  assert.ok(!output.includes('Vertragszusage'));
  assert.equal(person.roomPreference.reportedValue,raw);
 }
});

function operationalControls(expected=4) {
 const nation=fixture.nations[0].nationCode,discipline=fixture.nations[0].groups[0].name;
 const area={areaId:'scope',nationCode:nation,discipline,personalGender:'M',reportedCount:9,expectedTotal:4,virtualPlaces:4,worldChampionCount:0,conflict:false,reasons:[],editable:true,baseToken:'current'};
 const quota={nationCode:nation,discipline,gender:'M',athletesEntered:9,expectedAthletes:4,officialQuota:6,registeredOfficials:10,singleRoomOfficialBasis:6,singleRoomsAllowed:2,singleRoomsRequested:4,singleRoomsPending:2,approvedExtraSingleRooms:0,officialsExceeded:true,coverageChanged:true,fisOfficialQuota:11,fisSingleRoomsAllowed:3};
 const values=expected===5?{cap:7,rooms:3,pending:0}:{cap:6,rooms:2,pending:1};
 Object.assign(quota,{expectedAthletes:expected,officialQuota:values.cap,singleRoomOfficialBasis:values.cap,singleRoomsAllowed:values.rooms,singleRoomsRequested:3,singleRoomsPending:values.pending});
 const context={...quota,athletes:expected,singleRoomsApproved:0};
 const overview=copy();overview.nations=[{...overview.nations[0],officials:10,groups:[{name:discipline,athletes:9,officials:10,coverageReviewRequired:false,contexts:[context],totals:{officialQuota:values.cap,singleRoomOfficialBasis:values.cap,expectedAthletes:expected,singleRoomsAllowed:values.rooms,singleRoomsRequested:3,singleRoomsApproved:0,singleRoomsPending:values.pending,quotaExemptSingleRooms:0}}]}] as any;
 const people=Array.from({length:3},(_,i)=>({matchKey:'o'+i,nationCode:nation,singleRoomQuotaExemptReason:null,singleRoomAllocation:{identity:'o'+i,personKey:'o'+i,status:i<values.rooms?'COVERED':'PENDING',context:[nation,discipline,'M']}}));
 return {planning:{mode:'IMPORT',rows:[area],operationalQuota:{rows:[quota],overview,people,conflict:false,reasons:[]}},choices:[{areaId:'scope',baseToken:'current',expectedTotal:expected}],onChange:()=>{},disabled:false};
}

test('athlete dialog removes the NN cards while Officials keeps authoritative operative results',()=>{
 const nn=operationalControls();
 const athlete=html(copy(),'athlete',{nn});
 assert.ok(!athlete.includes('Unterkunftsbedarf und operative Officials-/EZ-Quote'));
 assert.ok(!athlete.includes('<select'));
 const visible=text(html(copy(),'officials',{nn}));
 assert.ok(visible.includes('4 für Unterkunft eingeplant'));
 assert.ok(visible.includes('2 regulär'));assert.ok(visible.includes('1 noch offen'));
});

test('Officials view hides stale operative figures during reloads or errors but preserves the named FIS snapshot',()=>{
 for(const extra of [{busy:true},{error:'Vorschau fehlgeschlagen'}]) {
  const output=html(copy(),'officials',{nn:{...operationalControls(),...extra}});
  assert.ok(!output.includes('<table'));
  assert.ok(output.includes(extra.busy?'Operative Vorschau wird berechnet':'Vorschau fehlgeschlagen'));
 }
});

test('unresolved person selections explicitly show the normal fallback in both quota views',()=>{
 const nn=operationalControls();
 Object.assign(nn.planning.rows[0],{conflict:true,reasons:['Bestand geändert'],virtualPlaces:0});
 Object.assign(nn.planning.operationalQuota,{conflict:true,reasons:['Bestand geändert']});
 Object.assign(nn.planning.operationalQuota.rows[0],{nnForecastBlocked:true,expectedAthletes:9,officialQuota:11,singleRoomOfficialBasis:10,singleRoomsAllowed:3});
 Object.assign(nn.planning.operationalQuota.overview.nations[0].groups[0].contexts[0],nn.planning.operationalQuota.rows[0]);
 for(const kind of ['athlete','officials']) {
  const output=html(copy(),kind,{nn}),visible=text(output);
  assert.ok(visible.includes(kind==='athlete'?'Personenauswahl klären':'Personenauswahl klären · normale Athletenbasis'));
  if(kind==='officials'){assert.ok(!visible.includes('9 geplant'));assert.ok(visible.includes('Auswahl ungeklärt; normale Basis'));}


  assert.ok(!visible.includes('Operative Officials-Obergrenze 6'));
  assert.ok(!output.includes('aria-label="NN-Plätze"'));
 }
});


test('one Officials table and its coverage details use the same operative allocations',()=>{
 for(const expected of [4,5]) {
  const nn=operationalControls(expected),output=html(copy(),'officials',{nn}),visible=text(output);
  assert.ok(!output.includes('<dl'));
  assert.ok(!visible.includes('Operative Prognose · Unterkunft'));
  assert.equal((output.match(/<table/g)??[]).length,1); // both triples in the existing context table
  assert.ok(visible.includes(`${expected} für Unterkunft eingeplant`));
  assert.ok(visible.includes(expected===4?'2 regulär':'3 regulär'));
  assert.equal(visible.includes('1 noch offen'),expected===4);
  assert.equal(visible.includes('Alle 3 EZ gedeckt'),expected===5);
  assert.ok(visible.includes('Originalmeldungen bleiben erhalten'));
  assert.ok(visible.includes('Zuordnungen und Bewertungsgrundlage'));
  assert.ok(!output.includes('Unterkunftserwartung bearbeiten'));
 }
});


test('operative table keeps paid approvals and verified champion exemptions in its existing chips',()=>{
 const nn=operationalControls(),op=nn.planning.operationalQuota,nation=op.overview.nations[0];
 op.people.push({matchKey:'paid',nationCode:nation.nationCode,singleRoomQuotaExemptReason:null,singleRoomAllocation:{identity:'paid',personKey:'paid',status:'APPROVED_EXTRA',context:[nation.nationCode,nation.groups[0].name,'M']}});
 op.people.push({matchKey:'champ',nationCode:nation.nationCode,singleRoomQuotaExemptReason:'WORLD_CHAMPION',singleRoomAllocation:{identity:'champ',personKey:'champ',status:'EXEMPT',context:[nation.nationCode,nation.groups[0].name,'M']}});
 Object.assign(nation.groups[0].totals,{singleRoomsRequested:5,singleRoomsApproved:1,quotaExemptSingleRooms:1});
 Object.assign(nation.groups[0].contexts[0],{singleRoomsRequested:5,singleRoomsApproved:1,quotaExemptSingleRooms:1});
 const visible=text(html(copy(),'officials',{nn}));
 assert.ok(visible.includes('2 regulär'));assert.ok(visible.includes('1 zusätzlich genehmigt'));assert.ok(visible.includes('1 WM-Ausnahme'));assert.ok(visible.includes('1 noch offen'));
});

test('primary operative quota table exposes only the Officials and EZ triples',()=>{
 const nn=operationalControls();
 nn.planning.operationalQuota.overview.nations[0].groups[0].contexts[0].officialsDeviation=4;
 const output=html(copy(),'officials',{nn});
 const headers=[...output.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(match=>text(match[1]).trim());
 assert.equal(headers.filter(h=>h==='Erlaubt').length,2);
 assert.ok(headers.includes('Vorhanden')&&headers.includes('Angefragt'));
 assert.equal(headers.filter(h=>h==='Abweichung').length,2);
 assert.ok(!headers.includes('Berechnungsbasis EZ')&&!headers.includes('Genehmigt')&&!headers.includes('Ausnahmen'));
 assert.ok(text(output).includes('+4')&&text(output).includes('+1'));
 assert.ok(!output.includes('Σ M/W'));
});


test('disposition uses operative athletes and booked allocations in the same two triples',async()=>{
 const Panel=(await server.ssrLoadModule('/src/app/components/Assignments.tsx')).QuotasPanel;
 const props={allUnits:[],assignedUnits:[],onSelect:()=>{},filterNation:'',onFilterNation:()=>{},filterDiscipline:'',onFilterDiscipline:()=>{},filterGender:'',onFilterGender:()=>{},nationOptions:[],disciplineOptions:[],genderOptions:[],refreshing:false};
 for(const pending of [0,1]) {
  const row={nationCode:'FIN',discipline:'Freeski Park & Pipe',gender:'M',athletesEntered:9,expectedAthletes:4,officialQuota:6,registeredOfficials:10,officialsDeviation:4,assignedOfficials:4,singleRoomOfficialBasis:6,singleRoomsAllowed:2,singleRoomsUsed:3,singleRoomsRequested:4,singleRoomsPending:pending,quotaExemptSingleRooms:1,approvedExtraSingleRooms:pending?0:1,singleRoomAllocations:[],quotaStatus:pending?'DECISION_REQUIRED':'EXCEPTION_APPROVED'};
  const output=renderToStaticMarkup(createElement(Panel,{...props,rows:[row]})),visible=text(output);
  assert.ok(visible.includes('4 für Unterkunft eingeplant'));
  assert.ok(!visible.includes('9 für Unterkunft eingeplant'));
  for(const label of ['Erlaubt','Vorhanden','Genutzt','Abweichung'])assert.ok(visible.includes(label),label);
  assert.equal((visible.match(/Erlaubt/g)||[]).length,2);
  assert.ok(!visible.includes('EZ-Basis')&&!visible.includes('Regulär gedeckt'));
  assert.match(visible,/Vorhanden 10 Abweichung \+4/);
  assert.match(visible,new RegExp(`Genutzt 4 Abweichung ${pending?'\\+1':'0'}`));
 }
});

test('import tile does not label the binding operative quota result as a FIS calculation',async()=>{
 const PreviewCard=(await server.ssrLoadModule('/src/app/components/DataImport.tsx')).PreviewCard;
 const preview={people:[],rooms:[],errors:[],warnings:[],quotaOverview:copy()};
 const output=renderToStaticMarkup(createElement(PreviewCard,{preview,peopleRows:[],roomRows:[],onOpen:()=>{}}));
 assert.ok(text(output).includes('EZ-Kontexte offen · Importprüfung'));
 assert.ok(!text(output).includes('EZ-Kontexte offen · FIS-Prüfstand'));
});
