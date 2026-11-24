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
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const interval={checkInDate:'2027-03-11',checkOutDate:'2027-03-23'};
 let legacySingle=true,single=true,fail=false,delayFamily=false,readOnly=false,singleWish=false,apartmentMode=false,legacyMode=false,legacyBedroom:number|null=null,newBedroom:number|null=null;
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
  const coverage = (availableFrom:string,availableUntil:string) => ({availableFrom,availableUntil,coversRequestedRange:true,intervals:[{availableFrom,availableUntil}]});
  const firstSlots=slots.map(slot=>({...slot,inventoryId:'1',dateCoverage:coverage(interval.checkInDate,interval.checkOutDate)}));
  const free={slotId:'h:r:free',slotIndex:9,hotelId:'h',hotelName:'Synthetic Hotel',roomTypeId:'r',roomTypeName:'DZ',capacity:2,roomNumber:'Zimmer 09',inventoryRoomCount:9,dateCoverage:coverage(interval.checkInDate,interval.checkOutDate),inventoryId:'1',bookings:[]};
  const later={...free,slotId:'h:r:later',slotIndex:1,roomNumber:'K2-1',inventoryRoomCount:1,dateCoverage:coverage('2027-03-23','2027-03-31'),inventoryId:'2'};
  if (legacyMode) {
    // Apartment type, count and dates from backend/seed_data.py. People are fixtures.
    const rooms = [1,2,3].map(index=>({
      ...free,slotId:`h:r:1:${index}`,slotIndex:index,roomNumber:`K1-${index}`,
      roomLabel:`Apartment 0${index}`,hotelName:'Hotel Alpenrose',roomTypeName:'APP: 2 DZ + 2 DU',
      capacity:4,inventoryRoomCount:3,apartmentLayout:{bedrooms:[2,2],showers:2},
      dateCoverage:coverage('2027-03-04','2027-03-21'),
      bookings:index===3?[{
        bookingId:'legacy-booking',hotelId:'h',roomTypeId:'r',roomNumber:legacyBedroom?'K1-3':'Zimmer 03',
        sourceRoomNumber:legacyBedroom?'K1-3':'Slot 03',bedroomIndex:legacyBedroom,capacity:legacyBedroom?2:4,
        checkInDate:'2027-03-11',checkOutDate:'2027-03-20',countsAsSingle:legacySingle,
        occupants:[occupants.find(person=>person.athleteId==='full')],
      }, ...newBedroom?[{
        bookingId:'new-bedroom', bedroomIndex:newBedroom, hotelId:'h',roomTypeId:'r',roomNumber:'K1-3',
        capacity:2,checkInDate:'2027-03-11',checkOutDate:'2027-03-20',countsAsSingle:true,
        occupants:[occupants.find(person=>person.athleteId==='open')],
      }]:[]]:[],
    }));
    return {timeline:{startDate:interval.checkInDate,endDate:interval.checkOutDate},
      units:{unassigned:units.filter(u=>!u.isFullyAssigned),assigned:units.filter(u=>u.isFullyAssigned)},
      hotels:[{hotelId:'h',hotelName:'Hotel Alpenrose',slots:rooms}],validationByUnit:{}};
  }
  if (apartmentMode) {
    const apartment = {...free, slotId:'apt:1',roomNumber:'K1-1',roomLabel:'Apartment 01',
      roomTypeName:'APP: 2 DZ + DU', apartmentLayout:{bedrooms:[2,2],showers:1}};
    return {timeline:{startDate:interval.checkInDate,endDate:interval.checkOutDate},
      units:{unassigned:units.filter(u=>!u.isFullyAssigned),assigned:units.filter(u=>u.isFullyAssigned)},
      hotels:[{hotelId:'h',hotelName:'Synthetic Hotel',slots:[apartment]}],validationByUnit:{}};
  }
  return {timeline:{startDate:interval.checkInDate,endDate:interval.checkOutDate},units:{unassigned:units.filter(u=>!u.isFullyAssigned),assigned:units.filter(u=>u.isFullyAssigned)},hotels:[{hotelId:'h',hotelName:'Synthetic Hotel',slots:[...firstSlots,free,later]}],validationByUnit:{}};

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
   if (legacyMode) {
     const targets=Object.fromEntries(needs.flatMap(need=>[need.key,...need.athleteIds.map(id=>`${need.key}:athlete:${id}`)].map(key=>[key,[
       {slotId:'h:r:1:3:bedroom:2',bedroomIndex:2,status:legacyBedroom?'valid':'blocked',
        messages:legacyBedroom?[]:['Bestandsbuchung klären: zuerst einen Schlafraum zuordnen.']},
     ]])));
     return route.fulfill({json:{targets,hotels:{}}});
   }
   const targets=Object.fromEntries(needs.flatMap(need=>[need.key,...need.athleteIds.map(id=>`${need.key}:athlete:${id}`)].map(key=>[key,need.athleteIds.includes('open')?apartmentMode?[{slotId:'apt:1:bedroom:2',status:'warning',messages:['Ausnahme erforderlich: DU'],apartmentRules:['DU']}]:[{slotId:'booking:booking-mismatch',status:'valid',messages:[]},{slotId:'h:r:free',status:'valid',messages:[]}]:[]])));
   return route.fulfill({json:{targets,hotels:{}}});
  }
  if(req.method()==='PUT'&&path==='/assignments/bookings/legacy-booking'){
    legacySingle=req.postDataJSON().countsAsSingle;
    return route.fulfill({json:{id:'legacy-booking',countsAsSingle:legacySingle}});
  }
  if(req.method()==='POST'&&path==='/assignments/bookings/legacy-booking/bedroom'){
    legacyBedroom=req.postDataJSON().bedroomIndex;
    return route.fulfill({json:{id:'legacy-booking',bedroomIndex:legacyBedroom}});
  }
  if(req.method()==='POST'&&path==='/assignments/segments'&&legacyMode){
    newBedroom=req.postDataJSON().bedroomIndex;
    return route.fulfill({status:201,json:{success:true,booking:{id:'new-bedroom',bedroomIndex:newBedroom},people:[]}});
  }
  if(req.method()==='POST'&&path==='/assignments/segments')return route.fulfill({status:409,json:{message:'Synthetic stale target; no booking changed.'}});
  if(path.startsWith('/assignments/planning-view/validations/'))return route.fulfill({json:{validations:[]}});
  const bodies:Record<string,unknown>={'/auth/me':{username:'local-admin',displayName:'local-admin',groups:[readOnly?'incoming-viewer':'incoming-admin'],permissions:readOnly?['data.read']:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/assignments/planning-view':planning(),'/athletes':people().map(p=>({id:p.personId,firstname:p.name,lastname:'Synthetic',nationCode:'AUT',function:p.function,gender:'M',competitions:[]}))};
  return route.fulfill({status:path in bodies?200:404,json:bodies[path]??{message:'Unexpected synthetic request'}});
 });
 await page.goto(`${origin}/assignments`);
 const summary=page.locator('section[aria-label="Personen Soll/Ist"]');
 await summary.getByRole('button',{name:'Vollständig 3 / 6',exact:true}).waitFor({timeout:30000});
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
 const groups=page.locator('[data-room-type-group="r"] > button');
 assert.equal(await groups.count(),2);
 assert.match(await groups.nth(0).innerText(),/11\.03\.–23\.03\.2027/);
 assert.match(await groups.nth(1).innerText(),/0\/1 Zimmer · 0\/2 Betten/);
 assert.match(await groups.nth(1).innerText(),/23\.03\.–31\.03\.2027/);
 await groups.nth(1).click();
 assert.equal(await groups.nth(0).getAttribute('aria-expanded'),'true');
 assert.equal(await groups.nth(1).getAttribute('aria-expanded'),'false');
 const openCard=page.getByRole('group',{name:/^Offen ·/});
 assert.match(await openCard.innerText(),/AUT · M · Athlete · (Snowboard Cross|Ski Cross)/);
 const assignedCards=page.locator('.ops-occupant-card');
 assert.ok((await assignedCards.allTextContents()).some(label=>/EST · M · Official · (Snowboard Cross|Ski Cross)/.test(label)));
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

 readOnly=false;apartmentMode=true;
 await page.goto(`${origin}/assignments`);
 await summary.getByRole('button',{name:'Vollständig 3 / 6',exact:true}).waitFor({timeout:30000});
 await page.getByText('Synthetic Hotel',{exact:true}).first().click();
 const apartment=page.getByRole('region',{name:'Apartment 9'});
 assert.equal(await apartment.locator('[data-bedroom-index]').count(),2);
 const transfer = await page.evaluateHandle(()=>new DataTransfer());
 await page.getByRole('group',{name:/^Offen ·/}).dispatchEvent('dragstart',{dataTransfer:transfer});
 const secondBedroom=apartment.locator('[data-bedroom-index="2"]');
 await secondBedroom.getByText('Ausnahme erforderlich: DU').waitFor();
 assert.match(await secondBedroom.innerText(),/DZ · 0\/2 · Frei/);
 await secondBedroom.dispatchEvent('dragover',{dataTransfer:transfer});
 await secondBedroom.getByText('Loslassen zum Zuweisen').waitFor();
 await secondBedroom.dispatchEvent('drop',{dataTransfer:transfer});
 const exception=page.getByRole('dialog').filter({hasText:'Apartmentausnahme bestätigen'});
 const confirm=exception.getByRole('button',{name:'Ausnahme verbindlich zuweisen'});
 assert.equal(await confirm.isDisabled(),true);
 await exception.getByLabel('Begründung').fill('Bestätigt mit der Unterkunft');
 const exceptionPost=page.waitForRequest(r=>r.method()==='POST' && r.url().endsWith('/assignments/segments'));
 await confirm.click();
 const override=(await exceptionPost).postDataJSON();
 assert.equal(override.bedroomIndex,2);
 assert.equal(override.confirmApartmentException,true);
 assert.deepEqual(override.acceptedApartmentRules,['DU']);
 assert.equal(override.apartmentExceptionReason,'Bestätigt mit der Unterkunft');
 legacyMode=true;
 interval.checkOutDate='2027-03-20';
 await page.goto(`${origin}/assignments`);
 await page.getByText('Hotel Alpenrose',{exact:true}).first().click();
 const legacy=page.getByRole('region',{name:'Apartment 3'});
 const pendingPerson=page.getByRole('group',{name:/^Offen ·/});
 const pendingDrag=await page.evaluateHandle(()=>new DataTransfer());
 await pendingPerson.dispatchEvent('dragstart',{dataTransfer:pendingDrag});
 const unresolvedRoom=legacy.locator('[data-bedroom-index="2"]');
 await unresolvedRoom.getByText(/Bestandsbuchung klären/).waitFor();
 assert.equal(await unresolvedRoom.isDisabled(),true);
 await pendingPerson.dispatchEvent('dragend',{dataTransfer:pendingDrag});
 await legacy.getByRole('button',{name:'Schlafraum zuordnen',exact:true}).click();
 assert.match(await legacy.innerText(),/Hotel Alpenrose · Apartment 3/);
 assert.match(await legacy.innerText(),/Vollständig · EZ-Nutzung/);
 const assign=legacy.getByRole('button',{name:'Zuordnung bestätigen'});
 assert.equal(await assign.isDisabled(),true);
 await legacy.getByLabel('Zielschlafraum').selectOption('1');
 const legacyPost=page.waitForRequest(r=>r.method()==='POST' && r.url().endsWith('/legacy-booking/bedroom'));
 await assign.click();
 assert.deepEqual((await legacyPost).postDataJSON(),{inventoryId:'1',roomNumber:'K1-3',bedroomIndex:1,
   expected:{roomNumber:'Slot 03',athleteIds:['full'],checkInDate:'2027-03-11',checkOutDate:'2027-03-20',countsAsSingle:true}});
 const firstBedroom=legacy.locator('[data-apartment-bedroom="1"]');
 await firstBedroom.getByText('Vollständig', {exact:false}).first().waitFor();
 await firstBedroom.getByText(/DZ · 1\/2 · Einzelbelegung/).waitFor();
 await firstBedroom.locator('.ops-occupant-card').click();
 const detailsDialog=page.getByRole('dialog');
 await detailsDialog.getByText(/Physische Einzelbelegung/).waitFor();
 const checkbox=detailsDialog.getByLabel('Als EZ werten',{exact:true});
 assert.equal(await checkbox.isChecked(),true);
 const quotaUpdate=page.waitForRequest(r=>r.method()==='PUT' && r.url().endsWith('/legacy-booking'));
 await checkbox.click();
 assert.deepEqual((await quotaUpdate).postDataJSON(),{countsAsSingle:false});
 await detailsDialog.getByRole('button',{name:'Schließen',exact:true}).click();
 await firstBedroom.getByText(/DZ · 1\/2 · Teilweise belegt/).waitFor();
 const roomTwo=legacy.locator('[data-bedroom-index="2"]');
 const person=page.getByRole('group',{name:/^Offen ·/});
 const nextTransfer=await page.evaluateHandle(()=>new DataTransfer());
 await person.dispatchEvent('dragstart',{dataTransfer:nextTransfer});
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Apartment 3"] [data-bedroom-index="2"]')?.hasAttribute('disabled'));
 const lightBedroomColors=await roomTwo.evaluate(node=>({
   foreground:getComputedStyle(node).color,
   background:getComputedStyle(node.closest('[data-apartment-bedroom]')!).backgroundColor,
 }));
 await page.getByRole('button',{name:'Dunkles Theme verwenden',exact:true}).click();
 const darkBedroomColors=await roomTwo.evaluate(node=>({
   foreground:getComputedStyle(node).color,
   background:getComputedStyle(node.closest('[data-apartment-bedroom]')!).backgroundColor,
 }));
 assert.notDeepEqual(darkBedroomColors,lightBedroomColors);
 const newPost=page.waitForRequest(r=>r.method()==='POST' && r.url().endsWith('/assignments/segments'));
 await roomTwo.click();
 const newBooking=(await newPost).postDataJSON();
 assert.equal(newBooking.bedroomIndex,2);
 assert.equal(newBooking.roomNumber,'K1-3');
 assert.equal(newBooking.inventoryId,'1');
 await legacy.locator('[data-apartment-bedroom="2"]').locator('.ops-occupant-card').waitFor();
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

