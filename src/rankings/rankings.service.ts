import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreTier, ScoringService } from '../scoring/scoring.service';

export interface RankingEntry {
  rank: number;
  user: { id: string; name: string };
  points: number;
  exactCount: number; // tiebreak / info
  scoredCount: number; // predictions that already counted (match had a result)
  // Match ranking only: the participant's predicted scoreline and earned tier.
  prediction?: { home: number; away: number };
  tier?: ScoreTier;
}

export interface RankingResponse {
  entries: RankingEntry[]; // top 100
  currentUser: RankingEntry | null; // logged user's row (even if outside top 100)
  totalParticipants: number;
}

export interface MatchRankingResponse extends RankingResponse {
  provisional: boolean; // true while the match is LIVE
  result: { home: number; away: number } | null;
  // False until kickoff: others' predictions are hidden (only the caller sees
  // their own), so nobody peeks at guesses before betting. entries is empty.
  revealed: boolean;
}

export interface EngagementResponse {
  matchId: string;
  totalPredictions: number;
  distribution: Array<{
    homeScore: number;
    awayScore: number;
    count: number;
    percentage: number; // 0–100, one decimal
  }>;
}

interface Acc {
  user: { id: string; name: string };
  points: number;
  exact: number;
  scored: number;
  prediction?: { home: number; away: number };
  tier?: ScoreTier;
  // Tiebreaker: epoch ms of the relevant prediction (this match's, or the
  // user's earliest in the tournament). Earlier predictions rank higher.
  predictedAt?: number;
}

