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
