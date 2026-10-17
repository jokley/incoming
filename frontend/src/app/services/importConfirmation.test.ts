import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSuccessfulApiResponse, requireImportConfirmation, importConfirmationMessage, reloadImportSession } from './importConfirmation.ts';

test('HTTP 400/500 exposes the backend error and never renders success counters', async () => {
  for (const status of [400,500]) {
    const response = new Response(JSON.stringify({error:'value too long for type character varying(100)'}),{status});
    let success = '', error = '';
    try {
      const body: unknown = await response.json();
      requireSuccessfulApiResponse(response,body);
      success = importConfirmationMessage(requireImportConfirmation(body));
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Import fehlgeschlagen';
    }
    assert.equal(success,'');
    assert.equal(error,'value too long for type character varying(100)');
    assert.ok(!error.includes('peopleCreated'));
  }
});

test('successful import retains its summary and the existing success message', () => {
  const result = {success:true,summary:{peopleCreated:2,peopleUpdated:3,fisRoomsImported:4},run:{id:'1',importType:'FIS',startedAt:null,finishedAt:null}};
  requireSuccessfulApiResponse(new Response('',{status:200}),result);
  assert.equal(requireImportConfirmation(result),result);
  assert.equal(result.summary.fisRoomsImported,4);
  assert.equal(importConfirmationMessage(result),'Import erfolgreich: 2 neu, 3 aktualisiert. Bestehende Dispositionen wurden nicht verändert.');
});

test('malformed success responses fail explicitly before accessing counters', () => {
  for (const result of [undefined,{error:'Import failed'},{success:true},{success:true,summary:{peopleCreated:1}}]) {
    assert.throws(()=>importConfirmationMessage(result),error=>error instanceof Error && !error.message.includes('peopleCreated'));
  }
  assert.throws(()=>requireImportConfirmation({error:'Actual failure'}),/Actual failure/);
});


test('confirmation reload starts independent reads concurrently, exactly once', async () => {
  const calls: string[] = [];
  let finishDetail!: (value: { id: string }) => void;
  let finishList!: (value: { id: string }[]) => void;
  const pending = reloadImportSession<{ id: string }>('42', {
    getImportSession: id => { calls.push(`detail:${id}`); return new Promise(resolve => { finishDetail = resolve; }); },
    getImportSessions: () => { calls.push('list'); return new Promise(resolve => { finishList = resolve; }); },
  });
  assert.deepEqual(calls, ['detail:42', 'list']);
  finishList([{ id: '42' }]);
  finishDetail({ id: '42' });
  assert.deepEqual(await pending, [{ id: '42' }, [{ id: '42' }]]);
  assert.equal(calls.length, 2);
});
