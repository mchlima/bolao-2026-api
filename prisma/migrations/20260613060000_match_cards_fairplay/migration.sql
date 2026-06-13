-- Discipline (cards) on matches, captured by the ESPN robot.
-- Additive, NOT NULL with default 0 → safe for existing rows and old code.
ALTER TABLE "matches" ADD COLUMN "homeYellow"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "matches" ADD COLUMN "homeRed"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "matches" ADD COLUMN "awayYellow"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "matches" ADD COLUMN "awayRed"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "matches" ADD COLUMN "homeFairPlay" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "matches" ADD COLUMN "awayFairPlay" INTEGER NOT NULL DEFAULT 0;
