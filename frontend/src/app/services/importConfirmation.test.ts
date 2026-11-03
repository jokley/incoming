import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSuccessfulApiResponse, requireImportConfirmation, importConfirmationMessage, reloadImportSession, archiveImportSessionChecked } from './importConfirmation.ts';

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
  assert.equal(importConfirmationMessage(result),'Import erfolgreich: 2 neu, 3 aktualisiert, 0 entfernt. 0 Dispositionen geändert.');
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


const openSession = {id:'42',currentVersionId:'7',nation:'ARG',status:'PROFESSIONALLY_REVIEWED'} as import('../data/importSessions.ts').ImportSession;
const archivedSession = {...openSession,status:'ARCHIVED'} as import('../data/importSessions.ts').ImportSession;

test('session close validates current state and uses the confirmed archived response',async()=>{
 const calls:string[]=[];
 const result=await archiveImportSessionChecked(openSession,{
  getImportSession:async id=>{calls.push(`read:${id}`);return openSession;},
  archiveImportSession:async(id,version)=>{calls.push(`archive:${id}:${version}`);return archivedSession;},
 });
 assert.equal(result,archivedSession);assert.deepEqual(calls,['read:42','archive:42:7']);
});

test('lost close response is recovered from the server without repeating the write',async()=>{
 for(const response of ['lost','http500','malformed']){
  let reads=0,writes=0;
  const result=await archiveImportSessionChecked(openSession,{
   getImportSession:async()=>++reads===1?openSession:archivedSession,
   archiveImportSession:async()=>{writes++;if(response==='lost')throw new TypeError('Failed to fetch');if(response==='http500')throw Object.assign(new Error('Internal Server Error'),{status:500});return undefined as any;},
  });
  assert.equal(result,archivedSession);assert.equal(reads,2);assert.equal(writes,1);
 }
});

test('retry with an archived server state is idempotent without another archive request',async()=>{
 let writes=0;
 const current={...archivedSession,currentVersionId:'8'};
 assert.equal(await archiveImportSessionChecked(openSession,{
  getImportSession:async()=>current,
  archiveImportSession:async()=>{writes++;return archivedSession;},
 }),current);
 assert.equal(writes,0);
});

test('unknown outcome stays explicit and the next attempt checks before writing',async()=>{
 let reads=0,writes=0;
 const source={getImportSession:async()=>{reads++;if(reads===2)throw new TypeError('Failed to fetch');return reads===1?openSession:archivedSession;},
  archiveImportSession:async()=>{writes++;throw new TypeError('Failed to fetch');}};
 await assert.rejects(archiveImportSessionChecked(openSession,source),/Abschlussstatus derzeit unklar/);
 assert.equal(await archiveImportSessionChecked(openSession,source),archivedSession);
 assert.equal(writes,1);assert.equal(reads,3);
});

test('unavailable state, foreign response and newer version cannot initiate a close',async()=>{
 for(const mode of ['offline','foreign','stale']){
  let writes=0;
  await assert.rejects(archiveImportSessionChecked(openSession,{
   getImportSession:async()=>{if(mode==='offline')throw new TypeError('Failed to fetch');return {...openSession,...(mode==='foreign'?{id:'99'}:{currentVersionId:'8'})};},
   archiveImportSession:async()=>{writes++;return archivedSession;},
  }),mode==='stale'?/neuere Importversion/:/Serverstatus konnte nicht geprüft/);
  assert.equal(writes,0);
 }
});

test('a real rejected close remains a failure when the server is not archived',async()=>{
 const rejection=Object.assign(new Error('STALE_PREVIEW'),{error:'STALE_PREVIEW'});let reads=0;
 await assert.rejects(archiveImportSessionChecked(openSession,{
  getImportSession:async()=>{reads++;return openSession;},
  archiveImportSession:async()=>{throw rejection;},
 }),error=>error===rejection);
 assert.equal(reads,2);
});
