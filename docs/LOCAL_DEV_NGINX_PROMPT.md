# Separate Codex prompt for /workspace/wireguard

In `/workspace/wireguard`, inspect the active edge-nginx configuration before
editing. Do not change Incoming, Authelia, PROD/TEST vHosts or global upload limits.
Do not deploy or reload without explicit authorization.

Observed on 2026-11-06: `https://code.jokley.at/absproxy/5173/api/...` rejects
Content-Length 1048577 with nginx/1.27.5 HTTP 413, while 1048576 gets the normal
login redirect. Flask and Vite accept the larger request. The apparent source is
`infra/edge/nginx/vhosts-available/code.jokley.at.conf`, enabled by the symlink
in `vhosts-enabled` and bind-mounted by `infra/edge/docker-compose.yml`.
Confirm the actual live mount/source and effective `nginx -T` first; this Compose
file is labelled a migration candidate, so do not assume it is deployed as-is.
Do not edit the legacy `data/nginx/nginx.conf` or runtime copies blindly.

Add an exact-match location inside the existing `code.jokley.at` TLS server:

```nginx
location = /absproxy/5173/api/admin/database/import {
    client_max_body_size 100m;
    include /etc/nginx/includes/authelia-authrequest.conf;

    proxy_pass http://code-server:8080;
    proxy_http_version 1.1;
    proxy_read_timeout 300;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Retain the existing server-level Authelia include, unauthorized handler, URI,
forwarded headers and all other locations. A `proxy_pass` without a URI suffix
preserves `/absproxy/5173/...`. Do not add an unauthenticated upload exception.
Prefer only this exact DEV endpoint; do not set `client_max_body_size` globally
or for all of `code.jokley.at`. 100m includes multipart overhead; check actual
required backup sizes before choosing a larger bound.

Provide a small reviewable patch and validate nginx syntax using the real
configuration/mounts. After separately authorized reload, verify authenticated
uploads above 1 MiB and below 100 MiB, rejection above the chosen bound, unchanged
login protection, unchanged other hosts/routes and working Vite HMR. No restore,
migration, database deletion or backup cleanup is part of validation.
