import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseGeneration } from './databaseGeneration.ts';
test('restore epoch accompanies writes and changed responses cannot enter old caches', () => {
  let reloads=0;const gate=new DatabaseGeneration(()=>reloads++);
  gate.observe(new Response('',{headers:{'X-Database-Generation':'initial'}}));
  const headers=new Headers();gate.decorate(headers);assert.equal(headers.get('X-Database-Generation'),'initial');
  assert.throws(()=>gate.observe(new Response('',{headers:{'X-Database-Generation':'restored'}})),{name:'AbortError'});
  assert.equal(reloads,1);assert.throws(()=>gate.decorate(new Headers()),{name:'AbortError'});
  assert.throws(()=>gate.observe(new Response('old response')),{name:'AbortError'});
  assert.equal(reloads,1);
});

test('an old response body finishing after restore cannot populate a cache', async t => {
  const {createServer}=await import('vite');
  const server=await createServer({configFile:false,envFile:false,logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null}});
  t.after(()=>server.close());
  let reloads=0;
  const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{location:{assign:()=>reloads++}}});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');});
  let pending:ReadableStreamDefaultController<Uint8Array>|undefined;
  t.mock.method(globalThis,'fetch',async url=>{
    const generation=String(url).includes('/hotels')?'restored':'initial';
    const headers={'Content-Type':'application/json','X-Database-Generation':generation};
    if(String(url).includes('/athletes'))return new Response(new ReadableStream<Uint8Array>({start(controller){pending=controller;}}),{headers});
    return Response.json([],{headers});
  });
  const {api}=await server.ssrLoadModule('/src/app/services/api.ts');
  await api.getCurrentUser();api.eventScope.activate('1');
  const old=api.getAthletes();await new Promise(resolve=>setTimeout(resolve,0));
  await assert.rejects(api.getHotels(),{name:'AbortError'});
  pending!.enqueue(new TextEncoder().encode('[]'));pending!.close();
  await assert.rejects(old,{name:'AbortError'});
  assert.equal(reloads,1);
});
