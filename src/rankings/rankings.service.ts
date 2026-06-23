import { Injectable, NotFoundException } from '@nestjs/common';
import { SeasonStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompetitionsService } from '../competitions/competitions.service';
import { PhaseWeightService } from '../scoring/phase-weight.service';
import { ScoreTier, ScoringService } from '../scoring/scoring.service';

export interface RankingEntry {
  rank: number;
  user: { id: string; name: string; avatarUrl: string | null };
  points: number;
  exactCount: number; // "cravadas" (exact scorelines) — 2nd tiebreak / info
  scoredCount: number; // "pontuadas": predictions on a match that already counted
  predictedCount: number; // "palpitadas": predictions made in this scope — last tiebreak
  // Match ranking only: the participant's predicted scoreline and earned tier.
  prediction?: { home: number; away: number };
  tier?: ScoreTier;
}

export interface RankingResponse {
  entries: RankingEntry[]; // top 100
  currentUser: RankingEntry | null; // logged user's row (even if outside top 100)
  totalParticipants: number;
}

/**
 * Public competition leaderboard (rota /boloes/ranking/:competition). Resolves a
 * competition by its URL slug to its active season and returns that season's
 * global ranking — but only to authenticated callers (names are private). Anonymous
 * visitors get the competition/season metadata + crowd size to fuel a join CTA.
 */
export interface CompetitionRankingResponse {
  competition: { id: string; name: string; urlSlug: string };
  season: {
    id: string;
    name: string;
    seasonLabel: string | null;
    slug: string | null;
    status: SeasonStatus;
  } | null;
  totalParticipants: number;
  ranking: RankingResponse | null; // null for anonymous visitors (privacy/LGPD)
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
  user: { id: string; name: string; avatarUrl: string | null };
  points: number;
  exact: number; // "cravadas"
  scored: number; // "pontuadas" (predictions on a counted match)
  predicted: number; // "palpitadas" (predictions made in this scope)
  prediction?: { home: number; away: number };
  tier?: ScoreTier;
}

