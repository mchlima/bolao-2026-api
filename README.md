# bolao-2026-api

Backend / API REST do **Bolão 2026**. NestJS + Prisma (Postgres/Supabase), containerizado com
Docker, atrás de Nginx no VPS. Contratos: ver [`bolao-2026-docs`](../bolao-2026-docs).

> Identificadores em **inglês**; mensagens de UI (pt-BR) ficam no frontend.

## Setup local

```bash
npm install
cp .env.example .env          # preencher DATABASE_URL / DIRECT_URL (Supabase, dual-URL)
npm run prisma:generate
npm run prisma:migrate        # cria a primeira migration (usa DIRECT_URL, 5432)
npm run start:dev
```

API em `http://localhost:3000/api`. Health: `GET /api/health`.

## Prisma + Supabase (dual-URL)

- `DATABASE_URL` → pooler **6543** (`?pgbouncer=true`) — runtime.
- `DIRECT_URL` → direta **5432** — apenas Prisma CLI (`migrate`/`introspect`).
- Em produção: `npm run prisma:deploy` (`prisma migrate deploy`). **Nunca `migrate dev`.**
- Prisma 6.x: conferir se a versão lê o direct URL via `prisma.config.ts`.

## Docker (VPS)

```bash
docker compose build
docker compose up -d
```

O container roda `prisma migrate deploy` no startup e sobe a API na porta 3000 (exposta só em
`127.0.0.1` para o Nginx do host — ver `nginx/api.conf`).

## Estrutura

```
prisma/schema.prisma           # schema canônico (espelha docs/database/schema.md)
src/
  main.ts                      # bootstrap: prefixo /api, ValidationPipe, filtro de erro, CORS
  app.module.ts                # ConfigModule + PrismaModule + HealthModule + (feature modules)
  prisma/                      # PrismaService global
  common/filters/              # AllExceptionsFilter (formato de erro padrão)
  health/                      # GET /api/health
```

## Ordem de construção (docs §6)

1. User + auth (JWT, role, isActive) → 2. Team/Stadium → 3. Tournament/Match →
4. Prediction + ScoringService → 5. Rankings + engagement → 6. Admin.
