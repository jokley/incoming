"""PostgreSQL-only backup runner and its small internal control service."""

from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time

BACKUP_LOCK = threading.Lock()


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
        "retention": max(1, int(os.environ.get("BACKUP_RETENTION", "30"))),
    }


def write_status(directory, payload):
    temporary = directory / ".last-backup.json.tmp"
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(directory / "last-backup.json")


def apply_retention(directory, keep):
    dumps = sorted(directory.glob("*.dump.gz"), key=lambda item: item.stat().st_mtime,
                   reverse=True)
    for expired in dumps[keep:]:
        expired.unlink()
        log("backup_deleted", filename=expired.name, reason="retention")


def postgres_version(settings):
    process = subprocess.run(
        ["psql", "-h", settings["host"], "-p", settings["port"], "-U", settings["user"],
         "-d", settings["database"], "-Atc", "SHOW server_version"],
        env={**os.environ, "PGPASSWORD": settings["password"]}, capture_output=True, text=True,
        check=True,
    )
    return process.stdout.strip().split(".")[0]


def create_backup(now=None):
    if not BACKUP_LOCK.acquire(blocking=False):
        raise RuntimeError("A backup is already running")
    started = time.monotonic()
    settings = None
    try:
        settings = config()
        directory = settings["directory"]
        directory.mkdir(parents=True, exist_ok=True)
        created = now or datetime.now(timezone.utc)
        safe_db = re.sub(r"[^A-Za-z0-9_.-]", "_", settings["database"])
        filename = f'{safe_db}-{created.strftime("%Y-%m-%d_%H%M%S")}.dump.gz'
        target, temporary = directory / filename, directory / f".{filename}.tmp"
        command = ["pg_dump", "-h", settings["host"], "-p", settings["port"], "-U",
                   settings["user"], "--format=custom", "--no-password", settings["database"]]
        log("backup_started", database=settings["database"], filename=filename)
        with temporary.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as output:
            result = subprocess.run(command, env={**os.environ, "PGPASSWORD": settings["password"]},
                                    stdout=output, stderr=subprocess.PIPE)
        if result.returncode:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.decode(errors="replace").strip() or "pg_dump failed")
        temporary.replace(target)
        duration = round(time.monotonic() - started, 3)
        payload = {"status": "success", "created": created.isoformat().replace("+00:00", "Z"),
                   "filename": filename, "size": target.stat().st_size,
                   "durationSeconds": duration, "database": settings["database"],
                   "postgresVersion": postgres_version(settings)}
        write_status(directory, payload)
        apply_retention(directory, settings["retention"])
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
        if self.path != "/backup":
            return self._reply(404, {"error": "not found"})
        if BACKUP_LOCK.locked():
            return self._reply(409, {"error": "backup already running"})
        threading.Thread(target=_background_backup, daemon=True).start()
        self._reply(202, {"status": "accepted"})

    def log_message(self, format, *args):
        log("http_request", client=self.client_address[0], message=format % args)


def _background_backup():
    try:
        create_backup()
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
        _background_backup()


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
        create_backup()
    elif action == "serve":
        serve()
    else:
        raise SystemExit("Usage: backup_service.py [serve|now]")
