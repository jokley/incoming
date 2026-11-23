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

test('concrete demand deduplicates confirmed pairs and keeps real gaps', async t => {
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
  const demand = concreteRoomDemand(records);
  assert.deepEqual(demand.days.map(({ ez, dz, beds, unknown }: Record<string, number>) =>
    [ez, dz, beds, unknown]), [[1, 1, 4, 1], [1, 0, 1, 0], [0, 1, 2, 0], [0, 0, 0, 0]]);
  assert.equal(demand.provisional, true);
  const [first, second] = buildCapacityTimeline({ hotels: [hotel], events: [], athletes: [], bookings: [booking] }, demand);
  assert.equal(first.liveRoomReserve, 1);
  assert.equal(first.liveEzReserve, -1);
  assert.equal(second.liveEzReserve, 0);
  assert.equal(second.demandDz, 0);
  const mismatched = concreteRoomDemand(excelDemandRecords([
    people[0], { ...people[1], arrivalDate: '2027-03-03', departureDate: '2027-03-04' },
  ], [pair], []));
  assert.deepEqual(mismatched.days.map(({ beds }: { beds: number }) => beds), [1, 1, 0]);
  assert.equal(mismatched.provisional, true);
});

test('all four sources compare independent demand with the same dated room contracts', async t => {
  const server = await createServer({ configFile: false, envFile: false, logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { concreteRoomDemand, excelDemandRecords, importedDemandRecords, buildCapacityTimeline } =
    await server.ssrLoadModule('/src/app/services/planningCalculations.ts');
  const dates = { arrivalDate: '2027-03-02', departureDate: '2027-03-04' };
  const dz = { id: 'dz', name: 'DZ', maxPersons: 2 };
  const ez = { id: 'ez', name: 'EZ / DU', maxPersons: 2 };
  const other = { id: 'other', name: 'Apartment', maxPersons: 4 };
  const hotel = { id: 'h', name: 'Hotel', roomInventories: [dz, ez, other].map((roomType, index) => ({
    id: roomType.id, roomType, roomCount: index === 2 ? 3 : 1,
    availableFrom: dates.arrivalDate, availableUntil: index === 1 ? dates.arrivalDate : dates.departureDate,
  })) };
  const bookings = ['A', 'B'].map((nationCode, i) => ({
    id: nationCode, hotel, roomType: dz, countsAsSingle: i === 1, checkInDate: dates.arrivalDate,
    checkOutDate: dates.departureDate, occupants: [{ athlete: { id: String(i + 1), nationCode } }],
  }));
  const athletes = [{ ...dates, id: '1', roomType: 'Single' }];
  const data = { hotels: [hotel], bookings, athletes, events: [
    { startDate: dates.arrivalDate, endDate: dates.arrivalDate, personDemand: 6 },
  ] };
  const excel = concreteRoomDemand(excelDemandRecords([
    { ...dates, matchKey: 'A', existingAthleteId: 1, roomType: 'Single' },
    { ...dates, matchKey: 'C', roomType: 'Single' },
  ], [], []));
  const imported = concreteRoomDemand(importedDemandRecords(athletes, []));
  for (const [source, demand, expected] of [
    ['event', undefined, [4, 2, 2]],
    ['excel', excel, [2, 2, 0]],
    ['import', imported, [1, 1, 0]],
    ['live', undefined, [2, 0, 2]],
  ] as const) {
    const [first, second, checkout] = buildCapacityTimeline(data, demand, source);
    assert.deepEqual([first.roomSupply, first.ezSupply, first.dzSupply], [5, 1, 1]);
    assert.deepEqual([second.roomSupply, second.ezSupply, second.dzSupply], [4, 0, 1]);
    const actual = source === 'event' ? [first.plannedRooms, first.plannedEz, first.plannedDz]
      : [first.demandRooms, first.demandEz, first.demandDz];
    assert.deepEqual(actual, expected);
    const reserves = source === 'event' ? [first.eventRoomReserve, first.eventEzReserve, first.eventDzReserve]
      : [first.liveRoomReserve, first.liveEzReserve, first.liveDzReserve];
    assert.deepEqual(reserves, expected.map((value, index) => [5, 1, 1][index] - value));
    if (source === 'event') assert.equal(checkout.plannedRooms, 0);
    else assert.equal(checkout.demandRooms, 0);
    if (source !== 'live') {
      const [withoutBookings] = buildCapacityTimeline({ ...data, bookings: [] }, demand, source);
      assert.deepEqual([withoutBookings.eventRoomReserve, withoutBookings.liveRoomReserve],
        [first.eventRoomReserve, first.liveRoomReserve]);
    }
  }
});

test('nation live demand follows booking nights and apportions mixed-nation rooms once', async t => {
  const server = await createServer({ configFile: false, envFile: false, logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { bookedNationDemand } = await server.ssrLoadModule('/src/app/services/planningCalculations.ts');
  const booking = {
    id: 'shared', checkInDate: '2027-03-02', checkOutDate: '2027-03-04', roomType: { maxPersons: 2, name: 'DZ' },
    occupants: [{ athlete: { id: 's', nationCode: 'SUI' } }, { athlete: { id: 'p', nationCode: 'POL' } }],
  };
  const later = { ...booking, id: 'later', checkInDate: '2027-03-05', checkOutDate: '2027-03-06',
    roomType: { maxPersons: 1, name: 'EZ' }, occupants: [booking.occupants[0]] };
  const [sui, pol] = bookedNationDemand([booking, later, booking]);
  assert.equal(sui.count, 1);
  assert.equal(pol.count, 1);
  assert.deepEqual(sui.days.map(({ beds, ez, dz }: Record<string, number>) => [beds, ez, dz]),
    [[1, 0, 0.5], [1, 0, 0.5], [0, 0, 0], [1, 1, 0], [0, 0, 0]]);
  assert.equal(pol.days[0].dz + sui.days[0].dz, 1);
});
