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
const html=(value:QuotaOverview,kind='officials')=>renderToStaticMarkup(createElement(Content,{overview:value,kind}));
const text=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const copy=()=>structuredClone(fixture);

test('ITA: distinct nation/group counts, overlap explanation and no speculative coverage',()=>{
 const output=html(copy());const visible=text(output);
 for(const label of ['Athleten gesamt','Officials gesamt','Personen gesamt','Officials gemeldet: 9 eindeutige Personen','Officials gemeldet: 10 eindeutige Personen','5 Officials sind in beiden Event Groups gemeldet','14 unterschiedliche Officials','Männer','Frauen','Gesamt','Quotenabdeckung fachlich zu prüfen'])assert.ok(visible.includes(label),label);
 assert.equal((visible.match(/Officials gemeldet:/g)||[]).length,2);
 assert.ok(!visible.includes('Mehrpreisfall genehmigt'));
 assert.ok(output.includes('overflow-x-auto')&&output.includes('role="region"')&&output.includes('tabindex="0"'));
});
test('athlete limits/genders and fixed WM revision have understandable labels',()=>{
 const visible=text(html(copy(),'athlete'));
 for(const label of ['WM-Quotenregel','Revision 3','fixiert','Nation ITA','Freestyle / Freeski','10 Athleten gemeldet','Reguläres Limit: 36','6 von 20','4 von 20','Innerhalb der Quote'])assert.ok(visible.includes(label),label);
 assert.ok(!visible.includes('0 / 0 / 0'));
});
test('partial approval separates total and gender limits, without inventing a distinct count',()=>{
 const data=copy(),nation=data.nations[0],row=nation.athleteFamilies[0];
 Object.assign(row,{athleteQuotaUsed:40,athleteQuotaStatus:'EXCEEDED',decisionStatus:'PENDING',approvedExtent:{total:2,M:1,F:0},uncoveredExtent:{total:2,M:0,F:0}});
 nation.athletes=40;nation.athletesApprovedDistinct=null;nation.athleteDecisionsOpen=1;
 const visible=text(html(data,'athlete'));
 for(const label of ['Umfang je Grenze','Gesamtgrenze','Männergrenze','Frauengrenze','1 Entscheidung erforderlich','Noch ungedeckt'])assert.ok(visible.includes(label),label);
 assert.ok(!visible.includes('Innerhalb der Quote'));
 row.decisionStatus='APPROVED';row.uncoveredExtent={total:0,M:0,F:0};nation.athleteDecisionsOpen=0;
 assert.ok(text(html(data,'athlete')).includes('Bereits genehmigt'));
});
test('draft, non-WM and incomplete data cannot look compliant',()=>{
 const data=copy();data.event.isWorldChampionship=false;data.event.rulesFixed=false;data.nations[0].incomplete=true;
 const visible=text(html(data,'athlete'));
 assert.ok(visible.includes('Nicht-WM')&&visible.includes('Entwurf')&&visible.includes('Quotendaten prüfen'));
 assert.ok(!visible.includes('Innerhalb der Quote'));
});
test('additional unassigned functions do not disappear into a misleading national total',()=>{
 const data=copy();Object.assign(data.nations[0],{peopleTotal:25,otherPeople:1});
 const visible=text(html(data));
 assert.ok(visible.includes('Athleten + Officials')&&visible.includes('Vollständige Meldung: 25 Personen'));
 assert.ok(visible.includes('nicht in der Summe Athleten + Officials enthalten'));
});
