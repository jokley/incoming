import assert from 'node:assert/strict';
import test from 'node:test';

import { actionableQuotaCaseCount, calculateAdditionalCosts, hasSingleRoomSurcharge, quotaRequiresAction, singleRoomBadgeLabels, uniqueQuotaContext } from './quotaEvaluation.ts';

test('single-room and surcharge badges follow independent persisted state', () => {
  assert.deepEqual(singleRoomBadgeLabels(true, 'APPROVED_EXTRA'), ['Einzelzimmer', 'EZ genehmigt', 'Mehrpreis']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'APPROVED_EXTRA'), ['EZ genehmigt']);
  assert.deepEqual(singleRoomBadgeLabels(true, 'IN_QUOTA'), ['Einzelzimmer']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'NONE'), []);
  assert.equal(hasSingleRoomSurcharge({ single_room_status: 'APPROVED_EXTRA', assignment: { countsAsSingle: true } }), true);
  assert.equal(hasSingleRoomSurcharge({ single_room_status: 'APPROVED_EXTRA', assignment: { countsAsSingle: false } }), false);
  assert.deepEqual(calculateAdditionalCosts([
    { personId: 'approved-active', bookingId: '1', nationCode: 'BRA', discipline: 'HP', gender: 'M', countsAsSingle: true, singleRoomStatus: 'APPROVED_EXTRA' },
    { personId: 'approved-inactive', bookingId: '2', nationCode: 'BRA', discipline: 'HP', gender: 'M', countsAsSingle: false, singleRoomStatus: 'APPROVED_EXTRA' },
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
    'Einzelzimmer', 'EZ genehmigt', 'Mehrpreis',
  ]);
  assert.deepEqual(singleRoomBadgeLabels(true, 'IN_QUOTA'), ['Einzelzimmer']);
  assert.equal(singleRoomBadgeLabels(true, 'IN_QUOTA').includes('EZ genehmigt'), false);
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
