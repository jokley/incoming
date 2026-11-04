# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app/frontend
# Optional CA mount is used only by isolated build infrastructure, never copied.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm install -g pnpm@10.30.3
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; pnpm install --frozen-lockfile
COPY frontend/ ./
COPY public/ /app/public/
ENV VITE_API_URL=/api
RUN pnpm run typecheck && pnpm run build

FROM nginx:1.28-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 5173
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -Y off -q --spider http://127.0.0.1:5173/health || exit 1
