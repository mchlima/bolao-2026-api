import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StageStandings } from './standings.types';
import { StandingsService } from './standings.service';

const TEAM_SELECT = {
  id: true,
  name: true,
  shortName: true,
  logoUrl: true,
  countryCode: true,
} as const;

@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standings: StandingsService,
  ) {}

  /** Full season structure: stages → groups (+teams) and rounds. For admin + viz. */
  async getStructure(seasonId: string) {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      include: {
        competition: true,
        stages: {
          orderBy: { order: 'asc' },
          include: {
            groups: {
              orderBy: { order: 'asc' },
              include: { teams: { include: { team: { select: TEAM_SELECT } } } },
            },
            rounds: {
              orderBy: { order: 'asc' },
              include: {
                matches: {
                  orderBy: [{ matchNumber: 'asc' }, { kickoffAt: 'asc' }],
                  select: {
                    id: true,
                    matchNumber: true,
                    leg: true,
                    kickoffAt: true,
                    status: true,
                    homeScore: true,
                    awayScore: true,
                    groupId: true,
                    tieId: true,
                    homeSourceLabel: true,
                    awaySourceLabel: true,
                    homeTeam: { select: TEAM_SELECT },
                    awayTeam: { select: TEAM_SELECT },
                    stadium: { select: { name: true, city: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!season) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Torneio não encontrado.',
      });
    }
    return season;
  }

  /** Standings tables for every LEAGUE/GROUP stage of the season. */
  getStandings(seasonId: string): Promise<StageStandings[]> {
    return this.standings.seasonStandings(seasonId);
  }

  /** Knockout bracket: each KNOCKOUT stage → rounds → ties (resolved teams + aggregate + legs). */
  async getBracket(seasonId: string) {
    const stages = await this.prisma.stage.findMany({
      where: { seasonId, format: 'KNOCKOUT' },
      orderBy: { order: 'asc' },
      include: {
        rounds: {
          orderBy: { order: 'asc' },
          include: {
            ties: {
              orderBy: { order: 'asc' },
              include: {
                homeTeam: { select: TEAM_SELECT },
                awayTeam: { select: TEAM_SELECT },
                winnerTeam: { select: TEAM_SELECT },
                matches: {
                  orderBy: { leg: 'asc' },
                  select: {
                    id: true,
                    matchNumber: true,
                    leg: true,
                    kickoffAt: true,
                    status: true,
                    homeScore: true,
                    awayScore: true,
                    homePenalties: true,
                    awayPenalties: true,
                    homeTeam: { select: TEAM_SELECT },
                    awayTeam: { select: TEAM_SELECT },
                    stadium: { select: { name: true, city: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    return stages.map((stage) => ({
      stageId: stage.id,
      stageName: stage.name,
      hasThirdPlace: stage.hasThirdPlace,
      rounds: stage.rounds.map((round) => ({
        roundId: round.id,
        name: round.name,
        legs: round.legs,
        ties: round.ties.map((tie) => ({
          id: tie.id,
          order: tie.order,
          home: tie.homeTeam,
          away: tie.awayTeam,
          homeSourceLabel: tie.homeSourceLabel,
          awaySourceLabel: tie.awaySourceLabel,
          aggregateHome: tie.aggregateHome,
          aggregateAway: tie.aggregateAway,
          winnerTeamId: tie.winnerTeamId,
          winner: tie.winnerTeam,
          resolution: tie.resolution,
          legs: tie.matches,
        })),
      })),
    }));
  }
}
