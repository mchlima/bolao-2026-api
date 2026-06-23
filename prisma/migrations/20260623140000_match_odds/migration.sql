-- Pre-match win probability (1X2) derived from ESPN betting odds, for the match preview.
ALTER TABLE "matches" ADD COLUMN "oddsHomePct" DOUBLE PRECISION;
ALTER TABLE "matches" ADD COLUMN "oddsDrawPct" DOUBLE PRECISION;
ALTER TABLE "matches" ADD COLUMN "oddsAwayPct" DOUBLE PRECISION;
ALTER TABLE "matches" ADD COLUMN "oddsProvider" TEXT;
ALTER TABLE "matches" ADD COLUMN "oddsUpdatedAt" TIMESTAMP(3);
