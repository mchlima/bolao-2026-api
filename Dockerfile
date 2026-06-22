# syntax=docker/dockerfile:1

# ─────────────── Stage 1: build ───────────────
FROM node:22-slim AS build
# Prisma needs openssl on Debian slim images
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build
# Prune dev deps for a lean runtime node_modules (keeps generated Prisma client)
RUN npm prune --omit=dev

# ─────────────── Stage 2: runtime ───────────────
FROM node:22-slim AS runtime
# openssl: Prisma. postgresql-client-17: the daily BackupService runs pg_dump,
# which must match the v17 server — Debian's default client is v15, so pull v17
# from the PostgreSQL APT repo (PGDG). fontconfig + fonts-liberation: server-side
# match-cover rendering (sharp/librsvg) needs a font installed to draw the text.
RUN apt-get update -y && apt-get install -y openssl curl ca-certificates fontconfig fonts-liberation \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
       https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update -y && apt-get install -y postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3000
# Run pending migrations against DIRECT_URL, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
