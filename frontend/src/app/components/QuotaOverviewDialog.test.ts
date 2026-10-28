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
 for(const label of ['24 Personen','10 Athleten','14','eindeutige Officials','EZ-Anspruch Σ M/W','EZ angefordert','Fachlich prüfen','5 Officials in mehreren Event Groups','Σ M/W','Officials-Basis'])assert.ok(visible.includes(label),label);
 assert.equal((output.match(/<details/g)||[]).length,2);assert.ok(!output.includes(' open=""'));
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
 for(const kind of ['athlete','officials']){const visible=text(html(data,kind));assert.ok(visible.includes('Nicht-WM')&&visible.includes('Entwurf')&&visible.includes('Fachlich prüfen'));assert.ok(!visible.includes('Innerhalb der Quote'));}
});
test('EZ approvals and exemptions stay visible without inventing officials coverage',()=>{
 const data=copy(),group=data.nations[0].groups[0];
 group.totals.singleRoomsPending=2;group.totals.singleRoomsApproved=1;group.totals.quotaExemptSingleRooms=1;
 const visible=text(html(data));
 for(const label of ['2 EZ offen','1 zusätzliche EZ genehmigt','1 EZ-Ausnahmen','Fachlich prüfen'])assert.ok(visible.includes(label));
 assert.ok(!visible.includes('Officials überschritten'));
});
test('additional unassigned functions remain visible in the distinct person total',()=>{
 const data=copy();Object.assign(data.nations[0],{peopleTotal:25,otherPeople:1});
 const visible=text(html(data));assert.ok(visible.includes('25 Personen')&&visible.includes('1 weitere / unzugeordnete Personen'));
});
test('both views retain exactly one competition hierarchy and provide existing-list navigation',()=>{
 const overview=copy(),nation=overview.nations[0].nationCode;
 const halfpipe={id:'1',name:"Men's Snowboard Halfpipe",group:'Snowboard Park & Pipe',gender:'M'};
 const air={...halfpipe,id:'2',name:"Men's Snowboard Big Air"};
 const preview={people:[{matchKey:'athlete',function:'Athlete',gender:'M',nationCode:nation},{matchKey:'staff',function:'NSA Coach',gender:'M',nationCode:nation}]};
 const control={people:[{personKey:'athlete',competitions:[halfpipe,air]},{personKey:'staff',competitions:[halfpipe]}],competitions:[halfpipe,air],issues:[]};
 const before=structuredClone({overview,preview,control});
 for(const kind of ['athlete','officials']){
  const output=html(overview,kind,{preview,control,onPeople:()=>{throw Error('render must not navigate');}});
  assert.equal((output.match(/<caption class="sr-only">Wettbewerbsteilnehmer nach Geschlecht/g)||[]).length,1);
  const hierarchy=output.match(/<table[^>]*><caption class="sr-only">Wettbewerbsteilnehmer nach Geschlecht[\s\S]*?<\/table>/)?.[0]??'';
  const rows=[...hierarchy.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(row=>text(row[1]).trim());
  assert.deepEqual(rows,['Disziplin / Wettbewerb Männer Frauen Gesamt','Snowboard Park &amp; Pipe 1 0 1','Halfpipe 1 0 1','Big Air 1 0 1']);
  if(kind==='officials'){
   for(const group of overview.nations[0].groups)assert.ok(output.includes(`aria-label="Officials ${group.name.replaceAll('&','&amp;')} anzeigen"`));
   assert.ok(output.includes('Personen anzeigen'));
  }
 }
 assert.deepEqual({overview,preview,control},before);
});
