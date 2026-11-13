import test from 'node:test';
import assert from 'node:assert/strict';
import type { Competition } from '../types.ts';
import { competitionFilterGroups, competitionGroupSelected, toggleCompetitionGroup, matchesCompetitionSelection, sportAreaOptions } from './athleteCompetitionFilters.ts';

test('two area options count every membership once and combine with concrete competitions', () => {
  const sb = competition('sb', 'Halfpipe', 'Snowboard Halfpipe');
  const fs = { ...competition('fs', 'Halfpipe', 'Freeski Halfpipe'), sport: 'Freeski', quotaDiscipline: 'Freeski Park & Pipe' };
  const mo = { ...competition('mo', 'Moguls', 'Moguls'), sport: 'Freestyle Ski', quotaDiscipline: 'Freestyle' };
  const rows = [
    { id: 's', competitions: [sb] },
    { id: 'f', competitions: [fs, mo, fs] },
    { id: 'both', competitions: [fs, sb] },
    { id: 'unknown', competitions: [{ ...sb, id: 'unknown', sport: 'Unknown' }] },
    { id: 'none', competitions: [] },
  ];
  const options = sportAreaOptions(rows);
  assert.deepEqual(options, [
    { value: 'Snowboard', label: 'Snowboard', count: 2 },
    { value: 'Freestyle', label: 'Freestyle / Freeski', count: 2 },
  ]);
  assert.deepEqual(sportAreaOptions([...rows, rows[1]]), options);
  for (const option of options) assert.equal(rows.filter(p => matchesCompetitionSelection(p, [], option.value)).length, option.count);
  assert.deepEqual(rows.filter(p => matchesCompetitionSelection(p, ['fs'], 'Freestyle')).map(p => p.id), ['f', 'both']);
  assert.deepEqual(rows.filter(p => matchesCompetitionSelection(p, ['fs'], 'Snowboard')), []);
  assert.deepEqual(rows.filter(p => matchesCompetitionSelection(p, ['sb'], 'Snowboard')).map(p => p.id), ['s', 'both']);
  assert.equal(matchesCompetitionSelection(rows[3], [], 'Freestyle'), false);
  assert.equal(matchesCompetitionSelection({competitions:[{...fs,sport:'Freestyle / Freeski'}]}, [], 'Freestyle'), false);
  assert.equal(matchesCompetitionSelection(rows[0], [], 'Unknown'), false);
  assert.equal(matchesCompetitionSelection(rows[4], [], ''), true);
  assert.deepEqual(sportAreaOptions(rows, ['mo']).map(o => o.count), [0, 1]);
  assert.deepEqual(sportAreaOptions([]).map(o => o.count), [0, 0]);
});

const competition = (id:string,name:string,displayName:string):Competition => ({
  id,name,displayName,importCode:id,code:id,sport:'Snowboard',gender:name.startsWith("Men's")?'M':'W',
  quotaDiscipline:'Snowboard Park & Pipe',teamCompetition:false,active:true,
});
const bigM=competition('bm',"Men's Big Air",'Snowboard Big Air');
const bigW=competition('bw',"Women's Big Air",'Snowboard Big Air');
const halfM=competition('hm',"Men's Halfpipe",'Snowboard Halfpipe');
const halfW=competition('hw',"Women's Halfpipe",'Snowboard Halfpipe');
const people = [
  {id:'1',gender:'M',competitions:[bigM,halfM]},
  {id:'2',gender:'W',competitions:[bigW,halfW]},
  {id:'3',gender:'M',competitions:[bigM,bigW,bigM]},
];

test('gender-specific events form neutral options with all IDs and distinct person counts',()=>{
  const groups=competitionFilterGroups([...people,people[2]]);
  assert.deepEqual(groups.map(g=>[g.label,g.count]),[['Big Air',3],['Halfpipe',2]]);
  const big=groups[0];
  assert.deepEqual(big.competitionIds,['bm','bw']);
  const selected=toggleCompetitionGroup(big,[]);
  assert.deepEqual(people.filter(p=>matchesCompetitionSelection(p,selected)).map(p=>p.id),['1','2','3']);
  assert.equal(competitionGroupSelected(big,selected),true);
  assert.deepEqual(toggleCompetitionGroup(big,selected),[]);
  // Existing gender filtering remains an independent AND condition.
  assert.deepEqual(people.filter(p=>matchesCompetitionSelection(p,selected) && p.gender==='M').map(p=>p.id),['1','3']);
  assert.deepEqual(people.filter(p=>matchesCompetitionSelection(p,selected) && p.gender==='W').map(p=>p.id),['2']);
  assert.deepEqual(toggleCompetitionGroup(big,['hm']),['hm','bm','bw']);
});

test('team labels use structured event names and legacy exact-name selections remain supported',()=>{
  const team=competition('team','Mixed Parallel Team','Parallel Team');
  const snowboardTeam=competition('cross','Mixed Snowboard Cross Team','Snowboard Cross Team');
  const groups=competitionFilterGroups([{id:'1',competitions:[team,snowboardTeam]}]);
  assert.deepEqual(groups.map(g=>g.label),['Parallel Team','Snowboard Cross Team']);
  const big=competitionFilterGroups(people)[0];
  assert.equal(competitionGroupSelected(big,[bigM.name]),true);
  assert.deepEqual(toggleCompetitionGroup(big,[bigM.name,'hm']),['hm']);
  assert.equal(matchesCompetitionSelection(people[0],[bigM.name]),true);
  assert.equal(matchesCompetitionSelection(people[0],['bw']),false);
});

test('structured displayName takes precedence and fallback normalization is deterministic',()=>{
  const group=competitionFilterGroups([{id:'1',competitions:[competition('x','Unrelated official name','Parallel Slalom')]}]);
  assert.equal(group[0].label,'Parallel Slalom');
  const fallback=competitionFilterGroups([{id:'1',competitions:[competition('m',"Men's Parallel Giant Slalom",''),competition('w',"Women's Parallel Giant Slalom",'')]}]);
  assert.equal(fallback.length,1);
  assert.equal(fallback[0].label,'Parallel Giant Slalom');
  assert.equal(fallback[0].count,1);
});
