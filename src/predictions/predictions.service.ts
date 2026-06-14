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

@Injectable()
export class PredictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly phaseWeight: PhaseWeightService,
    private readonly events: EventsService,
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
