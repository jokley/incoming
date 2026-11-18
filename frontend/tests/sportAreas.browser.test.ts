import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { createServer } from 'vite';

test('area filters and event mappings use two labels without changing API identities', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const vite = await createServer({ root, configFile: `${root}vite.config.ts`, envFile: false,
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, base: '/',
    cacheDir: await mkdtemp(`${tmpdir()}/incoming-area-browser-`),
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false, ws: false } });
  t.after(() => vite.close());
  await vite.listen();
  const browser = await chromium.launch({ headless: true,
    ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  const competitions = [
    { id:'sb',sport:'Snowboard',displayName:'Snowboard Halfpipe',quotaDiscipline:'Snowboard Park & Pipe' },
    { id:'fs',sport:'Freeski',displayName:'Freeski Halfpipe',quotaDiscipline:'Freeski Park & Pipe' },
    { id:'mo',sport:'Freestyle Ski',displayName:'Moguls',quotaDiscipline:'Freestyle' },
  ].map(c => ({ ...c,name:c.displayName,importCode:c.id,code:c.id,gender:'M',active:true,teamCompetition:false }));
  const people = [
    { id:'1',firstname:'Snow',nationCode:'AUT',competitions:[competitions[0]] },
    { id:'2',firstname:'Ski',nationCode:'ITA',competitions:[competitions[1]] },
    { id:'3',firstname:'Mogul',nationCode:'AUT',competitions:[competitions[2],competitions[2]] },
    { id:'4',firstname:'Dual',nationCode:'AUT',competitions:[competitions[1],competitions[0]] },
    { id:'5',firstname:'Other',nationCode:'AUT',competitions:[] },
  ].map(p => ({ ...p,lastname:'Rider',function:'Athlete',gender:'M',single_room_status:'NONE',accommodationRequirement:'REQUIRED' }));
  const event = { id:'1',name:'Synthetic WM',active:true,year:2027,planningPeriods:[],
    competitionMappings:competitions.map(c => ({ ...c,competitionId:c.id,eventId:'1',officialName:c.name,fisCodex:c.code })) };
  const writes: string[] = [];
  // Every API request is intercepted; no TEST/PROD services or data are used.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice('/api'.length);
    // Auth observation is a normal mocked POST; no domain mutation is allowed.
    if (route.request().method() !== 'GET' && path !== '/auth/me') writes.push(path);
    const bodies: Record<string, unknown> = {
      '/auth/me':{username:'local-admin',displayName:'local-admin',groups:['incoming-admin'],permissions:['*']},
      '/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},
      '/athletes':people,'/competitions':competitions,'/admin/events':[event],'/admin/events/1':event,
    };
    await route.fulfill({ status:path in bodies ? 200 : 404,json:bodies[path] ?? {error:'Unexpected synthetic test request'} });
  });
  page.on('pageerror', error => console.error('Area browser error:', error.message));
  const section = (name: string) => page.getByRole('heading',{name,exact:true}).locator('..');
  const rows = () => page.locator('table tbody tr');
  await page.goto(`${origin}/athletes`);
  await section('Bereich').waitFor();
  assert.equal(await section('Bereich').getByRole('button').count(),2);
  assert.match(await section('Bereich').getByRole('button',{name:/^Snowboard/}).innerText(),/2/);
  assert.match(await section('Bereich').getByRole('button',{name:/^Freestyle \/ Freeski/}).innerText(),/3/);
  await section('Bereich').getByRole('button',{name:/^Freestyle \/ Freeski/}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 3);
  const visible = (await rows().allTextContents()).join(' ');
  for (const name of ['Ski Rider','Mogul Rider','Dual Rider']) assert.ok(visible.includes(name));
  assert.ok(!visible.includes('Snow Rider'));
  await section('Nationen').getByRole('button',{name:/^AUT/}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 2);
  assert.match(await section('Bereich').getByRole('button',{name:/^Freestyle \/ Freeski/}).innerText(),/2/);
  await page.getByRole('button',{name:/^Moguls/}).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 1);
  assert.ok((await rows().innerText()).includes('Mogul Rider'));
  assert.match(await section('Bereich').getByRole('button',{name:/^Freestyle \/ Freeski/}).innerText(),/1/);

  await page.goto(`${origin}/administration`);
  await page.getByRole('tab',{name:'Competition Mapping',exact:true}).click();
  await page.getByRole('columnheader',{name:'Bereich',exact:true}).waitFor();
  assert.equal(await page.getByRole('cell',{name:'Snowboard',exact:true}).count(),1);
  assert.equal(await page.getByRole('cell',{name:'Freestyle / Freeski',exact:true}).count(),2);
  assert.equal(await page.getByRole('cell',{name:'Freeski',exact:true}).count(),0);
  assert.equal(await page.getByRole('cell',{name:'Freestyle Ski',exact:true}).count(),0);
  assert.deepEqual(writes,[]);
});

