"""PostgreSQL-only backup runner and its small internal control service."""

from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import uuid
from urllib.parse import unquote

BACKUP_LOCK = threading.Lock()
RESTORE_LOCK = threading.Lock()
MAX_IMPORT_SIZE = 10 * 1024 * 1024 * 1024
BACKUP_CATEGORIES = ("automatic", "manual", "pre-restore")
BACKUPS_PER_CATEGORY = 2


class LimitedReader:
    """Expose exactly one HTTP request body instead of waiting for socket EOF."""

    def __init__(self, source, length):
        self.source = source
        self.remaining = length

    def read(self, size=-1):
        if self.remaining <= 0:
            return b""
        requested = self.remaining if size < 0 else min(size, self.remaining)
        chunk = self.source.read(requested)
        self.remaining -= len(chunk)
        return chunk


class CronSchedule:
    """Small strict five-field UTC cron parser (lists, ranges and steps)."""

    RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 6))

    def __init__(self, expression):
        fields = expression.split()
        if len(fields) != 5:
            raise ValueError('BACKUP_SCHEDULE must contain five cron fields')
        self.values = [self._parse(field, *limits) for field, limits in zip(fields, self.RANGES)]

    @staticmethod
    def _parse(field, minimum, maximum):
        values = set()
        for part in field.split(','):
            base, separator, step_text = part.partition('/')
            step = int(step_text) if separator else 1
            if step < 1:
                raise ValueError('Cron steps must be positive')
            if base == '*':
                start, end = minimum, maximum
            elif '-' in base:
                start, end = map(int, base.split('-', 1))
            else:
                start = end = int(base)
            if start < minimum or end > maximum or start > end:
                raise ValueError(f'Cron value outside {minimum}-{maximum}')
            values.update(range(start, end + 1, step))
        return values

    def next(self, after):
        candidate = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
        for _ in range(366 * 24 * 60 * 5):
            # Cron treats Sunday as 0; Python treats Monday as 0.
            cron_weekday = (candidate.weekday() + 1) % 7
            current = (candidate.minute, candidate.hour, candidate.day,
                       candidate.month, cron_weekday)
            if all(value in allowed for value, allowed in zip(current, self.values)):
                return candidate
            candidate += timedelta(minutes=1)
        raise ValueError('Cron schedule has no occurrence in the next five years')


def log(event, level="info", **fields):
    print(json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(), "level": level,
                      "event": event, **fields}, separators=(",", ":")), flush=True)


def config():
    required = ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing PostgreSQL environment variables: {', '.join(missing)}")
    return {
        "directory": Path(os.environ.get("BACKUP_DIR", "/backups")),
        "database": os.environ["POSTGRES_DB"],
        "user": os.environ["POSTGRES_USER"],
        "password": os.environ["POSTGRES_PASSWORD"],
        "host": os.environ.get("POSTGRES_HOST", "postgres"),
        "port": os.environ.get("POSTGRES_PORT", "5432"),
    }


def write_status(directory, payload):
    temporary = directory / ".last-backup.json.tmp"
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(directory / "last-backup.json")


def keep_latest_backups(directory):
    """Keep only the two newest timestamped dumps in one category."""
    dumps = sorted(directory.glob("*.dump.gz"), key=lambda item: item.stat().st_mtime,
                   reverse=True)
    for expired in dumps[BACKUPS_PER_CATEGORY:]:
        expired.unlink()
        log("backup_deleted", category=directory.name, filename=expired.name,
            reason="category_limit")


def postgres_version(settings):
    process = subprocess.run(
        ["psql", "-h", settings["host"], "-p", settings["port"], "-U", settings["user"],
         "-d", settings["database"], "-Atc", "SHOW server_version"],
        env={**os.environ, "PGPASSWORD": settings["password"]}, capture_output=True, text=True,
        check=True,
    )
    return process.stdout.strip().split(".")[0]


