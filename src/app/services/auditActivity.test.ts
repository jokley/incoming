import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuditEvent } from '../types.ts';
import { assignmentWorkspaceHref, describeAuditEvent } from './auditActivity.ts';

test('athlete review deep-links use the booking projection without an unsupported room type id', () => {
  const href = assignmentWorkspaceHref({ bookingId: '17', hotelId: '4', personId: '23' });
  assert.equal(href, '/assignments?assignmentId=17&hotelId=4&athleteId=23');
  assert.equal(assignmentWorkspaceHref({ bookingId: null, hotelId: null, personId: '23' }), '/assignments?athleteId=23');
});

const event = (path: string, entityRefs?: AuditEvent['entityRefs']): AuditEvent => ({
  id: path,
  entityType: 'import',
  entityId: '7',
  action: 'update',
  path,
  changes: { decision: 'APPROVED' },
  username: 'operator',
  displayName: 'Operator',
  method: 'PATCH',
  createdAt: '2026-10-01T10:00:00Z',
  entityRefs,
});

test('decision activity deep-links to the concrete decision', () => {
  const approved = describeAuditEvent(event('/api/import/sessions/7/approvals/41'));
  assert.equal(approved.openLabel, 'Entscheidung anzeigen');
  assert.equal(approved.href, '/import?decisionId=41');

  const revised = describeAuditEvent({
    ...event('/api/import/sessions/7/approvals/42', {
      importSessionId: '7', decisionId: '42',
    }),
    activity: 'Einzelzimmerentscheidung geändert',
    category: 'Entscheidungen',
    entityLabel: 'BRA',
  });
  assert.equal(revised.href, '/import?decisionId=42');
});

test('import activity continues to deep-link to the import session', () => {
  const approvedImport = describeAuditEvent(event('/api/import/sessions/7/approve'));
  assert.equal(approvedImport.openLabel, 'Importsession öffnen');
  assert.equal(approvedImport.href, '/import?sessionId=7');

  const completedImport = describeAuditEvent(event('/api/import/sessions/7/import'));
  assert.equal(completedImport.href, '/import?sessionId=7');
});
