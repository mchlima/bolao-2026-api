-- Curated broadcasters (rights holders) for a Season edition, e.g.
-- [{ "name": "CazéTV", "url": "https://www.youtube.com/@CazeTV" }]. Display-only,
-- feeds the public match page "onde assistir". Nullable; null/empty = none.
ALTER TABLE "seasons" ADD COLUMN "broadcasters" JSONB;
