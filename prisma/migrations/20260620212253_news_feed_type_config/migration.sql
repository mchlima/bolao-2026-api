-- AlterTable
ALTER TABLE "news_feeds" ADD COLUMN     "config" JSONB,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'RSS';
