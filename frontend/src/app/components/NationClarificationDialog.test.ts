import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createServer,type ViteDevServer} from 'vite';
import {fileURLToPath} from 'node:url';
let server:ViteDevServer;let suggestions:(keys:string[],people:Array<{personKey:string}>)=>string[];
before(async()=>{
  server=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../../../../node_modules/.vite-clarification',import.meta.url)),root:fileURLToPath(new URL('../../..',import.meta.url)),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});
  suggestions=(await server.ssrLoadModule('/src/app/components/NationClarificationDialog.tsx')).suggestedPeople;
});
after(async()=>{await server?.close()});
test('a problem group proposes twelve unique current people and excludes absent references',()=>{
  const people=Array.from({length:12},(_,i)=>({personKey:`p${i}`}));
  const keys=[...people.map(p=>p.personKey),'old-person','p0'];
  assert.deepEqual(suggestions(keys,people),people.map(p=>p.personKey));
  assert.equal(keys.length,14);
});
