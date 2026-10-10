import { useEffect, useMemo, useState } from 'react';
import { Loader2, Bed, DoorOpen } from 'lucide-react';
import { api } from '../services/api';
import { HotelCapacityOverview, HotelReservationRow, Hotel } from '../types';

export function RoomOccupancy() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [capacity, setCapacity] = useState<HotelCapacityOverview[]>([]);
  const [reservations, setReservations] = useState<HotelReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ hotelId: '', startDate: '', endDate: '', roomTypeId: '', nation: '', discipline: '' });

  useEffect(() => { loadHotels(); }, []);
  useEffect(() => { loadData(); }, [filters.hotelId, filters.startDate, filters.endDate, filters.roomTypeId, filters.nation, filters.discipline]);

  const loadHotels = async () => setHotels(await api.getHotels());

  const loadData = async () => {
    try {
      setLoading(true);
      const params = {
        hotel_id: filters.hotelId || undefined,
        start_date: filters.startDate || undefined,
        end_date: filters.endDate || undefined,
        room_type_id: filters.roomTypeId || undefined,
        nation: filters.nation || undefined,
        discipline: filters.discipline || undefined,
      };
      const overview = await api.getHotelCapacityOverview(params);
      setCapacity(overview);
      if (filters.hotelId) {
        setReservations(await api.getHotelReservations(filters.hotelId, params));
      } else {
        setReservations([]);
      }
    } finally { setLoading(false); }
  };

  const totals = useMemo(() => capacity.reduce((acc, h) => {
    acc.inventoryRooms += h.totals.inventoryRooms;
    acc.inventoryBeds += h.totals.inventoryBeds;
    acc.occupiedBeds += h.totals.occupiedBeds;
    acc.remainingBeds += h.totals.remainingBeds;
    return acc;
  }, { inventoryRooms: 0, inventoryBeds: 0, occupiedBeds: 0, remainingBeds: 0 }), [capacity]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  return <div className="space-y-6">
    <h3 className="text-lg font-semibold">Zimmerbelegung Übersicht</h3>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <input className="border rounded p-2" placeholder="Nation" value={filters.nation} onChange={e => setFilters({ ...filters, nation: e.target.value })} />
      <input className="border rounded p-2" placeholder="Disziplin" value={filters.discipline} onChange={e => setFilters({ ...filters, discipline: e.target.value })} />
      <select className="border rounded p-2" value={filters.hotelId} onChange={e => setFilters({ ...filters, hotelId: e.target.value })}><option value="">Alle Hotels</option>{hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      <input className="border rounded p-2" type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} />
      <input className="border rounded p-2" type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} />
      <input className="border rounded p-2" placeholder="Room Type ID" value={filters.roomTypeId} onChange={e => setFilters({ ...filters, roomTypeId: e.target.value })} />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow p-6 border border-blue-200"><Bed className="w-10 h-10 text-blue-600" /><h4>Zimmer Inventar</h4><div className="text-3xl font-bold text-blue-600">{totals.inventoryRooms}</div></div>
      <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow p-6 border border-purple-200"><DoorOpen className="w-10 h-10 text-purple-600" /><h4>Belegte Betten</h4><div className="text-3xl font-bold text-purple-600">{totals.occupiedBeds}</div></div>
      <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow p-6 border border-green-200"><h4>Verfügbar</h4><div className="text-3xl font-bold text-green-600">{totals.remainingBeds}</div></div>
    </div>

    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead><tr><th className="px-4 py-2 text-left">Hotel</th><th className="px-4 py-2">Inventar</th><th className="px-4 py-2">Belegt</th><th className="px-4 py-2">Rest</th></tr></thead>
        <tbody>
          {capacity.map((h) => <tr key={h.hotel.id}><td className="px-4 py-2">{h.hotel.name}</td><td className="px-4 py-2 text-center">{h.totals.inventoryBeds}</td><td className="px-4 py-2 text-center">{h.totals.occupiedBeds}</td><td className="px-4 py-2 text-center">{h.totals.remainingBeds}</td></tr>)}
        </tbody>
      </table>
    </div>

    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <div className="px-6 py-4 bg-gray-50 border-b"><h4 className="text-md font-semibold">Hotel reservation table</h4></div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead><tr><th className="px-4 py-2 text-left">Zimmer</th><th className="px-4 py-2">Typ</th><th className="px-4 py-2">Belegung</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Von/Bis</th><th className="px-4 py-2">Notiz</th></tr></thead>
        <tbody>
          {reservations.map((r) => <tr key={r.assignmentId}><td className="px-4 py-2">{r.roomNumber || '-'}</td><td className="px-4 py-2">{r.roomType.name}</td><td className="px-4 py-2 text-center">{r.occupancy}</td><td className="px-4 py-2">{r.guestName}{r.sharedWithName ? ` / ${r.sharedWithName}` : ''}</td><td className="px-4 py-2">{r.checkInDate} - {r.checkOutDate}</td><td className="px-4 py-2">{r.specialNotes || '-'}</td></tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}
