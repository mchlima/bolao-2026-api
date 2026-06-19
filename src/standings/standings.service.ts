import { Injectable } from '@nestjs/common';
import type { Prisma, SeasonStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RankingsService } from '../rankings/rankings.service';
import type {
  MyPoolStanding,
  MyStandingsResponse,
  MyStandingsTournament,
} from './standings.types';

const TOURNAMENT_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  status: true,
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
            select: { id: true, name: true, season: { select: TOURNAMENT_SELECT } },
          },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.season.findMany({
        where: { matches: { some: { predictions: { some: { userId } } } } },
        select: TOURNAMENT_SELECT,
      }),
    ]);

    // Distinct seasons across both sources, keeping the season metadata.
    const seasons = new Map<string, (typeof predictedSeasons)[number]>();
    for (const s of predictedSeasons) seasons.set(s.id, s);
    for (const m of memberships) seasons.set(m.pool.season.id, m.pool.season);

    // Pools grouped by their season, preserving membership order.
    const poolsBySeason = new Map<string, { id: string; name: string }[]>();
    for (const m of memberships) {
      const list = poolsBySeason.get(m.pool.season.id) ?? [];
      list.push({ id: m.pool.id, name: m.pool.name });
      poolsBySeason.set(m.pool.season.id, list);
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
    season: { id: string; name: string; status: SeasonStatus },
    pools: { id: string; name: string }[],
    userId: string,
  ): Promise<MyStandingsTournament> {
    const [general, poolStandings] = await Promise.all([
      this.rankings.tournamentRanking(season.id, userId).then((r) => ({
        me: r.currentUser,
        total: r.totalParticipants,
      })),
      Promise.all(pools.map((p) => this.poolStanding(season.id, p, userId))),
    ]);

    return {
      id: season.id,
      name: season.name,
      status: season.status,
      general,
      pools: poolStandings,
    };
  }

  private async poolStanding(
    seasonId: string,
    pool: { id: string; name: string },
    userId: string,
  ): Promise<MyPoolStanding> {
    const members = await this.prisma.poolMember.findMany({
      where: { poolId: pool.id },
      select: { userId: true },
    });
    const ranking = await this.rankings.tournamentRanking(
      seasonId,
      userId,
      members.map((m) => m.userId),
    );
    return {
      poolId: pool.id,
      name: pool.name,
      me: ranking.currentUser,
      total: ranking.totalParticipants,
    };
  }
}
