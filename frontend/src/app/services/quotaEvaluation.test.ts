import assert from 'node:assert/strict';
import test from 'node:test';

import { actionableQuotaCaseCount, calculateAdditionalCosts, hasSingleRoomSurcharge, quotaRequiresAction, singleRoomBadgeLabels, singleRoomSpecialStatusLabel, uniqueQuotaContext } from './quotaEvaluation.ts';

test('single-room and surcharge badges follow independent persisted state', () => {
  assert.deepEqual(singleRoomBadgeLabels(true, 'APPROVED_EXTRA'), ['EZ genehmigt', 'Einzelzimmer', 'Mehrpreis']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'APPROVED_EXTRA'), ['EZ genehmigt']);
  assert.deepEqual(singleRoomBadgeLabels(true, 'IN_QUOTA'), ['Einzelzimmer']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'NONE'), []);
  assert.equal(hasSingleRoomSurcharge({ single_room_status: 'APPROVED_EXTRA', assignment: { countsAsSingle: true } }), true);
  assert.equal(hasSingleRoomSurcharge({ single_room_status: 'APPROVED_EXTRA', assignment: { countsAsSingle: false } }), false);
  assert.deepEqual(calculateAdditionalCosts([
    { personId: 'approved-active', bookingId: '1', nationCode: 'BRA', discipline: 'HP', gender: 'M', countsAsSingle: true, singleRoomStatus: 'APPROVED_EXTRA', approvedQuotaDisciplines: ['HP'] },
    { personId: 'approved-inactive', bookingId: '2', nationCode: 'BRA', discipline: 'HP', gender: 'M', countsAsSingle: false, singleRoomStatus: 'APPROVED_EXTRA', approvedQuotaDisciplines: ['HP'] },
    { personId: 'ordinary-active', bookingId: '3', nationCode: 'BRA', discipline: 'HP', gender: 'M', countsAsSingle: true, singleRoomStatus: 'IN_QUOTA' },
  ], 2).map(person => person.additionalCost), [true, false, false]);
});

test('approval reassignment moves the durable approval badge', () => {
  const before = {
    A: singleRoomBadgeLabels(false, 'APPROVED_EXTRA'),
    B: singleRoomBadgeLabels(false, 'IN_QUOTA'),
  };
  const after = {
    A: singleRoomBadgeLabels(false, 'IN_QUOTA'),
    B: singleRoomBadgeLabels(false, 'APPROVED_EXTRA'),
  };

  assert.deepEqual(before, { A: ['EZ genehmigt'], B: [] });
  assert.deepEqual(after, { A: [], B: ['EZ genehmigt'] });
});

test('assigned room cards use the shared single-room presentation', () => {
  assert.deepEqual(singleRoomBadgeLabels(false, 'APPROVED_EXTRA'), ['EZ genehmigt']);
  assert.deepEqual(singleRoomBadgeLabels(true, 'APPROVED_EXTRA'), [
    'EZ genehmigt', 'Einzelzimmer', 'Mehrpreis',
  ]);
  assert.deepEqual(singleRoomBadgeLabels(true, 'IN_QUOTA'), ['Einzelzimmer']);
  assert.equal(singleRoomBadgeLabels(true, 'IN_QUOTA').includes('EZ genehmigt'), false);
});

test('quota-exempt accommodation badges stay separate from surcharge approval', () => {
  assert.deepEqual(singleRoomBadgeLabels(true, 'NONE', 'WORLD_CHAMPION'), ['👑 WM', 'Einzelzimmer']);
  assert.deepEqual(singleRoomBadgeLabels(true, 'NONE', 'OTHER'), ['EZ ✓', 'Einzelzimmer']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'NONE', 'WORLD_CHAMPION'), ['👑 WM']);
  assert.equal(singleRoomBadgeLabels(true, 'NONE', 'OTHER').includes('Mehrpreis'), false);
  assert.equal(singleRoomSpecialStatusLabel('NONE', 'WORLD_CHAMPION'), 'Weltmeister');
  assert.equal(singleRoomSpecialStatusLabel('NONE', 'OTHER'), 'EZ-Ausnahme');
  assert.equal(singleRoomSpecialStatusLabel('APPROVED_EXTRA', null), 'Mehrpreis genehmigt');
});

