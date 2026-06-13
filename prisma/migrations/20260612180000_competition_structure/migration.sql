-- Competition structure milestone.
-- Hand-edited (not the default Prisma drop/create) so it PRESERVES live data: the
-- former flat `tournaments` table is RENAMED to `seasons` and gains a `Competition`
-- parent; `matches.tournamentId`/`pools.tournamentId` are RENAMED (not dropped) to
-- `seasonId`; the `TournamentStatus` enum is RENAMED to `SeasonStatus` (identical values).
-- New structure tables (stages/groups/group_teams/rounds/ties) and the knockout result
-- columns on `matches` are added. Structural backfill (stages/groups/rounds/ties +
-- linking matches) runs afterwards via the seed/backfill script, reading the existing
-- phaseLabel/groupName/sourceLabel columns (kept as display fallbacks).

-- ── Enums ──────────────────────────────────────────────────────────────────────
-- Rename in place (values DRAFT/UPCOMING/ONGOING/FINISHED unchanged) so the
-- seasons.status column keeps its data and binding.
ALTER TYPE "TournamentStatus" RENAME TO "SeasonStatus";

CREATE TYPE "CompetitionType" AS ENUM ('LEAGUE', 'CUP', 'LEAGUE_CUP');
CREATE TYPE "SeasonFormat" AS ENUM ('LEAGUE', 'GROUPS', 'KNOCKOUT', 'GROUPS_KNOCKOUT');
CREATE TYPE "StageFormat" AS ENUM ('LEAGUE', 'GROUP', 'KNOCKOUT');
CREATE TYPE "TiebreakPreset" AS ENUM ('BRASILEIRAO', 'FIFA', 'UEFA', 'CONMEBOL', 'GENERIC');
CREATE TYPE "MatchDuration" AS ENUM ('REGULAR', 'EXTRA_TIME', 'PENALTY_SHOOTOUT');
CREATE TYPE "MatchWinner" AS ENUM ('HOME', 'AWAY', 'DRAW');
CREATE TYPE "TieResolution" AS ENUM ('AGGREGATE', 'AWAY_GOALS', 'EXTRA_TIME', 'PENALTIES');
CREATE TYPE "SlotSourceType" AS ENUM ('GROUP_POSITION', 'BEST_RANKED', 'MATCH_WINNER', 'MATCH_LOSER');

-- ── Competition (new parent) ────────────────────────────────────────────────────
CREATE TABLE "competitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "CompetitionType" NOT NULL,
    "country" TEXT,
    "confederation" TEXT,
    "logoUrl" TEXT,
    "espnLeagueSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "competitions_slug_key" ON "competitions"("slug");

