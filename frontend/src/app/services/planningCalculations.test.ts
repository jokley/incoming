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
  const timeline = buildCapacityTimeline({hotels:[],events:[],athletes:[],bookings:bookings.map(booking=>({...booking,hotel:{id:'hotel',name:'Hotel'},roomType:{id:'dz',name:'DZ',maxPersons:2}}))});
  assert.equal(timeline[0].assignedEz, 3);
  assert.equal(timeline[0].assignedBeds, 4);
});


test('external bookings contribute no local rooms or beds',async t=>{
  const server=await createServer({configFile:false,envFile:false,logLevel:'silent',server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});t.after(()=>server.close());
  const {buildCapacityTimeline,buildHotelRiskRows}=await server.ssrLoadModule('/src/app/services/planningCalculations.ts');
  const external={id:'10',name:'Kühtai',accommodationType:'EXTERNAL',roomInventories:[]};
  const booking={id:'1',hotel:external,roomType:null,checkInDate:'2027-03-14',checkOutDate:'2027-03-20',occupants:[{athlete:{id:'A'}}]};
  const days=buildCapacityTimeline({hotels:[external],events:[],athletes:[],bookings:[booking]});
  assert.ok(days.every(day=>day.assignedRooms===0 && day.assignedBeds===0));
  assert.deepEqual(buildHotelRiskRows([external],[booking]),[]);
});

test('concrete demand deduplicates confirmed pairs and booking occupants and keeps real gaps', async t => {
  const server = await createServer({ configFile: false, envFile: false, logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { concreteRoomDemand, excelDemandRecords, buildCapacityTimeline } =
    await server.ssrLoadModule('/src/app/services/planningCalculations.ts');
  const people = [
    { matchKey: 'a', existingAthleteId: 1, roomType: 'Double shared' },
    { matchKey: 'b', roomType: 'Double shared' },
    { matchKey: 'ez', roomType: 'Single', arrivalDate: '2027-03-02', departureDate: '2027-03-04' },
    { matchKey: 'skip', accommodationRequirement: 'NO_DISPO', roomType: 'Single' },
    { matchKey: 'nr', accommodationRequirement: 'NO_ROOM', roomType: 'Single' },
    { matchKey: 'bench', roomType: 'Single' },
    { matchKey: 'unknown', arrivalDate: '2027-03-02', departureDate: '2027-03-03' },
  ];
  const pair = { person1Key: 'a', person2Key: 'b', roomType: 'Double shared',
    checkInDate: '2027-03-02', checkOutDate: '2027-03-03' };
  const rooms = [pair, pair, { ...pair, checkInDate: '2027-03-04', checkOutDate: '2027-03-05' }];
  const dz = { id: 'dz', name: 'DZ', maxPersons: 2 };
  const ez = { id: 'ez', name: 'EZ', maxPersons: 1 };
  const hotel = { id: 'h', name: 'Hotel', roomInventories: [
    { id: 'i', roomType: dz, roomCount: 3, availableFrom: '2027-03-02', availableUntil: '2027-03-05' },
    { id: 'j', roomType: ez, roomCount: 1, availableFrom: '2027-03-03', availableUntil: '2027-03-04' },
  ] };
  const booking = { id: 'one', hotel, roomType: dz, countsAsSingle: true,
    checkInDate: '2027-03-04', checkOutDate: '2027-03-05', occupants: [{ athlete: { id: '1' } }] };
  const records = excelDemandRecords(people, rooms, ['preview:bench']);
  const demand = concreteRoomDemand(records, [booking, booking]);
  assert.deepEqual(demand.days.map(({ ez, dz, beds, blocked, unknown }: Record<string, number>) =>
    [ez, dz, beds, blocked, unknown]), [[1, 1, 4, 0, 1], [1, 0, 1, 0, 0], [0, 2, 2, 1, 0], [0, 0, 0, 0, 0]]);
  assert.equal(demand.provisional, true);
  const [first, second] = buildCapacityTimeline({ hotels: [hotel], events: [], athletes: [], bookings: [booking] }, demand);
  assert.equal(first.liveRoomReserve, 1);
  assert.equal(first.liveEzReserve, -1);
  assert.equal(second.liveEzReserve, 0);
  assert.equal(second.demandDz, 0);
  const joining = concreteRoomDemand(records, [{ ...booking, countsAsSingle: false }]);
  assert.equal(joining.days[2].dz, 1);
  const mismatched = concreteRoomDemand(excelDemandRecords([
    people[0], { ...people[1], arrivalDate: '2027-03-03', departureDate: '2027-03-04' },
  ], [pair], []), []);
  assert.deepEqual(mismatched.days.map(({ beds }: { beds: number }) => beds), [1, 1, 0]);
  assert.equal(mismatched.provisional, true);
});

test('Excel counts source occupants once and subtracts other bookings from capacity only', async t => {
  const server = await createServer({ configFile: false, envFile: false, logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { concreteRoomDemand, excelDemandRecords, buildCapacityTimeline } =
    await server.ssrLoadModule('/src/app/services/planningCalculations.ts');
  const dates = { arrivalDate: '2027-03-02', departureDate: '2027-03-03' };
  const roomType = { id: 'dz', name: 'DZ', maxPersons: 2 };
  const hotel = { id: 'h', name: 'Hotel', roomInventories: [
    { id: 'i', roomType, roomCount: 2, availableFrom: dates.arrivalDate, availableUntil: dates.arrivalDate },
  ] };
  const bookings = ['A', 'B'].map((nationCode, i) => ({
    id: nationCode, hotel, roomType, countsAsSingle: i === 1, checkInDate: dates.arrivalDate,
    checkOutDate: dates.departureDate, occupants: [{ athlete: { id: String(i + 1), nationCode } }],
  }));
  const data = { hotels: [hotel], bookings, athletes: [], events: [] };
  const booked = { ...dates, matchKey: 'booked', existingAthleteId: 1, roomType: 'Double' };
  const open = { ...dates, matchKey: 'open', roomType: 'Double' };
  const project = (people: Array<typeof booked | typeof open>) => concreteRoomDemand(
    excelDemandRecords(people, [], [], 'A:'), bookings, { separateOutsideBookings: true });
  const covered = project([booked]);
  assert.deepEqual([covered.days[0].rooms, covered.days[0].beds], [1, 1]);
  assert.deepEqual(covered.days[0].outside, { rooms: 1, ez: 0, dz: 1, beds: 2 });
  const [balanced] = buildCapacityTimeline(data, covered);
  assert.deepEqual([balanced.assignedRooms, balanced.excelRoomSupply, balanced.liveRoomReserve, balanced.liveDzReserve],
    [2, 1, 0, 0]);
  const [short] = buildCapacityTimeline(data, project([booked, open]));
  assert.deepEqual([short.demandRooms, short.demandBeds, short.liveRoomReserve, short.liveDzReserve],
    [2, 2, -1, -1]);
  const [empty] = buildCapacityTimeline({ ...data, hotels: [] }, project([]));
  assert.deepEqual([empty.demandRooms, empty.demandBeds, empty.liveRoomReserve, empty.liveDzReserve], [0, 0, 0, 0]);
});
