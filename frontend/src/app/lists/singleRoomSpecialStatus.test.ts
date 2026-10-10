import assert from 'node:assert/strict';
import test from 'node:test';

import { personExportColumns } from './listExports.ts';

test('person accommodation export exposes quota-exempt status', () => {
  assert.ok(personExportColumns.some(([key, label]) =>
    key === 'singleRoomSpecialStatus' && label === 'EZ-Sonderstatus'));
});