-- Seed the Competition for the existing World Cup season so the NOT NULL FK backfills.
-- Idempotent on slug; stable id referenced by the seed/backfill script.
INSERT INTO "competitions" ("id", "name", "slug", "type", "confederation", "espnLeagueSlug", "createdAt", "updatedAt")
VALUES ('cmp_wc_fifa', 'Copa do Mundo FIFA', 'fifa.world', 'LEAGUE_CUP', 'FIFA', 'fifa.world', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- ── Tournament → Season (rename, preserve rows) ─────────────────────────────────
ALTER TABLE "tournaments" RENAME TO "seasons";
ALTER TABLE "seasons" RENAME CONSTRAINT "tournaments_pkey" TO "seasons_pkey";
ALTER TABLE "seasons"
    ADD COLUMN "competitionId" TEXT,
    ADD COLUMN "seasonLabel" TEXT,
    ADD COLUMN "format" "SeasonFormat" NOT NULL DEFAULT 'KNOCKOUT',
    ADD COLUMN "winnerTeamId" TEXT;

-- Backfill the existing season(s) onto the World Cup competition, then enforce NOT NULL.
UPDATE "seasons"
    SET "competitionId" = 'cmp_wc_fifa',
        "format" = 'GROUPS_KNOCKOUT',
        "seasonLabel" = '2026'
    WHERE "competitionId" IS NULL;
ALTER TABLE "seasons" ALTER COLUMN "competitionId" SET NOT NULL;

CREATE INDEX "seasons_competitionId_idx" ON "seasons"("competitionId");

-- ── matches: rename FK column + add structure/result columns ─────────────────────
ALTER TABLE "matches" DROP CONSTRAINT "matches_tournamentId_fkey";
DROP INDEX "matches_tournamentId_idx";
DROP INDEX "matches_tournamentId_matchNumber_key";

ALTER TABLE "matches" RENAME COLUMN "tournamentId" TO "seasonId";
ALTER TABLE "matches"
    ADD COLUMN "stageId" TEXT,
    ADD COLUMN "groupId" TEXT,
    ADD COLUMN "roundId" TEXT,
    ADD COLUMN "tieId" TEXT,
    ADD COLUMN "leg" INTEGER,
    ADD COLUMN "homePenalties" INTEGER,
    ADD COLUMN "awayPenalties" INTEGER,
    ADD COLUMN "winner" "MatchWinner",
    ADD COLUMN "duration" "MatchDuration";

CREATE INDEX "matches_seasonId_idx" ON "matches"("seasonId");
CREATE INDEX "matches_groupId_idx" ON "matches"("groupId");
CREATE INDEX "matches_roundId_idx" ON "matches"("roundId");
CREATE INDEX "matches_tieId_idx" ON "matches"("tieId");
CREATE UNIQUE INDEX "matches_seasonId_matchNumber_key" ON "matches"("seasonId", "matchNumber");

-- ── pools: rename FK column ──────────────────────────────────────────────────────
ALTER TABLE "pools" DROP CONSTRAINT "pools_tournamentId_fkey";
DROP INDEX "pools_tournamentId_idx";
ALTER TABLE "pools" RENAME COLUMN "tournamentId" TO "seasonId";
CREATE INDEX "pools_seasonId_idx" ON "pools"("seasonId");

-- ── New structure tables ─────────────────────────────────────────────────────────
CREATE TABLE "stages" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" "StageFormat" NOT NULL,
    "order" INTEGER NOT NULL,
    "tiebreakPreset" "TiebreakPreset" NOT NULL DEFAULT 'GENERIC',
    "tiebreakOverride" JSONB,
    "hasThirdPlace" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stages_seasonId_idx" ON "stages"("seasonId");

CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "groups_stageId_idx" ON "groups"("stageId");

CREATE TABLE "group_teams" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seed" INTEGER,

    CONSTRAINT "group_teams_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_teams_teamId_idx" ON "group_teams"("teamId");
CREATE UNIQUE INDEX "group_teams_groupId_teamId_key" ON "group_teams"("groupId", "teamId");

CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "number" INTEGER,
    "name" TEXT,
    "legs" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rounds_stageId_idx" ON "rounds"("stageId");

CREATE TABLE "ties" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "homeSource" JSONB,
    "awaySource" JSONB,
    "homeSourceLabel" TEXT,
    "awaySourceLabel" TEXT,
    "aggregateHome" INTEGER,
    "aggregateAway" INTEGER,
    "winnerTeamId" TEXT,
    "resolution" "TieResolution",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ties_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ties_roundId_idx" ON "ties"("roundId");

-- ── Foreign keys ─────────────────────────────────────────────────────────────────
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stages" ADD CONSTRAINT "stages_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_teams" ADD CONSTRAINT "group_teams_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_teams" ADD CONSTRAINT "group_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ties" ADD CONSTRAINT "ties_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ties" ADD CONSTRAINT "ties_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ties" ADD CONSTRAINT "ties_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ties" ADD CONSTRAINT "ties_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "matches" ADD CONSTRAINT "matches_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_tieId_fkey" FOREIGN KEY ("tieId") REFERENCES "ties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pools" ADD CONSTRAINT "pools_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
