import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';
import {chromium} from 'playwright';
import {createServer} from 'vite';

test('person overview drills into assigned people, refreshes after persistence, and rejects stale or failed evaluations',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-status-`),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const interval={checkInDate:'2027-03-11',checkOutDate:'2027-03-23'};
 let single=true,fail=false,delayFamily=false,readOnly=false,singleWish=false;
 let releaseFamily:()=>void=()=>{};
 let familyGate=Promise.resolve();
 let mutationGate=Promise.resolve();let releaseMutation:()=>void=()=>{};
 const seed=[['full','Vollständig','FULLY_ASSIGNED','MATCH','NO_SINGLE_USE','Snowboard'],['partial','Teilweise','PARTIALLY_ASSIGNED','UNKNOWN','NO_SINGLE_USE','Freestyle'],['open','Offen','UNASSIGNED','UNASSIGNED','NO_SINGLE_USE','Snowboard'],['conflict','Konflikt','CONFLICT','UNKNOWN','NO_SINGLE_USE','Snowboard'],['mismatch','Wunschabweichung','FULLY_ASSIGNED','MISMATCH','APPROVED_EXTRA','Freestyle'],['orphan','Kontextlos','FULLY_ASSIGNED','MATCH','PENDING','Snowboard']];
 const people=()=>seed.map(([id,name,coverage,wish,ez,family])=>{
  const segments=coverage==='UNASSIGNED'?[]:[{...interval,bookingId:`booking-${id}`,hotelId:'h',hotelName:'Synthetic Hotel',roomTypeId:'r',roomTypeName:'DZ',roomNumber:id,countsAsSingle:id==='orphan'?single:false,conflictCodes:coverage==='CONFLICT'?['BOOKING_OVERLAP']:[],capacity:2,occupantCount:1,physicalUsage:'SOLE_DOUBLE',comparison:wish}];
  if(id==='full')segments.splice(0,1,{...segments[0],checkOutDate:'2027-03-16'},{...segments[0],bookingId:'booking-full-2',checkInDate:'2027-03-16'});
  const ac={overallInterval:interval,coverageStatus:coverage,segments,coveredIntervals:coverage==='UNASSIGNED'?[]:[interval],openIntervals:['UNASSIGNED','PARTIALLY_ASSIGNED'].includes(coverage)?[interval]:[],conflicts:coverage==='CONFLICT'?[{code:'BOOKING_OVERLAP',bookingIds:[`booking-${id}`]}]:[]};
  return {personId:id,eventId:'1',name,nationCode:id==='full'?'EST':'AUT',personalGender:id==='orphan'?'W':'M',personType:id==='open'?'ATHLETE':'OFFICIAL',function:id==='open'?'Athlete':'Official',accommodationRequirement:'REQUIRED',sportFamilies:[family],quotaDisciplines:[family==='Snowboard'?'Snowboard Cross':'Ski Cross'],quotaContexts:[],matchesContextFilters:true,accommodation:ac,roomPreference:{reportedValue:'Double shared',reportedKind:'DOUBLE',status:wish,hasMismatch:wish==='MISMATCH',segments},singleRoom:{hasSingleUse:id==='orphan'?single:ez==='APPROVED_EXTRA',status:id==='orphan'&&!single?'NO_SINGLE_USE':ez,context:null,eligibleContexts:[],bookingIds:segments.filter(s=>s.countsAsSingle).map(s=>s.bookingId),storedApprovalId:id==='mismatch'?'99':null,applicableApprovalId:id==='mismatch'?'99':null,approvalApplicable:id==='mismatch',approvedContexts:[],exemptionReason:null,reason:id==='orphan'&&single?'Kein gültiger Quotenkontext zuordenbar':null}};
 });
 const overview=(query:URLSearchParams)=>{
  const records=people().filter(p=>(!query.get('nationCode')||query.get('nationCode')===p.nationCode)&&(!query.get('personType')||query.get('personType')===p.personType)).filter(p=>{p.matchesContextFilters=(!query.get('sportFamily')||p.sportFamilies.includes(query.get('sportFamily')!))&&(!query.get('discipline')||p.quotaDisciplines.includes(query.get('discipline')!));return p.matchesContextFilters||p.singleRoom.status==='PENDING';});
  const count=(key:string)=>records.filter(p=>p.accommodation.coverageStatus===key).length;
  return {rows:[],unallocatedSingleRooms:[],personStatuses:records,personSummary:{peopleTotal:records.length,accommodationPeopleRequired:records.length,fullyAssigned:count('FULLY_ASSIGNED'),unassigned:count('UNASSIGNED'),partiallyAssigned:count('PARTIALLY_ASSIGNED'),accommodationConflicts:count('CONFLICT'),roomPreferenceMismatches:records.filter(p=>p.roomPreference.hasMismatch).length,pendingSingleRoomPeople:records.filter(p=>p.singleRoom.status==='PENDING').length,contextlessPendingSingleRoomPeople:records.filter(p=>p.singleRoom.status==='PENDING').length},personFilters:{nationCode:query.get('nationCode'),discipline:query.get('discipline'),gender:query.get('gender'),sportFamily:query.get('sportFamily'),personType:query.get('personType'),personalGender:null,contextlessPendingIncluded:true}};
 };
 const planning=()=>{
  const occupants=people().map(p=>({athleteId:p.personId,name:p.name,firstname:p.name,lastname:'Synthetic',nationCode:p.nationCode,function:p.function,gender:p.personalGender,quotaDisciplines:p.quotaDisciplines,roomType:p.personId==='open'&&singleWish?'Single':'Double shared',accommodationRequirement:'REQUIRED',accommodationRateCategory:'STANDARD',accommodationRateSource:'DEFAULT',arrivalDate:interval.checkInDate,departureDate:interval.checkOutDate,accommodationCoverage:p.accommodation,hasPendingReview:false,importChangeTypes:[],importChangeDetails:[],single_room_status:'NONE',single_room_decision_id:p.singleRoom.storedApprovalId}));
  const units=occupants.map(p=>({unitId:`unit-${p.athleteId}`,sourceRowKey:p.athleteId,nationCode:p.nationCode,occupants:[p],roomType:'Double shared',roomTypeLabel:'double',roomCategoryLabel:'dz',occupantCount:1,...interval,specialMealFlags:[],statusBadges:[],assignmentWarnings:[],isFullyAssigned:p.accommodationCoverage.coverageStatus==='FULLY_ASSIGNED'}));
  const slots=people().flatMap(p=>p.accommodation.segments.map((s,index)=>({slotId:`h:r:${s.bookingId}`,slotIndex:index+1,hotelId:'h',hotelName:'Synthetic Hotel',roomTypeId:'r',roomTypeName:'DZ',capacity:2,roomNumber:s.roomNumber,inventoryRoomCount:6,dateCoverage:{availableFrom:interval.checkInDate,availableUntil:interval.checkOutDate,coversRequestedRange:true},bookings:[{bookingId:s.bookingId,hotelId:'h',roomTypeId:'r',roomNumber:s.roomNumber,capacity:2,checkInDate:s.checkInDate,checkOutDate:s.checkOutDate,countsAsSingle:s.countsAsSingle,occupants:[occupants.find(o=>o.athleteId===p.personId)]}]})));
  return {timeline:{startDate:interval.checkInDate,endDate:interval.checkOutDate},units:{unassigned:units.filter(u=>!u.isFullyAssigned),assigned:units.filter(u=>u.isFullyAssigned)},hotels:[{hotelId:'h',hotelName:'Synthetic Hotel',slots:[...slots,{slotId:'h:r:free',slotIndex:9,hotelId:'h',hotelName:'Synthetic Hotel',roomTypeId:'r',roomTypeName:'DZ',capacity:2,roomNumber:'Zimmer 09',inventoryRoomCount:9,dateCoverage:{availableFrom:interval.checkInDate,availableUntil:interval.checkOutDate,coversRequestedRange:true},bookings:[]}]}],validationByUnit:{}};
 };
 const event={id:'1',name:'Synthetic status event',active:true,planningPeriods:[]};
 const errors:string[]=[],writes:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);requests.push(`${req.method()} ${path}`);
  if(path==='/fis/official-quotas'){
   assert.equal(url.searchParams.get('includePeople'),'true');
   const payload=overview(url.searchParams);
   if(delayFamily&&url.searchParams.get('sportFamily')==='Freestyle')await familyGate;
   return route.fulfill({status:fail?503:200,json:fail?{message:'Synthetic unavailable'}:payload});
  }
  if(req.method()==='PUT'&&path==='/assignments/bookings/booking-orphan'){writes.push(path);await mutationGate;single=JSON.parse(req.postData()!).countsAsSingle;return route.fulfill({json:{success:true}});}
  if(path==='/import/approvals/99')return route.fulfill({json:{importSession:{id:'s1'}}});
  if(path==='/import/sessions')return route.fulfill({json:[]});
  if(path==='/assignments/availability'){
   const needs=JSON.parse(req.postData()!).needs as Array<{key:string;athleteIds:string[]}>;
   const targets=Object.fromEntries(needs.flatMap(need=>[need.key,...need.athleteIds.map(id=>`${need.key}:athlete:${id}`)].map(key=>[key,need.athleteIds.includes('open')?[{slotId:'booking:booking-mismatch',status:'valid',messages:[]},{slotId:'h:r:free',status:'valid',messages:[]}]:[]])));
   return route.fulfill({json:{targets,hotels:{}}});
  }
  if(req.method()==='POST'&&path==='/assignments/segments')return route.fulfill({status:409,json:{message:'Synthetic stale target; no booking changed.'}});
  if(path.startsWith('/assignments/planning-view/validations/'))return route.fulfill({json:{validations:[]}});
  const bodies:Record<string,unknown>={'/auth/me':{username:'local-admin',displayName:'local-admin',groups:[readOnly?'incoming-viewer':'incoming-admin'],permissions:readOnly?['data.read']:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/assignments/planning-view':planning(),'/athletes':people().map(p=>({id:p.personId,firstname:p.name,lastname:'Synthetic',nationCode:'AUT',function:p.function,gender:'M',competitions:[]}))};
  return route.fulfill({status:path in bodies?200:404,json:bodies[path]??{message:'Unexpected synthetic request'}});
 });
 await page.goto(`${origin}/assignments`);
 const summary=page.locator('section[aria-label="Personen Soll/Ist"]');
 await summary.getByRole('button',{name:'Vollständig 3 / 6',exact:true}).waitFor();
 // Status and nation filters browse the same people without creating demands.
 const statusFilters=page.getByText('Status',{exact:true}).locator('..');
 await statusFilters.getByRole('button',{name:'Zugewiesen',exact:true}).click();
 let cards=page.locator('[role="group"][aria-label*=" · "]');
 await page.getByText('3 Einträge · 0 Planungsklärungen',{exact:true}).waitFor();
 assert.equal(await cards.count(),3);
 assert.ok((await cards.all()).length>0);
 for(const card of await cards.all())assert.equal(await card.getAttribute('draggable'),'false');
 const nation=page.locator('select').filter({has:page.locator('option',{hasText:'Alle Nationen'})}).first();
 await nation.selectOption('AUT');
 assert.equal(await cards.count(),2);
 await statusFilters.getByRole('button',{name:'Alle',exact:true}).click();
 await page.getByText('5 Einträge · 0 Planungsklärungen',{exact:true}).waitFor();
 assert.equal(await cards.count(),5);
 await statusFilters.getByRole('button',{name:'Offen',exact:true}).click();
 await page.getByText('3 namentliche Aufgaben · 0 Planungsklärungen',{exact:true}).waitFor();
 assert.equal(await cards.count(),3);
 await nation.selectOption('');
 // A valid join is a hotel target even when there is no free-room target.
 await page.getByText('Synthetic Hotel',{exact:true}).first().click();
 const openCard=page.getByRole('group',{name:/^Offen ·/});
 const join=openCard.getByRole('button',{name:'Person hier zuweisen',exact:true});
 await join.waitFor();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Person hier zuweisen'&&!b.disabled));
 assert.equal(await join.isEnabled(),true);
 const joinRequest=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname==='/api/assignments/segments');
 await join.click();
 const joinPayload=(await joinRequest).postDataJSON();
 assert.equal(joinPayload.joinBookingId,'booking-mismatch');
 assert.deepEqual(joinPayload.athleteIds,['open']);
 assert.equal(joinPayload.checkInDate,interval.checkInDate);
 // An explicit shared-room drop also permits a reported EZ wish.
 singleWish=true;await page.reload();
 await summary.getByRole('button',{name:'Vollständig 3 / 6',exact:true}).waitFor();
 await page.getByText('Synthetic Hotel',{exact:true}).first().click();
 await openCard.getByText('EZ',{exact:true}).waitFor();
 // Dropping on the existing booking uses the same explicit join path.
 const existingRoom=page.locator('button').filter({has:page.locator('.ops-occupant-card').filter({hasText:'Wunschabweichung'})});
 const dropRequest=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname==='/api/assignments/segments');
 await openCard.dragTo(existingRoom);
 assert.deepEqual((await dropRequest).postDataJSON(),joinPayload);

 for(const [label,count] of [['Vollständig 3 / 6',3],['Nicht zugewiesen 1',1],['Teilweise 1',1],['Konflikte 1',1],['Wunschabweichungen 1',1],['EZ ungeklärt 1',1]] as const){
  await summary.getByRole('button',{name:label,exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await dialog.getByRole('list',{name:'Betroffene Personen'}).locator('li').count(),count);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 }
 await summary.getByRole('button',{name:'EZ ungeklärt 1',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Kontextlos · AUT',exact:true}).click();
 assert.match(await page.getByRole('dialog').innerText(),/Kein gültiger Quotenkontext zuordenbar/);
 assert.match(await page.getByRole('dialog').innerText(),/Vollständig untergebracht/);
 await page.getByRole('dialog').getByRole('button',{name:/Buchung booking-orphan/}).click();
 const bookingDialog=page.getByRole('dialog');await bookingDialog.getByLabel('Als EZ werten',{exact:true}).waitFor();
 assert.equal(await bookingDialog.getByRole('button',{name:'EZ-Entscheidung bearbeiten',exact:true}).isEnabled(),true);
 await bookingDialog.getByRole('button',{name:'EZ-Entscheidung bearbeiten',exact:true}).click();
 await bookingDialog.getByRole('alert').filter({hasText:'Keine aktuelle Importsession'}).waitFor();
 assert.deepEqual(writes,[]);
 mutationGate=new Promise<void>(resolve=>{releaseMutation=resolve;});
 const beforeSave=requests.filter(r=>r==='GET /fis/official-quotas').length;
 await bookingDialog.getByLabel('Als EZ werten',{exact:true}).click();
 await summary.locator('button').filter({hasText:'Vollständig —'}).waitFor();
 assert.equal(await summary.locator('button').filter({hasText:'Vollständig —'}).isDisabled(),true);
 assert.equal(requests.filter(r=>r==='GET /fis/official-quotas').length,beforeSave);
 releaseMutation();
 await summary.locator('button').filter({hasText:'EZ ungeklärt 0'}).waitFor();
 assert.deepEqual(writes,['/assignments/bookings/booking-orphan']);
 assert.ok(requests.filter(r=>r==='GET /fis/official-quotas').length>=2);
 await bookingDialog.getByRole('button',{name:'Schließen',exact:true}).click();await bookingDialog.waitFor({state:'hidden'});
 // Race: an older filtered response must not overwrite a newer evaluation.
 delayFamily=true;familyGate=new Promise<void>(resolve=>{releaseFamily=resolve;});
 const oldFilterRequest=page.waitForRequest(r=>r.url().includes('sportFamily=Freestyle'));
 await summary.getByLabel('Bereich der Personenübersicht').selectOption('Freestyle');
 await oldFilterRequest;
 await summary.getByLabel('Bereich der Personenübersicht').selectOption('Snowboard');
 await summary.getByRole('button',{name:'Vollständig 2 / 4',exact:true}).waitFor();
 releaseFamily();delayFamily=false;
 await summary.getByRole('button',{name:'Vollständig 2 / 4',exact:true}).waitFor();
 await summary.getByLabel('Bereich der Personenübersicht').selectOption('');
 await summary.getByRole('button',{name:'Vollständig 3 / 6',exact:true}).waitFor();
 fail=true;await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
 await summary.getByText('Personenstatus konnte nicht neu bewertet werden.').waitFor();
 assert.equal(await summary.getByRole('button',{name:'Vollständig —',exact:true}).isDisabled(),true);
 assert.equal(await page.locator('[aria-label="Personenstatus"] .text-\\[var\\(--ops-success\\)\\]').count(),0);
 fail=false;await summary.getByRole('button',{name:'Erneut laden'}).click();
 await summary.getByRole('button',{name:'Vollständig 3 / 6',exact:true}).waitFor();
 await mkdir('/workspace/artifacts',{recursive:true});
 await page.screenshot({path:'/workspace/artifacts/disposition-status-dark.png',animations:'disabled'});
 // Check the computed colors of the real MUI tooltip in both themes.
 const checkTooltipContrast=async()=>{
  const status=page.locator('[aria-label="Personenstatus"] button').first();
  await status.hover();
  const tooltip=page.getByRole('tooltip');await tooltip.waitFor();
  const colors=await tooltip.evaluate(node=>{const style=getComputedStyle(node.querySelector('.MuiTooltip-tooltip')??node);return {text:style.color,background:style.backgroundColor};});
  const luminance=(rgb:string)=>{const channels=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>n/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
  const a=luminance(colors.text),b=luminance(colors.background);
  assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,JSON.stringify(colors));
  await page.mouse.move(0,0);await tooltip.waitFor({state:'hidden'});
 };
 await checkTooltipContrast();
 await page.getByRole('button',{name:'Helles Theme verwenden',exact:true}).click();
 await checkTooltipContrast();
 await page.setViewportSize({width:390,height:844});
 await summary.getByRole('button',{name:'Wunschabweichungen 1',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Wunschabweichung · AUT',exact:true}).click();
 const details=await page.getByRole('dialog').innerText();
 for(const label of ['Entscheidung 99','Gemeldeter Zimmerwunsch: Doppelzimmer (geteilt)','Tatsächliche Unterbringung','EZ-Deckung'])assert.ok(details.includes(label),label);
 assert.ok(!details.includes('Vertragszusage'));
 await page.screenshot({path:'/workspace/artifacts/disposition-status-mobile-light.png',animations:'disabled'});
 await page.getByRole('dialog').getByRole('button',{name:/Buchung booking-mismatch/}).click();
 await page.getByRole('button',{name:'Entscheidung anzeigen',exact:true}).waitFor();
 await page.getByRole('button',{name:'EZ-Entscheidung bearbeiten',exact:true}).click();
 await page.waitForURL('**/import?sessionId=s1');
 assert.equal(requests.filter(r=>r.startsWith('PATCH /import/')).length,0);
 await page.setViewportSize({width:1440,height:1050});
 readOnly=true;await page.goto(`${origin}/assignments`);
 await summary.getByRole('button',{name:'Vollständig 3 / 6',exact:true}).waitFor();
 await page.getByText('Status',{exact:true}).locator('..').getByRole('button',{name:'Zugewiesen',exact:true}).click();
 await page.getByRole('group',{name:/^Kontextlos ·/}).click();
 await page.getByRole('dialog').waitFor();
 assert.equal(await page.getByRole('button',{name:'EZ-Entscheidung bearbeiten',exact:true}).count(),0);
 assert.equal(await page.getByLabel('Als EZ werten',{exact:true}).isDisabled(),true);

 assert.deepEqual(errors,[]);
});

test('provisional real people remain draggable and blocked selections preserve real tasks',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-virtual-`),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const interval={checkInDate:'2027-03-11',checkOutDate:'2027-03-23'};
 let total:number|null=4,blocked=false;
 const people=Array.from({length:8},(_,i)=>({id:String(i+1),firstname:'Real'+i,lastname:'Athlete',name:'Real'+i+' Athlete',nationCode:'FIN',function:'Athlete',gender:'M',quotaDisciplines:['Freeski Park & Pipe'],roomType:'Double shared',arrivalDate:interval.checkInDate,departureDate:interval.checkOutDate,single_room_status:'NONE',accommodationRequirement:'REQUIRED',accommodationCoverage:{overallInterval:interval,coverageStatus:'UNASSIGNED',segments:[],coveredIntervals:[],openIntervals:[interval],conflicts:[]}}));
 const row=()=>({areaId:'stable-area',eventId:'1',nationCode:'FIN',discipline:'Freeski Park & Pipe',personalGender:'M',sportFamilies:['Freestyle'],reportedCount:8,expectedTotal:null,selectedCount:blocked?null:total,usesVirtualPlanning:false,virtualPlaces:0,replacedPersonIds:blocked?[]:people.slice(total??8).map(p=>p.id),bookedPeopleCount:blocked?2:0,status:blocked?'CONFLICT':'PLANNED',conflict:blocked,reasons:blocked?['Importreihenfolge nicht eindeutig; Unterkunftsbedarf klären.']:[],editable:true,worldChampionCount:0,people:[],...interval,note:null,baseToken:'current',revision:0,updatedBy:null,updatedAt:null});
 const policy=()=>({replacedPersonIds:row().replacedPersonIds,provisionalPersonIds:blocked?[]:people.slice(0,total??8).map(p=>p.id),groups:blocked?[row()]:[],zeroGroups:[],controlledAreas:1,zeroAreas:0,virtualPlaces:0,conflicts:blocked?1:0});
 const units=people.map(p=>({unitId:'u'+p.id,nationCode:'FIN',sourceRowKey:p.id,occupants:[{...p,athleteId:p.id,provisionalAccommodation:true}],roomType:'Double shared',roomTypeLabel:'double',roomCategoryLabel:'dz',occupantCount:1,...interval,specialMealFlags:[],statusBadges:[],assignmentWarnings:[],isFullyAssigned:false}));
 const projected=()=>people.map(p=>({personId:p.id,eventId:'1',name:p.name,nationCode:'FIN',personalGender:'M',personType:'ATHLETE',function:'Athlete',accommodationRequirement:'REQUIRED',sportFamilies:['Freestyle'],quotaDisciplines:p.quotaDisciplines,quotaContexts:[],matchesContextFilters:true,accommodation:p.accommodationCoverage,roomPreference:{reportedValue:p.roomType,reportedKind:'DOUBLE',status:'UNASSIGNED',hasMismatch:false,segments:[]},singleRoom:{status:'NO_SINGLE_USE',hasSingleUse:false,context:null,eligibleContexts:[],bookingIds:[],storedApprovalId:null,applicableApprovalId:null,approvalApplicable:false,approvedContexts:[],exemptionReason:null,reason:null}}));
 const event={id:'1',name:'Provisional synthetic',active:true};const errors:string[]=[],writes:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);
  if(req.method()==='PUT'&&path==='/athletes/arrival-planning/stable-area'){total=req.postDataJSON().expectedTotal;writes.push(path);return route.fulfill({json:row()});}
  if(path==='/fis/official-quotas')return route.fulfill({json:{rows:[],unallocatedSingleRooms:[],personStatuses:projected(),personPlanning:policy(),personSummary:{peopleTotal:8,accommodationPeopleRequired:blocked?8:total??8,fullyAssigned:blocked?2:0,unassigned:blocked?6:total??8,partiallyAssigned:0,accommodationConflicts:0,roomPreferenceMismatches:0,pendingSingleRoomPeople:0,contextlessPendingSingleRoomPeople:0,operationalAccommodationDemand:blocked?8:total??8,virtualPlaces:row().virtualPlaces,virtualGroups:0,planningConflicts:blocked?1:0},personFilters:{nationCode:url.searchParams.get('nationCode'),discipline:url.searchParams.get('discipline'),gender:url.searchParams.get('gender'),sportFamily:url.searchParams.get('sportFamily'),personType:url.searchParams.get('personType'),personalGender:null,contextlessPendingIncluded:true}}});
  if(path==='/assignments/availability')return route.fulfill({json:{targets:{},hotels:{}}});
  const bodies:Record<string,unknown>={'/auth/me':{username:'tester',displayName:'Tester',groups:['incoming-admin'],permissions:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/athletes':people,'/athletes/arrival-planning':{eventId:'1',nationCode:url.searchParams.get('nationCode'),reportedCount:8,rows:[row()]},'/assignments/planning-view':{timeline:{startDate:interval.checkInDate,endDate:interval.checkOutDate},units:{unassigned:units,assigned:[]},hotels:[],validationByUnit:{},athletePlanning:policy()}};
  return route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected request'}});
 });
 await page.goto(`${origin}/assignments`);
 await page.getByText('4 namentliche Aufgaben · 0 Planungsklärungen',{exact:true}).waitFor();
 const cards=page.locator('aside div[role="group"][draggable="true"]');
 assert.equal(await cards.count(),4);assert.equal(await page.locator('aside').getByText('Vorläufig',{exact:true}).count(),4);
 const source=cards.first(),transfer=await page.evaluateHandle(()=>new DataTransfer());
 await source.dispatchEvent('dragstart',{dataTransfer:transfer});assert.match(await transfer.evaluate(value=>value.getData('text/plain')),/^need:/);await source.dispatchEvent('dragend');
 assert.equal(await page.getByRole('article',{name:/Virtuelle Gruppe/}).count(),0);
 await page.getByRole('button',{name:'Vollständig 0 / 4',exact:true}).waitFor();
 await page.screenshot({path:'/workspace/artifacts/provisional-queue-dark.png',animations:'disabled'});
 await page.getByRole('button',{name:'Helles Theme verwenden',exact:true}).click();
 await page.screenshot({path:'/workspace/artifacts/provisional-queue-light.png',animations:'disabled'});
 total=5;await page.reload();await page.getByText('5 namentliche Aufgaben · 0 Planungsklärungen',{exact:true}).waitFor();assert.equal(await cards.count(),5);
 blocked=true;
 people.slice(0,2).forEach(person=>Object.assign(person.accommodationCoverage,{coverageStatus:'FULLY_ASSIGNED',openIntervals:[],coveredIntervals:[interval]}));
 await page.reload();await page.getByText('6 namentliche Aufgaben · 1 Planungsklärungen',{exact:true}).waitFor();
 assert.equal(await cards.count(),6);await page.getByRole('button',{name:'Vollständig 2 / Klärung',exact:true}).waitFor();
 assert.match(await page.getByRole('article',{name:/Planungsklärung/}).innerText(),/Importreihenfolge nicht eindeutig/);
 await page.getByRole('button',{name:'Nicht zugewiesen 6',exact:true}).click();
 assert.equal(await page.getByRole('dialog').getByRole('list',{name:'Betroffene Personen'}).locator('li').count(),6);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});

