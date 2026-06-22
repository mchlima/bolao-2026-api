-- Slug público do torneio (sem "FIFA"), p/ /futebol/torneios/:slug. Único global.
ALTER TABLE "seasons" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "seasons_slug_key" ON "seasons"("slug");