test('Handlungsbedarf counts unresolved action rather than technical overage', () => {
  const unresolvedExcess = { quotaStatus: 'DECISION_REQUIRED' as const, openApprovals: 1, singleRoomsUsed: 3, singleRoomsAllowed: 2 };
  const approvedExcess = { quotaStatus: 'EXCEPTION_APPROVED' as const, openApprovals: 0, singleRoomsUsed: 3, singleRoomsAllowed: 2 };
  const fulfilled = { quotaStatus: 'FULFILLED' as const, openApprovals: 0, singleRoomsUsed: 2, singleRoomsAllowed: 2 };
  assert.equal(quotaRequiresAction(unresolvedExcess), true);
  assert.equal(quotaRequiresAction(approvedExcess), false);
  assert.equal(quotaRequiresAction(fulfilled), false);
  assert.equal(actionableQuotaCaseCount([
    unresolvedExcess,
    approvedExcess,
    fulfilled,
  ]), 1);
});

test('header quota values require exactly one quota context', () => {
  const halfpipe = {
    nationCode: 'BRA', discipline: 'Snowboard Halfpipe', gender: 'M',
    assignedOfficials: 0, officialQuota: 5, singleRoomsUsed: 3, singleRoomsAllowed: 2,
  };
  const bigAir = {
    nationCode: 'BRA', discipline: 'Snowboard Big Air', gender: 'M',
    assignedOfficials: 0, officialQuota: 3, singleRoomsUsed: 1, singleRoomsAllowed: 1,
  };

  assert.equal(uniqueQuotaContext([halfpipe, bigAir]), null);
  const selected = uniqueQuotaContext([halfpipe]);
  assert.deepEqual(selected && {
    officials: `${selected.assignedOfficials}/${selected.officialQuota}`,
    singles: `${selected.singleRoomsUsed}/${selected.singleRoomsAllowed}`,
  }, { officials: '0/5', singles: '3/2' });
});

test('booking and planning quota consumers use arbitrary mapped groups without legacy fallbacks', async () => {
  const { quotaAssignmentsFromBookings, quotaAssignmentsFromPlanning, evaluateQuotaGroup } = await import('./quotaEvaluation.ts');
  const bookings = [{ id: 'booking', countsAsSingle: false, occupants: [{ athlete: {
    id: 'person', nationCode: 'AUT', gender: 'M', discipline: 'Legacy',
    competitions: [{ quotaDiscipline: 'TestGroup' }, { quotaDiscipline: 'TestGroup' }],
  } }] }];
  const mapped = quotaAssignmentsFromBookings(bookings as never);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].discipline, 'TestGroup');
  assert.equal(mapped[0].countsAsSingle, false);
  const active = { ...mapped[0], countsAsSingle: true };
  assert.equal(evaluateQuotaGroup({ nationCode: 'AUT', discipline: 'TestGroup', gender: 'M',
    singleRoomsAllowed: 1 }, [active, active]).usedSingleRooms, 1);
  bookings[0].occupants[0].athlete.competitions = [];
  assert.deepEqual(quotaAssignmentsFromBookings(bookings as never), []);
  const hotels = [{ slots: [{ bookings: [{ bookingId: 'booking', countsAsSingle: false,
    occupants: [{ athleteId: 'person', nationCode: 'AUT', gender: 'M', discipline: 'Legacy',
      quotaDisciplines: ['TestGroup', 'TestGroup'] }] }] }] }];
  assert.equal(quotaAssignmentsFromPlanning(hotels as never)[0].discipline, 'TestGroup');
  hotels[0].slots[0].bookings[0].occupants[0].quotaDisciplines = [];
  assert.deepEqual(quotaAssignmentsFromPlanning(hotels as never), []);
});


