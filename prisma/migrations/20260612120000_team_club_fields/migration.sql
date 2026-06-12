-- AlterTable: ESPN-sourced club metadata
ALTER TABLE "teams" ADD COLUMN "logoDarkUrl" TEXT,
ADD COLUMN "espnId" TEXT,
ADD COLUMN "color" TEXT,
ADD COLUMN "colorAlt" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "teams_espnId_key" ON "teams"("espnId");
