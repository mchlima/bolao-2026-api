-- URL-safe slug derivado do nome do time, p/ a página pública /futebol/selecoes/:slug.
-- Único global (NULLs múltiplos permitidos); preenchido por backfill após o ALTER.
ALTER TABLE "teams" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");
