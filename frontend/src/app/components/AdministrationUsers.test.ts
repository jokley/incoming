import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPermissions } from '../auth/permissions.ts';

test('only server-confirmed superadmin exposes rights management', () => {
  const user={username:'owner',displayName:'Owner',email:'',groups:['admin'],permissions:['*']};
  assert.equal(buildPermissions(user).canManageUsers,false);
  assert.equal(buildPermissions({...user,isSuperadmin:true}).canManageUsers,true);
  assert.equal(buildPermissions({...user,groups:[],permissions:[],isSuperadmin:true}).isAdmin,true);
});

test('grant editor shows exact three levels, last observed groups and non-revocable superadmin', async t => {
  const server=await createServer({configFile:false,envFile:false,logLevel:'silent',server:{middlewareMode:true,hmr:false,ws:false,watch:null}});
  t.after(()=>server.close());
  const { UserAccessEditor }=await server.ssrLoadModule('/src/app/components/AdministrationUsers.tsx');
  const props={user:{username:'person',displayName:'Person',groups:['incoming-viewer'],lastSeenAt:null,isSuperadmin:false,grants:{},revision:'r'},events:[{id:'1',name:'First Event',active:true}],onSaved:async()=>{}};
  const normal=renderToStaticMarkup(createElement(UserAccessEditor,props));
  assert.match(normal,/First Event/); assert.match(normal,/Kein Zugriff/);
  assert.match(normal,/incoming-viewer/); assert.match(normal,/Änderungen speichern/);
  assert.match(normal,/passende Funktionsrechte/);
  const root=renderToStaticMarkup(createElement(UserAccessEditor,{...props,user:{...props.user,isSuperadmin:true}}));
  assert.match(root,/hier nicht entziehbar/); assert.doesNotMatch(root,/Änderungen speichern/);
});
