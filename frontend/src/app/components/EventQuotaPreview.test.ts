import assert from 'node:assert/strict';
import {test,after,before} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer,type ViteDevServer} from 'vite';
import {fileURLToPath} from 'node:url';
let server:ViteDevServer;let Preview:any;let rows:any;let nationReviewSelection:any;let PrimaryAction:any;let Queue:any;
before(async()=>{
  server=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../../../../node_modules/.vite-quota-preview',import.meta.url)),root:fileURLToPath(new URL('../../..',import.meta.url)),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});
  const mod=await server.ssrLoadModule('/src/app/components/DataImport.tsx');Preview=mod.PreviewCard;rows=mod.athleteQuotaRows;nationReviewSelection=mod.nationReviewSelection;PrimaryAction=mod.SessionPrimaryAction;Queue=(await server.ssrLoadModule('/src/app/components/ImportQueue.tsx')).ImportQueue;
});
after(async()=>{await server?.close()});
const check={topLevelDiscipline:'Snowboard',athleteQuotaUsed:40,athleteQuotaLimit:36,athleteGenderUsed:{M:21,F:19},athleteGenderLimit:20,athleteQuotaStatus:'EXCEEDED',decisionStatus:'PENDING',approvedExtent:{total:2,M:1,F:0},uncoveredExtent:{total:2,M:0,F:0}};
const preview={people:[],rooms:[],errors:[],warnings:[],quotaChecks:[],athleteQuotaChecks:[check],dispositionAnalysis:{changes:[]}};
test('four responsive preview tiles show actual family data and open decisions',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview,peopleRows:[],roomRows:[],onOpen:()=>{}}));
  for(const label of ['Personen','Zimmerzuordnungen','Officials &amp; EZ-Quote','Athleten-/Disziplinquote','40 / 36','Familienquote','Genehmigung erforderlich'])assert.ok(html.includes(label),label);
  assert.match(html,/sm:grid-cols-2 2xl:grid-cols-4/);
  assert.deepEqual(rows(preview)[0],['Snowboard','40 / 36','21 / 20','19 / 20','Gesamtgrenze: 2 · Männer: 1 · Frauen: 0','Gesamtgrenze: 2 · Männer: 0 · Frauen: 0','Offen']);
});
test('an incomplete check is not presented as quota compliant',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,athleteQuotaChecks:[{...check,athleteQuotaStatus:'INCOMPLETE'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
  assert.match(html,/Unvollständige Quotendaten/);
});

test('a covered excess stays visibly distinct from a base-quota result',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,athleteQuotaChecks:[{...check,decisionStatus:'APPROVED'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
  assert.match(html,/Überschreitung genehmigt/);
});
test('an unresolved family cannot appear quota compliant when no rows were calculated',()=>{
  const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,athleteQuotaChecks:[],errors:[{code:'ATHLETE_QUOTA_FAMILY_UNKNOWN'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
  assert.match(html,/Quotendaten unvollständig/);
});


test('unmapped blocking file errors remain visible in the relevant tile',()=>{
 const html=renderToStaticMarkup(createElement(Preview,{preview:{...preview,errors:[{code:'ENTRY_MISSING_COLUMNS',message:'Pflichtspalten fehlen'}]},peopleRows:[],roomRows:[],onOpen:()=>{}}));
 assert.match(html,/1 Importfehler/);
});

test('family tile surfaces CAN one and GER two unresolved positions without summing athletes',()=>{
 const competition=(id:string,name:string,count:number)=>({id,name,gender:'M',sportEntries:[{nation:'CAN',unverifiedAdditional:count}]});
 const control={competitions:[competition('ss',"Men's Slopestyle",0),competition('ba',"Men's Big Air",1)],people:[],issues:[]};
 const data={...preview,athleteQuotaChecks:[{...check,athleteQuotaUsed:14,athleteQuotaStatus:'WITHIN_QUOTA',decisionStatus:null}],quotaOverview:{event:{rulesFixed:true},nations:[]}};
 const render=()=>renderToStaticMarkup(createElement(Preview,{preview:data,control,peopleRows:[],roomRows:[],onOpen:()=>{}}));
 const can=render();assert.ok(can.includes('14 / 36')&&can.includes('Familienquote OK')&&can.includes('1 Sportliche Prüfung offen')&&can.includes('Big Air Männer'));
 control.competitions[0].sportEntries[0].unverifiedAdditional=5;control.competitions[1].sportEntries[0].unverifiedAdditional=5;
 const ger=render();assert.ok(ger.includes('2 Wettbewerbspositionen prüfen'));assert.ok(!ger.includes('10 Wettbewerbspositionen'));
});


test('partial preview labels the file roster, not the combined nation population',()=>{
 for(const [family,label,count] of [['Snowboard','Snowboard (SB)',4],['Freestyle','Freestyle/Freeski (FS)',7]] as const){
  const data={...preview,replacementScope:{kind:'SPORT_FAMILY',family},people:Array.from({length:count},()=>({firstname:'Synthetic',lastname:'Person'}))};
  const html=renderToStaticMarkup(createElement(Preview,{preview:data,peopleRows:[],roomRows:[],onOpen:()=>{}}));
  assert.ok(html.includes(`Teilmeldung · ${label}`));
  assert.ok(html.includes(`${count} Personen`));assert.ok(html.includes('aus diesen Dateien'));
 }
 const full=renderToStaticMarkup(createElement(Preview,{preview:{...preview,replacementScope:{kind:'FULL_NATION'}},peopleRows:[],roomRows:[],onOpen:()=>{}}));
 assert.ok(full.includes('Sonderaktion · vollständiger Nationsersatz'));assert.ok(!full.includes('aus diesen Dateien'));
});


test('combined nation uses the same four tiles and keeps a partial imported session operationally open',async()=>{
 const {hasOpenSubmissions}=await import('../data/importSessions.ts');
 const combined={...preview,replacementScope:{kind:'SPORT_FAMILY',families:['Snowboard','Freestyle']},submissionSources:{Snowboard:1,Freestyle:2},people:Array.from({length:11},()=>({firstname:'Synthetic',lastname:'Person'}))};
 const html=renderToStaticMarkup(createElement(Preview,{preview:combined,peopleRows:[],roomRows:[],onOpen:()=>{}}));
 assert.ok(html.includes('Erfasster Nationsentwurf')&&html.includes('11 Personen'));
 assert.ok(!html.includes('aus diesen Dateien'));
 const session={status:'IMPORTED',submissions:[{status:'IMPORTED'},{status:'PROFESSIONALLY_REVIEWED'}]};
 assert.equal(hasOpenSubmissions(session),true);
 session.submissions[1].status='IMPORTED';assert.equal(hasOpenSubmissions(session),false);
});

const sourceSession={id:'nation',status:'PROFESSIONALLY_REVIEWED',approvals:[],submissions:[{family:'Snowboard',versionId:'1'},{family:'Freestyle',versionId:'2'}]};
test('nation opening collects all latest sources without a manual selection',()=>{
 assert.deepEqual(nationReviewSelection({...sourceSession,preview:{submissionSources:{Freestyle:2}}}),{sourceVersionIds:['1','2']});
 assert.deepEqual(nationReviewSelection({...sourceSession,submissions:[{family:'Snowboard',versionId:'1'}]}),{sourceVersionIds:['1']});
});
test('opening a current joint review preserves approved and imported versions',()=>{
 for(const status of ['APPROVED','IMPORTED','PROFESSIONALLY_REVIEWED'])assert.equal(nationReviewSelection({...sourceSession,status,preview:{submissionSources:{Snowboard:1,Freestyle:2}}}),undefined);
});
test('corrections, stale reviews and explicit rechecks use current source ids',()=>{
 const current={...sourceSession,preview:{submissionSources:{Snowboard:1,Freestyle:2}}};
 assert.deepEqual(nationReviewSelection({...current,submissions:[{family:'Snowboard',versionId:'3'},{family:'Freestyle',versionId:'2',errors:1}]}),{sourceVersionIds:['3','2']});
 for(const flag of ['planStale','quotaRulesChanged'])assert.deepEqual(nationReviewSelection({...current,preview:{...current.preview,[flag]:true}}),{sourceVersionIds:['1','2']});
 assert.deepEqual(nationReviewSelection(current,true),{sourceVersionIds:['1','2']});
});
test('legacy reviews and deliberate full replacement retain their scope',()=>{
 assert.equal(nationReviewSelection({...sourceSession,submissions:[]}),undefined);
 assert.equal(nationReviewSelection({...sourceSession,preview:{replacementScope:{kind:'FULL_NATION'}}}),undefined);
});
test('exactly one next action; stale approval never offers import',()=>{
 const cases=[
  {files:[{},{}],label:'Dateien prüfen',status:'APPROVED'},
  {stale:true,label:'Prüfung fortsetzen',status:'APPROVED'},
  {missing:true,label:'Prüfung fortsetzen',status:'APPROVED'},
  {label:'Freigeben',status:'PROFESSIONALLY_REVIEWED'},
  {label:'Importieren',status:'APPROVED'},
  {label:'Erneut prüfen',status:'IMPORTED'},
  {label:'Dateien aktualisieren',status:'PROFESSIONALLY_REVIEWED',invalid:true},
  {label:'Entscheidungen bearbeiten',status:'WAITING_FOR_NATION',pending:true},
 ];
 for(const item of cases){
  const props={session:{...sourceSession,status:item.status,approvals:item.pending?[{decision:'PENDING',description:'EZ prüfen',type:'QUOTA_SINGLE_ROOMS_EXCEEDED',quotaDetails:{}}]:[]},preview:item.missing?null:{...preview,isValid:!item.invalid,errors:item.invalid?[{code:'ENTRY_INVALID_ARRIVAL_DATE'}]:[],changePlan:{digest:'current'},planStale:item.stale},files:item.files??[],loading:false,confirming:false,reviewConfirmed:true,onPreview:()=>{},onRecheck:()=>{},onOpenTask:()=>{},onApprove:()=>{},onImport:()=>{}};
  const html=renderToStaticMarkup(createElement(PrimaryAction,props));
  assert.equal((html.match(/<button/g)||[]).length,1,item.label);assert.ok(html.includes(item.label),item.label);
  if(item.stale||item.missing)assert.ok(!html.includes('Importieren'));
 }
});

test('mandatory questions guide only the relevant review; unrelated and optional questions preserve release',()=>{
 const data={...preview,isValid:true,errors:[],changePlan:{digest:'current'}};
 for(const [required,relevant,expected] of [[true,true,'Rückfrage klären'],[true,false,'Freigeben'],[false,true,'Freigeben']] as const){
  const session={...sourceSession,status:'PROFESSIONALLY_REVIEWED',approvals:[],nationClarifications:{subjects:[],items:[{id:'q',required,relevant,state:'OPEN'}]}};
  const output=renderToStaticMarkup(createElement(PrimaryAction,{session,preview:data,files:[],loading:false,confirming:false,reviewConfirmed:true,onPreview:()=>{},onRecheck:()=>{},onOpenTask:()=>{},onApprove:()=>{},onImport:()=>{}}));
  assert.ok(output.includes(expected));assert.ok(!output.includes('disabled=""'));assert.equal((output.match(/<button/g)||[]).length,1);
 }
});


test('closed sessions ignore historical open submissions and never auto-recheck',async()=>{
 const {hasOpenSubmissions}=await import('../data/importSessions.ts');
 for(const status of ['ARCHIVED','CANCELLED']){
  const session={...sourceSession,status,submissions:[{status:'PROFESSIONALLY_REVIEWED'}]};
  assert.equal(hasOpenSubmissions(session),false);
  assert.equal(nationReviewSelection(session,true),undefined);
 }
});

test('queue excludes closed sessions from normal count and keeps collapsed history',()=>{
 const sessions=['PROFESSIONALLY_REVIEWED','IMPORTED','ARCHIVED','CANCELLED'].map((status,i)=>({...sourceSession,id:String(i),nation:['ARG','ITA','JPN','CAN'][i],status,submissions:[],errors:0,warnings:0}));
 const html=renderToStaticMarkup(createElement(Queue,{sessions,selectedId:null,onSelect:()=>{},onClose:()=>{}}));
 assert.ok(html.includes('Importwarteschlange (2)'));
 const open=html.slice(html.indexOf('Offene Nationen'),html.indexOf('Importierte Nationen'));
 assert.ok(open.includes('ARG')&&!open.includes('JPN')&&!open.includes('CAN'));
 const imported=html.slice(html.indexOf('Importierte Nationen'),html.indexOf('<details'));
 assert.ok(imported.includes('ITA')&&!imported.includes('JPN')&&!imported.includes('CAN'));
 assert.match(html,/<details class="mt-5 text-sm"><summary/);
 assert.ok(html.includes('Geschlossene Importsessions (2)'));
 assert.equal((html.match(/title="Importsession aus Warteschlange entfernen"/g)??[]).length,2);
 const readonly=renderToStaticMarkup(createElement(Queue,{sessions,selectedId:null,onSelect:()=>{}}));
 assert.ok(!readonly.includes('Importsession aus Warteschlange entfernen'));
});

test('read-only users can inspect the import but cannot upload, recheck, release or confirm',()=>{
 for(const status of ['DRAFT','PROFESSIONALLY_REVIEWED','APPROVED','IMPORTED']){
  const session={...sourceSession,status,approvals:[]};
  const html=renderToStaticMarkup(createElement(PrimaryAction,{canWrite:false,session,preview:{...preview,isValid:true,errors:[],changePlan:{digest:'current'}},files:[],loading:false,confirming:false,reviewConfirmed:true,onPreview:()=>{},onRecheck:()=>{},onOpenTask:()=>{},onApprove:()=>{},onImport:()=>{}}));
  assert.match(html,/disabled=""/);
 }
});