test('hotel periods and selected dates preserve empty hotels and existing bookings',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const vite=await createServer({root,configFile:`${root}vite.config.ts`,envFile:false,base:'/',cacheDir:await mkdtemp(`${tmpdir()}/incoming-hotels-`),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,open:false,hmr:false,ws:false}});
 t.after(()=>vite.close());await vite.listen();
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10000);
 const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 const event={id:'1',name:'Synthetic hotel event',active:true,planningPeriods:[]};
 const types=[{id:'dz',name:'DZ / DU',maxPersons:2},{id:'ez',name:'EZ / DU',maxPersons:1}];
 const hotel={id:'h',name:'Synthetic Daneu',accommodationType:'HOTEL',roomInventories:types.map((roomType,i)=>({id:'inv'+i,hotelId:'h',roomTypeId:roomType.id,roomType,roomCount:i?8:10,availableFrom:i?'2027-03-16':'2027-03-08',availableUntil:i?'2027-03-22':'2027-03-15'}))};
 const empty={id:'e',name:'Synthetic Empty',location:'Brand',roomInventories:[]};
 const booked={id:'b',hotel:{id:'h',name:hotel.name},roomType:types[1],checkInDate:'2027-03-16',checkOutDate:'2027-03-18',occupants:[{athlete:{id:'1'}}]};
 const errors:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.slice(4);
  if(request.method()!=='GET'&&path!=='/auth/me')writes.push(path);
  if(request.method()==='DELETE'&&path.startsWith('/hotels/h/inventory/')){
   hotel.roomInventories=hotel.roomInventories.filter(item=>!path.endsWith('/'+item.id));
   return route.fulfill({status:204});
  }
  const bodies:Record<string,unknown>={'/auth/me':{username:'tester',groups:['incoming-admin'],permissions:['*']},'/active-event-context':{events:[{...event,canRead:true,canWrite:true}],selectedEventId:'1',switchingAllowed:false},'/hotels':[hotel,empty],'/room-types':types,'/room-bookings/grouped':[booked]};
  return route.fulfill({status:path in bodies?200:404,json:bodies[path]??{error:'Unexpected synthetic request'}});
 });
 await page.goto(`${origin}/hotels`,{timeout:30000});
 await page.getByRole('heading',{name:'Hotels & Zimmerkontingente',exact:true}).waitFor();
 await page.getByText('Kontingente im Gesamtzeitraum',{exact:true}).waitFor();
 const hotelButton=page.getByRole('button',{name:/^Synthetic Daneu/});
 const emptyButton=page.getByRole('button',{name:/^Synthetic Empty/});
 assert.match(await hotelButton.innerText(),/10 Zimmer gleichzeitig/);
 assert.match(await emptyButton.innerText(),/Kein Kontingent/);
 await emptyButton.click();
 await page.getByText('Für dieses Hotel sind noch keine Zeiträume angelegt.',{exact:true}).waitFor();
 await hotelButton.click();
 assert.equal(await page.locator('input[type="date"]').count(),0);
 assert.equal(await page.getByText('Stichtag (Belegungsnacht)',{exact:true}).count(),0);
 const contracts=page.locator('b').filter({hasText:/^\d+ gesamt$/});
 assert.deepEqual((await contracts.allTextContents()).map(s=>s.trim()),['10 gesamt','20 gesamt','8 gesamt','8 gesamt']);
 await page.getByText('Timeline',{exact:true}).waitFor();
 await page.getByText('Tatsächliche Kontingent- und Buchungszeiträume',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Stichtag',exact:true}).click();
 const day=page.getByLabel('Stichtag (Belegungsnacht)');
 await day.fill('2027-03-07');
 assert.match(await hotelButton.innerText(),/Kein Kontingent am Stichtag/);
 await day.fill('2027-03-10');
 await page.getByText('Inventarzimmer',{exact:true}).waitFor();
 assert.match(await hotelButton.innerText(),/10 Zimmer frei am Stichtag/);
 await page.getByRole('button',{name:'Gesamtzeitraum',exact:true}).click();
 for(const id of ['inv0','inv1']){
   await page.getByRole('button',{name:'Kontingent löschen',exact:true}).first().click();
   await Promise.all([
     page.waitForResponse(response=>response.url().endsWith('/api/hotels')&&response.request().method()==='GET'),
     page.getByRole('dialog').getByRole('button',{name:'Löschen',exact:true}).click(),
   ]);
 }
 await page.getByText('Buchungen ohne ausreichendes Kontingent',{exact:true}).waitFor();
 await page.getByText('Buchungen',{exact:true}).first().waitFor();
 assert.match(await hotelButton.innerText(),/Kein Kontingent/);
 assert.deepEqual(writes,['/hotels/h/inventory/inv0','/hotels/h/inventory/inv1']);
 assert.deepEqual(errors,[]);
});
