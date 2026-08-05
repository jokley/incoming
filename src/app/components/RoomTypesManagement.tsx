import { PageLayout, PageHeader, ContentCard, PermissionButton, READ_ONLY_TOOLTIP } from './PageLayout';
import { useState, useEffect } from 'react';
import { usePermissions } from '../auth/AuthProvider';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

interface RoomType {
  id: string;
  name: string;
  maxPersons: number;
}

export function RoomTypesManagement() {
  const permissions = usePermissions();
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', maxPersons: 2 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/room-types`);
      if (!response.ok) throw new Error('Failed to load');
      const data = await response.json();
      setRoomTypes(data);
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
      const url = editingId
        ? `${API_BASE_URL}/room-types/${editingId}`
        : `${API_BASE_URL}/room-types`;

      const response = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error('Failed to save');

      await loadData();
      setFormData({ name: '', maxPersons: 2 });
      setIsAdding(false);
      setEditingId(null);
    } catch (err) {
      setError('Fehler beim Speichern');
    }
  };

  const handleEdit = (roomType: RoomType) => {
    setFormData({ name: roomType.name, maxPersons: roomType.maxPersons });
    setEditingId(roomType.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!permissions.canDelete) return;
    if (!confirm('Zimmertyp wirklich löschen?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/room-types/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete');
      await loadData();
    } catch (err) {
      setError('Fehler beim Löschen');
    }
  };

  const handleCancel = () => {
    setFormData({ name: '', maxPersons: 2 });
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
        <h2 className="text-2xl font-bold text-gray-900">Zimmertypen</h2>
        {!isAdding && (
          <button
            onClick={() => permissions.canCreate && setIsAdding(true)}
            disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="w-5 h-5 mr-2" />
            Zimmertyp hinzufügen
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {isAdding && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">
            {editingId ? 'Zimmertyp bearbeiten' : 'Neuer Zimmertyp'}
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name (z.B. "DZ / DU")
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="DZ / DU"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max. Personen
                </label>
                <input
                  type="number"
                  value={formData.maxPersons}
                  onChange={(e) => setFormData({ ...formData, maxPersons: parseInt(e.target.value) || 0 })}
                  required
                  min="1"
                  max="10"
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

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Max. Personen</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Aktionen</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {roomTypes.map((rt) => (
              <tr key={rt.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {rt.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                  {rt.maxPersons}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => permissions.canEdit && handleEdit(rt)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => permissions.canDelete && handleDelete(rt.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {roomTypes.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Keine Zimmertypen vorhanden. Fügen Sie den ersten hinzu!
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 Beispiele für Zimmertypen</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li><strong>DZ / DU</strong> - Doppelzimmer mit Dusche (2 Personen)</li>
          <li><strong>EZ / DU</strong> - Einzelzimmer mit Dusche (1 Person)</li>
          <li><strong>APP: 2 DZ + 2 DU</strong> - Apartment mit 2 Doppelzimmern (4 Personen)</li>
          <li><strong>3BZ / DU</strong> - 3-Bett-Zimmer mit Dusche (2 Personen)</li>
        </ul>
      </div>
    </div>
  );
}
