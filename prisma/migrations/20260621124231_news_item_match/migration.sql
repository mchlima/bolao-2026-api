-- AlterTable
ALTER TABLE "news_items" ADD COLUMN     "matchId" TEXT;

-- CreateIndex
CREATE INDEX "news_items_matchId_idx" ON "news_items"("matchId");

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
