import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorldChampion } from '../types.ts';
import { championEditions, championEditionKey, championsForEdition, championDraft, championSourceUrl, newChampionEdition, championDisciplines, filterChampions, emptyChampionFilters, scopedChampionFilters } from './worldChampionAdministration.ts';

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
  for(const source of ['', ' ', null, undefined, 'verified evidence','javascript:alert(1)','file:///tmp/source']) assert.equal(championSourceUrl(source),null);
});

test('FIS source links and stored metadata remain exact without availability checks',()=>{
  const source='https://medias3.fis-ski.com/pdf/2025/FS/8226/2025FS8226RLF.pdf';
  const existing=row('source',{source});
  assert.equal(championSourceUrl(existing.source),source);
  assert.equal(championSourceUrl('HTTPS://Example.com:443/%2f'),'HTTPS://Example.com:443/%2f');
  const edited=championDraft(existing,undefined,'other');
  edited.active=false;
  assert.equal(edited.source,source);
  assert.equal(existing.source,source);
  assert.equal(championEditions([existing])[0].count,1);
});

test('new list becomes an existing-model edition through its first champion',()=>{
  const edition=newChampionEdition(' Bakuriani ',2023);
  const draft=championDraft(undefined,edition,'target1');
  assert.equal(draft.championship,'Bakuriani'); assert.equal(draft.championshipYear,2023);
  const saved=row('new',{...draft,name:'New champion'});
  assert.equal(championEditions([saved])[0].key,edition.key);
  assert.deepEqual(championsForEdition([saved],edition.key),[saved]);
});

test('gender, discipline and name/nation search combine with AND logic',()=>{
  const rows=[row('1',{discipline:'Halfpipe',gender:'M',name:'Zoe'}),row('2',{discipline:'Halfpipe',gender:'W',name:'Ada'}),row('3',{discipline:'Slopestyle',gender:'W',nation:'USA'})];
  const filters=emptyChampionFilters(championEditionKey(rows[0]));
  assert.deepEqual(filterChampions(rows,{...filters,gender:'W'}).map(r=>r.id),['2','3']);
  assert.deepEqual(filterChampions(rows,{...filters,discipline:'Halfpipe'}).map(r=>r.id),['1','2']);
  assert.deepEqual(filterChampions(rows,{...filters,discipline:'Halfpipe',gender:'W'}).map(r=>r.id),['2']);
  assert.deepEqual(filterChampions(rows,{...filters,search:' usa '}).map(r=>r.id),['3']);
  assert.deepEqual(filterChampions(rows,{...filters,discipline:'Halfpipe',gender:'W',search:'ada'}).map(r=>r.id),['2']);
  assert.deepEqual(filterChampions(rows,{...filters,discipline:'Halfpipe',gender:'W',search:'USA'}),[]);
});

test('discipline options are unique and edition-scoped; switching scopes filters',()=>{
  const rows=[row('1',{discipline:'Halfpipe'}),row('2',{discipline:'Halfpipe'}),row('3',{championship:'Aspen',discipline:'Big Air'})];
  const key=championEditionKey(rows[0]);
  assert.deepEqual(championDisciplines(championsForEdition(rows,key)),['Halfpipe']);
  const filters={...emptyChampionFilters(key),discipline:'Halfpipe',gender:'W',search:'Ada'};
  assert.equal(scopedChampionFilters(filters,key),filters);
  const other=championEditionKey(rows[2]);
  assert.deepEqual(scopedChampionFilters(filters,other),emptyChampionFilters(other));
});

test('default sort places gender before name and retains deterministic ties',()=>{
  const rows=[row('3',{name:'Ada',gender:'W'}),row('2',{name:'Zoe',gender:'M'}),row('1',{name:'Zoe',gender:'M'}),row('4',{discipline:'Halfpipe',gender:'W'})];
  assert.deepEqual(championsForEdition(rows,championEditionKey(rows[0])).map(r=>r.id),['4','1','2','3']);
});
