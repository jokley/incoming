import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { canConfirmReview, importReviewRequest } from '../services/importReview.ts';
import type { ImportChangePlan } from '../types';

const plan: ImportChangePlan = {digest:'reviewed',eventId:7,nation:'JPN',importVersion:2,snapshotScope:'FULL_NATION',requiresDestructiveConfirmation:true,
  people:{create:[],update:[],unchanged:[],remove:[{personId:42,name:'Removed Person',fisCode:'9300953',competitorId:'0042',competitionIds:[1],bookingIds:[9],before:{accommodation_requirement:'NO_ROOM',accommodation_requirement_source:'MANUAL',accommodation_rate_category:'SPECIAL',single_room_status:'APPROVED_EXTRA'}}]},
  memberships:{add:[],remove:[{personId:42,competitionId:1}],unchanged:[]},operations:{bookingIds:[9],deleteEmptyBookingIds:[9],partnerIds:[8],bookings:[{id:9,check_in_date:'2027-03-03',check_out_date:'2027-03-09',counts_as_single:false}]}};
let server: ViteDevServer;
let Component: React.ElementType;
before(async()=>{server=await createServer({configFile:false,root:fileURLToPath(new URL('../../..',import.meta.url)),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});Component=(await server.ssrLoadModule('/src/app/components/ImportChangePlan.tsx')).ImportChangePlan;});
after(async()=>{await server?.close();});

test('requires destructive consent and a current plan, but no separate scope consent',()=>{
  assert.equal(canConfirmReview(plan,false),false);
  assert.equal(canConfirmReview(plan,true,true),false);
  assert.throws(()=>importReviewRequest(plan,false));
  assert.deepEqual(importReviewRequest(plan,true),{planDigest:'reviewed',snapshotScope:'FULL_NATION',confirmDestructiveChanges:true});
  assert.equal(canConfirmReview(undefined,true),false);
  assert.equal(canConfirmReview({...plan,requiresDestructiveConfirmation:false},false),true);
});

test('shows removal identities, manual values, booking consequences and explicit consent',()=>{
  const html=renderToStaticMarkup(createElement(Component,{plan,editable:true,scopeConfirmed:false,destructiveConfirmed:false,onScope:()=>{},onDestructive:()=>{},onRecheck:()=>{},busy:false}));
  for(const text of ['Änderungsplan','Removed Person','9300953','0042','SPECIAL','NO_ROOM','Diese Meldung ersetzt den bisherigen vollständigen Nationenbestand für das ausgewählte Event.','Buchungsfolgen','Nach Entfernung leer','Historische Genehmigungs-Evidence'])assert.ok(html.includes(text),text);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,1);
  assert.ok(!html.includes('checked=""'));
  assert.ok(!html.includes('Vollständige Nationenmeldung bestätigen'));
});

test('stale plans visibly require new review and disable confirmation controls',()=>{
  const html=renderToStaticMarkup(createElement(Component,{plan,stale:true,editable:true,scopeConfirmed:false,destructiveConfirmed:false,onScope:()=>{},onDestructive:()=>{},onRecheck:()=>{},busy:false}));
  assert.ok(html.includes('Prüfstand veraltet'));
  assert.ok(html.includes('Erneut prüfen / Reimport vorbereiten'));
  assert.equal((html.match(/type="checkbox" disabled=""/g)||[]).length,1);
});


test('sport-family plan labels its actual scope and confirms exactly that server scope',()=>{
 const partial={...structuredClone(plan),snapshotScope:'SPORT_FAMILY' as const,sourceFamily:'Snowboard' as const};
 partial.people.unchanged=[{personId:8,name:'Preserved other-family person'}];
 const html=renderToStaticMarkup(createElement(Component,{plan:partial,stale:false,editable:true,destructiveConfirmed:true,onDestructive:()=>{},onRecheck:()=>{},busy:false}));
 assert.ok(html.includes('Unverändert erhaltene Personen (1)')&&html.includes('Preserved other-family person'));
 assert.ok(html.includes('Teilmeldung')&&html.includes('Snowboard (SB)'));
 assert.ok(html.includes('Personen und Mitgliedschaften des anderen Bereichs bleiben erhalten'));
 assert.equal(importReviewRequest(partial,true).snapshotScope,'SPORT_FAMILY');
 assert.equal(importReviewRequest(plan,true).snapshotScope,'FULL_NATION');
});


test('partial plans distinguish the resulting nation total without counting removed people or memberships twice',()=>{
 const partial={...structuredClone(plan),snapshotScope:'SPORT_FAMILY',sourceFamily:'Freestyle'};
 partial.people.create=[{personKey:'new',personId:null,name:'New'}];
 partial.people.update=[{personId:2,name:'Shared person'}];
 partial.people.unchanged=[{personId:3,name:'Preserved SB'}];
 const props={plan:partial,editable:true,destructiveConfirmed:false,onDestructive:()=>{},onRecheck:()=>{},busy:false};
 const html=renderToStaticMarkup(createElement(Component,props));
 assert.ok(html.includes('Nationsbestand nach diesem Import: 3 Personen'));
 assert.ok(!renderToStaticMarkup(createElement(Component,{...props,stale:true})).includes('Nationsbestand nach diesem Import:'));
 assert.ok(!renderToStaticMarkup(createElement(Component,{...props,plan})).includes('Nationsbestand nach diesem Import:'));
});
