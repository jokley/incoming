import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { canConfirmReview, importReviewRequest } from '../services/importReview.ts';
import type { ImportChangePlan } from '../types';

const plan: ImportChangePlan = {digest:'reviewed',eventId:7,nation:'JPN',importVersion:2,snapshotScope:'FULL_NATION',requiresDestructiveConfirmation:true,
  people:{create:[],update:[],unchanged:[],remove:[{personId:42,name:'Removed Person',fisCode:'9300953',competitorId:'0042',competitionIds:[1],bookingIds:[9],before:{accommodation_requirement:'NO_ROOM',accommodation_requirement_source:'MANUAL',accommodation_rate_category:'SPECIAL',single_room_status:'APPROVED_EXTRA'}}]},
  memberships:{add:[],remove:[{personId:42,competitionId:1}],unchanged:[]},operations:{bookingIds:[9],deleteEmptyBookingIds:[9],partnerIds:[8],bookings:[{id:9,check_in_date:'2027-03-03',check_out_date:'2027-03-09',counts_as_single:false}]}};
let server: ViteDevServer;
let Component: React.ElementType;
before(async()=>{server=await createServer({configFile:false,root:new URL('../../..',import.meta.url).pathname,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null},esbuild:{jsx:'automatic'}});Component=(await server.ssrLoadModule('/src/app/components/ImportChangePlan.tsx')).ImportChangePlan;});
after(async()=>{await server?.close();});

test('requires scope, destructive consent and a current plan',()=>{
  for(const [scope,destructive,stale] of [[false,true,false],[true,false,false],[true,true,true]]){
    assert.equal(canConfirmReview(plan,scope,destructive,stale),false);
    assert.throws(()=>importReviewRequest(plan,scope,destructive,stale));
  }
  assert.deepEqual(importReviewRequest(plan,true,true),{planDigest:'reviewed',snapshotScope:'FULL_NATION',confirmDestructiveChanges:true});
  assert.equal(canConfirmReview(undefined,true,true),false);
});

test('shows removal identities, manual values, booking consequences and explicit consent',()=>{
  const html=renderToStaticMarkup(createElement(Component,{plan,editable:true,scopeConfirmed:false,destructiveConfirmed:false,onScope:()=>{},onDestructive:()=>{},onRecheck:()=>{},busy:false}));
  for(const text of ['Änderungsplan','Removed Person','9300953','0042','SPECIAL','NO_ROOM','vollständige Meldung','Keine Teilmeldung','Buchungsfolgen','Nach Entfernung leer','Historische Genehmigungs-Evidence'])assert.ok(html.includes(text),text);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,2);
  assert.ok(!html.includes('checked=""'));
});

test('stale plans visibly require new review and disable confirmation controls',()=>{
  const html=renderToStaticMarkup(createElement(Component,{plan,stale:true,editable:true,scopeConfirmed:false,destructiveConfirmed:false,onScope:()=>{},onDestructive:()=>{},onRecheck:()=>{},busy:false}));
  assert.ok(html.includes('Prüfstand veraltet'));
  assert.ok(html.includes('Erneut prüfen / Reimport vorbereiten'));
  assert.equal((html.match(/type="checkbox" disabled=""/g)||[]).length,2);
});
