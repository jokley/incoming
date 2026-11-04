import test from 'node:test';
import assert from 'node:assert/strict';
import { accommodationSurcharge } from './accommodationSurcharge.ts';
import { createListRows } from '../lists/listEngine.ts';
import type { Athlete } from '../types.ts';

const person=(extra:Partial<Athlete>={})=>({id:'1',firstname:'One',lastname:'Person',nationCode:'AUS',function:'Athlete',single_room_status:'NONE',...extra} as Athlete);
test('SPECIAL shows Ja in the shared overview/export rows without single-room approval',()=>{
 const p=person({accommodationRateCategory:'SPECIAL'});const before=structuredClone(p);
 assert.equal(createListRows([p],[])[0].surcharge,'Ja');
 assert.deepEqual(accommodationSurcharge(p),{applicable:true,hasAccommodationSurcharge:true,surchargeReasons:['SPECIAL_RATE']});
 assert.deepEqual(p,before);assert.equal(p.single_room_status,'NONE');
});
test('existing active APPROVED_EXTRA surcharge remains Ja and inactive approval remains Nein',()=>{
 const active=person({single_room_status:'APPROVED_EXTRA',assignment:{countsAsSingle:true} as Athlete['assignment']});
 assert.equal(createListRows([active],[])[0].surcharge,'Ja');
 assert.deepEqual(accommodationSurcharge(active).surchargeReasons,['APPROVED_EXTRA_SINGLE']);
 const inactive={...active,assignment:{countsAsSingle:false}} as Athlete;
 assert.equal(createListRows([inactive],[])[0].surcharge,'Nein');
});
test('STANDARD without approval remains Nein, including absent metadata',()=>{
 assert.equal(createListRows([person({accommodationRateCategory:'STANDARD'})],[])[0].surcharge,'Nein');
 assert.equal(createListRows([person()],[])[0].surcharge,'Nein');
 assert.deepEqual(accommodationSurcharge(null),{applicable:true,hasAccommodationSurcharge:false,surchargeReasons:[]});
});
test('both reasons remain separately represented without changing approval state',()=>{
 const p=person({accommodationRateCategory:'SPECIAL',single_room_status:'APPROVED_EXTRA',assignment:{countsAsSingle:true} as Athlete['assignment']});
 assert.deepEqual(accommodationSurcharge(p).surchargeReasons,['SPECIAL_RATE','APPROVED_EXTRA_SINGLE']);
 assert.equal(p.single_room_status,'APPROVED_EXTRA');
});
