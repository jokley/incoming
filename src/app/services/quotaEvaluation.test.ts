import assert from 'node:assert/strict';
import test from 'node:test';

import { actionableQuotaCaseCount, quotaRequiresAction, singleRoomBadgeLabels, uniqueQuotaContext } from './quotaEvaluation.ts';

test('single-room and surcharge badges follow independent persisted state', () => {
  assert.deepEqual(singleRoomBadgeLabels(true, 'APPROVED_EXTRA'), ['Einzelzimmer', 'Mehrpreis']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'APPROVED_EXTRA'), ['Mehrpreis']);
  assert.deepEqual(singleRoomBadgeLabels(true, 'IN_QUOTA'), ['Einzelzimmer']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'NONE'), []);
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
