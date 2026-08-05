# Authelia authentication and authorization

Incoming trusts identity headers only when they are overwritten by the Nginx
reverse proxy. Configure the `/api/` location after `auth_request` as follows
(header names on the right are the response headers from Authelia):

```nginx
auth_request_set $auth_user $upstream_http_remote_user;
auth_request_set $auth_groups $upstream_http_remote_groups;
auth_request_set $auth_name $upstream_http_remote_name;
auth_request_set $auth_email $upstream_http_remote_email;

proxy_set_header X-Authenticated-User $auth_user;
proxy_set_header X-Authenticated-Groups $auth_groups;
proxy_set_header X-Authenticated-Name $auth_name;
proxy_set_header X-Authenticated-Email $auth_email;
proxy_set_header X-Auth-Proxy-Secret "a-long-random-value";
```

Set the exact same random value as `AUTH_PROXY_SECRET` in `incoming.env`;
`docker-compose.yml` loads this file via `env_file`, so the backend container
receives the secret without committing it. Never expose it to the frontend. If
Nginx and Incoming
are moved into a shared Docker network, also remove the backend's host port and
use `proxy_pass http://backend:5000`.

API authentication failures must remain JSON responses rather than redirects:

```nginx
location @api_unauthorized {
    default_type application/json;
    return 401 '{"error":"UNAUTHENTICATED"}';
}
```

Authelia groups map to application permissions as follows:

* `incoming-viewer`: read only.
* `incoming-editor`: read, master data changes, assignments, and imports.
* `incoming-admin` or `admin`: full access, including the audit log.

For local development only, set `AUTH_DEV_USER` and `AUTH_DEV_GROUPS`. These
variables must never be set in production.

Copy `incoming.env.example` to `incoming.env` on the server and replace `AUTH_PROXY_SECRET=change-me` with the real shared secret.
