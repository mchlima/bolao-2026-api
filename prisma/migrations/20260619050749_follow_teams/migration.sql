-- CreateTable
CREATE TABLE "followed_teams" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followed_teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "followed_teams_teamId_idx" ON "followed_teams"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "followed_teams_userId_teamId_key" ON "followed_teams"("userId", "teamId");

-- AddForeignKey
ALTER TABLE "followed_teams" ADD CONSTRAINT "followed_teams_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followed_teams" ADD CONSTRAINT "followed_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
