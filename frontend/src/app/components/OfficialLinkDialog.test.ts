import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer,type ViteDevServer} from 'vite';
import {fileURLToPath} from 'node:url';
let server:ViteDevServer;let Choices:React.ElementType;
before(async()=>{server=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../../../../node_modules/.vite-official-links',import.meta.url)),root:fileURLToPath(new URL('../../..',import.meta.url)),optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});Choices=(await server.ssrLoadModule('/src/app/components/OfficialLinkDialog.tsx')).OfficialLinkChoices;});
after(async()=>{await server?.close()});
const candidates=Array.from({length:6},(_,i)=>({key:`p${i}`,name:`Synthetic Official ${i}`,identities:[{family:'Snowboard',staffId:`SB-${i}`,function:'NSA Coach',row:i+2},{family:'Freestyle',staffId:`FS-${i}`,function:'NSA Coach',row:i+3}]}));
test('six source pairs show both scoped staff IDs and require per-person explicit consent',()=>{
 const html=renderToStaticMarkup(createElement(Choices,{candidates,selected:[],busy:false,onToggle:()=>{}}));
 assert.equal((html.match(/type="checkbox"/g)||[]).length,6);assert.ok(!html.includes('checked=""'));
 for(let i=0;i<6;i++){assert.ok(html.includes(`SB-${i}`));assert.ok(html.includes(`FS-${i}`));}
 assert.ok(html.includes('Snowboard')&&html.includes('Freestyle/Freeski'));
});
test('partial confirmation never checks the remaining candidates and busy state locks all choices',()=>{
 const html=renderToStaticMarkup(createElement(Choices,{candidates,selected:['p2'],busy:true,onToggle:()=>{}}));
 assert.equal((html.match(/checked=""/g)||[]).length,1);
 assert.equal((html.match(/disabled=""/g)||[]).length,6);
});
