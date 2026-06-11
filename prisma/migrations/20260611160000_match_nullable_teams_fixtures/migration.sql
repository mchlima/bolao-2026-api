-- Make match teams optional (TBD knockout slots) + add fixture metadata
ALTER TABLE "matches" ALTER COLUMN "homeTeamId" DROP NOT NULL;
ALTER TABLE "matches" ALTER COLUMN "awayTeamId" DROP NOT NULL;
ALTER TABLE "matches" ADD COLUMN "homeSourceLabel" TEXT;
ALTER TABLE "matches" ADD COLUMN "awaySourceLabel" TEXT;
ALTER TABLE "matches" ADD COLUMN "groupName" TEXT;
ALTER TABLE "matches" ADD COLUMN "matchNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "matches_tournamentId_matchNumber_key" ON "matches"("tournamentId", "matchNumber");
