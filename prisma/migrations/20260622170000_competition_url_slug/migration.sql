-- Slug público de URL da competição (rotas /futebol/campeonato/:urlSlug).
ALTER TABLE "competitions" ADD COLUMN "urlSlug" TEXT;
CREATE UNIQUE INDEX "competitions_urlSlug_key" ON "competitions"("urlSlug");

-- Backfill das competições com temporada pública ativa (as que aparecem na nav).
UPDATE "competitions" SET "urlSlug" = 'brasileirao-serie-a' WHERE "name" = 'Brasileirão Série A' AND "urlSlug" IS NULL;
UPDATE "competitions" SET "urlSlug" = 'copa-do-mundo'       WHERE "name" = 'Copa do Mundo FIFA'  AND "urlSlug" IS NULL;
