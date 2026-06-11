import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Match, Prediction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreResult, ScoringService } from '../scoring/scoring.service';
import { UpsertPredictionDto } from './dto/upsert-prediction.dto';

const PREDICTION_INCLUDE = {
  match: {
    include: {
      homeTeam: true,
      awayTeam: true,
      stadium: true,
      tournament: { select: { id: true, name: true } },
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

    return this.findOneForUser(userId, dto.matchId);
  }

  async findMine(
    userId: string,
    tournamentId?: string,
  ): Promise<PredictionView[]> {
    const predictions = await this.prisma.prediction.findMany({
      where: { userId, ...(tournamentId && { match: { tournamentId } }) },
      include: PREDICTION_INCLUDE,
      relationLoadStrategy: 'join',
      orderBy: { match: { kickoffAt: 'asc' } },
    });
    return predictions.map((p) => this.withScore(p));
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
    return this.withScore(prediction);
  }

  /**
   * Whether a match accepts predictions. The admin override (predictionsOpen)
   * wins when set; otherwise the automatic rule applies (SCHEDULED + before
   * kickoff). Terminal states (finished/cancelled) never accept predictions,
   * even with the override on. Both teams must be set.
   */
  static acceptsPredictions(match: Match): boolean {
    if (match.homeTeamId == null || match.awayTeamId == null) return false;
    if (match.status === 'FINISHED' || match.status === 'CANCELLED') return false;
    const auto = match.status === 'SCHEDULED' && new Date() < match.kickoffAt;
    return match.predictionsOpen ?? auto;
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

  private withScore(prediction: PredictionWithMatch): PredictionView {
    const m = prediction.match;
    const scorable =
      m.status !== 'CANCELLED' && m.homeScore != null && m.awayScore != null;
    const score = scorable
      ? this.scoring.score(
          { home: prediction.homeScore, away: prediction.awayScore },
          { home: m.homeScore as number, away: m.awayScore as number },
        )
      : null;
    return { ...prediction, score };
  }
}
