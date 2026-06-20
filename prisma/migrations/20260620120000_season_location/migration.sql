-- Host location of a season edition (e.g. "Estados Unidos, Canadá e México").
-- Feeds the SportsEvent (superEvent) structured data on match pages. Nullable;
-- falls back to the competition country when empty.
ALTER TABLE "seasons" ADD COLUMN "location" TEXT;

-- Seed the host for the 2026 World Cup edition so its SportsEvent is valid out of
-- the box (admin can edit it later). Only touches rows that still have no location.
UPDATE "seasons"
SET "location" = 'Estados Unidos, Canadá e México'
WHERE "location" IS NULL AND "name" ILIKE '%copa do mundo%2026%';
