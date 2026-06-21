-- AlterTable
ALTER TABLE "news_items" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "news_items_slug_key" ON "news_items"("slug");
