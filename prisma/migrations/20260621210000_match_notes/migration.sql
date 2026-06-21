-- CreateTable
CREATE TABLE "match_notes" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_notes_matchId_idx" ON "match_notes"("matchId");

-- AddForeignKey
ALTER TABLE "match_notes" ADD CONSTRAINT "match_notes_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
