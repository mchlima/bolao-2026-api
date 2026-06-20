-- CreateEnum
CREATE TYPE "PoolRunStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "pool_runs" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "label" TEXT,
    "status" "PoolRunStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pool_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pool_runs_poolId_idx" ON "pool_runs"("poolId");

-- CreateIndex
CREATE INDEX "pool_runs_seasonId_idx" ON "pool_runs"("seasonId");

-- AddForeignKey
ALTER TABLE "pool_runs" ADD CONSTRAINT "pool_runs_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_runs" ADD CONSTRAINT "pool_runs_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing pool becomes "Temporada 1" (ACTIVE). startAt is set
-- just before the season's first kickoff so ALL current matches keep counting —
-- existing rankings are preserved exactly. Seasons with no matches fall back to
-- the pool's createdAt (no matches to count anyway).
INSERT INTO "pool_runs" ("id", "poolId", "seasonId", "label", "status", "startAt", "endAt", "order", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    p."id",
    p."seasonId",
    'Temporada 1',
    'ACTIVE'::"PoolRunStatus",
    COALESCE(
        (SELECT MIN(m."kickoffAt") FROM "matches" m WHERE m."seasonId" = p."seasonId") - INTERVAL '1 second',
        p."createdAt"
    ),
    NULL,
    1,
    p."createdAt",
    CURRENT_TIMESTAMP
FROM "pools" p;

-- DropForeignKey + DropIndex + drop the now-migrated column from pools.
ALTER TABLE "pools" DROP CONSTRAINT IF EXISTS "pools_seasonId_fkey";
DROP INDEX IF EXISTS "pools_seasonId_idx";
ALTER TABLE "pools" DROP COLUMN "seasonId";