def create_backup(category, now=None):
    if category not in BACKUP_CATEGORIES:
        raise ValueError(f"Unknown backup category: {category}")
    if not BACKUP_LOCK.acquire(blocking=False):
        raise RuntimeError("A backup is already running")
    started = time.monotonic()
    settings = None
    try:
        settings = config()
        directory = settings["directory"] / category
        directory.mkdir(parents=True, exist_ok=True)
        created = now or datetime.now(timezone.utc)
        safe_db = re.sub(r"[^A-Za-z0-9_.-]", "_", settings["database"])
        filename = f'{safe_db}-{created.strftime("%Y-%m-%d_%H%M%S")}.dump.gz'
        target, temporary = directory / filename, directory / f".{filename}.tmp"
        command = ["pg_dump", "-h", settings["host"], "-p", settings["port"], "-U",
                   settings["user"], "--format=custom", "--no-password", settings["database"]]
        log("backup_started", database=settings["database"], filename=filename)
        with temporary.open("wb") as output:
            result = subprocess.run(command, env={**os.environ, "PGPASSWORD": settings["password"]},
                                    stdout=output, stderr=subprocess.PIPE)
        if result.returncode:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.decode(errors="replace").strip() or "pg_dump failed")
        temporary.replace(target)
        duration = round(time.monotonic() - started, 3)
        payload = {"status": "success", "created": created.isoformat().replace("+00:00", "Z"),
                   "filename": filename, "size": target.stat().st_size,
                   "category": category,
                   "durationSeconds": duration, "database": settings["database"],
                   "postgresVersion": postgres_version(settings)}
        write_status(settings["directory"], payload)
        keep_latest_backups(directory)
        log("backup_succeeded", **payload)
        return payload
    except Exception as error:
        directory = settings["directory"] if settings else Path(os.environ.get("BACKUP_DIR", "/backups"))
        directory.mkdir(parents=True, exist_ok=True)
        payload = {"status": "error", "created": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                   "durationSeconds": round(time.monotonic() - started, 3), "error": str(error)}
        write_status(directory, payload)
        log("backup_failed", level="error", **payload)
        raise
    finally:
        BACKUP_LOCK.release()


def imported_directory(settings):
    directory = settings["directory"] / ".imports"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def validate_dump(path, settings):
    """Validate the archive with PostgreSQL tooling without touching the database."""
    with path.open("rb") as archive:
        if archive.read(5) != b"PGDMP":
            raise ValueError("Die Datei ist kein gültiges PostgreSQL-Custom-Backup.")
    process = subprocess.run(
        ["pg_restore", "--list", str(path)], capture_output=True, text=True,
    )
    if process.returncode:
        raise ValueError("Die Datei ist kein gültiges PostgreSQL-Custom-Backup.")


def import_dump(source, original_name):
    settings = config()
    token = uuid.uuid4().hex
    target = imported_directory(settings) / f"{token}.dump"
    try:
        with target.open("wb") as output:
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
                if output.tell() > MAX_IMPORT_SIZE:
                    raise ValueError("Die Backupdatei ist zu groß.")
        if not target.stat().st_size:
            raise ValueError("Die ausgewählte Datei ist leer.")
        validate_dump(target, settings)
        log("backup_imported", token=token, size=target.stat().st_size)
        return {"token": token, "filename": original_name, "size": target.stat().st_size,
                "modified": datetime.now(timezone.utc).timestamp(), "local": True}
    except Exception:
        target.unlink(missing_ok=True)
        raise


def resolve_restore_source(payload, settings):
    if payload.get("token"):
        token = payload["token"]
        if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{32}", token):
            raise FileNotFoundError
        path = imported_directory(settings) / f"{token}.dump"
        return path, True
    filename = payload.get("filename", "")
    category = payload.get("category", "")
    if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.dump\.gz", filename):
        raise FileNotFoundError
    if category not in BACKUP_CATEGORIES:
        raise FileNotFoundError
    return settings["directory"] / category / filename, False


def disconnect_application(settings):
    """Release application locks immediately before the short restore window."""
    command = ["psql", "-h", settings["host"], "-p", settings["port"], "-U", settings["user"],
               "-d", settings["database"], "-v", "ON_ERROR_STOP=1", "-Atc",
               "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
               "WHERE datname = current_database() AND pid <> pg_backend_pid()"]
    process = subprocess.run(command, env={**os.environ, "PGPASSWORD": settings["password"]},
                             capture_output=True, text=True)
    if process.returncode:
        raise RuntimeError("Die Datenbank konnte nicht für die Wiederherstellung vorbereitet werden.")


