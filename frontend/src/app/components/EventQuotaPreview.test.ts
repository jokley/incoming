import assert from 'node:assert/strict';
import {test,after,before} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer,type ViteDevServer} from 'vite';
import {fileURLToPath} from 'node:url';
let server:ViteDevServer;let Preview:any;let rows:any;
before(async()=>{
  server=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../../../../node_modules/.vite-quota-preview',import.meta.url)),root:fileURLToPath(new URL('../../..',import.meta.url)),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});
  const mod=await server.ssrLoadModule('/src/app/components/DataImport.tsx');Preview=mod.PreviewCard;rows=mod.athleteQuotaRows;
});
after(async()=>{await server?.close()});
const check={topLevelDiscipline:'Snowboard',athleteQuotaUsed:40,athleteQuotaLimit:36,athleteGenderUsed:{M:21,F:19},athleteGenderLimit:20,athleteQuotaStatus:'EXCEEDED',decisionStatus:'PENDING',approvedExtent:{total:2,M:1,F:0},uncoveredExtent:{total:2,M:0,F:0}};
const preview={people:[],rooms:[],errors:[],warnings:[],quotaChecks:[],athleteQuotaChecks:[check],dispositionAnalysis:{changes:[]}};
test('four responsive preview tiles show actual family data and open decisions',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview,peopleRows:[],roomRows:[],onOpen:()=>{}}));
  for(const label of ['Personen','Zimmerzuordnungen','Officials &amp; EZ-Quote','Athleten-/Disziplinquote','40 / 36','Familienquote','Genehmigung erforderlich'])assert.ok(html.includes(label),label);
  assert.match(html,/sm:grid-cols-2 2xl:grid-cols-4/);
  assert.deepEqual(rows(preview)[0],['Snowboard','40 / 36','21 / 20','19 / 20','Gesamtgrenze: 2 · Männer: 1 · Frauen: 0','Gesamtgrenze: 2 · Männer: 0 · Frauen: 0','Offen']);
});
test('an incomplete check is not presented as quota compliant',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,athleteQuotaChecks:[{...check,athleteQuotaStatus:'INCOMPLETE'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
  assert.match(html,/Unvollständige Quotendaten/);
});

test('a covered excess stays visibly distinct from a base-quota result',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,athleteQuotaChecks:[{...check,decisionStatus:'APPROVED'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
  assert.match(html,/Überschreitung genehmigt/);
});
test('an unresolved family cannot appear quota compliant when no rows were calculated',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,athleteQuotaChecks:[],errors:[{code:'ATHLETE_QUOTA_FAMILY_UNKNOWN'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
  assert.match(html,/Quotendaten unvollständig/);
});


test('unmapped blocking file errors remain visible in the relevant tile',()=>{
 const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,errors:[{code:'ENTRY_MISSING_COLUMNS',message:'Pflichtspalten fehlen'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
 assert.match(html,/1 Importfehler/);
});

test('family tile surfaces CAN one and GER two unresolved positions without summing athletes',()=>{
 const competition=(id:string,name:string,count:number)=>({id,name,gender:'M',sportEntries:[{nation:'CAN',unverifiedAdditional:count}]});
 const control={competitions:[competition('ss',"Men's Slopestyle",0),competition('ba',"Men's Big Air",1)],people:[],issues:[]};
 const data={...preview,athleteQuotaChecks:[{...check,athleteQuotaUsed:14,athleteQuotaStatus:'WITHIN_QUOTA',decisionStatus:null}],quotaOverview:{event:{rulesFixed:true},nations:[]}};
 const render=()=>renderToStaticMarkup(createElement(Preview,{preview:data,control,peopleRows:[],roomRows:[],onOpen:()=>{}}));
 const can=render();assert.ok(can.includes('14 / 36')&&can.includes('Familienquote OK')&&can.includes('1 Zusatzrecht prüfen')&&can.includes('Big Air Männer'));
 control.competitions[0].sportEntries[0].unverifiedAdditional=5;control.competitions[1].sportEntries[0].unverifiedAdditional=5;
 const ger=render();assert.ok(ger.includes('2 Wettbewerbspositionen prüfen'));assert.ok(!ger.includes('10 Wettbewerbspositionen'));
});
