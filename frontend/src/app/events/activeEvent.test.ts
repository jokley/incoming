import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveEventStore, type EventCapabilities } from './activeEventStore.ts';
import { EventRequestScope, EVENT_HEADER } from './eventRequestScope.ts';
const event = (id: string) => ({ id, name: `Event ${id}`, active: true, canRead: true, canWrite: true });
const catalog = (switchingAllowed = false): EventCapabilities => ({ events: [event('1'), event('2')], selectedEventId: '1', switchingAllowed });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const json = (r: Response) => r.json();

test('missing active selection prevents operational requests', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  await assert.rejects(new EventRequestScope().run('/api/athletes', undefined, json), /Eventkontext/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('only the server-selected event is used; presence in catalogue is no release', async () => {
  const scope = new EventRequestScope(); const store = new ActiveEventStore(scope, async () => catalog());
  await store.load(); assert.equal(store.snapshot().selectedEvent?.id, '1');
  assert.equal(scope.eventId, '1'); assert.equal(store.select('2'), false);
  assert.equal(scope.eventId, '1'); assert.equal(store.select('999'), false);
});

for (const selectedEventId of [null, '', '999']) test(`no first/active fallback for selected ID ${selectedEventId}`, async () => {
  const scope = new EventRequestScope(); const store = new ActiveEventStore(scope, async () => ({ ...catalog(), selectedEventId }));
  await store.load(); assert.equal(store.snapshot().status, 'error'); assert.equal(scope.eventId, null);
});

test('unauthorized or duplicate bootstrap selection fails closed', async () => {
  for (const events of [[{ ...event('1'), canRead: false }], [event('1'), event('1')]]) {
    const store = new ActiveEventStore(new EventRequestScope(), async () => ({ ...catalog(), events }));
    await store.load(); assert.equal(store.snapshot().status, 'error');
  }
});

test('missing grant bootstrap clears prior context and retry requires explicit server grant', async t => {
  const scope = new EventRequestScope(); let granted = true;
  const store = new ActiveEventStore(scope, async () => {
    if (!granted) throw new Error('FORBIDDEN');
    return { events: [event('1')], selectedEventId: '1', switchingAllowed: false };
  });
  await store.load(); assert.equal(scope.eventId, '1');
  granted = false; await store.load();
  assert.equal(store.snapshot().status, 'error');
  assert.equal(store.snapshot().error, 'FORBIDDEN');
  assert.equal(store.snapshot().selectedEvent, null);
  assert.deepEqual(store.snapshot().events, []);
  assert.equal(scope.eventId, null);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  await assert.rejects(scope.run('/api/athletes', undefined, json), /Eventkontext/);
  assert.equal(fetch.mock.callCount(), 0);
  granted = true; await store.load();
  assert.equal(store.snapshot().status, 'ready'); assert.equal(scope.eventId, '1');
});

test('explicit simulated A-B-A changes every request lease and workspace revision', async t => {
  const scope = new EventRequestScope(); let resets = 0;
  const store = new ActiveEventStore(scope, async () => catalog(true), () => null, () => { resets++; });
  await store.load();
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => Response.json({ owner: new Headers(init?.headers).get(EVENT_HEADER) }));
  for (const owner of ['1', '2', '1']) {
    assert.equal(store.select(owner), true);
    for (const path of ['athletes', 'assignments/planning-view', 'fis/official-quotas', 'import/sessions', 'hotels', 'events', 'analytics/occupancy-timeline', 'audit-events']) {
      assert.deepEqual(await scope.run(`/api/${path}`, undefined, json), { owner });
    }
  }
  assert.equal(store.snapshot().revision, 3); assert.equal(resets, 2); assert.equal(fetch.mock.callCount(), 24);
});

test('stale request cannot reappear after A-B-A even when fetch ignores abort', async t => {
  const scope = new EventRequestScope(); scope.activate('1'); const reply = deferred<Response>();
  t.mock.method(globalThis, 'fetch', () => reply.promise);
  const old = scope.run('/api/athletes', undefined, json);
  scope.activate('2'); scope.activate('1'); reply.resolve(Response.json({ person: 'Old A' }));
  await assert.rejects(old, { name: 'AbortError' });
});

test('body arriving after event switch cannot publish stale data', async t => {
  const scope = new EventRequestScope(); scope.activate('1'); const body = deferred<string>(); const entered = deferred<void>();
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const old = scope.run('/api/athletes', undefined, async () => { entered.resolve(); return body.promise; });
  await entered.promise; scope.activate('2'); body.resolve('Old A');
  await assert.rejects(old, { name: 'AbortError' });
});

test('unsaved forms and active reviews block rather than silently discard', async () => {
  const scope = new EventRequestScope(); let dirty = true;
  const store = new ActiveEventStore(scope, async () => catalog(true), () => dirty ? 'Ungespeichert' : null);
  await store.load(); assert.equal(store.select('2'), false); assert.equal(scope.eventId, '1');
  dirty = false; const release = store.block('Import-Review offen');
  assert.equal(store.select('2'), false); assert.match(store.snapshot().error!, /Import-Review/);
  release(); assert.equal(store.select('2'), true);
});

test('ongoing mutations block event switch until their entire body is consumed', async t => {
  const scope = new EventRequestScope(); const store = new ActiveEventStore(scope, async () => catalog(true)); await store.load();
  const reply = deferred<Response>(); t.mock.method(globalThis, 'fetch', () => reply.promise);
  const write = scope.run('/api/import/sessions/1/import', { method: 'POST' }, json);
  assert.equal(store.select('2'), false); assert.equal(scope.hasPendingWrites, true);
  reply.resolve(Response.json({ success: true })); await write;
  assert.equal(store.select('2'), true); assert.equal(scope.hasPendingWrites, false);
});

test('latest bootstrap wins and unavailable bootstrap is explicit', async () => {
  const scope = new EventRequestScope(); const first = deferred<EventCapabilities>(); let calls = 0;
  const store = new ActiveEventStore(scope, () => ++calls === 1 ? first.promise : Promise.resolve({ ...catalog(), selectedEventId: '2' }));
  const slow = store.load(); await store.load(); first.resolve(catalog()); await slow;
  assert.equal(store.snapshot().selectedEvent?.id, '2');
  const failed = new ActiveEventStore(scope, async () => { throw new Error('FORBIDDEN'); });
  await failed.load(); assert.equal(failed.snapshot().error, 'FORBIDDEN'); assert.equal(scope.eventId, null);
});

test('external cancellation and disposal abort outstanding requests', async t => {
  const scope = new EventRequestScope(); const store = new ActiveEventStore(scope, async () => catalog(true)); await store.load();
  const external = new AbortController(); t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  external.abort(); await assert.rejects(scope.run('/api/athletes', { signal: external.signal }, json), { name: 'AbortError' });
  store.dispose(); assert.equal(scope.eventId, null);
});

test('authentication refresh survives workspace disposal while event requests do not', async t => {
  const scope = new EventRequestScope(); scope.activate('1'); const reply = deferred<Response>();
  t.mock.method(globalThis, 'fetch', () => reply.promise);
  const auth = scope.run('/api/auth/me', undefined, json, 'auth');
  scope.activate(null); reply.resolve(Response.json({ username:'current user' }));
  assert.deepEqual(await auth, { username:'current user' });
});

test('newly authorized choices appear without changing the current workspace or dirty blockers', async () => {
  const scope = new EventRequestScope(); let choices = catalog(false);
  const store = new ActiveEventStore(scope, async () => choices);
  await store.load(); const revision = store.snapshot().revision;
  const unblock = store.block('Ungespeichert');
  choices = {events:[event('1'),event('2'),event('3')],selectedEventId:'1',switchingAllowed:true};
  await store.refreshChoices();
  assert.equal(store.snapshot().events.length,3); assert.equal(store.snapshot().revision,revision);
  assert.equal(scope.eventId,'1'); assert.equal(store.select('3'),false);
  unblock(); assert.equal(store.select('3'),true);
});

test('late choice refresh after A-B-A cannot overwrite current event permissions', async () => {
  const scope = new EventRequestScope(); let reply:Promise<EventCapabilities> = Promise.resolve(catalog(true));
  const store = new ActiveEventStore(scope, () => reply); await store.load();
  const delayed = deferred<EventCapabilities>(); reply=delayed.promise;
  const refresh = store.refreshChoices(); store.select('2'); store.select('1');
  delayed.resolve({...catalog(true), events:[{...event('1'),canWrite:false}]}); await refresh;
  assert.equal(store.snapshot().selectedEvent?.canWrite,true);
  assert.equal(store.snapshot().events.length,2);
});
