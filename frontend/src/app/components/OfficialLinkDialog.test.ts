import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer,type ViteDevServer} from 'vite';
import {fileURLToPath} from 'node:url';
let server:ViteDevServer;let Choices:React.ElementType;let Dialog:React.ElementType;
before(async()=>{server=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../../../../node_modules/.vite-official-links',import.meta.url)),root:fileURLToPath(new URL('../../..',import.meta.url)),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'},plugins:[{
 name:'official-link-test-shell',
 enforce:'pre',
 // Render the actual dialog state/content without MUI's browser-only portal.
 transform(code,id){if(id.endsWith('/OfficialLinkDialog.tsx'))return code.replace("from '../design-system'", "from 'official-link-test-shell'");},
 resolveId(id){if(id==='official-link-test-shell')return '\0official-link-test-shell';},
 load(id){if(id==='\0official-link-test-shell')return "import {createElement} from 'react'; export function EnterpriseDialog({children,actions}){return createElement('div',null,children,actions)} export function OpsButton(props){return createElement('button',props)}";},
}]});const module=await server.ssrLoadModule('/src/app/components/OfficialLinkDialog.tsx');Choices=module.OfficialLinkChoices;Dialog=module.OfficialLinkDialog;});
after(async()=>{await server?.close()});
const candidates=Array.from({length:6},(_,i)=>({key:`p${i}`,name:`Synthetic Official ${i}`,identities:[{family:'Snowboard',staffId:`SB-${i}`,function:'NSA Coach',row:i+2},{family:'Freestyle',staffId:`FS-${i}`,function:'NSA Coach',row:i+3}]}));
test('opening the actual dialog preselects six proposals, reports the count and never confirms',()=>{
 let confirmations=0;
 const html=renderToStaticMarkup(createElement(Dialog,{proposal:{token:'aut',sessionId:'1',candidates},onClose:()=>{},onConfirm:async()=>{confirmations++;}}));
 assert.equal((html.match(/checked=""/g)||[]).length,6);
 assert.ok(html.includes('6 von 6 Zuordnungen ausgewählt'));
 assert.ok(html.includes('6 geprüfte Zuordnungen bestätigen'));
 assert.equal(confirmations,0);
});
test('a new token starts with its own longer list; an empty proposal cannot be confirmed',()=>{
 const long=Array.from({length:24},(_,i)=>({...candidates[0],key:`aus${i}`}));
 const render=(token:string,items:typeof candidates)=>renderToStaticMarkup(createElement(Dialog,{proposal:{token,sessionId:'1',candidates:items},onClose:()=>{},onConfirm:async()=>{assert.fail('Rendering must not persist');}}));
 const html=render('aus-new',long);
 assert.equal((html.match(/checked=""/g)||[]).length,24);
 assert.ok(html.includes('24 von 24 Zuordnungen ausgewählt'));
 assert.match(render('empty',[]),/<button[^>]*disabled=""[^>]*>0 geprüfte Zuordnungen bestätigen<\/button>/);
});
test('all six AUT-style proposals can be selected while both scoped identities stay visible',()=>{
 const html=renderToStaticMarkup(createElement(Choices,{candidates,selected:candidates.map(p=>p.key),busy:false,onToggle:()=>{}}));
 assert.equal((html.match(/type="checkbox"/g)||[]).length,6);assert.equal((html.match(/checked=""/g)||[]).length,6);
 for(let i=0;i<6;i++){assert.ok(html.includes(`SB-${i}`));assert.ok(html.includes(`FS-${i}`));}
 assert.ok(html.includes('Snowboard')&&html.includes('Freestyle / Freeski'));
});
test('long AUS-style lists retain every selectable source pair and mark different functions',()=>{
 const long=Array.from({length:24},(_,i)=>({...candidates[0],key:`aus${i}`,name:`AUS Official ${i}`,identities:[{family:'Snowboard',staffId:`SB-${i}`,function:'NSA Coach',row:i+2},{family:'Freestyle',staffId:`FS-${i}`,function:'NSA Medical',row:i+3}]}));
 const html=renderToStaticMarkup(createElement(Choices,{candidates:long,selected:long.map(p=>p.key),busy:false,onToggle:()=>{}}));
 assert.equal((html.match(/checked=""/g)||[]).length,24);
 assert.equal((html.match(/Unterschiedliche Funktionen/g)||[]).length,24);
 assert.ok(html.includes('SB-23')&&html.includes('FS-23')&&html.includes('NSA Medical'));
});
test('clearing the choices leaves no person selected or described as already confirmed',()=>{
 const html=renderToStaticMarkup(createElement(Choices,{candidates,selected:[],busy:false,onToggle:()=>{}}));
 assert.ok(!html.includes('checked=""'));
 assert.ok(!html.includes('dieselbe Person bestätigt'));
 assert.equal((html.match(/zur Zuordnung auswählen/g)||[]).length,6);
});
test('partial confirmation never checks the remaining candidates and busy state locks all choices',()=>{
 const html=renderToStaticMarkup(createElement(Choices,{candidates,selected:['p2'],busy:true,onToggle:()=>{}}));
 assert.equal((html.match(/checked=""/g)||[]).length,1);
 assert.equal((html.match(/disabled=""/g)||[]).length,6);
});
