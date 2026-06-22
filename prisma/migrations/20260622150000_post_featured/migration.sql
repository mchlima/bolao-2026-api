-- Destaque editorial manual: o post marcado vira a manchete (hero) na home e em /noticias.
-- Coluna com default false, sem backfill necessário.
ALTER TABLE "posts" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- Ordenação featured-first sem varredura (featured desc + publishedAt desc no público).
CREATE INDEX "posts_featured_publishedAt_idx" ON "posts"("featured", "publishedAt");
