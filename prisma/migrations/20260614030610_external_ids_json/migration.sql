-- Unify external-provider ids (ESPN, GE, …) into a single JSON column per entity,
-- replacing the scattered columns: teams.espnId/espnAbbr, matches.externalId,
-- competitions.espnLeagueSlug. Shapes:
--   teams.externalIds        { "espn": { "id": "2029", "code": "PAL" }, "ge": { "id": "275", "code": "PAL" } }
--   matches.externalIds      { "espn": { "id": "401841141" }, "ge": { "id": "346405" } }
--   competitions.externalIds { "espn": { "slug": "bra.1" }, "ge": { "championshipId": "<uuid>", "phase": "<slug>" } }

-- 1. Add the new JSON columns.
ALTER TABLE "teams" ADD COLUMN "externalIds" JSONB;
ALTER TABLE "matches" ADD COLUMN "externalIds" JSONB;
ALTER TABLE "competitions" ADD COLUMN "externalIds" JSONB;

-- 2. Backfill from the legacy columns (only the keys that existed). The WHERE
--    guards ensure we never build an empty {"espn":{}} object.
UPDATE "teams"
SET "externalIds" = jsonb_build_object(
  'espn', jsonb_strip_nulls(jsonb_build_object('id', "espnId", 'code', "espnAbbr"))
)
WHERE "espnId" IS NOT NULL OR "espnAbbr" IS NOT NULL;

UPDATE "matches"
SET "externalIds" = jsonb_build_object('espn', jsonb_build_object('id', "externalId"))
WHERE "externalId" IS NOT NULL;

UPDATE "competitions"
SET "externalIds" = jsonb_build_object('espn', jsonb_build_object('slug', "espnLeagueSlug"))
WHERE "espnLeagueSlug" IS NOT NULL;

-- 3. Drop the legacy columns. Dropping "espnId" also drops its UNIQUE index.
ALTER TABLE "teams" DROP COLUMN "espnId";
ALTER TABLE "teams" DROP COLUMN "espnAbbr";
ALTER TABLE "matches" DROP COLUMN "externalId";
ALTER TABLE "competitions" DROP COLUMN "espnLeagueSlug";
