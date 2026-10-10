import assert from 'node:assert/strict';
import test from 'node:test';

import { disciplineDisplayName, matchesDisciplineAndGender, matchesDisciplineMembership } from './competitionPresentation.ts';

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
