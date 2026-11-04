import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('only exact database metadata GETs work without an operational event lease', async t => {
  const server = await createServer({configFile:false,envFile:false,logLevel:'silent',
    define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},
    server:{middlewareMode:true,hmr:false,ws:false,watch:null}});
  t.after(()=>server.close());
  const {api}=await server.ssrLoadModule('/src/app/services/api.ts');
  const calls: {url:string;headers:Headers}[]=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls.push({url:String(url),headers:new Headers(init?.headers)});
    return Response.json({});
  });
  await api.getDatabaseStatus();await api.getDatabaseBackups();
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>!c.headers.has('X-Championship-Event-ID')));
  await api.createDatabaseBackup();
  assert.equal(calls.length,3);
  assert.equal(calls.at(-1)?.headers.has('X-Championship-Event-ID'),false);
  await api.getAdminEvents(); await api.getAdminEvent('7'); await api.getChampionLists();
  assert.equal(calls.at(-2)?.headers.get('X-Championship-Event-ID'),'7');
  assert.equal(api.eventScope.eventId,null);
  await assert.rejects(api.getAthletes(),/Eventkontext/);
  // Download remains a backend-authorized global export; test denied response without DOM save.
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:403}));
  await assert.rejects(api.downloadDatabaseBackup('test.dump.gz','manual'),/FORBIDDEN/);
  const {DatabaseBackups}=await server.ssrLoadModule('/src/app/components/DatabaseBackups.tsx');
  const markup=renderToStaticMarkup(createElement(DatabaseBackups));
  assert.match(markup,/HTTP-Erreichbarkeit ist kein Sicherungsnachweis/);
  assert.match(markup,/Nicht nachgewiesen/);
  // No capability response has arrived: safe default is disabled controls.
  assert.match(markup, /disabled=""[^>]*>.*?Backup jetzt erstellen/s);
});
