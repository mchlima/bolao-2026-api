import { Injectable } from '@nestjs/common';
import type { PoolRun, Prisma, SeasonStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RankingsService } from '../rankings/rankings.service';
import type {
  MyPoolStanding,
  MyStandingsResponse,
  MyStandingsTournament,
} from './standings.types';

const TOURNAMENT_SELECT = {
  id: true,
  slug: true,
  name: true,
  logoUrl: true,
  status: true,
  // Competição-dona — o slider linka o hub por /futebol/campeonato/:urlSlug.
  competition: { select: { name: true, urlSlug: true } },
} satisfies Prisma.SeasonSelect;

// Slider order: live tournaments first, then upcoming, finished, drafts last.
const STATUS_RANK: Record<SeasonStatus, number> = {
  ONGOING: 0,
  UPCOMING: 1,
  FINISHED: 2,
  DRAFT: 3,
};

@Injectable()
export class StandingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rankings: RankingsService,
  ) {}

  /**
   * The user's position in every scope they play, for the início's "Sua posição"
   * slider. Grouped by tournament — a season is included when the user is in a
   * pool of it OR has predicted in it (so the GERAL card shows even without a
   * pool, matching the old single-card home). Within each: GERAL first, then the
   * user's pools (oldest membership first).
   */
  async forUser(userId: string): Promise<MyStandingsResponse> {
    const [memberships, predictedSeasons] = await Promise.all([
      this.prisma.poolMember.findMany({
        where: { userId },
        select: {
          pool: {
            select: {
              id: true,
              name: true,
              runs: { include: { season: { select: TOURNAMENT_SELECT } } },
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.season.findMany({
        where: { matches: { some: { predictions: { some: { userId } } } } },
        select: TOURNAMENT_SELECT,
      }),
    ]);

    // Each pool is placed under its CURRENT temporada's season, scored within
    // that run's window. Pools without a run are skipped (shouldn't happen).
    const poolEntries = memberships
      .map((m) => {
        const run = pickCurrentRun(m.pool.runs);
        return run ? { poolId: m.pool.id, name: m.pool.name, run } : null;
      })
      .filter((p): p is PoolEntry => p !== null);

    // Distinct seasons across both sources, keeping the season metadata.
    const seasons = new Map<string, (typeof predictedSeasons)[number]>();
    for (const s of predictedSeasons) seasons.set(s.id, s);
    for (const p of poolEntries) seasons.set(p.run.season.id, p.run.season);

    // Pools grouped by their current run's season, preserving membership order.
    const poolsBySeason = new Map<string, PoolEntry[]>();
    for (const p of poolEntries) {
      const list = poolsBySeason.get(p.run.season.id) ?? [];
      list.push(p);
      poolsBySeason.set(p.run.season.id, list);
    }

    const ordered = [...seasons.values()].sort(
      (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name),
    );

    const tournaments = await Promise.all(
      ordered.map((season) => this.buildTournament(season, poolsBySeason.get(season.id) ?? [], userId)),
    );

    return { tournaments };
  }

  private async buildTournament(
    season: {
      id: string;
      slug: string | null;
      name: string;
      status: SeasonStatus;
      competition: { name: string; urlSlug: string | null };
    },
    pools: PoolEntry[],
    userId: string,
  ): Promise<MyStandingsTournament> {
    const [general, poolStandings] = await Promise.all([
      this.rankings.tournamentRanking(season.id, userId).then((r) => ({
        me: r.currentUser,
        total: r.totalParticipants,
      })),
      Promise.all(pools.map((p) => this.poolStanding(p, userId))),
    ]);

    return {
      id: season.id,
      slug: season.slug,
      name: season.name,
      status: season.status,
      competition: season.competition ?? null,
      general,
      pools: poolStandings,
    };
  }

  private async poolStanding(
    pool: PoolEntry,
    userId: string,
  ): Promise<MyPoolStanding> {
    const members = await this.prisma.poolMember.findMany({
      where: { poolId: pool.poolId },
      select: { userId: true },
    });
    const ids = members.map((m) => m.userId);
    const { run } = pool;
    // A run that hasn't started yet shows everyone at zero.
    const ranking =
      run.status === 'DRAFT' || !run.startAt
        ? await this.rankings.zeroRanking(ids, userId)
        : await this.rankings.tournamentRanking(run.seasonId, userId, ids, {
            startAt: run.startAt,
            endAt: run.endAt,
          });
    return {
      poolId: pool.poolId,
      name: pool.name,
      me: ranking.currentUser,
      total: ranking.totalParticipants,
    };
  }
}

type PoolRunWithSeason = PoolRun & {
  season: {
    id: string;
    slug: string | null;
    name: string;
    logoUrl: string | null;
    status: SeasonStatus;
    competition: { name: string; urlSlug: string | null };
  };
};
interface PoolEntry {
  poolId: string;
  name: string;
  run: PoolRunWithSeason;
}

/** The open temporada (endAt null) if any, otherwise the latest by order. */
function pickCurrentRun(runs: PoolRunWithSeason[]): PoolRunWithSeason | null {
  if (!runs.length) return null;
  const open = runs.filter((r) => r.endAt === null);
  const pool = open.length ? open : runs;
  return pool.reduce((a, b) => (b.order > a.order ? b : a));
}
