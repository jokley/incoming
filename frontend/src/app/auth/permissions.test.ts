import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPermissions, withEventWriteAccess } from './permissions.ts';

test('event read-only grant restricts global admin capabilities without changing the role', () => {
  const admin = buildPermissions({username:'admin',displayName:'Admin',email:'',groups:['incoming-admin'],permissions:['*']});
  const scoped = withEventWriteAccess(admin, false);
  assert.equal(scoped.isAdmin, true);
  assert.equal(scoped.canReadAudit, true);
  assert.equal(scoped.isReadOnly, true);
  for (const key of ['canEdit','canDelete','canCreate','canManageImports','canManageAssignments','canManageHotels','canManageRoomTypes'] as const) assert.equal(scoped[key], false);
  assert.equal(withEventWriteAccess(admin, true), admin);
});

test('event write grant cannot elevate a functional viewer role', () => {
  const viewer = buildPermissions({username:'reader',displayName:'Reader',email:'',groups:['incoming-viewer'],permissions:['data.read']});
  assert.equal(withEventWriteAccess(viewer,true).canEdit,false);
});
