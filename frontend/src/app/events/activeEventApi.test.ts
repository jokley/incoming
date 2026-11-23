import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('actual API facade applies context to JSON, multipart, globals and download paths', async t => {
  const server = await createServer({ configFile: false, envFile: false, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_ASSIGNMENT_PERFORMANCE': JSON.stringify('false') },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  t.after(() => server.close());
  const { api } = await server.ssrLoadModule('/src/app/services/api.ts');
  const calls: Array<{url: string; init?: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init }); return Response.json({});
  });
  await api.getCurrentUser(); await api.getActiveEventContext();
  assert.equal(new Headers(calls[0].init?.headers).has('X-Championship-Event-ID'), false);
  await assert.rejects(api.getAthletes(), /Eventkontext/);
  api.eventScope.activate('7');
  for (const call of [() => api.getAthletes(), () => api.getHotels(), () => api.getEvents(),
    () => api.getRoomTypes(), () => api.getImportSessions(), () => api.getOfficialQuotaUsage(),
    () => api.getOfficialQuotaOverview({nationCode:'AUT',discipline:'Ski Cross',gender:'M'}),
    () => api.getAuditEvents(), () => api.previewFisImport([], true, undefined, '7')]) await call();
  assert.ok(calls.slice(2).every(c => new Headers(c.init?.headers).get('X-Championship-Event-ID') === '7'));
  const overviewCall=calls.find(c=>c.url.includes('includeUnallocated=true'));
  assert.ok(overviewCall);
  assert.match(overviewCall.url,/nationCode=AUT/);
  assert.match(overviewCall.url,/discipline=Ski\+Cross/);
  assert.match(overviewCall.url,/gender=M/);
  const personCallCount=calls.length;
  await api.getOfficialQuotaOverview({includePeople:true,sportFamily:'Snowboard',personType:'OFFICIAL',personalGender:'W'});
  const personQuery=new URL(calls.at(-1)!.url,'https://example.test').searchParams;
  assert.equal(personQuery.get('includePeople'),'true');assert.equal(personQuery.get('sportFamily'),'Snowboard');
  assert.equal(personQuery.get('personType'),'OFFICIAL');assert.equal(personQuery.get('personalGender'),'W');
  assert.equal(new Headers(calls.at(-1)!.init?.headers).get('X-Championship-Event-ID'),'7');
  const multipart = calls[personCallCount-1]!;
  assert.equal(new Headers(multipart.init?.headers).has('Content-Type'), false);
  assert.equal((multipart.init!.body as FormData).get('eventId'), '7');
  const before = calls.length;
  await assert.rejects(api.previewFisImport([], true, undefined, '8'), /übereinstimmen/);
  assert.equal(calls.length, before);
  // A forbidden download still verifies the direct-file path's header; no DOM download needed.
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({url:String(url),init}); return new Response('', {status:403}); });
  await assert.rejects(api.generateScenario('1'), /FORBIDDEN/);
  await assert.rejects(api.downloadDatabaseBackup('file.dump','manual'));
  assert.equal(new Headers(calls.at(-2)!.init?.headers).get('X-Championship-Event-ID'),'7');
  assert.equal(new Headers(calls.at(-1)!.init?.headers).has('X-Championship-Event-ID'),false);
  const { EventSelector } = await server.ssrLoadModule('/src/app/events/ActiveEventSelector.tsx');
  const markup = renderToStaticMarkup(createElement(EventSelector, { state: { events:[{id:'7',name:'WSC Montafon 2027'}], selectedEvent:{id:'7'}, switchingAllowed:false }, selectEvent:()=>false }));
  assert.match(markup, /WSC Montafon 2027/); assert.match(markup, /Aktive Veranstaltung/); assert.match(markup, /disabled/);
  const { ActiveEventProvider } = await server.ssrLoadModule('/src/app/events/ActiveEventProvider.tsx');
  assert.doesNotMatch(renderToStaticMarkup(createElement(ActiveEventProvider, null, 'private persons')), /private persons/);
});
