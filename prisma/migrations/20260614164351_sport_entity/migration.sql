-- Thin Sport entity (Futebol + future sports). Competitions and teams gain a
-- required sportId (backfilled to Futebol). Global uniques become per-sport so a
-- future sport can't collide: Competition.slug and Team.countryCode.

-- 1. Sport table + the Futebol row.
CREATE TABLE "sports" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "iconUrl" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sports_slug_key" ON "sports"("slug");
INSERT INTO "sports" ("id","name","slug","order","updatedAt")
VALUES ('sport_futebol','Futebol','futebol',0, CURRENT_TIMESTAMP);

-- 2. sportId on competitions/teams: add nullable, backfill Futebol, set NOT NULL.
ALTER TABLE "competitions" ADD COLUMN "sportId" TEXT;
ALTER TABLE "teams" ADD COLUMN "sportId" TEXT;
UPDATE "competitions" SET "sportId" = 'sport_futebol';
UPDATE "teams" SET "sportId" = 'sport_futebol';
ALTER TABLE "competitions" ALTER COLUMN "sportId" SET NOT NULL;
ALTER TABLE "teams" ALTER COLUMN "sportId" SET NOT NULL;

-- 3. Swap global uniques for per-sport ones.
DROP INDEX IF EXISTS "competitions_slug_key";
DROP INDEX IF EXISTS "teams_countryCode_key";
CREATE UNIQUE INDEX "competitions_sportId_slug_key" ON "competitions"("sportId","slug");
CREATE UNIQUE INDEX "teams_sportId_countryCode_key" ON "teams"("sportId","countryCode");
CREATE INDEX "competitions_sportId_idx" ON "competitions"("sportId");
CREATE INDEX "teams_sportId_idx" ON "teams"("sportId");

-- 4. FKs.
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
