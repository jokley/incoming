# Freestyle WM 2027 - Event Management System

⛷️ Event-Management-Software für die Organisation der Freestyle-Weltmeisterschaft 2027 🏂

Event-Management-Software für die Organisation der Freestyle-Weltmeisterschaft mit Athletenverwaltung, Hotelzuweisungen, CSV-Import und professionellen Analysen.

⚠️ **WICHTIG**: Dieses System wurde komplett neu strukturiert basierend auf der Tabellenstruktur aus `hotel-zimmer-preise.csv`. Siehe `docs/SETUP.md` für Details.

## 🏗️ Architektur

- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Flask (Python) + SQLAlchemy
- **Datenbank**: SQLite
- **Deployment**: Docker Compose

## 🚀 Installation & Start

### Mit Docker Compose (empfohlen)

```bash
# Alle Services starten
docker-compose up --build

# Frontend: http://localhost:5173
# Backend API: http://localhost:5000/api
```

### Lokale Entwicklung

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Linux/Mac
# oder
python -m venv venv    # Windows

pip install -r requirements.txt
python seed_data.py       # Datenbank initialisieren
```

#### Frontend

```bash
# Im Hauptverzeichnis
pnpm install
cp incoming.env.example .env
pnpm run dev
```

## 📁 Projektstruktur

```
.
├── backend/
│   ├── app.py              # Flask Backend mit allen API Endpoints
│   ├── models.py           # Persistenzmodelle
│   ├── seed_data.py        # Datenbank-Initialisierung mit Beispieldaten
│   ├── requirements.txt
│   ├── Dockerfile
│   └── data/               # Persistente SQLite-Daten im Container
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx       # Haupt-Dashboard
│   │   │   ├── Athletes.tsx        # Athletenverwaltung
│   │   │   ├── Hotels.tsx          # Hotelverwaltung
│   │   │   ├── Assignments.tsx     # Zuweisungen
│   │   │   ├── Events.tsx          # Events & Gantt Chart
│   │   │   ├── RoomOccupancy.tsx   # Zimmerbelegung
│   │   │   └── Layout.tsx          # Navigation
│   │   ├── services/
│   │   │   └── api.ts             # API Service Layer
│   │   ├── data/
│   │   │   └── mockData.ts        # Mock-Daten (falls Backend offline)
│   │   ├── types.ts               # TypeScript Typen
│   │   └── routes.tsx             # React Router Konfiguration
│   └── styles/
├── docker-compose.yml
├── Dockerfile.frontend
└── README.md
```

Die Verantwortlichkeiten und Abhängigkeitsregeln der Module sind in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) dokumentiert.

## 🔌 API Endpoints

### Athleten
- `GET /api/athletes` - Alle Athleten abrufen
- `POST /api/athletes` - Neuen Athleten erstellen (Body: name, nation, discipline)
- `PUT /api/athletes/:id` - Athlet aktualisieren
- `DELETE /api/athletes/:id` - Athlet löschen

### Hotels
- `GET /api/hotels` - Alle Hotels abrufen
- `POST /api/hotels` - Neues Hotel erstellen (Body: name, location, region, singleRooms, doubleRooms, roomCategories)
- `PUT /api/hotels/:id` - Hotel aktualisieren
- `DELETE /api/hotels/:id` - Hotel löschen

### Zuweisungen
- `POST /api/assignments` - Athlet einem Hotel zuweisen (Body: athleteId, hotelId, roomType)
- `DELETE /api/assignments/:athleteId` - Zuweisung entfernen

### Events
- `GET /api/events` - Alle Events abrufen
- `POST /api/events` - Neues Event erstellen (Body: name, discipline, startDate, endDate, targetQuota)
- `PUT /api/events/:id` - Event aktualisieren
- `DELETE /api/events/:id` - Event löschen

### Statistiken
- `GET /api/statistics` - Dashboard-Statistiken abrufen (inkl. Zimmerbelegung)

## 🌐 Features

- **Dashboard**: 
  - Übersicht mit Statistiken, Charts nach Nation/Disziplin
  - Detaillierte Zimmerbelegung (EZ/DZ) mit Auslastungsvisualisierung
  - Hotel-Auslastung mit Kapazitätsübersicht
  
- **Athletenverwaltung**: 
  - CRUD-Operationen, Suche, Filterung
  - Zuordnung zu Einzelzimmern (EZ) oder Doppelzimmern (DZ)
  
- **Hotelverwaltung**: 
  - Getrennte Verwaltung von Einzelzimmern und Doppelzimmern
  - Ort und Region Attribute
  - Zimmerkategorien (z.B. "1x DZ + DU", "2x DZ + 2x DU")
  - Auslastungsanzeige und Kapazitätsmanagement
  
- **Zuweisungen**: 
  - Zimmertyp-basierte Zuweisung (50/50 Regel: EZ/DZ)
  - Kapazitätsprüfung nach Zimmertyp
  - Übersicht aller Zuweisungen
  
- **Events & Timeline**:
  - Gantt Chart für zeitlichen Verlauf der Veranstaltungen
  - Soll/Ist-Kontingente nach Disziplin
  - Farbcodierte Status-Anzeige (grün ≥100%, gelb 75-99%, orange 50-74%, rot <50%)
  - Event-Verwaltung mit Start/End-Datum

## 🛠️ Technologie-Stack

### Frontend
- React 18
- TypeScript
- Tailwind CSS v4
- React Router v7
- Recharts (Diagramme)
- Lucide React (Icons)

### Backend
- Flask 3.0
- SQLAlchemy (ORM)
- SQLite
- Flask-CORS

## 📦 Docker

Die Anwendung läuft in zwei Containern im gleichen Docker-Netzwerk:

- **backend**: Flask API (Port 5000)
- **frontend**: Vite Dev Server (Port 5173)

Persistente Daten werden im Volume `backend-data` gespeichert.

## 🔧 Konfiguration

### Environment Variables

Das System nutzt Vite Environment Variables:

**Lokal (Development):**
```env
VITE_API_URL=http://localhost:5000/api
```

**Production:**
```env
VITE_API_URL=https://incoming.jokley.at/api
```

Dateien:
- `.env.development` - Lokale Entwicklung
- `.env.production` - Production Build
- `.env` - Fallback (Production)

Siehe `docs/DEPLOYMENT.md` für Details zum Production-Setup.

## 💡 Zimmerverwaltung - 50/50 Regel

Die Anwendung unterstützt die 50/50 Regel für Zimmerbelegung:

- **Einzelzimmer (EZ)**: 1 Athlet pro Zimmer
- **Doppelzimmer (DZ)**: Bis zu 2 Athleten pro Zimmer

**Beispielrechnung:**
- 50 Doppelzimmer = bis zu 100 Athleten
- 25 Einzelzimmer = 25 Athleten
- **Gesamt: 125 Athleten Kapazität**

Pro Nation und Disziplin wird eine 50/50 Verteilung (EZ/DZ) angestrebt.

## 📊 Zimmerkategorien

Hotels können verschiedene Zimmerkategorien definieren:

- `1x DZ + DU` - 1 Doppelzimmer mit 1 Dusche
- `2x DZ + 2x DU` - 2 Doppelzimmer mit 2 Duschen
- `1x EZ + DU` - 1 Einzelzimmer mit 1 Dusche

Jede Kategorie kann Ausstattungsmerkmale haben (TV, WLAN, Balkon, etc.).

## 🆕 Neue Architektur (v2.0)

Das System wurde komplett neu strukturiert:

### Datenbankmodell
- **RoomType** - Zimmertypen mit MaxPersonen
- **Hotel + HotelRoomInventory** - Hotels mit Zimmern pro Zeitraum
- **Event + EventRoomDemand** - Events mit Bedarf
- **Athlete** - Athleten mit allen Details
- **RoomAssignment** - Zimmerzuteilungen

### CSV Import
Importieren Sie alle Daten aus einer CSV-Datei über `/import`

### Analysen
Detaillierte Auswertungen unter `/analytics`:
- Verfügbarkeit vs. Bedarf pro Zimmertyp
- Betten-Kapazität Berechnungen
- Status-Übersicht (ausreichend/fehlend)

Siehe `docs/SETUP.md` für vollständige Dokumentation!

## SQLite → PostgreSQL ETL

Der manuelle, transaktionale Datenimport inklusive Dry Run, Backup-, Cutover-
und Rollback-Verfahren ist in [`docs/SQLITE_POSTGRES_ETL.md`](docs/SQLITE_POSTGRES_ETL.md)
dokumentiert. Er wird niemals beim Anwendungsstart ausgeführt.

## 📝 Lizenz

MIT
