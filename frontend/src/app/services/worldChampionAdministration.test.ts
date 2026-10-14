import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorldChampion } from '../types.ts';
import { championEditions, championEditionKey, championsForEdition, championDraft, championSourceUrl } from './worldChampionAdministration.ts';

const row=(id:string,values:Partial<WorldChampion>={}):WorldChampion=>({id,eventId:'target1',fisCode:id,name:`Person ${id}`,nation:'AUT',gender:'M',discipline:'Parallel Slalom',eventGroup:'Snowboard Alpine',championship:'Engadin',championshipYear:2025,titleType:'INDIVIDUAL',entitlementEnabled:true,source:'https://www.fis-ski.com/results',active:true,createdAt:'',updatedAt:'',...values});

test('editions group by structured name and year across target events, never source URL',()=>{
  const rows=[row('1'),row('2',{eventId:'target2',source:'different evidence'}),row('3',{championshipYear:2023}),row('4',{championship:'Bakuriani',championshipYear:2023}),row('5',{championship:'Aspen',championshipYear:2021})];
  const editions=championEditions(rows);
  assert.equal(editions.length,4);
  assert.deepEqual(editions[0],{key:championEditionKey(rows[0]),championship:'Engadin',year:2025,label:'Engadin 2025',count:2});
  assert.deepEqual(championsForEdition(rows,editions[0].key).map(r=>r.id),['1','2']);
  assert.deepEqual(championsForEdition(rows,championEditionKey(rows[4])).map(r=>r.id),['5']);
});

test('edition rows sort deterministically by group, discipline, name and identity',()=>{
  const rows=[row('3',{name:'Zoe'}),row('2',{name:'Ada'}),row('1',{eventGroup:'Freestyle',discipline:'Moguls'})];
  assert.deepEqual(championsForEdition(rows,championEditionKey(rows[0])).map(r=>r.id),['1','2','3']);
  assert.deepEqual(rows.map(r=>r.id),['3','2','1']);
});

test('create inherits edition, edit preserves every existing field and status',()=>{
  const existing=row('7',{active:false,titleType:'TEAM',entitlementEnabled:false});
  const draft=championDraft(undefined,championEditions([existing])[0],'target2');
  assert.equal(draft.championship,'Engadin'); assert.equal(draft.championshipYear,2025);
  assert.equal(draft.eventId,'target2'); assert.equal(draft.id,undefined);
  assert.equal(draft.titleType,'INDIVIDUAL'); assert.equal(draft.active,true);
  const edit=championDraft(existing,undefined,'other');
  assert.deepEqual(edit,existing); assert.notEqual(edit,existing);
  edit.name='Edited'; assert.equal(existing.name,'Person 7');
});

test('source links accept HTTP(S) only; prose remains editable source metadata',()=>{
  assert.equal(championSourceUrl('https://www.fis-ski.com/results'),'https://www.fis-ski.com/results');
  for(const source of ['verified evidence','javascript:alert(1)','file:///tmp/source']) assert.equal(championSourceUrl(source),null);
});
