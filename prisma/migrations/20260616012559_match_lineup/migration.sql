-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "awayFormation" TEXT,
ADD COLUMN     "homeFormation" TEXT;

-- CreateTable
CREATE TABLE "match_lineup_entries" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "isStarter" BOOLEAN NOT NULL,
    "jersey" TEXT,
    "position" TEXT,
    "formationPlace" INTEGER,
    "subbedIn" BOOLEAN NOT NULL DEFAULT false,
    "subbedOut" BOOLEAN NOT NULL DEFAULT false,
    "subForPlayerId" TEXT,
    "yellow" INTEGER NOT NULL DEFAULT 0,
    "red" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_lineup_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_lineup_entries_matchId_idx" ON "match_lineup_entries"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "match_lineup_entries_matchId_playerId_key" ON "match_lineup_entries"("matchId", "playerId");

-- AddForeignKey
ALTER TABLE "match_lineup_entries" ADD CONSTRAINT "match_lineup_entries_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_lineup_entries" ADD CONSTRAINT "match_lineup_entries_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_lineup_entries" ADD CONSTRAINT "match_lineup_entries_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_lineup_entries" ADD CONSTRAINT "match_lineup_entries_subForPlayerId_fkey" FOREIGN KEY ("subForPlayerId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
