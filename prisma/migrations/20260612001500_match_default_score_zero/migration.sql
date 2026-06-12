-- Matches default to 0x0: backfill any null scores, then make the columns
-- NOT NULL DEFAULT 0. "No result yet" is now driven by status, not by null.
UPDATE "matches" SET "homeScore" = 0 WHERE "homeScore" IS NULL;
UPDATE "matches" SET "awayScore" = 0 WHERE "awayScore" IS NULL;

ALTER TABLE "matches"
  ALTER COLUMN "homeScore" SET DEFAULT 0,
  ALTER COLUMN "homeScore" SET NOT NULL,
  ALTER COLUMN "awayScore" SET DEFAULT 0,
  ALTER COLUMN "awayScore" SET NOT NULL;
