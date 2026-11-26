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
 const rooms=[{sourceRowKey:'joint',rowNumber:2,checkInDate:'2027-03-02',checkOutDate:'2027-03-04',person1Key:'snow',person1Name:'Snow Synthetic',person2Key:'ski',person2Name:'Ski Synthetic',roomType:'Double shared',sourceRows:[{versionId:10,version:1,row:2},{versionId:20,version:2,row:2}]},{sourceRowKey:'unknown',rowNumber:3,person1Key:'both',person1Name:'Both Synthetic',person2Key:null,roomType:'Double shared',sourceRows:[{versionId:10,version:1,row:3}]}];
 const preview={eventId:'1',people,rooms,errors:[{code:'ROOM_PERSON_NOT_FOUND',message:'Unresolved original Room List row',details:{row:9}}],warnings:[],quotaChecks:[],athleteQuotaChecks:[],isValid:false,submissionSources:{Snowboard:10,Freestyle:20},replacementScope:{kind:'SPORT_FAMILY'},changePlan:{digest:'frozen-plan',people:{create:[],update:[],unchanged:[],remove:[]},memberships:{add:[],remove:[]},operations:{bookingIds:[],deleteEmptyBookingIds:[],bookings:[],partnerIds:[]},validationErrors:[]},dispositionAnalysis:{changes:[],categories:Object.fromEntries(['removedAthletes','dispositionAffected'].map(name=>[name,{records:[]}]))}};
 const session={id:'1',nation:'AUT',status:'PROFESSIONALLY_REVIEWED',errors:1,warnings:0,version:3,currentVersionId:'30',uploadedAt:'2026-11-15T12:00:00Z',uploadedBy:'Synthetic',currentVersion:null,versions:[],history:[],approvals:[],preview,submissions:[{family:'Snowboard',versionId:'10',people:2,status:'DRAFT'},{family:'Freestyle',versionId:'20',people:2,status:'DRAFT'}],importControl:{people:people.map(p=>({personKey:p.matchKey,competitions:[],quotaContexts:[]})),issues:[],competitions:[]}};
 const event={id:'1',name:'Synthetic grouping event',active:true,year:2027,planningPeriods:[]};
 const requests:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname.slice(4);requests.push(`${route.request().method()} ${path}`);const bodies:Record<string,unknown>={'/auth/me':{username:'local-admin',displayName:'local-admin',groups:['incoming-admin'],permissions:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/import/sessions':[session],'/import/sessions/1':session};await route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected request'}});});
 await page.goto(`${origin}/import?sessionId=1`);
 const grouping=page.getByRole('group',{name:'Gruppieren:'});await grouping.waitFor();
 await page.getByText(/Zimmerbedarf \(vorläufig\) · 02\.03\.: 1 bekannt · 1 DZ · 0 EZ/).waitFor();
 assert.equal(await grouping.getByRole('button',{name:'Aus',exact:true}).getAttribute('aria-pressed'),'true');
 const findings=page.getByRole('region',{name:'Klärungsübersicht'});
 assert.match(await findings.innerText(),/Blockierend.*Unresolved original Room List row/);
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


