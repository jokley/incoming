import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { competitionMembershipList, disciplineDisplayName, matchesDisciplineAndGender, matchesDisciplineMembership, sportAreaLabel } from './competitionPresentation.ts';

test('area labels normalize existing sport names without inferring competition identities', () => {
  assert.equal(sportAreaLabel('Snowboard'), 'Snowboard');
  for (const value of ['Freestyle', 'Freeski', 'Freestyle Ski']) assert.equal(sportAreaLabel(value), 'Freestyle / Freeski');
  for (const value of ['Unknown', 'Ski Cross', 'Freeski Park & Pipe', 'WSC_HP_M_8171']) assert.equal(sportAreaLabel(value), value);
  assert.equal(sportAreaLabel(null), '—');
});

test('display aliases agree with the existing central catalogue for all 31 competitions', () => {
  // Read the authoritative catalogue, rather than maintaining a second group map.
  const rows = JSON.parse(execFileSync('python', ['-c',
    'import json; from competitions import COMPETITIONS, competition_athlete_family; print(json.dumps([dict(sport=c.sport, family=competition_athlete_family(c), group=c.quota_discipline) for c in COMPETITIONS]))'],
    { cwd: fileURLToPath(new URL('../../../../backend/', import.meta.url)), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
  assert.equal(rows.length, 31);
  assert.equal(new Set(rows.map((row: {group:string}) => row.group)).size, 6);
  for (const row of rows) assert.equal(sportAreaLabel(row.sport), sportAreaLabel(row.family));
});

test('discipline labels omit competition gender and redundant sport qualifiers', () => {
  assert.equal(disciplineDisplayName("Men's Snowboard Big Air"), 'Big Air');
  assert.equal(disciplineDisplayName("Women's Snowboard Halfpipe"), 'Halfpipe');
  assert.equal(disciplineDisplayName('Snowboard Cross'), 'Snowboard Cross');
  assert.equal(disciplineDisplayName("Women's Snowboard Slopestyle"), 'Slopestyle');
});

test('canonical discipline membership remains independent from gender', () => {
  const quotaDisciplines = ['Snowboard Halfpipe'];
  assert.equal(matchesDisciplineMembership("Men's Halfpipe", quotaDisciplines, 'Snowboard Halfpipe'), true);
  assert.equal(matchesDisciplineMembership("Women's Halfpipe", quotaDisciplines, 'Snowboard Halfpipe'), true);
  assert.equal(matchesDisciplineMembership("Men's Big Air", ['Snowboard Big Air'], 'Snowboard Halfpipe'), false);
});

test('discipline and gender filters select the matching quota member together', () => {
  const people = [
    { nationCode: 'BRA', discipline: "Men's Halfpipe", quotaDisciplines: ['Snowboard Halfpipe'], gender: 'M' },
    { nationCode: 'BRA', discipline: "Women's Halfpipe", quotaDisciplines: ['Snowboard Halfpipe'], gender: 'W' },
  ];
  const matches = (nation: string, gender: string) => people.filter((person) =>
    person.nationCode === nation
    && matchesDisciplineAndGender(person, 'Snowboard Halfpipe', gender));

  assert.deepEqual(matches('BRA', 'M').map((person) => person.discipline), ["Men's Halfpipe"]);
  assert.deepEqual(matches('BRA', 'F').map((person) => person.discipline), ["Women's Halfpipe"]);
  assert.deepEqual(matches('AUT', 'M'), []);
});

test('quota filters never infer membership from legacy display discipline', () => {
  assert.equal(matchesDisciplineMembership('TestGroup', undefined, 'TestGroup'), false);
  assert.equal(matchesDisciplineMembership('Legacy', ['TestGroup'], 'TestGroup'), true);
});


test('concrete memberships are compact, gender-neutral and duplicate-free',()=>{
 assert.equal(competitionMembershipList([{name:"Men's Snowboard Slopestyle"},{name:"Women's Snowboard Slopestyle"},{name:'Snowboard Big Air'},{name:'Halfpipe'}]),'Slopestyle · Big Air · Halfpipe');
 assert.equal(competitionMembershipList([{name:'Moguls'},{name:'Dual Moguls'}]),'Moguls · Dual Moguls');
 assert.equal(competitionMembershipList(), '');
 assert.equal(competitionMembershipList([]), '');
});
