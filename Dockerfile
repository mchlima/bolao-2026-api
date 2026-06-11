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
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3000
# Run pending migrations against DIRECT_URL, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