test('approved room usage is restricted to the backend-resolved approval group', async () => {
  const { calculateAdditionalCosts } = await import('./quotaEvaluation.ts');
  const person = { personId: 'A', bookingId: '1', nationCode: 'AUT', gender: 'M',
    countsAsSingle: true, singleRoomStatus: 'APPROVED_EXTRA' as const,
    approvedQuotaDisciplines: ['Snowboard'] };
  assert.deepEqual(calculateAdditionalCosts([
    { ...person, discipline: 'Snowboard' }, { ...person, discipline: 'Freestyle' },
    { ...person, discipline: 'Snowboard', approvedQuotaDisciplines: undefined },
  ], 1).map(p => p.additionalCost), [true, false, false]);
});


test('shared Officials follow every authoritative athlete M/W context and never their own gender', async () => {
  const { readFileSync } = await import('node:fs');
  const { evaluateAllQuotaGroups } = await import('./quotaEvaluation.ts');
  const fixture = JSON.parse(readFileSync(new URL('../../../../backend/tests/fixtures/fis_quota_contexts.json', import.meta.url), 'utf8'));
  const assignments = fixture.people.filter((p: { personId: string }) => fixture.assignedPersonIds.includes(p.personId))
    .flatMap((p: { personId: string; quotaDisciplines: string[] }) => p.quotaDisciplines.map(discipline => ({
      ...p, discipline, bookingId: p.personId, countsAsSingle: true,
    })));
  const evaluated = evaluateAllQuotaGroups(fixture.expected, [...assignments, ...assignments]);
  assert.deepEqual(evaluated.map(group => ({ key: group.key, used: group.usedSingleRooms,
    officials: group.people.length })), fixture.expected.map((row: { nationCode: string; discipline: string;
      gender: string; singleRoomsUsed: number; quotaExemptSingleRooms: number }) => ({
    key: `${row.nationCode}|${row.discipline}|${row.gender}`, used: row.singleRoomsUsed, officials: row.singleRoomsUsed + row.quotaExemptSingleRooms,
  })));
});

test('A definitions cannot become an operational allowance context', async () => {
  const { evaluateQuotaGroup } = await import('./quotaEvaluation.ts');
  const definition = { nationCode: 'AUT', discipline: 'Ski Cross', gender: 'A', singleRoomsAllowed: 1 };
  assert.throws(() => evaluateQuotaGroup(definition, [{ personId: 'O', bookingId: '1', nationCode: 'AUT',
    discipline: 'Ski Cross', gender: 'A', function: 'Official', countsAsSingle: true }]), /athlete gender M\/W/);
});

test('an Official approval in W cannot authorize the M context', async () => {
  const { evaluateAllQuotaGroups } = await import('./quotaEvaluation.ts');
  const definitions = ['M', 'W'].map(gender => ({ nationCode: 'AUT', discipline: 'Ski Cross',
    gender, singleRoomsAllowed: 1 }));
  const official = { personId: 'O', bookingId: '1', nationCode: 'AUT', discipline: 'Ski Cross',
    gender: 'M', function: 'Official', countsAsSingle: true, singleRoomStatus: 'APPROVED_EXTRA' as const,
    approvedQuotaDisciplines: ['Ski Cross'],
    approvedQuotaContexts: [{ nationCode: 'AUT', discipline: 'Ski Cross', gender: 'W' }] };
  assert.deepEqual(evaluateAllQuotaGroups(definitions, [official]).map(group =>
    Boolean(group.people[0]?.additionalCost)), [false, true]);
});


test('single-room control lists share athlete-derived context matching', async () => {
  const { matchesQuotaAllowanceContext } = await import('./quotaEvaluation.ts');
  const definition = { nationCode: 'AUT', discipline: 'Ski Cross', gender: 'W' };
  const person = { nationCode: 'AUT', quotaDisciplines: ['Ski Cross'], gender: 'M', function: 'Official' };
  assert.equal(matchesQuotaAllowanceContext(person, definition), true);
  assert.equal(matchesQuotaAllowanceContext({ ...person, gender: 'A' }, definition), true);
  assert.equal(matchesQuotaAllowanceContext({ ...person, function: 'Athlete' }, definition), false);
  assert.equal(matchesQuotaAllowanceContext({ ...person, function: 'Athlete', gender: 'W' }, definition), true);
  assert.equal(matchesQuotaAllowanceContext(person, { ...definition, gender: 'A' }), false);
});


