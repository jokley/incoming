import assert from 'node:assert/strict';
import test from 'node:test';
import {createListRows} from './listEngine.ts';
import type {Athlete} from '../types.ts';

test('person list adds true competition labels without changing canonical filter and export discipline',()=>{
 const person={id:'1',firstname:'Synthetic',lastname:'Person',nationCode:'ITA',single_room_status:'NONE',quotaDisciplines:['Freestyle'],
  discipline:'Legacy',disciplines:["Men's Moguls","Men's Dual Moguls"],competitions:[{name:"Men's Moguls"},{name:"Men's Dual Moguls"},{name:"Men's Moguls"}]} as Athlete;
 const [row,official]=createListRows([person,{...person,id:'2',function:'NSA Coach',disciplines:[],competitions:[]}],[]);
 assert.equal(row.eventGroups,'Freestyle');assert.equal(row.competitionNames,'Moguls · Dual Moguls');
 assert.equal(row.discipline,'Moguls • Dual Moguls');
 assert.equal(official.eventGroups,'Freestyle');assert.equal(official.competitionNames,'');
});
