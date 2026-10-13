import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { physicalSingleRoomUsageFromBookings, physicalSingleRoomPersonIdsFromBookings } from './quotaEvaluation.ts';

test('capacity counts distinct physical people across groups, including exempt and unmapped people', async t => {
  const bookings = [
    { id:'1', countsAsSingle:true, checkInDate:'2027-03-01',checkOutDate:'2027-03-03',occupants:[{athlete:{id:'A',
      competitions:[{quotaDiscipline:'Ski Cross'},{quotaDiscipline:'Freestyle'}]}}]},
    { id:'2', countsAsSingle:true, checkInDate:'2027-03-01',checkOutDate:'2027-03-03',occupants:[{athlete:{id:'B',
      singleRoomQuotaExemptReason:'OTHER',competitions:[]}}]},
    { id:'3', countsAsSingle:true, checkInDate:'2027-03-01',checkOutDate:'2027-03-03',occupants:[{athlete:{id:'C',competitions:[]}}]},
    { id:'4', countsAsSingle:false, checkInDate:'2027-03-01',checkOutDate:'2027-03-03',occupants:[{athlete:{id:'D'}}]},
  ];
  assert.equal(physicalSingleRoomUsageFromBookings(bookings as never), 3);
  assert.deepEqual([...physicalSingleRoomPersonIdsFromBookings([...bookings,bookings[3]] as never)].sort(), ['A','B','C']);
  assert.equal(physicalSingleRoomUsageFromBookings([...bookings,bookings[0]] as never), 3);
  const server = await createServer({configFile:false,envFile:false,logLevel:'silent',
    server:{middlewareMode:true,watch:null},appType:'custom'});
  t.after(()=>server.close());
  const {buildCapacityTimeline} = await server.ssrLoadModule('/src/app/services/planningCalculations.ts');
  const timeline = buildCapacityTimeline({hotels:[],events:[],athletes:[],bookings});
  assert.equal(timeline[0].assignedEz, 3);
  assert.equal(timeline[0].assignedBeds, 4);
});
