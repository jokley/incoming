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

test('editor uses explicit operative capabilities and never gains administrative authority',()=>{
 const editor=buildPermissions({username:'editor',displayName:'Editor',email:'',groups:['incoming-editor'],permissions:['data.read','data.write','assignments.write','imports.write','audit.read']});
 for(const key of ['canEdit','canDelete','canCreate','canManageHotels','canManageRoomTypes','canManageAssignments','canManageImports','canReadAudit'] as const)assert.equal(editor[key],true,key);
 assert.equal(editor.isAdmin,false);assert.equal(editor.canManageUsers,false);
 const restricted=withEventWriteAccess(editor,false);
 assert.equal(restricted.canManageImports,false);assert.equal(restricted.canDelete,false);
});

test('role labels and a data write capability do not invent import or assignment authority',()=>{
 const user={username:'limited',displayName:'Limited',email:'',groups:['incoming-editor'],permissions:['data.read','data.write']};
 const limited=buildPermissions(user);
 assert.equal(limited.canEdit,true);assert.equal(limited.canManageImports,false);assert.equal(limited.canManageAssignments,false);assert.equal(limited.canReadAudit,false);
 const imports=buildPermissions({...user,permissions:['data.read','imports.write']});
 assert.equal(imports.canManageImports,true);assert.equal(imports.canEdit,false);assert.equal(imports.canDelete,false);
});
