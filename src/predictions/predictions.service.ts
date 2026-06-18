import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Match, Prediction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreResult, ScoringService } from '../scoring/scoring.service';
import { PhaseWeightService } from '../scoring/phase-weight.service';
import { EventsService } from '../events/events.service';
import { AuditService } from '../audit/audit.service';
import { UpsertPredictionDto } from './dto/upsert-prediction.dto';

const PREDICTION_INCLUDE = {
  match: {
    include: {
      homeTeam: true,
      awayTeam: true,
      stadium: true,
      season: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PredictionInclude;

type PredictionWithMatch = Prisma.PredictionGetPayload<{
  include: typeof PREDICTION_INCLUDE;
}>;

export type PredictionView = PredictionWithMatch & {
  score: ScoreResult | null; // provisional during LIVE, final on FINISHED, null otherwise
};

type MatchWithTeams = Prisma.MatchGetPayload<{
  include: { homeTeam: true; awayTeam: true };
}>;

/** One row of the admin "predictions of a user" view: every match of a season,
 * with the user's palpite (or null) and its current points. */
export interface AdminUserPredictionRow {
  match: MatchWithTeams;
  prediction: { homeScore: number; awayScore: number } | null;
  score: ScoreResult | null;
}

@Injectable()
export class PredictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly phaseWeight: PhaseWeightService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async upsert(
    userId: string,
    dto: UpsertPredictionDto,
  ): Promise<PredictionView> {
    const match = await this.prisma.match.findUnique({
      where: { id: dto.matchId },
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }
    this.assertOpenForPrediction(match);

    await this.prisma.prediction.upsert({
      where: { userId_matchId: { userId, matchId: dto.matchId } },
      update: { homeScore: dto.homeScore, awayScore: dto.awayScore },
      create: {
        userId,
        matchId: dto.matchId,
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
      },
    });

    this.events.emit(
      `match:${dto.matchId}`,
      `tournament:${match.seasonId}`,
    );
    return this.findOneForUser(userId, dto.matchId);
  }

  /**
   * Admin manual upsert: set/replace ANY user's prediction for a match, with NO
   * kickoff lock — works even when the match is closed, LIVE or FINISHED (the
   * admin owns the call). Scoring is derived on read, so a palpite added to a
   * LIVE/FINISHED match counts in the rankings immediately. Audited.
   */
  async adminUpsert(
    targetUserId: string,
    params: { matchId: string; homeScore: number; awayScore: number },
    adminId: string,
  ): Promise<PredictionView> {
    const match = await this.prisma.match.findUnique({
      where: { id: params.matchId },
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }
    // The one gate we keep even for admins: a match without both teams can't be
    // scored (no opponents), so a palpite would be meaningless.
    if (match.homeTeamId == null || match.awayTeamId == null) {
      throw new ForbiddenException({
        code: 'MATCH_NOT_OPEN',
        message: 'A partida ainda não tem os dois times definidos.',
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Usuário não encontrado.',
      });
    }

    const existing = await this.prisma.prediction.findUnique({
      where: { userId_matchId: { userId: targetUserId, matchId: params.matchId } },
    });
    const saved = await this.prisma.prediction.upsert({
      where: { userId_matchId: { userId: targetUserId, matchId: params.matchId } },
      update: { homeScore: params.homeScore, awayScore: params.awayScore },
      create: {
        userId: targetUserId,
        matchId: params.matchId,
        homeScore: params.homeScore,
        awayScore: params.awayScore,
      },
    });

    await this.audit.record({
      actorUserId: adminId,
      action: 'PREDICTION_UPSERT_ADMIN',
      entityType: 'Prediction',
      entityId: saved.id,
      diff: {
        targetUserId,
        matchId: params.matchId,
        matchStatus: match.status,
        homeScore: { before: existing?.homeScore ?? null, after: params.homeScore },
        awayScore: { before: existing?.awayScore ?? null, after: params.awayScore },
      },
    });

    this.events.emit(`match:${params.matchId}`, `tournament:${match.seasonId}`);
    return this.findOneForUser(targetUserId, params.matchId);
  }

  /**
   * Admin view: every match of a season (with both teams) plus this user's
   * palpite (or null) and current points — so the admin can fill blanks or fix
   * an existing one from a single list.
   */
  async adminListForUser(
    userId: string,
    seasonId: string,
  ): Promise<AdminUserPredictionRow[]> {
    const [matches, preds, weightByRound] = await Promise.all([
      this.prisma.match.findMany({
        where: {
          seasonId,
          homeTeamId: { not: null },
          awayTeamId: { not: null },
        },
        include: { homeTeam: true, awayTeam: true },
        orderBy: { kickoffAt: 'asc' },
      }),
      this.prisma.prediction.findMany({
        where: { userId, match: { seasonId } },
        select: { matchId: true, homeScore: true, awayScore: true },
      }),
      this.phaseWeight.byRound(seasonId),
    ]);
    const byMatch = new Map(preds.map((p) => [p.matchId, p]));
    return matches.map((m) => {
      const p = byMatch.get(m.id);
      const scorable = m.status === 'LIVE' || m.status === 'FINISHED';
      const weight = (m.roundId && weightByRound.get(m.roundId)) || 1;
      const score =
        p && scorable
          ? this.scoring.score(
              { home: p.homeScore, away: p.awayScore },
              { home: m.homeScore, away: m.awayScore },
              weight,
            )
          : null;
      return {
        match: m,
        prediction: p ? { homeScore: p.homeScore, awayScore: p.awayScore } : null,
        score,
      };
    });
  }

  async findMine(
    userId: string,
    seasonId?: string,
  ): Promise<PredictionView[]> {
    const predictions = await this.prisma.prediction.findMany({
      where: { userId, ...(seasonId && { match: { seasonId } }) },
      include: PREDICTION_INCLUDE,
      relationLoadStrategy: 'join',
      orderBy: { match: { kickoffAt: 'asc' } },
    });
    const seasonIds = [...new Set(predictions.map((p) => p.match.seasonId))];
    const weightByRound = await this.phaseWeight.byRound(seasonIds);
    return predictions.map((p) => this.withScore(p, weightByRound));
  }

  private async findOneForUser(
    userId: string,
    matchId: string,
  ): Promise<PredictionView> {
    const prediction = await this.prisma.prediction.findUnique({
      where: { userId_matchId: { userId, matchId } },
      include: PREDICTION_INCLUDE,
      relationLoadStrategy: 'join',
    });
    if (!prediction) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Palpite não encontrado.',
      });
    }
    const weightByRound = await this.phaseWeight.byRound(
      prediction.match.seasonId,
    );
    return this.withScore(prediction, weightByRound);
  }

  /**
   * Whether a match accepts predictions. Predictions ALWAYS close at kickoff:
   * the admin override (predictionsOpen) can only close the window EARLY
   * (false) — it can never hold it open once the match has started, so nobody
   * bets with the live score in front of them. Finished/cancelled matches and a
   * missing team also close it. Before kickoff, a SCHEDULED match is open unless
   * the admin closed it early.
   */
  static acceptsPredictions(match: Match): boolean {
    if (match.homeTeamId == null || match.awayTeamId == null) return false;
    if (match.status === 'FINISHED' || match.status === 'CANCELLED')
      return false;
    // Postponed: no real date yet (kickoffAt is a placeholder), so it stays open
    // until rescheduled — skip the kickoff gate. Admin can still close it early.
    if (match.status === 'POSTPONED') return match.predictionsOpen ?? true;
    // Hard gate: once kickoff passes (or the match is no longer SCHEDULED), the
    // window is closed regardless of the override.
    if (new Date() >= match.kickoffAt) return false;
    if (match.status !== 'SCHEDULED') return false;
    return match.predictionsOpen ?? true;
  }

  private assertOpenForPrediction(match: Match): void {
    if (match.homeTeamId == null || match.awayTeamId == null) {
      throw new ForbiddenException({
        code: 'MATCH_NOT_OPEN',
        message: 'A partida ainda não tem os dois times definidos.',
      });
    }
    if (!PredictionsService.acceptsPredictions(match)) {
      throw new ForbiddenException({
        code: 'PREDICTION_LOCKED',
        message: 'Palpites encerrados para esta partida.',
      });
    }
  }

  private withScore(
    prediction: PredictionWithMatch,
    weightByRound?: Map<string, number>,
  ): PredictionView {
    const m = prediction.match;
    // Scores default to 0x0, so "has a result" is driven by status, not by a
    // null score: only LIVE (provisional) or FINISHED matches are scored.
    const scorable = m.status === 'LIVE' || m.status === 'FINISHED';
    // Knockout matches scale by their phase weight (1 for group/league).
    const weight = (m.roundId && weightByRound?.get(m.roundId)) || 1;
    const score = scorable
      ? this.scoring.score(
          { home: prediction.homeScore, away: prediction.awayScore },
          { home: m.homeScore, away: m.awayScore },
          weight,
        )
      : null;
    return { ...prediction, score };
  }
}