def restore_backup(payload):
    """Run the one restore workflow, including its mandatory safety backup."""
    if not RESTORE_LOCK.acquire(blocking=False):
        raise RuntimeError("Eine Wiederherstellung läuft bereits.")
    imported = False
    source = None
    try:
        settings = config()
        source, imported = resolve_restore_source(payload, settings)
        if not source.is_file():
            raise FileNotFoundError
        validate_dump(source, settings)
        # This must finish successfully before pg_restore is ever invoked.
        safety_backup = create_backup("pre-restore")
        disconnect_application(settings)
        command = ["pg_restore", "-h", settings["host"], "-p", settings["port"],
                   "-U", settings["user"], "-d", settings["database"], "--clean",
                   "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error",
                   str(source)]
        result = subprocess.run(command, env={**os.environ, "PGPASSWORD": settings["password"]},
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or "Wiederherstellung fehlgeschlagen.")
        # A successful query verifies connectivity and the restored Alembic schema.
        integrity = subprocess.run(
            ["psql", "-h", settings["host"], "-p", settings["port"], "-U", settings["user"],
             "-d", settings["database"], "-Atc", "SELECT version_num FROM alembic_version"],
            env={**os.environ, "PGPASSWORD": settings["password"]}, capture_output=True, text=True)
        if integrity.returncode or not integrity.stdout.strip():
            raise RuntimeError("Die Integritätsprüfung des Backups ist fehlgeschlagen.")
        if imported:
            source.unlink(missing_ok=True)
        log("restore_succeeded", safetyBackup=safety_backup["filename"])
        return {"status": "success", "safetyBackup": safety_backup["filename"]}
    finally:
        RESTORE_LOCK.release()


class Handler(BaseHTTPRequestHandler):
    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._reply(200, {"status": "healthy"}) if self.path == "/health" else self._reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/backup":
            if BACKUP_LOCK.locked() or RESTORE_LOCK.locked():
                return self._reply(409, {"error": "backup already running"})
            threading.Thread(target=_background_backup, args=("manual",), daemon=True).start()
            return self._reply(202, {"status": "accepted"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.path == "/import":
                if length <= 0 or length > MAX_IMPORT_SIZE:
                    return self._reply(400, {"error": "INVALID_BACKUP", "message": "Die ausgewählte Backupdatei ist ungültig oder zu groß."})
                body = LimitedReader(self.rfile, length)
                return self._reply(201, import_dump(body, unquote(self.headers.get("X-Filename", "Lokales Backup"))))
            if self.path == "/restore":
                payload = json.loads(self.rfile.read(length))
                return self._reply(200, restore_backup(payload))
        except ValueError as error:
            return self._reply(400, {"error": "INVALID_BACKUP", "message": str(error)})
        except FileNotFoundError:
            return self._reply(404, {"error": "BACKUP_NOT_FOUND", "message": "Das Backup wurde nicht gefunden."})
        except RuntimeError as error:
            log("restore_failed", level="error", error=str(error))
            return self._reply(409, {"error": "RESTORE_FAILED", "message": str(error)})
        except Exception:
            log("restore_failed", level="error", error="unexpected error")
            return self._reply(500, {"error": "RESTORE_FAILED", "message": "Die Aktion konnte nicht abgeschlossen werden."})
        return self._reply(404, {"error": "not found"})

    def log_message(self, format, *args):
        log("http_request", client=self.client_address[0], message=format % args)


def _background_backup(category):
    try:
        create_backup(category)
    except Exception:
        pass


def scheduler():
    schedule = os.environ.get("BACKUP_SCHEDULE", "0 3 * * *")
    parsed = CronSchedule(schedule)  # fail fast on invalid configuration
    log("scheduler_started", schedule=schedule)
    while True:
        now = datetime.now(timezone.utc)
        delay = max(0, (parsed.next(now) - now).total_seconds())
        time.sleep(delay)
        _background_backup("automatic")


def serve():
    config()  # validate secrets before reporting healthy
    if os.environ.get("BACKUP_ENABLED", "true").lower() in {"1", "true", "yes", "on"}:
        threading.Thread(target=scheduler, daemon=True).start()
    else:
        log("scheduler_disabled")
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if action == "now":
        create_backup("manual")
    elif action == "serve":
        serve()
    else:
        raise SystemExit("Usage: backup_service.py [serve|now]")
