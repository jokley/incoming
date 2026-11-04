import test from 'node:test';
import assert from 'node:assert/strict';
import { currentPreviewDetail, canApproveSingleRoomSelection, canonicalSessionState } from './importPreview.ts';
import type { ImportSession } from '../data/importSessions.ts';

test('open person and quota dialogs reflect crown set/remove without reopening', () => {
  const personDialog: {title:string;rows:(string | number)[][]} = { title: 'Personen der Importvorschau', rows: [['no crown', '+EZ offen']] };
  const quotaDialog: {title:string;rows:(string | number)[][]} = { title: 'Quota & EZ', rows: [[1]] };
  const canonical = { people: [['Weltmeister', 'Einzelzimmer']], rooms: [['Weltmeister']], quota: [[0]] };
  assert.deepEqual(currentPreviewDetail(personDialog, canonical)?.rows, canonical.people);
  assert.deepEqual(currentPreviewDetail(quotaDialog, canonical)?.rows, canonical.quota);
  const removed = { people: [['no crown', '+EZ offen']], rooms: [['+EZ offen']], quota: [[1]] };
  assert.deepEqual(currentPreviewDetail(personDialog, removed)?.rows, removed.people);
  assert.deepEqual(currentPreviewDetail(quotaDialog, removed)?.rows, removed.quota);
  assert.deepEqual(personDialog.rows, [['no crown', '+EZ offen']]);
});

test('one or multiple people can be approved without selecting the entire excess', () => {
  assert.equal(canApproveSingleRoomSelection(['A'], 3), true);
  assert.equal(canApproveSingleRoomSelection(['A','B'], 3), true);
  assert.equal(canApproveSingleRoomSelection(['A','B','C'], 3), true);
  assert.equal(canApproveSingleRoomSelection([], 3), false);
  assert.equal(canApproveSingleRoomSelection(['A','A'], 3), false);
  assert.equal(canApproveSingleRoomSelection(['A','B'], 1), false);
});

test('release replaces the canonical preview used by card, markers and open details', () => {
  const session = {status:'APPROVED',preview:{quotaChecks:[{singleRoomsPending:0}],people:[{singleRoomEntitlement:'APPROVED_EXTRA'}]}} as unknown as ImportSession;
  const state = canonicalSessionState(session);
  assert.equal(state.selected,session);
  assert.equal(state.preview,session.preview);
  assert.equal(state.preview?.quotaChecks?.[0].singleRoomsPending,0);
  assert.equal(state.preview?.people[0].singleRoomEntitlement,'APPROVED_EXTRA');
  const oldDialog = {title:'Quota & EZ',rows:[['+1 EZ offen']]};
  assert.deepEqual(currentPreviewDetail(oldDialog,{people:[['Mehrpreis genehmigt']],rooms:[],quota:[['✓']]})?.rows,[['✓']]);
});
