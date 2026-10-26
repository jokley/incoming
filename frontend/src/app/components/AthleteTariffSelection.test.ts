import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true,entries:[],include:[]},appType:'custom'});
const {tariffSelectionValid,AthleteTariffSelection,AccommodationRateProvenance}=await server.ssrLoadModule('/src/app/components/AthleteTariffSelection.tsx');
await server.close();
const candidates=['m1','m2','m3','f1','f2'].map(personKey=>({personKey,name:personKey,gender:personKey.startsWith('m')?'M':'F'}));
test('JPN overlap selects four people, three men, not seven',()=>{
 const extent={total:4,M:3,F:0};
 assert.equal(tariffSelectionValid(extent,candidates,['m1','m2','m3','f1'],'SPECIAL_SELECTED'),true);
 assert.equal(tariffSelectionValid(extent,candidates,['m1','m2','f1','f2'],'SPECIAL_SELECTED'),false);
 assert.equal(tariffSelectionValid(extent,candidates,[],'SPECIAL_SELECTED'),false);
 assert.equal(tariffSelectionValid(extent,candidates,[],'NONE'),true);
 const html=renderToStaticMarkup(createElement(AthleteTariffSelection,{extent,candidates,selected:[],effect:'SPECIAL_SELECTED',onEffect:()=>{},onSelected:()=>{}}));
 for(const text of ['Tarifwirkung','Genau 4','mindestens 3 Männer','höchstens einmal','Manuelle Tarife','Preisliche Festlegung offen','EZ-Genehmigungen bleiben unabhängig'])assert.ok(html.includes(text),text);
});
test('preview names approval provenance and preserves manual tariff priority',()=>{
 const html=renderToStaticMarkup(createElement(AccommodationRateProvenance,{person:{accommodationRateSource:'MANUAL',accommodationRateCategory:'STANDARD',accommodationRateApprovalIds:[12],accommodationRateExplanation:'Manueller Standard bleibt erhalten. Preisliche Festlegung offen.'}}));
 assert.match(html,/Manueller Tarif hat Vorrang/);assert.match(html,/#12/);assert.match(html,/Preisliche Festlegung offen/);
});