test('physical allocation covers shared people once and respects restricted eligibility', async () => {
  const { evaluateAllQuotaGroups, getQuotaSummary } = await import('./quotaEvaluation.ts');
  const definitions = ['M', 'W'].map(gender => ({ nationCode: 'AUT', discipline: 'Ski Cross', gender, singleRoomsAllowed: 1 }));
  const shared = ['A','B'].map(personId => ({ personId, bookingId: personId, nationCode: 'AUT',
    discipline: 'Ski Cross', gender: 'A', function: 'Official', countsAsSingle: true }));
  const groups = evaluateAllQuotaGroups(definitions, [...shared, ...shared]);
  assert.equal(getQuotaSummary(groups).usedSingleRooms, 2);
  assert.equal(getQuotaSummary(groups).overflow, 0);
  assert.equal(new Set(groups.flatMap(g => g.people.map(p => p.personId))).size, 2);
  const single = evaluateAllQuotaGroups(definitions, [shared[0]]);
  assert.equal(getQuotaSummary(single).usedSingleRooms, 1);
  const restricted = shared.map(p => ({ ...p, function: 'Athlete', gender: 'M' }));
  const excess = evaluateAllQuotaGroups(definitions, restricted);
  assert.equal(getQuotaSummary(excess).overflow, 1);
  assert.equal(excess.find(g => g.key.endsWith('|W'))?.usedSingleRooms, 0);
  assert.equal(excess.flatMap(g => g.people).filter(p => p.allocationStatus === 'PENDING').length, 1);
});

test('augmenting matching and exemptions preserve one normal slot per covered person', async () => {
  const { allocateSingleRoomPeople } = await import('./quotaEvaluation.ts');
  const definitions = [
    { nationCode:'AUT',discipline:'Ski Cross',gender:'M',singleRoomsAllowed:1 },
    { nationCode:'AUT',discipline:'Ski Cross',gender:'W',singleRoomsAllowed:1 },
    { nationCode:'AUT',discipline:'Freestyle',gender:'M',singleRoomsAllowed:1 },
  ];
  const base = {nationCode:'AUT',countsAsSingle:true,bookingId:'1'};
  const people = [
    {...base,personId:'A',discipline:'Ski Cross',function:'Official',gender:'A'},
    ...['B','C'].flatMap(personId => ['Ski Cross','Freestyle'].map(discipline => ({...base,personId,discipline,function:'Athlete',gender:'M'}))),
    {...base,personId:'D',discipline:'Ski Cross',function:'Official',gender:'A',singleRoomQuotaExemptReason:'OTHER' as const},
    {...base,personId:'E',discipline:'Ski Cross',function:'Official',gender:'M',countsAsSingle:false},
  ];
  const result = allocateSingleRoomPeople(definitions, people);
  assert.equal(result.filter(p => p.allocationStatus === 'COVERED').length, 3);
  assert.equal(result.filter(p => p.allocationStatus === 'EXEMPT').length, 1);
  assert.equal(result.filter(p => p.allocationStatus === 'PENDING').length, 0);
  assert.equal(result.some(p => p.personId === 'E'), false);
  assert.deepEqual(allocateSingleRoomPeople([...definitions].reverse(), [...people].reverse()), result);
});


test('authoritative allocation metadata cannot introduce an A allowance context', async () => {
  const { evaluateAllQuotaGroups } = await import('./quotaEvaluation.ts');
  assert.throws(() => evaluateAllQuotaGroups([{ nationCode:'AUT',discipline:'Ski Cross',gender:'A',
    singleRoomsAllowed:1,singleRoomAllocations:[] }], []), /athlete gender M\/W/);
});
