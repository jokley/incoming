import assert from 'node:assert/strict';
import test from 'node:test';

import { singleRoomBadgeLabels } from './quotaEvaluation.ts';

test('single-room and surcharge badges follow independent persisted state', () => {
  assert.deepEqual(singleRoomBadgeLabels(true, 'APPROVED_EXTRA'), ['Einzelzimmer', 'Mehrpreis']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'APPROVED_EXTRA'), ['Mehrpreis']);
  assert.deepEqual(singleRoomBadgeLabels(true, 'IN_QUOTA'), ['Einzelzimmer']);
  assert.deepEqual(singleRoomBadgeLabels(false, 'NONE'), []);
});
