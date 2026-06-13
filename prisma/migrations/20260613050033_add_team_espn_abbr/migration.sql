-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_awayTeamId_fkey";

-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_homeTeamId_fkey";

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "espnAbbr" TEXT;

-- Backfill: ESPN's abbreviation stays the stable score-matching key, so shortName
-- becomes display-only and can be localized (pt-BR) without breaking the robot.
UPDATE "teams" SET "espnAbbr" = "shortName" WHERE "espnAbbr" IS NULL;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
