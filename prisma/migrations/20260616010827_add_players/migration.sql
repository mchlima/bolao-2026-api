-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "position" TEXT,
    "photoUrl" TEXT,
    "status" TEXT,
    "espnId" TEXT,
    "cartolaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_espnId_key" ON "players"("espnId");

-- CreateIndex
CREATE UNIQUE INDEX "players_cartolaId_key" ON "players"("cartolaId");

-- CreateIndex
CREATE INDEX "players_teamId_idx" ON "players"("teamId");

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