@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
  ) {}

  async tournamentRanking(
    seasonId: string,
    currentUserId?: string,
    // When given, the ranking is scoped to these members (a pool/"bolão");
    // omit for the global ranking on the tournament page.
    memberUserIds?: string[],
  ): Promise<RankingResponse> {
    const tournament = await this.prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true },
    });
    if (!tournament) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Torneio não encontrado.',
      });
    }

    // LIVE or FINISHED matches contribute a scoreline (CANCELLED excluded); a
    // null side counts as 0, so provisional live points reflect e.g. 1-0.
    const matches = await this.prisma.match.findMany({
      where: {
        seasonId,
        status: { in: ['LIVE', 'FINISHED'] },
      },
      select: { id: true, homeScore: true, awayScore: true },
    });
    const resultByMatch = new Map(
      matches.map((m) => [
        m.id,
        { home: m.homeScore ?? 0, away: m.awayScore ?? 0 },
      ]),
    );

    const predictions = await this.prisma.prediction.findMany({
      where: {
        match: { seasonId },
        ...(memberUserIds && { userId: { in: memberUserIds } }),
      },
      select: {
        userId: true,
        matchId: true,
        homeScore: true,
        awayScore: true,
        createdAt: true,
        user: { select: { id: true, name: true, isActive: true } },
      },
    });

    const acc = new Map<string, Acc>();
    for (const p of predictions) {
      if (!p.user.isActive) continue;
      let a = acc.get(p.userId);
      if (!a) {
        a = {
          user: { id: p.user.id, name: p.user.name },
          points: 0,
          exact: 0,
          scored: 0,
        };
        acc.set(p.userId, a);
      }
      // Tiebreaker: the user's earliest prediction in the tournament.
      const ts = p.createdAt.getTime();
      if (a.predictedAt === undefined || ts < a.predictedAt) a.predictedAt = ts;
      const result = resultByMatch.get(p.matchId);
      if (result) {
        const s = this.scoring.score(
          { home: p.homeScore, away: p.awayScore },
          result,
        );
        a.points += s.points;
        a.scored += 1;
        if (s.tier === 'EXACT') a.exact += 1;
      }
    }

    return this.buildResponse([...acc.values()], currentUserId);
  }

  async matchRanking(
    matchId: string,
    currentUserId?: string,
    // When given, the ranking is scoped to these members (a pool/"bolão").
    memberUserIds?: string[],
  ): Promise<MatchRankingResponse> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        status: true,
        homeScore: true,
        awayScore: true,
        kickoffAt: true,
      },
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }

    // LIVE or FINISHED matches have a scoreline; a null side counts as 0 (e.g.
    // 1-0 while the away score is still untouched). Provisional during LIVE.
    const playing = match.status === 'LIVE' || match.status === 'FINISHED';
    const result = playing
      ? { home: match.homeScore ?? 0, away: match.awayScore ?? 0 }
      : null;

    const predictions = await this.prisma.prediction.findMany({
      where: {
        matchId,
        ...(memberUserIds && { userId: { in: memberUserIds } }),
      },
      select: {
        userId: true,
        homeScore: true,
        awayScore: true,
        createdAt: true,
        user: { select: { id: true, name: true, isActive: true } },
      },
    });
    const active = predictions.filter((p) => p.user.isActive);

    // Predictions are secret until kickoff (same fairness rule as the lock).
    // Before that, return the count but hide everyone's guesses — the caller
    // still gets their own (for the "your prediction" UI).
    const revealed = playing || new Date() >= match.kickoffAt;
    if (!revealed) {
      const own = active.find((p) => p.userId === currentUserId);
      const ownEntry: Acc[] = own
        ? [
            {
              user: { id: own.user.id, name: own.user.name },
              points: 0,
              exact: 0,
              scored: 0,
              prediction: { home: own.homeScore, away: own.awayScore },
              predictedAt: own.createdAt.getTime(),
            },
          ]
        : [];
      return {
        entries: [],
        currentUser: this.buildResponse(ownEntry, currentUserId).currentUser,
        totalParticipants: active.length,
        provisional: false,
        result: null,
        revealed: false,
      };
    }

    const entries: Acc[] = [];
    for (const p of predictions) {
      if (!p.user.isActive) continue;
      const a: Acc = {
        user: { id: p.user.id, name: p.user.name },
        points: 0,
        exact: 0,
        scored: 0,
        prediction: { home: p.homeScore, away: p.awayScore },
        predictedAt: p.createdAt.getTime(),
      };
      if (result) {
        const s = this.scoring.score(
          { home: p.homeScore, away: p.awayScore },
          result,
        );
        a.points = s.points;
        a.scored = 1;
        a.tier = s.tier;
        if (s.tier === 'EXACT') a.exact = 1;
      }
      entries.push(a);
    }

    return {
      ...this.buildResponse(entries, currentUserId),
      provisional: match.status === 'LIVE',
      result,
      revealed: true,
    };
  }

  async engagement(matchId: string): Promise<EngagementResponse> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }

    const groups = await this.prisma.prediction.groupBy({
      by: ['homeScore', 'awayScore'],
      where: { matchId },
      _count: { _all: true },
    });
    const total = groups.reduce((sum, g) => sum + g._count._all, 0);

    const distribution = groups
      .map((g) => ({
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        count: g._count._all,
        percentage: total ? Math.round((g._count._all / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return { matchId, totalPredictions: total, distribution };
  }

  /** Sort, assign tie-aware ranks, take top 100, and locate the current user. */
  private buildResponse(accs: Acc[], currentUserId?: string): RankingResponse {
    accs.sort(
      (a, b) =>
        b.points - a.points ||
        // Tiebreaker: earlier prediction wins (smaller epoch ms first).
        (a.predictedAt ?? Infinity) - (b.predictedAt ?? Infinity) ||
        b.exact - a.exact ||
        a.user.name.localeCompare(b.user.name),
    );

    const ranked: RankingEntry[] = [];
    for (let i = 0; i < accs.length; i++) {
      const a = accs[i];
      // Truly tied (same points AND same prediction time) share a rank;
      // otherwise the time tiebreaker gives distinct, sequential positions.
      const prev = accs[i - 1];
      const rank =
        i > 0 && prev.points === a.points && prev.predictedAt === a.predictedAt
          ? ranked[i - 1].rank
          : i + 1;
      ranked.push({
        rank,
        user: a.user,
        points: a.points,
        exactCount: a.exact,
        scoredCount: a.scored,
        ...(a.prediction ? { prediction: a.prediction } : {}),
        ...(a.tier ? { tier: a.tier } : {}),
      });
    }

    return {
      entries: ranked.slice(0, 100),
      currentUser:
        (currentUserId && ranked.find((e) => e.user.id === currentUserId)) ||
        null,
      totalParticipants: ranked.length,
    };
  }
}
