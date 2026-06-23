-- Slug de SEO do jogo (ex.: "brasil-x-franca-2026-06-22"), derivado de times+data.
-- Nullable enquanto os times do mata-mata não resolvem; único. Populado por
-- ensureMatchSlug (create/update/resolver) + backfill (script backfill-match-slugs).
ALTER TABLE "matches" ADD COLUMN "slug" TEXT;

CREATE UNIQUE INDEX "matches_slug_key" ON "matches"("slug");
