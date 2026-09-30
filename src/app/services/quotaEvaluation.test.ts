import assert from 'node:assert/strict';
import test from 'node:test';

import { hasSingleRoomSurcharge, showStandaloneSingleRoomSurcharge } from './quotaEvaluation.ts';

test('approved-extra surcharge is represented exactly once by the combined status badge', () => {
  const person = { single_room_status: 'APPROVED_EXTRA' };
  const renderedSurchargeIndicators = Number(hasSingleRoomSurcharge(person))
    + Number(showStandaloneSingleRoomSurcharge(person));

  assert.equal(renderedSurchargeIndicators, 1);
  assert.equal(showStandaloneSingleRoomSurcharge(person), false);
});

test('non-approved statuses do not render a surcharge chip', () => {
  for (const single_room_status of ['NONE', 'IN_QUOTA', 'PENDING_APPROVAL']) {
    const person = { single_room_status };
    assert.equal(hasSingleRoomSurcharge(person), false);
    assert.equal(showStandaloneSingleRoomSurcharge(person), false);
  }
});
