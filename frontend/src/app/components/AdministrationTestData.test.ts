import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true,entries:[],include:[]},appType:'custom'});
const {CleanupScope}=await server.ssrLoadModule('/src/app/components/AdministrationTestData.tsx');
await server.close();
test('cleanup confirmation names dependent records and preserved shared rooms',()=>{
 const html=renderToStaticMarkup(createElement(CleanupScope,{preview:{counts:{people:4,memberships:6,bookings:2,occupants:4,legacyAssignments:1,sessions:1,versions:2,approvals:3,workflowEvents:7,sharedRoomsRetained:1},preserved:['Hotels','Kontingente','Quotenregeln']}}));
 for(const text of ['4 Personen','6 Competition-Zuordnungen','3 Genehmigungen','1 gemeinsam genutzte Zimmer','Hotels','Andere Events bleiben unverändert'])assert.ok(html.includes(text),text);
});
