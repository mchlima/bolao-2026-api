-- CreateTable
CREATE TABLE "match_stats" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_stats_matchId_idx" ON "match_stats"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "match_stats_matchId_teamId_key_key" ON "match_stats"("matchId", "teamId", "key");

-- AddForeignKey
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
