-- CreateTable
CREATE TABLE "news_feeds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultToneId" TEXT,
    "fetchIntervalMin" INTEGER NOT NULL DEFAULT 15,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_tones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "promptText" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_tones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_items" (
    "id" TEXT NOT NULL,
    "feedId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceGuid" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceSummary" TEXT,
    "publishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "relevanceScore" DOUBLE PRECISION,
    "relevanceReason" TEXT,
    "facts" JSONB,
    "toneId" TEXT,
    "toneSnapshot" TEXT,
    "toneVersion" INTEGER,
    "generatedText" TEXT,
    "model" TEXT,
    "error" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_revisions" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "guidance" TEXT,
    "generatedText" TEXT NOT NULL,
    "toneSnapshot" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_feeds_url_key" ON "news_feeds"("url");

-- CreateIndex
CREATE INDEX "news_feeds_isActive_idx" ON "news_feeds"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "news_tones_slug_key" ON "news_tones"("slug");

-- CreateIndex
CREATE INDEX "news_items_status_createdAt_idx" ON "news_items"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "news_items_feedId_sourceGuid_key" ON "news_items"("feedId", "sourceGuid");

-- CreateIndex
CREATE INDEX "news_revisions_itemId_idx" ON "news_revisions"("itemId");

-- AddForeignKey
ALTER TABLE "news_feeds" ADD CONSTRAINT "news_feeds_defaultToneId_fkey" FOREIGN KEY ("defaultToneId") REFERENCES "news_tones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "news_feeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_toneId_fkey" FOREIGN KEY ("toneId") REFERENCES "news_tones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_revisions" ADD CONSTRAINT "news_revisions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "news_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
