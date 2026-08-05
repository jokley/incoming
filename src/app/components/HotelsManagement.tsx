import { PageLayout, PageHeader, ContentCard, PermissionButton, READ_ONLY_TOOLTIP } from './PageLayout';
import { useState, useEffect } from 'react';
import { usePermissions } from '../auth/AuthProvider';
import { Plus, Pencil, Trash2, Loader2, Building2, Calendar, X } from 'lucide-react';
import { api } from '../services/api';
import { Hotel, RoomType } from '../types';

export function HotelsManagement() {
  const permissions = usePermissions();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(null);
  const [formData, setFormData] = useState({ name: '', location: '', region: '' });

  // Inventory form
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [inventoryForm, setInventoryForm] = useState({
    roomTypeId: '',
    availableFrom: '',
    availableUntil: '',
    roomCount: 0,
    hasHalfBoard: false,
    hasSR: false
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [hotelsData, roomTypesData] = await Promise.all([
        api.getHotels(),
        api.getRoomTypes()
      ]);

      setHotels(hotelsData);
      setRoomTypes(roomTypesData);
      setError(null);
    } catch (err) {
      setError('Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    if (!permissions.canEdit) return;
    e.preventDefault();

    try {
      if (editingId) {
        await api.updateHotel(editingId, formData);
      } else {
        await api.createHotel(formData);
      }

      await loadData();
      setFormData({ name: '', location: '', region: '' });
      setIsAdding(false);
      setEditingId(null);
    } catch (err) {
      setError('Fehler beim Speichern');
    }
  };

  const handleEdit = (hotel: Hotel) => {
    setFormData({
      name: hotel.name,
      location: hotel.location || '',
      region: hotel.region || ''
    });
    setEditingId(hotel.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!permissions.canDelete) return;
    if (!confirm('Hotel wirklich löschen? Alle Inventories werden ebenfalls gelöscht.')) return;

    try {
      await api.deleteHotel(id);
      await loadData();
      if (selectedHotel?.id === id) {
        setSelectedHotel(null);
      }
    } catch (err) {
      setError('Fehler beim Löschen');
    }
  };

  const handleAddInventory = async (e: React.FormEvent) => {
    if (!permissions.canCreate) return;
    e.preventDefault();
    if (!selectedHotel) return;

    try {
      await api.addHotelInventory(selectedHotel.id, inventoryForm);

      await loadData();
      setShowInventoryForm(false);
      setInventoryForm({
        roomTypeId: '',
        availableFrom: '',
        availableUntil: '',
        roomCount: 0,
        hasHalfBoard: false,
        hasSR: false
      });

      // Update selected hotel
      const updatedHotel = hotels.find(h => h.id === selectedHotel.id);
      if (updatedHotel) setSelectedHotel(updatedHotel);
    } catch (err) {
      setError('Fehler beim Hinzufügen des Inventorys');
    }
  };

  const handleDeleteInventory = async (hotelId: string, inventoryId: string) => {
    if (!permissions.canDelete) return;
    if (!confirm('Inventory wirklich löschen?')) return;

    try {
      await api.deleteHotelInventory(hotelId, inventoryId);
      await loadData();

      // Update selected hotel
      if (selectedHotel) {
        const updatedHotel = hotels.find(h => h.id === selectedHotel.id);
        if (updatedHotel) setSelectedHotel(updatedHotel);
      }
    } catch (err) {
      setError('Fehler beim Löschen');
    }
  };

  const handleCancel = () => {
    setFormData({ name: '', location: '', region: '' });
    setIsAdding(false);
    setEditingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Hotels & Zimmerkontingente</h2>
        {!isAdding && (
          <button
            onClick={() => permissions.canCreate && setIsAdding(true)}
            disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="w-5 h-5 mr-2" />
            Hotel hinzufügen
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Schließen</button>
        </div>
      )}

      {isAdding && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">
            {editingId ? 'Hotel bearbeiten' : 'Neues Hotel'}
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Hotel Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Grand Hotel Alpine"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ort
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Innsbruck"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Region
                </label>
                <input
                  type="text"
                  value={formData.region}
                  onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                  placeholder="Tirol"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {editingId ? 'Aktualisieren' : 'Erstellen'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hotels List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h3 className="text-lg font-semibold">Hotels ({hotels.length})</h3>
          </div>
          <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
            {hotels.map((hotel) => (
              <div
                key={hotel.id}
                className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedHotel?.id === hotel.id ? 'bg-blue-50' : ''
                }`}
                onClick={() => setSelectedHotel(hotel)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Building2 className="w-5 h-5 text-blue-600" />
                      <h4 className="font-semibold text-gray-900">{hotel.name}</h4>
                    </div>
                    <p className="text-sm text-gray-600">
                      {hotel.location && hotel.region
                        ? `${hotel.location}, ${hotel.region}`
                        : hotel.location || hotel.region || 'Keine Ortsinformation'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {hotel.roomInventories.length} Zimmerkontingente
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        permissions.canEdit && handleEdit(hotel);
                      }}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        permissions.canDelete && handleDelete(hotel.id);
                      }}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {hotels.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                Keine Hotels vorhanden. Fügen Sie das erste Hotel hinzu!
              </div>
            )}
          </div>
        </div>

        {/* Hotel Details & Inventories */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
            <h3 className="text-lg font-semibold">
              {selectedHotel ? `${selectedHotel.name} - Zimmerkontingente` : 'Hotel auswählen'}
            </h3>
            {selectedHotel && (
              <button
                onClick={() => setShowInventoryForm(true)}
                className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Plus className="w-4 h-4 inline mr-1" />
                Kontingent
              </button>
            )}
          </div>

          {selectedHotel ? (
            <div className="p-6 space-y-4">
              {showInventoryForm && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-semibold text-blue-900">Neues Zimmerkontingent</h4>
                    <button onClick={() => setShowInventoryForm(false)}>
                      <X className="w-5 h-5 text-blue-600" />
                    </button>
                  </div>
                  <form onSubmit={handleAddInventory}>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Zimmertyp *
                        </label>
                        <select
                          value={inventoryForm.roomTypeId}
                          onChange={(e) => setInventoryForm({ ...inventoryForm, roomTypeId: e.target.value })}
                          required
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Wählen --</option>
                          {roomTypes.map(rt => (
                            <option key={rt.id} value={rt.id}>{rt.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Anzahl Zimmer *
                        </label>
                        <input
                          type="number"
                          value={inventoryForm.roomCount || ''}
                          onChange={(e) => setInventoryForm({ ...inventoryForm, roomCount: parseInt(e.target.value) || 0 })}
                          required
                          min="1"
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Verfügbar von *
                        </label>
                        <input
                          type="date"
                          value={inventoryForm.availableFrom}
                          onChange={(e) => setInventoryForm({ ...inventoryForm, availableFrom: e.target.value })}
                          required
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Verfügbar bis *
                        </label>
                        <input
                          type="date"
                          value={inventoryForm.availableUntil}
                          onChange={(e) => setInventoryForm({ ...inventoryForm, availableUntil: e.target.value })}
                          required
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-4 mb-3">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={inventoryForm.hasHalfBoard}
                          onChange={(e) => setInventoryForm({ ...inventoryForm, hasHalfBoard: e.target.checked })}
                          className="mr-2"
                        />
                        <span className="text-sm">Halbpension (HP)</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={inventoryForm.hasSR}
                          onChange={(e) => setInventoryForm({ ...inventoryForm, hasSR: e.target.checked })}
                          className="mr-2"
                        />
                        <span className="text-sm">SR</span>
                      </label>
                    </div>
                    <button
                      type="submit"
                      className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                    >
                      Hinzufügen
                    </button>
                  </form>
                </div>
              )}

              {selectedHotel.roomInventories.length > 0 ? (
                <div className="space-y-3">
                  {selectedHotel.roomInventories.map((inv) => (
                    <div key={inv.id} className="border border-gray-200 rounded-lg p-3 hover:border-blue-300 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h5 className="font-semibold text-gray-900">{inv.roomType.name}</h5>
                          <p className="text-sm text-gray-600">
                            {inv.roomCount} Zimmer • {inv.roomType.maxPersons} Personen/Zimmer
                          </p>
                        </div>
                        <button
                          onClick={() => permissions.canDelete && handleDeleteInventory(selectedHotel.id, inv.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Calendar className="w-4 h-4" />
                        <span>
                          {new Date(inv.availableFrom).toLocaleDateString('de-DE')} - {new Date(inv.availableUntil).toLocaleDateString('de-DE')}
                        </span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        {inv.hasHalfBoard && (
                          <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">HP</span>
                        )}
                        {inv.hasSR && (
                          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">SR</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  Keine Zimmerkontingente vorhanden. Fügen Sie das erste hinzu!
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center text-gray-500">
              Wählen Sie ein Hotel aus der Liste links, um Zimmerkontingente zu verwalten.
            </div>
          )}
        </div>
      </div>

      {/* Gantt Chart */}
      {hotels.length > 0 && hotels.some(h => h.roomInventories && h.roomInventories.length > 0) && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Hotel Kontingente Timeline - Verfügbarkeit pro Tag</h3>
          <div className="overflow-x-auto">
            {(() => {
              // Get all inventories with dates
              const allInventories = hotels.flatMap(hotel =>
                (hotel.roomInventories || []).map(inv => ({
                  hotel,
                  inventory: inv,
                  startDate: new Date(inv.availableFrom),
                  endDate: new Date(inv.availableUntil),
                }))
              );

              if (allInventories.length === 0) return null;

              // Calculate date range
              const allDates = allInventories.flatMap(item => [item.startDate, item.endDate]);
              const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
              const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
              const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

              // Calculate daily availability
              const dailyBeds: number[] = new Array(totalDays).fill(0);
              allInventories.forEach(item => {
                const beds = item.inventory.roomCount * item.inventory.roomType.maxPersons;

                for (let d = 0; d < totalDays; d++) {
                  const currentDate = new Date(minDate);
                  currentDate.setDate(currentDate.getDate() + d);

                  if (currentDate >= item.startDate && currentDate <= item.endDate) {
                    dailyBeds[d] += beds;
                  }
                }
              });

              // Calculate rooms from beds: Betten / 1.5 = Zimmer
              const dailyRooms = dailyBeds.map(beds => Math.ceil(beds / 1.5));
              const dailyEZ = dailyRooms.map(rooms => Math.ceil(rooms / 2));
              const dailyDZ = dailyRooms.map(rooms => Math.ceil(rooms / 2));

              // Generate date labels
              const dateLabels: string[] = [];
              for (let i = 0; i < totalDays; i++) {
                const date = new Date(minDate);
                date.setDate(date.getDate() + i);
                dateLabels.push(date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }));
              }

              // Group by hotel
              const hotelGroups = hotels.filter(h => h.roomInventories && h.roomInventories.length > 0);

              return (
                <div className="min-w-full">
                  {/* Timeline header */}
                  <div className="flex mb-2">
                    <div className="w-64 flex-shrink-0"></div>
                    <div className="flex-1 flex">
                      {dateLabels.map((label, idx) => (
                        <div
                          key={idx}
                          className="flex-1 text-center text-xs text-gray-600 border-l border-gray-200 px-1"
                          style={{ minWidth: '40px' }}
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Hotels and their inventories */}
                  {hotelGroups.map((hotel) => {
                    const isSelectedHotel = selectedHotel?.id === hotel.id;

                    return (
                      <div key={hotel.id} className="mb-4">
                        <div className="flex items-center mb-1">
                          <div className="w-64 flex-shrink-0">
                            <p className={`text-sm font-semibold ${isSelectedHotel ? 'text-green-600' : 'text-gray-900'}`}>
                              {hotel.name}
                            </p>
                            <p className="text-xs text-gray-500">{hotel.location}, {hotel.region}</p>
                          </div>
                        </div>
                        {hotel.roomInventories?.map((inv) => {
                          const start = new Date(inv.availableFrom);
                          const end = new Date(inv.availableUntil);
                          const startOffset = Math.floor((start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
                          const duration = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                          const totalBeds = inv.roomCount * inv.roomType.maxPersons;

                          return (
                            <div key={inv.id} className="flex mb-1 items-center">
                              <div className="w-64 flex-shrink-0 pr-4 pl-4">
                                <p className="text-xs text-gray-700 truncate">{inv.roomType.name}</p>
                                <p className="text-xs text-gray-500">
                                  {inv.roomCount} Zimmer • {totalBeds} Betten
                                </p>
                              </div>
                              <div className="flex-1 relative h-8">
                                <div
                                  className={`absolute h-6 rounded flex items-center justify-center text-white text-xs font-medium transition-all cursor-pointer ${
                                    isSelectedHotel
                                      ? 'bg-green-700 ring-4 ring-green-300 shadow-lg'
                                      : 'bg-green-500 hover:bg-green-600'
                                  }`}
                                  style={{
                                    left: `${(startOffset / totalDays) * 100}%`,
                                    width: `${(duration / totalDays) * 100}%`,
                                  }}
                                  onClick={() => setSelectedHotel(hotel)}
                                >
                                  {duration}d
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* Daily Summary */}
                  <div className="mt-6 pt-4 border-t-2 border-gray-300">
                    <div className="flex mb-1">
                      <div className="w-64 flex-shrink-0 pr-4">
                        <p className="text-xs font-bold text-gray-900">Betten Gesamt</p>
                      </div>
                      <div className="flex-1 flex">
                        {dailyBeds.map((beds, idx) => (
                          <div
                            key={idx}
                            className="flex-1 text-center text-xs font-semibold border-l border-gray-200 px-1"
                            style={{ minWidth: '40px' }}
                          >
                            {beds > 0 ? beds : '-'}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex mb-1">
                      <div className="w-64 flex-shrink-0 pr-4">
                        <p className="text-xs font-semibold text-green-700">Zimmer (÷1,5)</p>
                      </div>
                      <div className="flex-1 flex">
                        {dailyRooms.map((rooms, idx) => (
                          <div
                            key={idx}
                            className="flex-1 text-center text-xs text-green-700 border-l border-gray-200 px-1"
                            style={{ minWidth: '40px' }}
                          >
                            {rooms > 0 ? rooms : '-'}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex mb-1">
                      <div className="w-64 flex-shrink-0 pr-4">
                        <p className="text-xs text-gray-600">EZ verfügbar</p>
                      </div>
                      <div className="flex-1 flex">
                        {dailyEZ.map((ez, idx) => (
                          <div
                            key={idx}
                            className="flex-1 text-center text-xs text-gray-600 border-l border-gray-200 px-1"
                            style={{ minWidth: '40px' }}
                          >
                            {ez > 0 ? ez : '-'}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex">
                      <div className="w-64 flex-shrink-0 pr-4">
                        <p className="text-xs text-gray-600">DZ verfügbar</p>
                      </div>
                      <div className="flex-1 flex">
                        {dailyDZ.map((dz, idx) => (
                          <div
                            key={idx}
                            className="flex-1 text-center text-xs text-gray-600 border-l border-gray-200 px-1"
                            style={{ minWidth: '40px' }}
                          >
                            {dz > 0 ? dz : '-'}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
