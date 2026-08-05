import { PageLayout, PageHeader, ContentCard, PermissionButton, READ_ONLY_TOOLTIP } from './PageLayout';
import { useState, useEffect } from 'react';
import { usePermissions } from '../auth/AuthProvider';
import { Plus, Building2, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { Hotel } from '../types';

export function Hotels() {
  const permissions = usePermissions();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newHotel, setNewHotel] = useState<Partial<Hotel>>({
    name: '',
    location: '',
    region: '',
    singleRooms: 0,
    doubleRooms: 0,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await api.getHotels();
      setHotels(data);
      setError(null);
    } catch (err) {
      setError('Fehler beim Laden der Hotels');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddHotel = async () => {
    if (!permissions.canCreate) return;
    if (newHotel.name && (newHotel.singleRooms || newHotel.doubleRooms)) {
      try {
        await api.createHotel({
          name: newHotel.name,
          location: newHotel.location,
          region: newHotel.region,
          singleRooms: newHotel.singleRooms || 0,
          doubleRooms: newHotel.doubleRooms || 0,
        });
        await loadData();
        setNewHotel({ name: '', location: '', region: '', singleRooms: 0, doubleRooms: 0 });
        setIsAdding(false);
      } catch (err) {
        setError('Fehler beim Hinzufügen des Hotels');
        console.error(err);
      }
    }
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
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Hotelverwaltung</h2>
        <button
          onClick={() => permissions.canCreate && setIsAdding(true)}
          disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="w-5 h-5 mr-2" />
          Hotel hinzufügen
        </button>
      </div>

      {isAdding && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Neues Hotel</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <input
              type="text"
              placeholder="Hotelname"
              value={newHotel.name}
              onChange={(e) => setNewHotel({ ...newHotel, name: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              placeholder="Ort"
              value={newHotel.location}
              onChange={(e) => setNewHotel({ ...newHotel, location: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              placeholder="Region"
              value={newHotel.region}
              onChange={(e) => setNewHotel({ ...newHotel, region: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="number"
              placeholder="Einzelzimmer (EZ)"
              value={newHotel.singleRooms || ''}
              onChange={(e) => setNewHotel({ ...newHotel, singleRooms: parseInt(e.target.value) || 0 })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="number"
              placeholder="Doppelzimmer (DZ)"
              value={newHotel.doubleRooms || ''}
              onChange={(e) => setNewHotel({ ...newHotel, doubleRooms: parseInt(e.target.value) || 0 })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={permissions.canCreate ? handleAddHotel : undefined}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Speichern
            </button>
            <button
              onClick={() => {
                setIsAdding(false);
                setNewHotel({ name: '', capacity: 0, assignedCount: 0 });
              }}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {hotels.map((hotel) => {
          const occupancyPercent = (hotel.assignedCount / hotel.capacity) * 100;
          return (
            <div key={hotel.id} className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 text-white">
                <div className="flex items-center gap-3">
                  <Building2 className="w-8 h-8" />
                  <div>
                    <h3 className="text-xl font-semibold">{hotel.name}</h3>
                    <p className="text-sm opacity-90">{hotel.location} • {hotel.region}</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Einzelzimmer</p>
                      <p className="text-lg font-bold text-gray-900">{hotel.singleRooms}</p>
                      <p className="text-xs text-blue-600">{hotel.assignedSingle} belegt</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Doppelzimmer</p>
                      <p className="text-lg font-bold text-gray-900">{hotel.doubleRooms}</p>
                      <p className="text-xs text-purple-600">{hotel.assignedDouble} / {hotel.doubleRooms * 2} Plätze</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-gray-600">Gesamt Kapazität</span>
                    <span className="text-2xl font-bold text-gray-900">{capacity}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Belegt</span>
                    <span className="text-2xl font-bold text-blue-600">{occupied}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Verfügbar</span>
                    <span className="text-2xl font-bold text-green-600">
                      {capacity - occupied}
                    </span>
                  </div>
                  <div className="pt-4">
                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                      <span>Auslastung</span>
                      <span>{occupancyPercent.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          occupancyPercent > 80
                            ? 'bg-red-500'
                            : occupancyPercent > 50
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${occupancyPercent}%` }}
                      />
                    </div>
                  </div>

                  {hotel.roomCategories && hotel.roomCategories.length > 0 && (
                    <div className="pt-4 border-t">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Zimmerkategorien:</p>
                      <div className="space-y-1">
                        {hotel.roomCategories.map((cat) => (
                          <div key={cat.id} className="flex justify-between text-xs">
                            <span className="text-gray-600">{cat.name}</span>
                            <span className="font-medium text-gray-900">{cat.count}x</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
