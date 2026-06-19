-- CreateTable
CREATE TABLE "followed_matches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followed_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "followed_matches_matchId_idx" ON "followed_matches"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "followed_matches_userId_matchId_key" ON "followed_matches"("userId", "matchId");

-- AddForeignKey
ALTER TABLE "followed_matches" ADD CONSTRAINT "followed_matches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followed_matches" ADD CONSTRAINT "followed_matches_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
