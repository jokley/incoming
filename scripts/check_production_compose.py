"""Read merged `docker compose config --format json` on stdin; print no secrets."""
import json
import sys


def validate(config, structural_only=False):
    services=config['services'];frontend=services['frontend'];backend=services['backend'];backup=services['backup']
    errors=[]
    if not structural_only:
        server_secret=(backend.get('environment') or {}).get('AUTH_PROXY_SECRET')
        backup_secret=(backup.get('environment') or {}).get('AUTH_PROXY_SECRET')
        if not server_secret or server_secret != backup_secret:
            errors.append('Backend und Backup benötigen dasselbe konfigurierte AUTH_PROXY_SECRET; Werte werden nicht ausgegeben.')
    if frontend.get('command') or frontend.get('entrypoint'):errors.append('Frontend command/entrypoint override entfernen und prüfen.')
    if frontend.get('volumes'):errors.append('Frontend-Volumes/Quellcode-Bindmounts sind im Produktionsimage nicht erlaubt.')
    if frontend.get('ports'):errors.append('Frontend darf keinen zusätzlichen öffentlichen Port veröffentlichen.')
    if (frontend.get('environment') or {}).get('VITE_API_URL'):errors.append('Veraltetes Frontend-Runtime-VITE_API_URL entfernen; das Image baut mit /api.')
    b=[v for v in backend.get('volumes',[]) if v.get('target')=='/backups']
    c=[v for v in backup.get('volumes',[]) if v.get('target')=='/backups']
    if len(b)!=1 or len(c)!=1 or b[0].get('source')!=c[0].get('source') or not b[0].get('read_only'):
        errors.append('Backend und Backup benötigen dasselbe lokale /backups-Volume, Backend read-only.')
    if (backend.get('depends_on') or {}).get('backup',{}).get('condition')!='service_healthy':errors.append('Backend muss auf den gesunden Backup-Koordinator warten.')
    if backend.get('entrypoint'):errors.append('Backend-Entrypoint-Override gegen den Restore-Startup-Guard prüfen und entfernen.')
    if not frontend.get('healthcheck'):errors.append('Frontend-Healthcheck fehlt.')
    return errors


if __name__=='__main__':
    try:errors=validate(json.load(sys.stdin), '--structural-only' in sys.argv[1:])
    except (ValueError,KeyError,TypeError):errors=['Ungültige oder unvollständige Compose-Konfiguration.']
    for error in errors:print(error,file=sys.stderr)
    if errors:raise SystemExit(1)
    print('Produktions-Compose-Prüfung erfolgreich; keine Environmentwerte ausgegeben.')
