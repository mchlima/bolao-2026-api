-- Per-account display timezone (backfills existing rows with the default)
ALTER TABLE "users" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