test('hotel overview keeps contracts and timeline without a date filter',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-hotels-`),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const event={id:'1',name:'Synthetic hotel event',active:true,planningPeriods:[]};
 const types=[{id:'dz',name:'DZ / DU',maxPersons:2},{id:'ez',name:'EZ / DU',maxPersons:1}];
 const hotel={id:'h',name:'Synthetic Daneu',accommodationType:'HOTEL',roomInventories:types.map((roomType,i)=>({id:'inv'+i,hotelId:'h',roomTypeId:roomType.id,roomType,roomCount:i?8:10,availableFrom:'2027-03-08',availableUntil:'2027-03-22'}))};
 const errors:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.slice(4);
  if(request.method()!=='GET'&&path!=='/auth/me')writes.push(path);
  const bodies:Record<string,unknown>={'/auth/me':{username:'tester',groups:['incoming-admin'],permissions:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/hotels':[hotel],'/room-types':types,'/room-bookings/grouped':[]};
  return route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected synthetic request'}});
 });
 await page.goto(`${origin}/hotels`);
 await page.getByRole('heading',{name:'Hotels & Zimmerkontingente',exact:true}).waitFor();
 await page.getByText('Inventarzimmer',{exact:true}).waitFor();
 assert.equal(await page.locator('input[type="date"]').count(),0);
 assert.equal(await page.getByText('Stichtag (Belegungsnacht)',{exact:true}).count(),0);
 const contracts=page.locator('b').filter({hasText:/^\d+ gesamt$/});
 assert.deepEqual((await contracts.allTextContents()).map(s=>s.trim()),['10 gesamt','20 gesamt','8 gesamt','8 gesamt']);
 await page.getByText('Timeline',{exact:true}).waitFor();
 await page.getByText('Tatsächliche Kontingent- und Buchungszeiträume',{exact:true}).waitFor();
 await mkdir('/workspace/artifacts',{recursive:true});
 await page.screenshot({path:'/workspace/artifacts/hotel-contract-inventory.png',animations:'disabled'});
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
