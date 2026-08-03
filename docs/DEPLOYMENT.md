# Deployment Guide - Freestyle WM

## 🌐 Environment-Konfiguration

Das System unterstützt verschiedene Umgebungen über `.env` Dateien.

### Environment Variables

Die wichtigste Variable ist:
```bash
VITE_API_URL=https://incoming.jokley.at/api
```

### Verfügbare .env Dateien

1. **`.env`** - Standardwerte (Production)
   ```bash
   VITE_API_URL=https://incoming.jokley.at/api
   ```

2. **`.env.development`** - Lokale Entwicklung
   ```bash
   VITE_API_URL=http://localhost:5000/api
   ```

3. **`.env.production`** - Production Build
   ```bash
   VITE_API_URL=https://incoming.jokley.at/api
   ```

### Vite nutzt automatisch:
- Im `dev` mode → `.env.development`
- Im `build` mode → `.env.production`
- Fallback → `.env`

---

## 🚀 Deployment auf incoming.jokley.at

### Vite Konfiguration

Die `vite.config.ts` ist bereits konfiguriert:

```typescript
server: {
  host: '0.0.0.0',        // Alle Interfaces
  port: 5173,              // Standard Port
  allowedHosts: [
    'incoming.jokley.at'   // Erlaubter Hostname
  ]
}
```

### Docker Setup für Production

#### 1. Environment Variables setzen

Erstellen Sie eine `.env` Datei:
```bash
VITE_API_URL=https://incoming.jokley.at/api
```

#### 2. Docker Compose anpassen

Ihre `docker-compose.yml` sollte so aussehen:

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    container_name: freestyle-wm-backend
    ports:
      - "5000:5000"
    volumes:
      - backend-data:/app/data
    environment:
      - FLASK_ENV=production
      - APP_DATA_DIR=/app/data
      - DATABASE_PATH=/app/data/freestyle_wm_new.db
    networks:
      - freestyle-network
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    container_name: freestyle-wm-frontend
    ports:
      - "5173:5173"
    environment:
      - VITE_API_URL=https://incoming.jokley.at/api
    depends_on:
      - backend
    networks:
      - freestyle-network
    restart: unless-stopped

networks:
  freestyle-network:
    driver: bridge

volumes:
  backend-data:
```

#### 3. Starten

```bash
docker-compose up -d --build
```

---

## 🔐 Nginx Reverse Proxy (Empfohlen)

Falls Sie Nginx als Reverse Proxy verwenden:

```nginx
# Frontend
server {
    listen 80;
    server_name incoming.jokley.at;

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Mit SSL (empfohlen):

```nginx
server {
    listen 443 ssl http2;
    server_name incoming.jokley.at;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name incoming.jokley.at;
    return 301 https://$server_name$request_uri;
}
```

---

## 📦 Production Build (Optional)

Wenn Sie einen statischen Build bevorzugen:

### 1. Frontend bauen
```bash
cd /workspaces/default/code
VITE_API_URL=https://incoming.jokley.at/api pnpm run build
```

### 2. Dist-Ordner serven

Mit Nginx:
```nginx
server {
    listen 80;
    server_name incoming.jokley.at;
    root /path/to/code/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:5000;
    }
}
```

Oder mit einem einfachen Server:
```bash
npx serve -s dist -p 5173
```

---

## 🔧 Troubleshooting

### Problem: CORS Errors

Stellen Sie sicher, dass das Flask Backend CORS erlaubt:

```python
# backend/app_new.py
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=['https://incoming.jokley.at'])
```

### Problem: API Calls schlagen fehl

1. Überprüfen Sie die Environment Variable:
   ```bash
   echo $VITE_API_URL
   ```

2. Im Browser Console:
   ```javascript
   console.log(import.meta.env.VITE_API_URL)
   ```

3. Testen Sie das Backend direkt:
   ```bash
   curl https://incoming.jokley.at/api/room-types
   ```

### Problem: Vite dev server ist nicht erreichbar

Überprüfen Sie:
1. `host: '0.0.0.0'` in vite.config.ts
2. `allowedHosts` enthält Ihren Hostnamen
3. Port 5173 ist geöffnet

---

## 🎯 Deployment Checkliste

- [ ] `.env` Datei mit Production API URL erstellt
- [ ] `vite.config.ts` hat `allowedHosts` konfiguriert
- [ ] Docker Container laufen (`docker-compose ps`)
- [ ] Backend ist unter `/api` erreichbar
- [ ] Frontend ist unter `/` erreichbar
- [ ] SSL Zertifikat installiert (empfohlen)
- [ ] CORS ist korrekt konfiguriert
- [ ] Firewall-Regeln erlauben Port 80/443

---

## 📊 Monitoring

### Container Status
```bash
docker-compose ps
docker-compose logs -f frontend
docker-compose logs -f backend
```

### Ressourcen
```bash
docker stats
```

### Logs
```bash
# Frontend
docker-compose logs -f --tail=100 frontend

# Backend
docker-compose logs -f --tail=100 backend
```

---

## 🔄 Updates deployen

```bash
# Code pullen
git pull

# Container neu bauen und starten
docker-compose down
docker-compose up -d --build

# Logs überprüfen
docker-compose logs -f
```

---

## 🗄️ Backup

### Datenbank sichern
```bash
# SQLite Datenbank kopieren
docker exec freestyle-wm-backend cp /app/freestyle_wm_new.db /app/backup_$(date +%Y%m%d).db

# Auf Host kopieren
docker cp freestyle-wm-backend:/app/backup_*.db ./backups/
```

### Restore
```bash
# Backup einspielen
docker cp ./backups/backup_20270427.db freestyle-wm-backend:/app/freestyle_wm_new.db

# Container neu starten
docker-compose restart backend
```

---

## 📞 Support

Bei Problemen:
1. Logs prüfen (`docker-compose logs`)
2. Environment Variables überprüfen
3. Netzwerk-Konnektivität testen
4. CORS-Konfiguration validieren
