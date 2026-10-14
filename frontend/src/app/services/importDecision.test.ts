import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportApproval, ImportSession } from '../data/importSessions.ts';
import { buildOperationsTask } from './importDecision.ts';
import { previewEventGroupLabel } from './competitionPresentation.ts';

test('multi-group preview shows all exact event groups separately from athlete top-level', () => {
  assert.equal(previewEventGroupLabel(['Snowboard Alpine', 'Snowboard Cross', 'Snowboard Park & Pipe']),
    'Snowboard Alpine, Snowboard Cross, Snowboard Park & Pipe');
  assert.equal(previewEventGroupLabel(['Freestyle']), 'Freestyle');
  assert.equal(previewEventGroupLabel([]), '—');
});

test('USA decision uses approval event group and exact gender, not the session or first quota row', () => {
  const session = { nation: 'USA', discipline: 'Legacy Snowboard', preview: {
    dispositionAnalysis: { categories: { quotaAffected: { records: [] } } },
    quotaChecks: [
      { nationCode: 'USA', discipline: 'Snowboard Alpine', gender: 'M', officials: 2, officialQuota: 4 },
      { nationCode: 'USA', discipline: 'Snowboard Cross', gender: 'M', officials: 9, officialQuota: 6 },
      { nationCode: 'USA', discipline: 'Snowboard Cross', gender: 'W', officials: 8, officialQuota: 5 },
    ],
  } } as unknown as ImportSession;
  const approval = { nation: 'USA', type: 'QUOTA_OFFICIALS_EXCEEDED', description: 'Officials überschritten',
    quotaDetails: { discipline: 'Snowboard Cross', gender: 'W', importedOfficials: 99, officialQuota: 99 },
  } as unknown as ImportApproval;
  const task = buildOperationsTask(session, approval);
  assert.equal(task.discipline, 'Snowboard Cross');
  assert.equal(task.gender, 'W');
  assert.deepEqual(task.quota, { current: 8, allowed: 5, label: 'Officials' });
  session.discipline = undefined;
  assert.equal(buildOperationsTask(session, approval).discipline, 'Snowboard Cross');
});

test('completed residual EZ decision retains structured EZ figures after its type changes', () => {
  const approval = {nation:'AUT', type:'NATION_APPROVED', decision:'APPROVED', description:'Zusätzliche EZ · Ski Cross · M',
    quotaDetails:{decisionKind:'SINGLE_ROOM',discipline:'Ski Cross',gender:'M',ezRequested:4,ezEntitlement:2,ezExcess:2,
      officialsBasis:6,officialsReported:9,singleRoomCandidates:[{personKey:'P',name:'P'}]}} as ImportApproval;
  const session = {nation:'AUT',preview:{dispositionAnalysis:{categories:{quotaAffected:{records:[]}}},
    quotaChecks:[{nationCode:'AUT',discipline:'Ski Cross',gender:'M',officials:9,officialQuota:6,singleRooms:4,singleRoomsAllowed:2}]}} as unknown as ImportSession;
  const task = buildOperationsTask(session,approval);
  assert.deepEqual(task.quota,{current:4,allowed:2,label:'Single Rooms'});
  assert.equal(task.excessCount,2);
  assert.equal(task.recommendation,'Mehrkosten abstimmen');
  approval.description='A human-readable description without rule names';
  assert.deepEqual(buildOperationsTask(session,approval).quota,task.quota);
});
