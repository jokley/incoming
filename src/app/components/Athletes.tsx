import { PageLayout, PageHeader, ContentCard, PermissionButton, READ_ONLY_TOOLTIP } from './PageLayout';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Filter, Loader2, Plus, Search } from 'lucide-react';

import { api } from '../services/api';
import { Athlete } from '../types';

export function Athletes() {
  const permissions = usePermissions();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState('');
  const [nationFilter, setNationFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'changed' | 'assigned_changed'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAcknowledgeId, setSavingAcknowledgeId] = useState<string | null>(null);
  const [newAthlete, setNewAthlete] = useState<Partial<Athlete>>({
    lastname: '',
    firstname: '',
    nationCode: '',
    discipline: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const athletesData = await api.getAthletes();
      setAthletes(athletesData);
      setError(null);
    } catch (err) {
      setError('Fehler beim Laden der Daten');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const uniqueDisciplines = Array.from(new Set(athletes.map((athlete) => athlete.discipline).filter(Boolean))).sort();
  const uniqueNations = Array.from(new Set(athletes.map((athlete) => athlete.nationCode).filter(Boolean))).sort();

  const changedAthletes = useMemo(
    () => athletes.filter((athlete) => athlete.hasPendingRoomlistReview),
    [athletes]
  );
  const assignedChangedAthletes = useMemo(
    () => athletes.filter((athlete) => athlete.changeTouchesAssignment),
    [athletes]
  );

  const filteredAthletes = athletes.filter((athlete) => {
    const search = searchTerm.toLowerCase();
    const fullName = `${athlete.firstname} ${athlete.lastname}`.toLowerCase();
    const nation = (athlete.nationCode || '').toLowerCase();
    const discipline = (athlete.discipline || '').toLowerCase();
    const roomType = (athlete.roomType || '').toLowerCase();
    const hotelName = (athlete.assignment?.hotelName || '').toLowerCase();

    const matchesSearch = (
      fullName.includes(search) ||
      nation.includes(search) ||
      discipline.includes(search) ||
      roomType.includes(search) ||
      hotelName.includes(search)
    );
    const matchesDiscipline = !disciplineFilter || athlete.discipline === disciplineFilter;
    const matchesNation = !nationFilter || athlete.nationCode === nationFilter;
    const matchesReview = (
      reviewFilter === 'all' ||
      (reviewFilter === 'changed' && athlete.hasPendingRoomlistReview) ||
      (reviewFilter === 'assigned_changed' && athlete.changeTouchesAssignment)
    );

    return matchesSearch && matchesDiscipline && matchesNation && matchesReview;
  });

  const handleAddAthlete = async () => {
    if (!permissions.canCreate) return;
    if (!newAthlete.lastname || !newAthlete.firstname || !newAthlete.nationCode) {
      setError('Vorname, Nachname und Nation sind Pflichtfelder.');
      return;
    }

    try {
      await api.createAthlete({
        lastname: newAthlete.lastname,
        firstname: newAthlete.firstname,
        nationCode: newAthlete.nationCode.toUpperCase(),
        function: 'Athlete',
      });
      await loadData();
      setNewAthlete({ lastname: '', firstname: '', nationCode: '', discipline: '' });
      setIsAdding(false);
    } catch (err) {
      setError('Fehler beim Hinzufügen des Athleten');
      console.error(err);
    }
  };

  const handleAcknowledgeChange = async (athlete: Athlete) => {
    if (!permissions.canEdit) return;
    try {
      setSavingAcknowledgeId(athlete.id);
      const updated = await api.acknowledgeAthleteRoomlistChange(athlete.id);
      setAthletes((current) => current.map((entry) => (
        entry.id === athlete.id
          ? {
              ...entry,
              ...updated,
              assignment: entry.assignment,
              hasPendingRoomlistReview: false,
              changeTouchesAssignment: false,
            }
          : entry
      )));
    } catch (err) {
      setError('Änderung konnte nicht bestätigt werden');
      console.error(err);
    } finally {
      setSavingAcknowledgeId(null);
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

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Athletenverwaltung</h2>
          <p className="text-sm text-gray-500 mt-1">
            Hier sieht der Disponent sofort, welche importierten Änderungen geprüft werden müssen.
          </p>
        </div>
        <button
          onClick={() => permissions.canCreate && setIsAdding(true)}
          disabled={!permissions.canCreate} title={!permissions.canCreate ? READ_ONLY_TOOLTIP : undefined} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="w-5 h-5 mr-2" />
          Athlet hinzufügen
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Änderungen offen"
          value={changedAthletes.length}
          subtitle="Importierte Änderungen warten auf Prüfung"
          tone={changedAthletes.length > 0 ? 'amber' : 'default'}
        />
        <SummaryCard
          title="Mit Zuweisung betroffen"
          value={assignedChangedAthletes.length}
          subtitle="Hier besteht bereits Hotel- oder Zimmerbezug"
          tone={assignedChangedAthletes.length > 0 ? 'red' : 'default'}
        />
        <SummaryCard
          title="Gesamt Athleten"
          value={athletes.length}
          subtitle="Aktuell im System"
        />
      </div>

      <div className="bg-white rounded-lg shadow p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Nach Name, Nation, Disziplin, Zimmer oder Hotel suchen..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <SelectFilter
            value={disciplineFilter}
            onChange={setDisciplineFilter}
            options={uniqueDisciplines}
            placeholder="Alle Disziplinen"
          />

          <SelectFilter
            value={nationFilter}
            onChange={setNationFilter}
            options={uniqueNations}
            placeholder="Alle Nationen"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip label="Alle" active={reviewFilter === 'all'} onClick={() => setReviewFilter('all')} />
          <FilterChip label={`Nur Änderungen (${changedAthletes.length})`} active={reviewFilter === 'changed'} onClick={() => setReviewFilter('changed')} />
          <FilterChip
            label={`Zuweisung betroffen (${assignedChangedAthletes.length})`}
            active={reviewFilter === 'assigned_changed'}
            onClick={() => setReviewFilter('assigned_changed')}
            tone="red"
          />
        </div>
      </div>

      {changedAthletes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900">Änderungen aus dem letzten Import müssen geprüft werden</p>
              <p className="text-sm text-amber-800 mt-1">
                Sobald du geprüft hast, dass An-/Abreise, Zimmerwunsch oder Partner weiterhin passen, kannst du die Änderung pro Person bestätigen.
                {assignedChangedAthletes.length > 0 && ' Rot markierte Zeilen haben bereits eine bestehende Hotel- oder Zimmerzuweisung.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {isAdding && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Neuer Athlet</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <input
              type="text"
              placeholder="Vorname"
              value={newAthlete.firstname || ''}
              onChange={(event) => setNewAthlete({ ...newAthlete, firstname: event.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              placeholder="Nachname"
              value={newAthlete.lastname || ''}
              onChange={(event) => setNewAthlete({ ...newAthlete, lastname: event.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              placeholder="Nation (z.B. AUT)"
              value={newAthlete.nationCode || ''}
              onChange={(event) => setNewAthlete({ ...newAthlete, nationCode: event.target.value.toUpperCase() })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              placeholder="Disziplin (optional)"
              value={newAthlete.discipline || ''}
              onChange={(event) => setNewAthlete({ ...newAthlete, discipline: event.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={permissions.canCreate ? handleAddAthlete : undefined}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Speichern
            </button>
            <button
              onClick={() => {
                setIsAdding(false);
                setNewAthlete({ lastname: '', firstname: '', nationCode: '', discipline: '' });
              }}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <HeaderCell>Name / Status</HeaderCell>
              <HeaderCell>Nation</HeaderCell>
              <HeaderCell>Disziplin</HeaderCell>
              <HeaderCell>Funktion</HeaderCell>
              <HeaderCell>Import-Änderung</HeaderCell>
              <HeaderCell>Zuweisung</HeaderCell>
              <HeaderCell>Wunsch aus Import</HeaderCell>
              <HeaderCell>Aktion</HeaderCell>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredAthletes.length > 0 ? (
              filteredAthletes.map((athlete) => {
                const hasPendingReview = Boolean(athlete.hasPendingRoomlistReview);
                const assignedAndChanged = Boolean(athlete.changeTouchesAssignment);
                const assignment = athlete.assignment;
                const rowClassName = assignedAndChanged
                  ? 'bg-red-50 hover:bg-red-100'
                  : hasPendingReview
                    ? 'bg-amber-50 hover:bg-amber-100'
                    : 'hover:bg-gray-50';

                return (
                  <tr key={athlete.id} className={rowClassName}>
                    <td className="px-6 py-4 align-top text-sm font-medium text-gray-900">
                      <div className="space-y-2">
                        <div>{athlete.firstname} {athlete.lastname}</div>
                        <div className="flex flex-wrap gap-1">
                          {athlete.missingFromLatestAthletesImport && <StatusBadge text="Nicht in letzter Athletenliste" tone="red" />}
                          {athlete.missingFromLatestRoomlistImport && <StatusBadge text="Nicht in letzter Roomlist" tone="orange" />}
                          {hasPendingReview && <StatusBadge text="Prüfung offen" tone={assignedAndChanged ? 'red' : 'amber'} />}
                          {!hasPendingReview && athlete.roomlistChangeAcknowledgedAt && <StatusBadge text="Änderung bestätigt" tone="green" />}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top whitespace-nowrap text-sm text-gray-600">{athlete.nationCode}</td>
                    <td className="px-6 py-4 align-top whitespace-nowrap text-sm text-gray-600">{athlete.discipline || '-'}</td>
                    <td className="px-6 py-4 align-top whitespace-nowrap text-sm text-gray-600">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">
                        {athlete.function || 'Athlete'}
                      </span>
                    </td>
                    <td className="px-6 py-4 align-top text-sm text-gray-700">
                      {hasPendingReview ? (
                        <div className="space-y-1">
                          <div className="font-medium text-gray-900">{translateChangeSummary(athlete.roomlistChangeSummary)}</div>
                          <div>Anreise: {formatDate(athlete.arrivalDate)}</div>
                          <div>Abreise: {formatDate(athlete.departureDate)}</div>
                          <div>Zimmerwunsch: {athlete.roomType || '-'}</div>
                          <div>Partner: {athlete.sharedWithName || '-'}</div>
                        </div>
                      ) : (
                        <span className="text-gray-500">Keine offene Änderung</span>
                      )}
                    </td>
                    <td className="px-6 py-4 align-top text-sm text-gray-700">
                      {assignment?.hasAssignment ? (
                        <div className="space-y-1">
                          <div className="font-medium text-gray-900">{assignment.hotelName || 'Hotel zugewiesen'}</div>
                          <div>Zimmer: {assignment.roomNumber || 'noch keine Nummer'} · {assignment.roomTypeName || '-'}</div>
                          <div>{formatDate(assignment.checkInDate)} – {formatDate(assignment.checkOutDate)}</div>
                          {assignedAndChanged && (
                            <div className="text-red-700 font-medium">
                              Achtung: Import-Änderung betrifft bestehende Zuweisung
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-500">Noch keine Hotel-/Zimmerzuweisung</span>
                      )}
                    </td>
                    <td className="px-6 py-4 align-top text-sm text-gray-700">
                      <div className="space-y-1">
                        <div>{athlete.roomType || '-'}</div>
                        <div>{athlete.sharedWithName || 'kein Partnerwunsch'}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top whitespace-nowrap text-sm text-gray-700">
                      {hasPendingReview ? (
                        <button
                          onClick={() => handleAcknowledgeChange(athlete)}
                          disabled={savingAcknowledgeId === athlete.id}
                          className="inline-flex items-center px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          {savingAcknowledgeId === athlete.id ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                          )}
                          Änderung bestätigen
                        </button>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                  Keine Athleten gefunden. Versuche andere Filter oder Suchbegriffe.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {filteredAthletes.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
            {filteredAthletes.length} von {athletes.length} Athleten angezeigt
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  tone = 'default',
}: {
  title: string;
  value: number;
  subtitle: string;
  tone?: 'default' | 'amber' | 'red';
}) {
  const className = tone === 'red'
    ? 'border-red-200 bg-red-50'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50'
      : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
      <div className="text-sm text-gray-600 mt-1">{subtitle}</div>
    </div>
  );
}

function SelectFilter({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  tone = 'default',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: 'default' | 'red';
}) {
  const className = active
    ? tone === 'red'
      ? 'bg-red-600 text-white border-red-600'
      : 'bg-blue-600 text-white border-blue-600'
    : tone === 'red'
      ? 'bg-white text-red-700 border-red-200'
      : 'bg-white text-gray-700 border-gray-200';
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${className}`}
    >
      {label}
    </button>
  );
}

function HeaderCell({ children }: { children: ReactNode }) {
  return (
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      {children}
    </th>
  );
}

function StatusBadge({
  text,
  tone,
}: {
  text: string;
  tone: 'red' | 'orange' | 'amber' | 'green';
}) {
  const className = {
    red: 'bg-red-100 text-red-700 border-red-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
    green: 'bg-green-100 text-green-700 border-green-200',
  }[tone];
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] border ${className}`}>
      {text}
    </span>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('de-DE');
}

function translateChangeSummary(summary?: string | null) {
  if (!summary) return 'Importdaten wurden geändert';
  return summary
    .replace('changed:', 'Geändert:')
    .replace('arrivalDate', 'Anreise')
    .replace('departureDate', 'Abreise')
    .replace('roomType', 'Zimmertyp')
    .replace('sharedWithName', 'Zimmerpartner')
    .replace('firstMeal', 'erste Mahlzeit')
    .replace('lastMeal', 'letzte Mahlzeit')
    .replace('specialMeal', 'Sonderverpflegung');
}
