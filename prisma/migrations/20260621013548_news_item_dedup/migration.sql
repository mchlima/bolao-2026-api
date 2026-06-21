-- AlterTable
ALTER TABLE "news_items" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "eventKey" TEXT;

-- CreateIndex
CREATE INDEX "news_items_eventKey_idx" ON "news_items"("eventKey");

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "news_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