@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly phaseWeight: PhaseWeightService,
    private readonly competitions: CompetitionsService,
  ) {}

  /**
   * Public competition leaderboard keyed by URL slug. Logged callers get the full
   * season ranking; anonymous ones only get the crowd size (no names exposed).
   */
  async competitionRanking(
    urlSlug: string,
    currentUserId?: string,
  ): Promise<CompetitionRankingResponse> {
    const comp = await this.competitions.findByUrlSlug(urlSlug);
    if (!comp) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Competição não encontrada.',
      });
    }
    const competition = { id: comp.id, name: comp.name, urlSlug: comp.urlSlug };
    const active = comp.activeSeason;
    if (!active) {
      return { competition, season: null, totalParticipants: 0, ranking: null };
    }
    const season = {
      id: active.id,
      name: active.name,
      seasonLabel: active.seasonLabel,
      slug: active.slug,
      status: active.status,
    };
    if (currentUserId) {
      const ranking = await this.tournamentRanking(active.id, currentUserId);
      return {
        competition,
        season,
        totalParticipants: ranking.totalParticipants,
        ranking,
      };
    }
    return {
      competition,
      season,
      totalParticipants: await this.countParticipants(active.id),
      ranking: null,
    };
  }

  /** Distinct active users with at least one prediction in the season. */
  private async countParticipants(seasonId: string): Promise<number> {
    const rows = await this.prisma.prediction.findMany({
      where: { match: { seasonId }, user: { isActive: true } },
      distinct: ['userId'],
      select: { userId: true },
    });
    return rows.length;
  }

  async tournamentRanking(
    seasonId: string,
    currentUserId?: string,
    // When given, the ranking is scoped to these members (a pool/"bolão");
    // omit for the global ranking on the tournament page.
    memberUserIds?: string[],
    // When given (a pool "temporada"/run), only matches whose kickoff is after
    // startAt — and up to endAt when the run is closed — count. Omit for the
    // global ranking, which always sums the whole tournament history.
    window?: { startAt: Date; endAt?: Date | null },
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
    // A run window restricts to matches that kicked off strictly after the start
    // (a match already underway at start time doesn't count — the next one does).
    const matches = await this.prisma.match.findMany({
      where: {
        seasonId,
        status: { in: ['LIVE', 'FINISHED'] },
        ...(window && {
          kickoffAt: {
            gt: window.startAt,
            ...(window.endAt ? { lte: window.endAt } : {}),
          },
        }),
      },
      select: { id: true, roundId: true, homeScore: true, awayScore: true },
    });
    // Per-match phase weight: knockout rounds scale up, group matches stay at 1.
    const weightByRound = await this.phaseWeight.byRound(seasonId);
    const resultByMatch = new Map(
      matches.map((m) => [
        m.id,
        {
          result: { home: m.homeScore ?? 0, away: m.awayScore ?? 0 },
          weight: (m.roundId && weightByRound.get(m.roundId)) || 1,
        },
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
        user: {
          select: { id: true, name: true, isActive: true, avatarUrl: true },
        },
      },
    });

    const acc = new Map<string, Acc>();
    for (const p of predictions) {
      if (!p.user.isActive) continue;
      let a = acc.get(p.userId);
      if (!a) {
        a = {
          user: { id: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl },
          points: 0,
          exact: 0,
          scored: 0,
          predicted: 0,
        };
        acc.set(p.userId, a);
      }
      a.predicted += 1; // "palpitadas": every prediction in scope (last tiebreak)
      const m = resultByMatch.get(p.matchId);
      if (m) {
        const s = this.scoring.score(
          { home: p.homeScore, away: p.awayScore },
          m.result,
          m.weight,
        );
        a.points += s.points;
        a.scored += 1;
        if (s.tier === 'EXACT') a.exact += 1;
      }
    }

    return this.buildResponse([...acc.values()], currentUserId);
  }

  /**
   * Everyone at zero — used by a pool run that hasn't started yet (DRAFT). Lists
   * the members so the table shows the lineup before the first match counts.
   */
  async zeroRanking(
    memberUserIds: string[],
    currentUserId?: string,
  ): Promise<RankingResponse> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: memberUserIds }, isActive: true },
      select: { id: true, name: true, avatarUrl: true },
    });
    return this.buildResponse(
      users.map((user) => ({ user, points: 0, exact: 0, scored: 0, predicted: 0 })),
      currentUserId,
    );
  }

  async matchRanking(
    matchId: string,
    currentUserId?: string,
    // When given, the ranking is scoped to these members (a pool/"bolão").
    memberUserIds?: string[],
  ): Promise<MatchRankingResponse> {
    // matchId pode vir como id (cuid) ou slug de SEO — a página de jogo usa a URL bonita.
    const match = await this.prisma.match.findFirst({
      where: { OR: [{ id: matchId }, { slug: matchId }] },
      select: {
        id: true,
        seasonId: true,
        roundId: true,
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
    // Phase weight for this match (1 unless it's a knockout round).
    const weightByRound = await this.phaseWeight.byRound(match.seasonId);
    const weight = (match.roundId && weightByRound.get(match.roundId)) || 1;

    const predictions = await this.prisma.prediction.findMany({
      where: {
        matchId: match.id,
        ...(memberUserIds && { userId: { in: memberUserIds } }),
      },
      select: {
        userId: true,
        homeScore: true,
        awayScore: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, isActive: true, avatarUrl: true },
        },
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
              user: {
                id: own.user.id,
                name: own.user.name,
                avatarUrl: own.user.avatarUrl,
              },
              points: 0,
              exact: 0,
              scored: 0,
              predicted: 1,
              prediction: { home: own.homeScore, away: own.awayScore },
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
        user: { id: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl },
        points: 0,
        exact: 0,
        scored: 0,
        predicted: 1,
        prediction: { home: p.homeScore, away: p.awayScore },
      };
      if (result) {
        const s = this.scoring.score(
          { home: p.homeScore, away: p.awayScore },
          result,
          weight,
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
    // Tiebreak order (app-wide): points → cravadas → pontuadas → palpitadas → name.
    accs.sort(
      (a, b) =>
        b.points - a.points ||
        b.exact - a.exact ||
        b.scored - a.scored ||
        b.predicted - a.predicted ||
        a.user.name.localeCompare(b.user.name),
    );

    const sameRank = (a: Acc, b: Acc) =>
      a.points === b.points &&
      a.exact === b.exact &&
      a.scored === b.scored &&
      a.predicted === b.predicted;

    const ranked: RankingEntry[] = [];
    for (let i = 0; i < accs.length; i++) {
      const a = accs[i];
      // Truly tied (equal on every criterion) share a rank; otherwise positions
      // are distinct and sequential.
      const prev = accs[i - 1];
      const rank = i > 0 && sameRank(prev, a) ? ranked[i - 1].rank : i + 1;
      ranked.push({
        rank,
        user: a.user,
        points: a.points,
        exactCount: a.exact,
        scoredCount: a.scored,
        predictedCount: a.predicted,
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