test('automatic person selection is shared by athlete and Officials quota views without NN editing',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-nn-browser-`),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const people=Array.from({length:9},(_,i)=>({athleteQuotaFamilies:['Freestyle'],rowNumber:i+2,roomType:'Double shared',accommodationRateCategory:'STANDARD',matchKey:'p'+i,id:String(i+1),firstname:i===0?'Champion':'Athlete'+i,lastname:'Synthetic',nationCode:'FIN',function:'Athlete',gender:'M',single_room_status:'NONE',competitions:[],quotaDisciplines:['Freeski Park & Pipe'],accommodationRequirement:'REQUIRED'}));
 const row:any={areaId:'forecast-scope',eventId:'1',nationCode:'FIN',discipline:'Freeski Park & Pipe',personalGender:'M',sportFamilies:['Freestyle'],reportedCount:9,expectedTotal:null,virtualPlaces:0,bookedPeopleCount:0,usesVirtualPlanning:false,replacedPersonIds:[],status:'NOT_SET',conflict:false,reasons:[],editable:true,worldChampionCount:1,people:[],quotaHints:[{name:'Halfpipe Herren',regularMax:4}],checkInDate:null,checkOutDate:null,note:null,revision:0,baseToken:'original',updatedBy:null,updatedAt:null};
 const planning:any={eventId:'1',nationCode:'FIN',reportedCount:9,mode:'IMPORT',versionId:'30',rows:[row],decisions:[]};
 const preview:any={eventId:'1',people,rooms:[],errors:[],warnings:[],quotaChecks:[],athleteQuotaChecks:[],isValid:true,changePlan:{digest:'frozen-plan',snapshotScope:'FULL_NATION',people:{create:[],update:[],unchanged:[],remove:[]},memberships:{add:[],remove:[]},operations:{bookingIds:[],deleteEmptyBookingIds:[],bookings:[],partnerIds:[]},validationErrors:[]},dispositionAnalysis:{changes:[],categories:Object.fromEntries(['removedAthletes','dispositionAffected'].map(name=>[name,{records:[]}]))}};
 preview.quotaOverview={event:{name:'Provisional synthetic',isWorldChampionship:true,rulesFixed:true,rulesRevision:1},nations:[{nationCode:'FIN',incomplete:false,athleteFamilies:[{topLevelDiscipline:'Freestyle',athleteQuotaUsed:9,athleteQuotaLimit:36,athleteGenderUsed:{M:9,F:0},athleteGenderLimit:22,athleteQuotaStatus:'WITHIN',decisionStatus:'NONE',requiredExtent:{}}],groups:[{name:'Freeski Park & Pipe',officials:10,athletes:9,coverageReviewRequired:false,contexts:[{gender:'M',athletes:9,officialQuota:11,singleRoomsAllowed:3,singleRoomsRequested:3,singleRoomsApproved:0,singleRoomsPending:0,quotaExemptSingleRooms:0}],totals:{officialQuota:11,singleRoomsAllowed:3,singleRoomsRequested:3,singleRoomsApproved:0,singleRoomsPending:0,quotaExemptSingleRooms:0}}],officials:10,otherPeople:0,coverageReviewRequired:false,ezDecisionsOpen:0}]};
 const session:any={id:'1',nation:'FIN',status:'PROFESSIONALLY_REVIEWED',errors:0,warnings:0,version:3,currentVersionId:'30',uploadedAt:'2026-11-15T12:00:00Z',uploadedBy:'Synthetic',currentVersion:null,versions:[],history:[],approvals:[],preview,nnPlanning:planning,importControl:{people:[],issues:[],competitions:[]}};
 const entry=(reported:number,extra:number)=>({nation:'FIN',reported,regularMax:4,status:extra?'REVIEW_REQUIRED':reported>4?'TITLE_COVERED':'NUMERIC_OK',reason:'Synthetic rule',aboveRegular:reported-4,championStarters:extra||reported<=4?0:1,unverifiedAdditional:extra,sharedPoolReported:null,sharedPoolUnverifiedAdditional:0,personKeys:people.slice(0,reported).map(p=>p.matchKey),champions:extra||reported<=4?[]:[{personKey:'p0',source:'Verified title'}],allocationConfirmed:false});
 const competitions=[{id:'ba',name:'Big Air Herren',group:row.discipline,gender:'M',sportEntries:[entry(8,4)]},{id:'ss',name:'Slopestyle Herren',group:row.discipline,gender:'M',sportEntries:[entry(8,4)]},{id:'hp',name:'Halfpipe Herren',group:row.discipline,gender:'M',sportEntries:[entry(5,0)]}];
 session.importControl={quotaGroups:[{name:row.discipline,family:'Freestyle'}],people:people.map((p,i)=>({personKey:p.matchKey,competitions:competitions.filter(c=>c.id==='ba'?i<8:c.id==='ss'?i>0:i<5).map(c=>({...c,family:'Freestyle'})),quotaContexts:[]})),competitions,issues:[]};
 const event={id:'1',name:'Provisional synthetic',active:true};
 const writes:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const project=(count:number)=>{
  Object.assign(row,{selectedCount:count,selectedWorldChampionCount:count===5?1:0});
  competitions[2].sportEntries=[entry(count===5?5:1,0)];
  row.replacedPersonIds=people.slice(count).map(p=>'preview:'+p.matchKey);
  const context={gender:'M',athletes:count,athletesEntered:9,expectedAthletes:count,officialQuota:count===4?6:7,registeredOfficials:10,officialsDeviation:count===4?4:3,singleRoomOfficialBasis:count===4?6:7,singleRoomsAllowed:count===4?2:3,singleRoomsRequested:3,singleRoomsPending:count===4?1:0,singleRoomsApproved:0,quotaExemptSingleRooms:0};
  planning.operationalQuota={conflict:false,reasons:[],people:Array.from({length:3},(_,i)=>({matchKey:'staff'+i,nationCode:'FIN',singleRoomAllocation:{identity:'staff'+i,status:i<context.singleRoomsAllowed?'COVERED':'PENDING',context:['FIN',row.discipline,'M']}})),rows:[context],overview:{...preview.quotaOverview,nations:[{...preview.quotaOverview.nations[0],groups:[{name:row.discipline,officials:10,athletes:9,contexts:[context],totals:context}]}]}};
 };project(4);
 let listRequests=0;
 const detailRequests:string[]=[];
 let rejectRequirement=true;
 let guidedRetry=false;
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.slice(4);
  if(req.method()==='GET' && path==='/import/sessions'){
   const params=new URL(req.url()).searchParams;
   assert.equal(params.get('view'),'queue');
   listRequests++;
   const summary={id:'1',nation:'FIN',status:session.status,version:1,currentVersionId:'30',
     uploadedAt:'2026-11-22T00:00:00Z',uploadedBy:'tester',errors:0,warnings:0,pendingDecisions:0,hasOpenSubmissions:false};
   return route.fulfill({json:[{...summary,matchesDecision:params.get('decisionId')==='42'},
     {...summary,id:'2',nation:'ITA',status:'ARCHIVED'}]});
  }
  if(req.method()==='GET' && /^\/import\/sessions\/\d+$/.test(path))detailRequests.push(path);
  if(path==='/import/approvals/42')return route.fulfill({json:{id:'42',nation:'FIN',decision:'APPROVED',
    importSession:{id:'1',nation:'FIN'},people:[],description:'Historical decision'}});
  if(path==='/import/sessions/2')return route.fulfill({json:{...session,id:'2',nation:'ITA',status:'ARCHIVED',preview:null}});
  if(req.method()!=='GET'&&path!=='/auth/me')writes.push(path);
  const bodies:Record<string,unknown>={'/auth/me':{username:'tester',groups:['incoming-admin'],permissions:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/import/sessions':[session],'/import/sessions/1':session,'/athletes':people};
  if(path==='/import/sessions/1/recheck' && req.method()==='POST'){
   preview.planStale=false;
   return route.fulfill({json:session});
  }
  if(/^\/import\/sessions\/1\/accommodation-requirements\/p[25]$/.test(path) && req.method()==='PATCH'){
   const payload=req.postDataJSON();
   const i=Number(path.at(-1));
   if(i===2 && rejectRequirement){
    rejectRequirement=false;
    return route.fulfill({status:409,json:{error:'STALE_PREVIEW',message:'Änderungsplan erneut prüfen.'}});
   }
   Object.assign(people[i], {accommodationRequirement:payload.accommodationRequirement || 'NO_ROOM',
     hasFisAccommodationDeviation:payload.accommodationRequirement==='NO_DISPO',
     fisAccommodationDeviationReasons:payload.accommodationRequirement==='NO_DISPO'?['No Dispo']:[]});
   return route.fulfill({json:session});
  }
  if(path==='/athletes/3' && req.method()==='GET') return route.fulfill({json:people[2]});
  if(path==='/athletes/3' && req.method()==='PATCH'){
   const payload=req.postDataJSON();
   assert.equal(payload.accommodationRequirement,'REQUIRED');
   if(payload.roomType==='Double shared' && !guidedRetry){
    guidedRetry=true;
    return route.fulfill({status:409,json:{message:'Speichern fehlgeschlagen – erneut versuchen.'}});
   }
   Object.assign(people[2], payload);
   return route.fulfill({json:people[2]});
  }
  if(path==='/athletes/4' && req.method()==='PATCH'){
   Object.assign(people[3], req.postDataJSON());
   return route.fulfill({json:people[3]});
  }
  await route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected request'}});
 });
 preview.rooms=[
  {rowNumber:2,sourceRowKey:'mixed',person1Key:'p0',person1Name:'Champion Synthetic',person2Key:'p4',person2Name:'Athlete4 Synthetic',roomType:'Double shared'},
  {rowNumber:3,sourceRowKey:'deferred',person1Key:'p5',person1Name:'Athlete5 Synthetic',person2Key:'p6',person2Name:'Athlete6 Synthetic',roomType:'Double shared'},
  {rowNumber:4,sourceRowKey:'single',person1Key:'p7',person1Name:'Athlete7 Synthetic',person2Key:null,roomType:'Single'},
  {rowNumber:5,sourceRowKey:'unknown',person1Key:'p8',person1Name:'Athlete8 Synthetic',person2Key:null,sharedWithRawName:'Unknown partner',roomType:'Double shared'},
 ];
 await page.goto(`${origin}/import?sessionId=1`);
 const openPeople=async()=>{await page.getByRole('button',{name:/^Personen/}).first().click();await page.getByRole('dialog',{name:'Personen der Importvorschau'}).waitFor();};
 await openPeople();let list=page.getByRole('dialog',{name:'Personen der Importvorschau'});
 assert.equal(await list.getByRole('button',{name:/^Importdetails/}).count(),9);
 assert.equal(await list.locator('tr[data-provisional-planning="deferred"]').count(),0);
 await page.keyboard.press('Escape');await page.getByRole('group',{name:'Gruppieren:'}).getByRole('button',{name:'Ein',exact:true}).click();await openPeople();
 assert.equal(await list.locator('tr[data-provisional-planning="deferred"]').count(),0);assert.match(await list.locator('th[scope="rowgroup"]').innerText(),/9 Personen/);
 const excluded=list.getByRole('button',{name:'Importdetails Athlete4 Synthetic',exact:true});assert.equal(await excluded.isEnabled(),true);
 await excluded.click();await page.getByRole('dialog',{name:'Athlete4 Synthetic',exact:true}).waitFor();assert.equal(await page.locator('[role="dialog"]').count(),2);await page.keyboard.press('Escape');
 await list.getByLabel('Person suchen').fill('Athlete4');assert.equal(await list.getByText('Außerhalb der Planungsempfehlung',{exact:true}).count(),1);
 await list.getByLabel('Person suchen').fill('');
 await page.screenshot({path:'/workspace/artifacts/preview-person-selection-dark.png',animations:'disabled'});
 await page.keyboard.press('Escape');
 const openRooms=async()=>{await page.getByRole('button',{name:/^Zimmerzuordnungen/}).click();await page.getByRole('dialog',{name:'Zimmer der Importvorschau'}).waitFor();};
 await openRooms();list=page.getByRole('dialog',{name:'Zimmer der Importvorschau'});
 assert.equal(await list.locator('tbody tr:has(td)').count(),4);
 assert.equal(await list.locator('tr[data-provisional-planning="deferred"]').count(),2);
 const mixed=list.getByRole('row').filter({hasText:'Champion Synthetic'});assert.equal(await mixed.getAttribute('data-provisional-planning'),null);assert.equal(await mixed.getByText('Außerhalb der Planungsempfehlung',{exact:true}).count(),1);
 const unknown=list.getByRole('row').filter({hasText:'Athlete8 Synthetic'});assert.equal(await unknown.getAttribute('data-provisional-planning'),null);assert.match(await unknown.innerText(),/Zimmerpartner ungeklärt/);
 await list.getByLabel('Anzeigen').selectOption('partner');assert.equal(await list.locator('tbody tr:has(td)').count(),1);assert.equal(await list.locator('tr[data-provisional-planning="deferred"]').count(),0);
 await list.getByLabel('Anzeigen').selectOption('all');
 await page.screenshot({path:'/workspace/artifacts/preview-room-selection-dark.png',animations:'disabled'});
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Helles Theme verwenden',exact:true}).click();await openRooms();
 await page.screenshot({path:'/workspace/artifacts/preview-room-selection-light.png',animations:'disabled'});await page.keyboard.press('Escape');
 const openAthletes=async()=>{await page.getByRole('button',{name:/^Athleten-\/Disziplinquote/}).click();await page.getByRole('dialog',{name:'Athleten-/Disziplinquote'}).waitFor();};
 await openAthletes();
 let dialog=page.getByRole('dialog');
 assert.equal(await dialog.getByText(/für Unterkunft eingeplant/).count(),0);
 const sportingLimit=dialog.getByRole('row',{name:/^Big Air/}).locator('td').first().locator('span[tabindex="0"]');
 await sportingLimit.hover();await page.getByRole('tooltip').waitFor();
 assert.match(await page.getByRole('tooltip').innerText(),/8 gemeldet, 4 regulär erlaubt. Sportliche Übermeldung prüfen/);
 await page.mouse.move(0,0);await page.getByRole('tooltip').waitFor({state:'hidden'});
 assert.equal(await dialog.getByRole('row',{name:/^Halfpipe/}).locator('td').first().locator('span[tabindex="0"]').count(),0);
 assert.equal(await dialog.getByRole('row',{name:/^Halfpipe/}).getByText(/vorläufig disponiert/).count(),0);
 assert.equal(await dialog.getByRole('spinbutton').count(),0);
 assert.equal(await dialog.getByRole('button',{name:/Unterkunftserwartung/}).count(),0);
 await page.screenshot({path:'/workspace/artifacts/preview-quota-excess-light.png',animations:'disabled'});
 await dialog.getByRole('button',{name:'Schließen',exact:true}).click();
 const officials=async(cap:string,rooms:string)=>{
  await page.getByRole('button',{name:/^Officials & EZ-Quote/}).click();
  const dlg=page.getByRole('dialog',{name:'Officials & EZ-Quote'});
  const context=dlg.getByRole('rowheader',{name:'Männer',exact:true}).locator('..');
  const summary=dlg.locator('span[aria-label$="· Quotenübersicht"]');
  assert.match(await summary.innerText(),new RegExp(`Officials: M \\+${cap==='6'?4:3}`));
  assert.match(await summary.innerText(),rooms==='2'?/EZ: \+1 offen/:/EZ: 0/);
  assert.ok(!(await summary.innerText()).includes('Athleten'));
  const cells=await context.locator('td').allTextContents();
  assert.deepEqual(cells,[cap==='6'?'4':'5',cap,'10',cap==='6'?'+4':'+3',rooms,'3',rooms==='2'?'+1':'0']);
  assert.equal(await dlg.getByRole('columnheader',{name:'Erlaubt',exact:true}).count(),2);
  assert.equal(await dlg.getByRole('columnheader',{name:'Abweichung',exact:true}).count(),2);
  assert.equal(await dlg.getByText('Σ M/W',{exact:true}).count(),0);
  await page.screenshot({path:`/workspace/artifacts/operative-official-ez-${cap}-light.png`,animations:'disabled'});
  await dlg.locator('summary').filter({hasText:'Deckung und Genehmigungen'}).click();
  assert.match(await dlg.innerText(),new RegExp(`${cap==='6'?4:5} für Unterkunft eingeplant`));
  assert.equal(await dlg.getByRole('spinbutton').count(),0);
  await dlg.getByRole('button',{name:'Schließen',exact:true}).click();
 };
 await officials('6','2');
 // A new confirmed server projection supplies the additional verified champion.
 project(5);await page.reload();await openAthletes();dialog=page.getByRole('dialog');
 assert.equal(await dialog.getByText(/für Unterkunft eingeplant/).count(),0);
 await page.screenshot({path:'/workspace/artifacts/provisional-athletes-champion.png',animations:'disabled'});
 await dialog.getByRole('button',{name:'Schließen',exact:true}).click();await officials('7','3');
 assert.deepEqual(writes,[]);
 await openPeople();
 list=page.getByRole('dialog',{name:'Personen der Importvorschau'});
 const beforeSaveListRequests=listRequests;
 const toggle = list.getByRole('checkbox',{name:'Nicht disponieren · Unterkunftsbedarf Athlete2 Synthetic'});
 await toggle.click();
 await list.getByRole('alert').filter({hasText:'Änderungsplan erneut prüfen.'}).waitFor();
 assert.equal(await toggle.isChecked(),false);
 await toggle.click();
 const skipped=list.getByRole('row').filter({hasText:'Athlete2 Synthetic'});
 await skipped.getByRole('img',{name:/Abweichung zur FIS-Meldung.*No Dispo/}).waitFor();
 assert.equal(await skipped.getAttribute('data-provisional-planning'),'deferred');
 assert.equal(await skipped.locator('.MuiSelect-nativeInput').evaluateAll(inputs =>
   inputs.length === 2 && inputs.every(input => getComputedStyle(input).display === 'none')), true);
 await page.screenshot({path:'/workspace/artifacts/import-no-dispo-fis-abweichung.png',animations:'disabled'});
 await list.getByRole('button',{name:'Importdetails Athlete5 Synthetic'}).click();
 const importDetail=page.getByRole('dialog',{name:'Athlete5 Synthetic'});
 await importDetail.getByRole('checkbox',{name:/Nicht disponieren/}).click();
 await importDetail.getByText(/Abweichung zur FIS-Meldung/).waitFor();
 await importDetail.getByRole('checkbox',{name:/Nicht disponieren/}).click();
 await importDetail.getByText(/Abweichung zur FIS-Meldung/).waitFor({state:'detached'});
 assert.equal(people[5].accommodationRequirement,'REQUIRED');
 assert.equal(await importDetail.getByRole('checkbox',{name:/Nicht disponieren/}).isChecked(),false);
 await importDetail.getByRole('button',{name:'Schließen',exact:true}).click();
 assert.equal(await list.getByRole('button',{name:/^Importdetails/}).count(),9);
 assert.equal(listRequests,beforeSaveListRequests);
 assert.deepEqual(writes,[...Array(2).fill('/import/sessions/1/accommodation-requirements/p2'),...Array(2).fill('/import/sessions/1/accommodation-requirements/p5')]);
 await page.keyboard.press('Escape');
 preview.planStale=true;
 await page.reload();
 await page.getByRole('button',{name:'Prüfung fortsetzen',exact:true}).click();
 await openPeople();
 assert.equal(await toggle.isChecked(),true);
 const released=list.getByRole('row').filter({hasText:'Athlete5 Synthetic'});
 assert.equal(await released.getAttribute('data-provisional-planning'),null);
 assert.equal(await released.getByRole('checkbox').isChecked(),false);
 assert.match(await released.innerText(),/Unterkunft benötigt/);
 await page.goto(`${origin}/athletes`);
 const personRow=page.getByRole('row').filter({hasText:'Athlete2 Synthetic'});
 await personRow.getByText('Nicht einplanen',{exact:true}).first().waitFor();
 assert.match((await personRow.getAttribute('class'))??'',/ops-surface-overlay/);
 await personRow.click();
 const personDialog=page.getByRole('dialog');
 await personDialog.getByRole('checkbox',{name:'Nicht disponieren (No Dispo)'}).uncheck();
 assert.match(await personDialog.locator('#athlete-accommodation-requirement').innerText(),/Unterkunft benötigt/);
 await personDialog.getByRole('button',{name:'Speichern',exact:true}).click();
 await personRow.getByText('Nicht zugewiesen',{exact:true}).waitFor();
 assert.doesNotMatch((await personRow.getAttribute('class'))??'',/ops-surface-overlay/);
 assert.deepEqual(writes,[...Array(2).fill('/import/sessions/1/accommodation-requirements/p2'),...Array(2).fill('/import/sessions/1/accommodation-requirements/p5'),'/import/sessions/1/recheck','/athletes/3']);
 detailRequests.length=0;
 await page.goto(`${origin}/import`);
 await page.getByText('Geschlossene Importsessions (1)',{exact:true}).waitFor();
 assert.deepEqual(detailRequests,[]);
 await page.getByText('Geschlossene Importsessions (1)',{exact:true}).click();
 await page.getByRole('button',{name:/^ITA /}).click();
 await page.getByText('Importsession geschlossen',{exact:true}).waitFor();
 assert.deepEqual(detailRequests,['/import/sessions/2']);

 detailRequests.length=0;
 await page.goto(`${origin}/import?decisionId=42`);
 await page.getByText('Historical decision',{exact:true}).waitFor();
 await page.getByText(/FIN –/).waitFor({state:'attached'});
 assert.deepEqual(detailRequests,['/import/sessions/1']);
 Object.assign(people[2], {
  accommodationRequirement:'UNRESOLVED',
  reportedAccommodationRequests:[{family:'Freestyle',version:1,entryRow:17,roomType:'Double shared',
    partner:'Beispiel Partner',arrivalDate:'2027-03-13',departureDate:'2027-03-22',roomRows:[12]},
  {family:'Snowboard',version:2,entryRow:39,roomType:'No room',roomRows:[]}],
 });
 people[3].accommodationRequirement='UNRESOLVED';
 await page.goto(`${origin}/athletes`);
 await personRow.getByText('Unterkunftsbedarf offen',{exact:true}).first().waitFor();
 await personRow.click();
 await personDialog.getByText(/Double shared · Beispiel Partner/).waitFor();
 await personDialog.getByText('Snowboard',{exact:true}).waitFor();
 await personDialog.getByText(/Room List Zeile 12/).waitFor();
 await page.screenshot({path:'/workspace/artifacts/unterkunft-entscheidung-desktop.png',animations:'disabled'});
 await page.setViewportSize({width:780,height:740});
 await page.screenshot({path:'/workspace/artifacts/unterkunft-entscheidung-kompakt.png',animations:'disabled'});
 const noDispo = personDialog.getByRole('checkbox',{name:'Nicht disponieren (No Dispo)'});
 assert.equal(await noDispo.isChecked(),false);
 assert.equal(await noDispo.isDisabled(),true);
 await personDialog.getByRole('button',{name:'Zimmerwunsch übernehmen'}).first().click();
 assert.equal(await personDialog.getByRole('textbox',{name:'Gewünschter Zimmerpartner'}).inputValue(),'Beispiel Partner');
 await personDialog.getByRole('button',{name:'Speichern & weiter'}).click();
 await personDialog.getByText('Speichern fehlgeschlagen – erneut versuchen.').waitFor();
 assert.equal(await personDialog.getByRole('textbox',{name:'Gewünschter Zimmerpartner'}).inputValue(),'Beispiel Partner');
 await personDialog.getByRole('button',{name:'Speichern & weiter'}).click();
 await personDialog.getByText(/Athlete3 Synthetic/).waitFor();
 await personDialog.locator('#athlete-accommodation-requirement').click();
 await page.getByRole('option',{name:'Kein Zimmer benötigt',exact:true}).click();
 await personDialog.getByRole('button',{name:'Speichern & weiter'}).click();
 await page.getByRole('status').filter({hasText:'alle Unterkunftsklärungen abgeschlossen'}).waitFor();
 Object.assign(people[2], {accommodationRequirement:'NO_DISPO', accommodationDecisionLabel:'Nicht disponieren',
   hasFisAccommodationDeviation:true, assignment:{hasAssignment:true}});
 Object.assign(people[3], {accommodationDecisionLabel:'Abweichung FIS', hasFisAccommodationDeviation:true, nationCode:'ITA'});
 Object.assign(people[4], {accommodationRequirement:'NO_DISPO', accommodationDecisionLabel:'Nicht disponieren',
   hasFisAccommodationDeviation:false});
 await page.goto(`${origin}/athletes?nation=FIN&status=fis-deviation`);
 await page.getByRole('button',{name:'Abweichung FIS 1',exact:true}).waitFor();
 assert.equal(await page.locator('tbody tr').count(),1);
 await personRow.getByText('Nicht disponieren',{exact:true}).waitFor();
 await personRow.getByText('Bestehende Buchung bleibt erhalten.',{exact:true}).waitFor();
 await personRow.click();
 await personDialog.getByText('Bestehende Buchung bleibt erhalten.',{exact:true}).waitFor();

 assert.deepEqual(errors,[]);
});

test('event housing editor uses one dynamic field per group and the existing revision workflow',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-housing-browser-`),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const competitions=['M','W','M'].map((gender,i)=>({id:String(i+1),name:'Synthetic '+i,displayName:'Synthetic '+i,gender,sport:'Freeski',quotaDiscipline:i<2?'Freeski Park & Pipe':'Ski Cross',active:true,teamCompetition:false}));
 const event={id:'1',name:'Housing test',year:2027,active:true,competitionMappings:[]};
 const config={schemaVersion:1,athletes:{Snowboard:{enabled:true,totalLimit:38,genderLimit:19},Freestyle:{enabled:true,totalLimit:42,genderLimit:21}},officials:{model:'ATHLETES_PLUS',allowance:2},singleRooms:[{upTo:3,rooms:1},{upTo:6,rooms:2},{upTo:null,rooms:3}],sportEntryRules:{schemaVersion:1,enabled:true,titleEdition:{championship:'Historical edition',year:2025},competitions:[{competitionId:'1',enabled:true,regularLimit:4,titleReferences:[],poolId:'shared'},{competitionId:'2',enabled:true,regularLimit:4,titleReferences:[],poolId:'shared'}],pools:[{id:'shared',regularLimit:4}]}};
 const record:any={status:'FIXED',revision:1,digest:'original',isWorldChampionship:true,config,sportRuleOptions:{competitions,titles:[]}};
 const writes:any[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.slice(4);
  if(req.method()==='POST'&&path.endsWith('/revision-preview')){
   const data=req.postDataJSON();writes.push({path,data});return route.fulfill({json:{before:{config,isWorldChampionship:true},after:{config:data.config,isWorldChampionship:true},reason:data.reason,confirmationDigest:'checked'}});
  }
  if(req.method()==='POST'&&path.endsWith('/revisions')){
   const data=req.postDataJSON();writes.push({path,data});assert.equal(data.confirm,true);assert.equal(data.confirmationDigest,'checked');
   Object.assign(record,{config:data.config,revision:2,digest:'new'});return route.fulfill({json:record});
  }
  if(req.method()==='PUT'&&path==='/admin/events/1/quota-rules'){
   const data=req.postDataJSON();writes.push({path,data});Object.assign(record,{config:data.config,digest:'draft-saved'});return route.fulfill({json:record});
  }
  if(req.method()!=='GET'&&path!=='/auth/me')throw Error('Unexpected mutation '+path);
  const bodies:Record<string,unknown>={'/auth/me':{username:'tester',groups:['incoming-admin'],permissions:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/admin/events':[event],'/admin/events/1':event,'/competitions':competitions,'/admin/events/1/quota-rules':record,'/admin/events/1/quota-rules/revisions':[]};
  return route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected synthetic request'}});
 });
 await page.goto(`${origin}/administration`);await page.getByRole('tab',{name:'Quotenregeln',exact:true}).click();
 const fields=page.getByRole('spinbutton',{name:/^Unterkunftskontingent/});await fields.first().waitFor();
 assert.equal(await fields.count(),2);assert.equal(await fields.first().inputValue(),'4');assert.equal(await fields.first().isDisabled(),true);
 assert.deepEqual(writes,[]);assert.equal('athleteHousing' in config,false);
 for(const label of ['Athleten-/Disziplinquoten','Gesamtlimit','Limit je Geschlecht','Sportliche Startplätze','Sportregeln für dieses Event aktivieren','Titelgrundlage'])assert.equal(await page.getByText(label,{exact:true}).count(),0);
 assert.equal(await page.getByRole('spinbutton',{name:/Officials-Basis/}).count(),1);
 assert.equal(await page.getByRole('spinbutton',{name:'EZ-Anspruch',exact:true}).count(),3);
 await page.getByRole('button',{name:'Neue Revision erstellen',exact:true}).click();
 await page.getByRole('spinbutton',{name:'Unterkunftskontingent Freeski Park & Pipe',exact:true}).fill('3');
 await page.getByRole('spinbutton',{name:'Unterkunftskontingent Ski Cross',exact:true}).fill('0');
 assert.deepEqual(writes,[]);
 await page.getByRole('textbox',{name:'Änderungsbegründung'}).fill('Unterkunft bewusst reduzieren');
 await page.getByRole('button',{name:'Vorher / Nachher prüfen',exact:true}).click();
 await page.getByText('Freeski Park & Pipe: 3 je Gender',{exact:true}).waitFor();
 assert.equal(await page.getByText('Freeski Park & Pipe: 4 je Gender',{exact:true}).count(),1);
 assert.deepEqual(writes[0].data.config.athleteHousing.regularPerGenderByEventGroup,{'Freeski Park & Pipe':3,'Ski Cross':0});
 assert.deepEqual(writes[0].data.config.sportEntryRules,config.sportEntryRules);
 assert.deepEqual(writes[0].data.config.athletes,config.athletes);assert.equal(writes[0].data.expectedRevision,1);
 assert.match(await page.locator('body').innerText(),/aufgrund der neuen Regelrevision können sie eine erneute Entscheidung erfordern/);
 await page.getByRole('button',{name:'Neue Revision ausdrücklich aktivieren',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Verbindlich festlegen',exact:true}).click();
 await page.getByText('Fixiert · Revision 2',{exact:true}).waitFor();assert.equal(writes.length,2);
 assert.equal(await fields.first().inputValue(),'3');assert.equal(await fields.first().isDisabled(),true);
 await page.screenshot({path:'/workspace/artifacts/housing-event-rules.png',animations:'disabled'});
 // An empty draft uses the server proposal explicitly; existing configs have no reset button.
 assert.equal(await page.getByRole('button',{name:'Regelentwurf anlegen',exact:true}).count(),0);
 const {sportEntryRules,...standardProposal}=config;void sportEntryRules;
 Object.assign(record,{status:'DRAFT',config:null,standardProposal});
 await page.reload();await page.getByRole('tab',{name:'Quotenregeln',exact:true}).click();
 await page.getByRole('button',{name:'Regelentwurf anlegen',exact:true}).click();
 assert.equal(writes.length,2);
 const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/quota-rules'));
 await page.getByRole('button',{name:'Entwurf validieren und speichern',exact:true}).click();await saved;
 assert.deepEqual(writes[2].data.config,standardProposal);
 assert.equal('sportEntryRules' in writes[2].data.config,false);
 assert.deepEqual(errors,[]);
});

test('analytics switches between event, saved Excel drafts, imported people and booked live data', async t => {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',
   cacheDir:await mkdtemp(`${tmpdir()}/incoming-excel-analytics-`),
   define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},
   server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 const event={id:'1',name:'Synthetic analytics',active:true};
 const stay={arrivalDate:'2027-03-02',departureDate:'2027-03-04',accommodationRequirement:'REQUIRED'};
 const roomType={id:'dz',name:'DZ',maxPersons:2};
 const extraNations=Array.from({length:13},(_,index)=>({
   nation:'X'+String(index).padStart(2,'0'), people:[{...stay,matchKey:'single',roomType:'Double'}],
   rooms:[],excludedIds:[],provisional:false,importStatus:'DRAFT',
 }));
 const people=[{...stay,id:'1',firstname:'One',lastname:'Person',nationCode:'POL',roomType:'Double'}];
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice(4);
  const bodies:Record<string,unknown>={
   '/auth/me':{username:'tester',groups:['incoming-admin'],permissions:['*']},
   '/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},
   '/hotels':[{id:'h',name:'Test',roomInventories:[{id:'i',roomType:{id:'dz',name:'DZ',maxPersons:2},roomCount:4,availableFrom:'2027-03-02',availableUntil:'2027-03-03'}]}],
   '/events':[{id:'plan',discipline:'Cross',startDate:'2027-03-02',endDate:'2027-03-03',personDemand:6}],
   '/athletes':people,'/room-bookings/grouped':[
     {id:'A',hotel:{id:'h',name:'Test'},roomType,checkInDate:stay.arrivalDate,checkOutDate:stay.departureDate,occupants:[{athlete:people[0]}]},
     {id:'B',hotel:{id:'h',name:'Test'},roomType,checkInDate:stay.arrivalDate,checkOutDate:stay.departureDate,occupants:[{athlete:{id:'b',nationCode:'CZE'}}]},
   ],
   '/athletes/arrival-planning':{rows:[]},
   '/analytics/import-demand':[{nation:'POL',people:[{...stay,matchKey:'x',roomType:'Single'},{...stay,matchKey:'p',existingAthleteId:1,roomType:'Double'},{...stay,matchKey:'unknown'}],rooms:[],excludedIds:[],provisional:false},{nation:'SUI',people:[],rooms:[],excludedIds:[],roomStatus:'zero',provisional:false},...extraNations,
    {nation:'ERR',people:[],rooms:[],excludedIds:[],roomStatus:'conflict',provisional:true,importStatus:'ERROR'},
    {nation:'NEW',people:[],rooms:[],excludedIds:[],roomStatus:'missing',provisional:true,importStatus:'NO_PREVIEW'}],
  };
  await route.fulfill({status:path in bodies?200:404,json:bodies[path]??{}});
 });
 await page.goto(`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}/analytics?source=event`);
 const daily=page.getByRole('table',{name:'Tageswerte'});
 await daily.getByRole('row',{name:/EZ-Bedarf \(Event\)/}).waitFor();
 await page.getByRole('button',{name:'Excel',exact:true}).click();
 await daily.getByRole('row',{name:/Reserve EZ/}).waitFor();
 assert.match(await daily.getByRole('row',{name:/Reserve EZ/}).innerText(),/-1/);
 assert.match(await daily.getByRole('row',{name:/Reserve zum bekannten Bedarf/}).innerText(),/-11/);
 assert.equal(await daily.getByRole('row',{name:'Bekannter Zimmerbedarf'}).locator('td').first().innerText(),'15');
 assert.equal(await daily.getByRole('row',{name:'DZ-Kontingent'}).locator('td').first().innerText(),'4');
 await page.getByText('Bekannter Zimmerpeak',{exact:true}).waitFor();
 await page.getByText(/Personen pro Nacht ohne eindeutige Zimmerart/).waitFor();
 await page.getByText(/Vorläufige Excel-Prognose/).waitFor();
 await page.getByRole('button',{name:'Import',exact:true}).click();
 await daily.getByRole('row',{name:/DZ-Bedarf \(Import\)/}).waitFor();
 assert.equal(await daily.getByRole('row',{name:/DZ-Bedarf \(Import\)/}).locator('td').first().innerText(),'1');
 await page.getByRole('button',{name:'Live',exact:true}).click();
 assert.equal(await daily.getByRole('row',{name:/DZ-Bedarf \(Live\)/}).locator('td').first().innerText(),'2');
 await page.getByRole('tab',{name:/Hotelrisiken/}).click();
 await page.getByText('Risiko über den Zeitraum',{exact:true}).waitFor();
 await page.getByRole('tab',{name:/Nationen & Bedarf/}).click();
 await page.getByRole('heading',{name:'Nationen & Bedarfsstruktur',exact:true}).waitFor();
 const sources = page.getByRole('group',{name:'Bedarfsquelle'});
 assert.deepEqual(await sources.getByRole('button').allTextContents(),['Excel','Import','Live']);
 await sources.getByRole('button',{name:'Excel'}).click();
 const all=page.getByRole('table',{name:'Vollständige Nationenübersicht'});
 await page.getByText('Excel · 17 Nationen',{exact:true}).waitFor();
 assert.equal(await all.locator('tbody tr').count(),17);
 assert.equal(await page.getByRole('button',{name:/(POL|X[0-9]{2}).*Bettennächte/}).count(),12);
 await all.getByRole('row',{name:/SUI.*0 Zimmer gemeldet/}).waitFor();
 await all.getByRole('row',{name:/ERR.*Fehlerhaft/}).waitFor();
 assert.equal(await all.getByRole('row',{name:/NEW.*Keine Vorschau/}).locator('td').nth(1).innerText(),'—');
 await all.getByRole('row',{name:/X12.*Noch nicht bestätigt/}).waitFor();
 await page.getByText('6 Bettennächte',{exact:true}).waitFor();
 await sources.getByRole('button',{name:'Import'}).click();
 await page.getByText('2 Bettennächte',{exact:true}).waitFor();
 assert.equal(await all.locator('tbody tr').count(),1);
 assert.equal(await page.getByText('0 Zimmer gemeldet',{exact:true}).count(),0);
 await sources.getByRole('button',{name:'Live'}).click();
 await page.getByRole('button',{name:/CZE.*2 Bettennächte/}).waitFor();

});
