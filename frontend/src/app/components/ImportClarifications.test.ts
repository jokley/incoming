import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer,type ViteDevServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {importFindings} from '../services/importFindings.ts';
import type {FisImportPreview,ImportControl} from '../types';
import type {ImportSession} from '../data/importSessions';
let server:ViteDevServer;let Panel:React.ElementType;
before(async()=>{server=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../../../../node_modules/.vite-import-findings',import.meta.url)),root:fileURLToPath(new URL('../../..',import.meta.url)),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});Panel=(await server.ssrLoadModule('/src/app/components/ImportClarifications.tsx')).ImportClarifications;});
after(async()=>{await server?.close()});
const preview={people:[{matchKey:'a',firstname:'Sample',lastname:'Official'}],rooms:[],submissionSources:{Snowboard:1,Freestyle:2},errors:[{code:'IMPORT_SHARED_STAY_SECTIONS',message:'Getrennte Aufenthalte',details:{personKey:'a',requirements:['REQUIRED','NO_ROOM'],periods:[{arrivalDate:'2027-03-01',departureDate:'2027-03-05'},{arrivalDate:'2027-03-08',departureDate:'2027-03-12'}],sourceRows:[{versionId:1,row:3},{versionId:2,row:4}]}}],warnings:[{code:'INFO_OFFICIALS_OVER_BASIS',message:'Officials über Basis (informativ)'}]} as unknown as FisImportPreview;
const session={approvals:[{id:'decision',decision:'PENDING',description:'Bestehende EZ-Entscheidung'}],nationClarifications:{items:[]}} as unknown as ImportSession;
function render(canWrite:boolean){return renderToStaticMarkup(createElement(Panel,{preview,session,findings:importFindings(preview),canWrite,onPerson:()=>assert.fail('render must not navigate'),onPeople:()=>assert.fail('render must not navigate'),onQuestion:()=>assert.fail('render must not write'),onDecision:()=>assert.fail('render must not decide'),onExistingQuestion:()=>{}}));}
test('overview counts actual severities, shows clickable people and both source periods without mutation',()=>{
 const before=JSON.stringify({preview,session});const html=render(true);
 for(const text of ['Klärungsübersicht','1 Importfehler','1 offene Entscheidungen','Sample Official','Snowboard (SB)','Freestyle/Freeski (FS)','2027-03-05','2027-03-08','korrigierte Excel-Meldung','nur ein Aufenthaltsfenster'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/data-finding-kind="error"/g)||[]).length,1);
 assert.equal((html.match(/data-finding-kind="info"/g)||[]).length,1);
 assert.equal(JSON.stringify({preview,session}),before);
});
test('viewer can inspect existing decisions and cannot document a question',()=>{
 const html=render(false);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Rückfrage dokumentieren<\/button>/);
 assert.ok(html.includes('Entscheidung ansehen'));assert.ok(!html.includes('Entscheidung bearbeiten'));
});
test('editors can use the existing decision and clarification routes',()=>{
 const html=render(true);assert.ok(html.includes('Entscheidung bearbeiten'));
 assert.match(html,/<button(?![^>]*disabled=")[^>]*>Rückfrage dokumentieren<\/button>/);
 assert.ok(!html.includes('Import freigeben'));
});
test('a warning alone remains informative and does not create a blocker or decision',()=>{
 const p={...preview,errors:[]};const s={...session,approvals:[]};
 const html=renderToStaticMarkup(createElement(Panel,{preview:p,session:s,findings:importFindings(p),canWrite:false,onPerson:()=>{},onPeople:()=>{},onQuestion:()=>{},onDecision:()=>{},onExistingQuestion:()=>{}}));
 assert.ok(html.includes('0 Importfehler'));assert.ok(html.includes('0 offene Entscheidungen'));
 assert.ok(!html.includes('data-finding-kind="error"'));
});
