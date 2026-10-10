FROM node:20-slim

WORKDIR /app/frontend

RUN npm install -g pnpm@10.30.3

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy only frontend-owned files. Root environment files and secrets are excluded.
COPY frontend/ ./

EXPOSE 5173
CMD ["pnpm", "run", "dev", "--", "--host", "0.0.0.0"]