test('import grouping preserves the joint roster, searches, room warnings and global blockers without requests', async t => {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-import-browser-`),server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage();const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const people=[['snow','Snow',['Snowboard'],['Configured Snow Group']],['ski','Ski',['Freestyle'],['Configured Ski Group','Second Ski Group']],['both','Both',['Snowboard','Freestyle'],['Configured Snow Group','Configured Ski Group']]].map(([matchKey,firstname,athleteQuotaFamilies,quotaDisciplines],i)=>({matchKey,firstname,athleteQuotaFamilies,quotaDisciplines,lastname:'Synthetic',nationCode:'AUT',rowNumber:i+2,function:'Athlete',gender:'M',roomType:'Double shared',accommodationRequirement:'REQUIRED',accommodationRateCategory:'STANDARD',competitionMemberships:[]}));
 const rooms=[{sourceRowKey:'joint',rowNumber:2,person1Key:'snow',person1Name:'Snow Synthetic',person2Key:'ski',person2Name:'Ski Synthetic',roomType:'Double shared',sourceRows:[{versionId:10,version:1,row:2},{versionId:20,version:2,row:2}]},{sourceRowKey:'unknown',rowNumber:3,person1Key:'both',person1Name:'Both Synthetic',person2Key:null,roomType:'Double shared',sourceRows:[{versionId:10,version:1,row:3}]}];
 const preview={eventId:'1',people,rooms,errors:[{code:'ROOM_PERSON_NOT_FOUND',message:'Unresolved original Room List row',details:{row:9}}],warnings:[],quotaChecks:[],athleteQuotaChecks:[],isValid:false,submissionSources:{Snowboard:10,Freestyle:20},replacementScope:{kind:'SPORT_FAMILY'},changePlan:{digest:'frozen-plan',people:{create:[],update:[],unchanged:[],remove:[]},memberships:{add:[],remove:[]},operations:{bookingIds:[],deleteEmptyBookingIds:[],bookings:[],partnerIds:[]},validationErrors:[]},dispositionAnalysis:{changes:[],categories:Object.fromEntries(['removedAthletes','dispositionAffected'].map(name=>[name,{records:[]}]))}};
 const session={id:'1',nation:'AUT',status:'PROFESSIONALLY_REVIEWED',errors:1,warnings:0,version:3,currentVersionId:'30',uploadedAt:'2026-11-15T12:00:00Z',uploadedBy:'Synthetic',currentVersion:null,versions:[],history:[],approvals:[],preview,submissions:[{family:'Snowboard',versionId:'10',people:2,status:'DRAFT'},{family:'Freestyle',versionId:'20',people:2,status:'DRAFT'}],importControl:{people:people.map(p=>({personKey:p.matchKey,competitions:[],quotaContexts:[]})),issues:[],competitions:[]}};
 const event={id:'1',name:'Synthetic grouping event',active:true,year:2027,planningPeriods:[]};
 const requests:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname.slice(4);requests.push(`${route.request().method()} ${path}`);const bodies:Record<string,unknown>={'/auth/me':{username:'local-admin',displayName:'local-admin',groups:['incoming-admin'],permissions:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/import/sessions':[session],'/import/sessions/1':session};await route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected request'}});});
 await page.goto(`${origin}/import?sessionId=1`);
 const grouping=page.getByRole('group',{name:'Gruppieren:'});await grouping.waitFor();
 assert.equal(await grouping.getByRole('button',{name:'Aus',exact:true}).getAttribute('aria-pressed'),'true');
 const initialRequests=[...requests];await grouping.getByRole('button',{name:'Ein',exact:true}).click();
 const card=page;
 await card.getByRole('button',{name:/^Personen/}).first().click();let dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.equal(await dialog.getByRole('button',{name:/^Importdetails /}).count(),3);
 const assertHeaders=async(unit:string,expected:string[])=>{
  assert.deepEqual(await dialog.locator('th[scope="rowgroup"]').allTextContents(),expected);
  const counts=await dialog.locator('th[scope="rowgroup"] span').allTextContents();
  assert.equal(counts.reduce((sum,label)=>sum+Number.parseInt(label),0),await dialog.locator('tbody tr td:first-child').count());
  assert.ok(counts.every(label=>label.endsWith(unit)));
 };
 await assertHeaders('Personen',['Freestyle / Freeski1 Personen','Gemeinsam / nicht eindeutig zugeordnet1 Personen','Snowboard1 Personen']);
 assert.equal(await dialog.locator('th[scope="rowgroup"]').filter({hasText:'Event Groups'}).count(),0);
 assert.match(await dialog.innerText(),/Configured Ski Group/);
 assert.match(await dialog.innerText(),/Second Ski Group/);
 await dialog.getByLabel('Person suchen').fill('Snow');assert.equal(await dialog.getByRole('button',{name:/^Importdetails /}).count(),1);
 await assertHeaders('Personen',['Snowboard1 Personen']);
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await card.getByRole('button',{name:/^Zimmerzuordnungen/}).click();dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.equal(await dialog.locator('tbody tr td:first-child').count(),2);assert.match(await dialog.innerText(),/Gemeinsam \/ nicht eindeutig zugeordnet/);assert.match(await dialog.innerText(),/Zimmerpartner ungeklärt/);assert.ok(!(await dialog.innerText()).includes('Configured Snow Group'));
 await assertHeaders('Zimmerangaben',['Gemeinsam / nicht eindeutig zugeordnet2 Zimmerangaben']);
 await dialog.getByLabel('Anzeigen').selectOption('partner');
 await assertHeaders('Zimmerangaben',['Gemeinsam / nicht eindeutig zugeordnet1 Zimmerangaben']);
 await dialog.getByLabel('Anzeigen').selectOption('all');
 await dialog.getByLabel('Person suchen').fill('Snow');
 await assertHeaders('Zimmerangaben',['Gemeinsam / nicht eindeutig zugeordnet1 Zimmerangaben']);
 await dialog.getByLabel('Person suchen').fill('');
 await dialog.getByLabel('Anzeigen').selectOption('error');assert.match(await dialog.innerText(),/Unresolved original Room List row/);
 assert.equal(await dialog.locator('th[scope="rowgroup"]').count(),0);
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await grouping.getByRole('button',{name:'Ein',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('button',{name:'Freigeben',exact:true}).count(),0);
 await grouping.getByRole('button',{name:'Aus',exact:true}).click();await card.getByRole('button',{name:/^Personen/}).first().click();dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:/^Importdetails /}).count(),3);assert.equal(await dialog.locator('th[scope="rowgroup"]').count(),0);
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>document.documentElement.classList.add('dark'));
 await grouping.getByRole('button',{name:'Ein',exact:true}).click();
 await card.getByRole('button',{name:/^Zimmerzuordnungen/}).click();
 await page.getByRole('dialog').waitFor();
 assert.equal(await page.getByRole('dialog').locator('tbody tr td:first-child').count(),2);
 await page.screenshot({path:'/tmp/incoming-grouped-mobile.png',animations:'disabled'});
 assert.deepEqual(requests,initialRequests);assert.deepEqual(errors,[]);
 // Planning is embedded in the import workspace, never linked to Athletes.
 assert.equal(await page.getByRole('link',{name:'Athletenprognose nach Import bearbeiten'}).count(),0);
 assert.ok(requests.every(request=>request.startsWith('GET ')||request==='POST /auth/me'));
});


test('NN decisions are integrated in import approval and editable after import without FIS replay',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-nn-browser-`),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const people=Array.from({length:8},(_,i)=>({matchKey:'p'+i,id:String(i+1),firstname:i===0?'Champion':'Athlete'+i,lastname:'Synthetic',nationCode:'FIN',function:'Athlete',gender:'M',single_room_status:'NONE',competitions:[],quotaDisciplines:['Freeski Park & Pipe'],accommodationRequirement:'REQUIRED'}));
 const row:any={areaId:'forecast-scope',eventId:'1',nationCode:'FIN',discipline:'Freeski Park & Pipe',personalGender:'M',sportFamilies:['Freestyle'],reportedCount:8,expectedTotal:null,virtualPlaces:0,bookedPeopleCount:0,usesVirtualPlanning:false,replacedPersonIds:[],status:'NOT_SET',conflict:false,reasons:[],editable:true,worldChampionCount:1,people:[],quotaHints:[{name:'Halfpipe Herren',regularMax:4}],checkInDate:null,checkOutDate:null,note:null,revision:0,baseToken:'original',updatedBy:null,updatedAt:null};
 const planning:any={eventId:'1',nationCode:'FIN',reportedCount:8,mode:'IMPORT',versionId:'30',rows:[row],decisions:[]};
 const preview:any={eventId:'1',people,rooms:[],errors:[],warnings:[],quotaChecks:[],athleteQuotaChecks:[],isValid:true,changePlan:{digest:'frozen-plan',snapshotScope:'FULL_NATION',people:{create:[],update:[],unchanged:[],remove:[]},memberships:{add:[],remove:[]},operations:{bookingIds:[],deleteEmptyBookingIds:[],bookings:[],partnerIds:[]},validationErrors:[]},dispositionAnalysis:{changes:[],categories:Object.fromEntries(['removedAthletes','dispositionAffected'].map(name=>[name,{records:[]}]))}};
 const session:any={id:'1',nation:'FIN',status:'PROFESSIONALLY_REVIEWED',errors:0,warnings:0,version:3,currentVersionId:'30',uploadedAt:'2026-11-15T12:00:00Z',uploadedBy:'Synthetic',currentVersion:null,versions:[],history:[],approvals:[],preview,nnPlanning:planning,importControl:{people:[],issues:[],competitions:[]}};
 const event={id:'1',name:'NN synthetic',active:true};let stale=false,reader=false;
 const writes:any[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.slice(4);
  if(req.method()==='POST'&&path.startsWith('/import/sessions/1/')){
   const body=req.postDataJSON();writes.push({path,body});
   if(path.endsWith('/approve')){assert.equal(body.nnPlanning[0].expectedTotal,4);planning.decisions=body.nnPlanning;session.status='APPROVED';}
   if(path.endsWith('/import')){assert.equal(body.versionId,'30');session.status='IMPORTED';planning.mode='LIVE';Object.assign(row,{expectedTotal:4,virtualPlaces:4,usesVirtualPlanning:true});return route.fulfill({json:{success:true,summary:{peopleCreated:8,peopleUpdated:0,fisRoomsImported:0},session}});}
   if(path.endsWith('/nn-planning')){
    assert.equal(body.versionId,'30');assert.equal(body.nnPlanning[0].expectedTotal,5);
    if(stale)return route.fulfill({status:409,json:{error:'STALE_PREVIEW',message:'Planung wurde geändert. Bitte neu laden.'}});
    Object.assign(row,{expectedTotal:5,virtualPlaces:5,usesVirtualPlanning:true,revision:2,baseToken:'next'});
   }
   return route.fulfill({json:session});
  }
  const bodies:Record<string,unknown>={'/auth/me':{username:'tester',groups:[reader?'incoming-viewer':'incoming-admin'],permissions:reader?['data.read']:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:!reader}],selectedEventId:'1',switchingAllowed:false},'/import/sessions':[session],'/import/sessions/1':session,'/athletes':people};
  return route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected request'}});
 });
 await page.goto(`${origin}/import?sessionId=1`);
 const section=page.locator('details[aria-label="NN-Unterkunftsplanung"]');await section.locator(':scope > summary').click();
 await section.getByText('Normal namentlich',{exact:true}).waitFor();assert.match(await section.innerText(),/Weltmeister/);
 const select=section.getByLabel('NN-Entscheidung Freeski Park & Pipe M',{exact:true});
 await select.selectOption('NN');await section.getByLabel('NN-Anzahl Freeski Park & Pipe M',{exact:true}).fill('4');
 assert.equal(writes.length,0); // Inputs and a discarded page never persist.
 await page.reload();await section.locator(':scope > summary').click();assert.equal(await select.inputValue(),'KEEP');assert.equal(writes.length,0);
 await select.selectOption('NN');await section.getByLabel('NN-Anzahl Freeski Park & Pipe M',{exact:true}).fill('');
 await page.getByRole('button',{name:'Freigeben',exact:true}).click();await page.getByText('NN-Gesamtzahl muss eine nichtnegative ganze Zahl sein.',{exact:true}).waitFor();assert.equal(writes.length,0);
 await section.getByLabel('NN-Anzahl Freeski Park & Pipe M',{exact:true}).fill('4');
 await page.getByRole('button',{name:'Freigeben',exact:true}).click();await page.getByRole('button',{name:'Importieren',exact:true}).waitFor();
 assert.equal(row.expectedTotal,null);assert.equal(await select.isDisabled(),true);
 await section.scrollIntoViewIfNeeded();await page.screenshot({path:'/workspace/artifacts/import-nn-approved.png',animations:'disabled'});
 await page.getByRole('button',{name:'Importieren',exact:true}).click();await section.getByRole('button',{name:'NN-Entscheidung übernehmen'}).waitFor();
 assert.equal(row.expectedTotal,4);
 await select.selectOption('NN');await section.getByLabel('NN-Anzahl Freeski Park & Pipe M',{exact:true}).fill('5');
 stale=true;await section.getByRole('button',{name:'NN-Entscheidung übernehmen'}).click();await page.getByText('Planung wurde geändert. Bitte neu laden.',{exact:true}).waitFor();assert.equal(row.expectedTotal,4);
 stale=false;await section.getByRole('button',{name:'NN-Entscheidung übernehmen'}).click();await section.getByRole('cell',{name:'5',exact:true}).waitFor();
 await section.scrollIntoViewIfNeeded();await page.screenshot({path:'/workspace/artifacts/import-nn-live.png',animations:'disabled'});
 await page.getByRole('button',{name:'Helles Theme verwenden',exact:true}).click();await section.scrollIntoViewIfNeeded();await page.screenshot({path:'/workspace/artifacts/import-nn-light.png',animations:'disabled'});
 assert.equal(writes.filter(w=>w.path.endsWith('/import')).length,1);assert.equal(writes.filter(w=>w.path.includes('/athletes')).length,0);
 // An imported individual submission opens its live NN decision without an automatic recheck/import.
 session.submissions=[{family:'Freestyle',versionId:'30',people:8,status:'IMPORTED'}];preview['replacementScope']={kind:'SPORT_FAMILY',family:'Freestyle'};
 await page.reload();await section.locator(':scope > summary').click();assert.equal(await select.isDisabled(),false);assert.equal(writes.filter(w=>w.path.endsWith('/recheck')).length,0);
 reader=true;await page.reload();await section.locator(':scope > summary').click();assert.equal(await select.isDisabled(),true);
 await page.goto(`${origin}/athletes`);await page.getByRole('columnheader',{name:'Gender',exact:true}).waitFor();assert.equal(await page.locator('details[aria-label="Athleten-Anreiseplanung"]').count(),0);
 assert.deepEqual(errors,[]);
});
