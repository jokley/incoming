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
const preview={errors:[],warnings:[],quotaChecks:[],athleteQuotaChecks:[check],dispositionAnalysis:{changes:[]}};
test('four responsive preview tiles show actual family data and open decisions',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview,peopleRows:[],roomRows:[],onOpen:()=>{}}));
  for(const label of ['Personen','Zimmerzuordnungen','Officials &amp; EZ-Quote','Athleten-/Disziplinquote','1 Quotenfamilien','1 offene Entscheidungen','Genehmigung erforderlich'])assert.ok(html.includes(label),label);
  assert.match(html,/sm:grid-cols-2 2xl:grid-cols-4/);
  assert.deepEqual(rows(preview)[0],['Snowboard','40 / 36','21 / 20','19 / 20','2 / 1 / 0','2 / 0 / 0','Offen']);
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
