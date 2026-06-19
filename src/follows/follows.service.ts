import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Team } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Relations the home "Seus jogos" card needs (same shape the agenda serves).
const UPCOMING_INCLUDE = {
  homeTeam: true,
  awayTeam: true,
  season: { select: { id: true, name: true, status: true } },
  round: { select: { number: true, name: true } },
  stadium: true,
} satisfies Prisma.MatchInclude;

export type FollowedUpcomingMatch = Prisma.MatchGetPayload<{ include: typeof UPCOMING_INCLUDE }>;

/** One followed team + its next (≤2) upcoming matches — for the grouped home view. */
export interface FollowingTeamGroup {
  team: Team;
  matches: FollowedUpcomingMatch[];
}
export interface FollowingView {
  teams: FollowingTeamGroup[];
  others: FollowedUpcomingMatch[]; // followed-by-match games not in any team group
  followedTeamCount: number; // all followed teams, even those with no upcoming game
}

/**
 * Teams a user follows to get a match reminder ~1h before kickoff. The follow set
 * is also read by the notifications reminder job to fan a match out to followers.
 */
@Injectable()
export class FollowsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's followed teams, full objects, alphabetical. */
  async list(userId: string): Promise<Team[]> {
    const rows = await this.prisma.followedTeam.findMany({
      where: { userId },
      include: { team: true },
      orderBy: { team: { name: 'asc' } },
    });
    return rows.map((r) => r.team);
  }

  /** Idempotent — following an already-followed team is a no-op. */
  async follow(userId: string, teamId: string): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Time não encontrado.' });
    }
    await this.prisma.followedTeam.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { userId, teamId },
      update: {},
    });
  }

  async unfollow(userId: string, teamId: string): Promise<void> {
    await this.prisma.followedTeam.deleteMany({ where: { userId, teamId } });
  }

  /** Match ids the user opted into explicitly (independent of team follows). */
  async listMatchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.followedMatch.findMany({
      where: { userId },
      select: { matchId: true },
    });
    return rows.map((r) => r.matchId);
  }

  /** Opt into a specific match. Idempotent — re-following is a no-op. */
  async followMatch(userId: string, matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    }
    await this.prisma.followedMatch.upsert({
      where: { userId_matchId: { userId, matchId } },
      create: { userId, matchId },
      update: {},
    });
  }

  async unfollowMatch(userId: string, matchId: string): Promise<void> {
    await this.prisma.followedMatch.deleteMany({ where: { userId, matchId } });
  }

  /**
   * Upcoming matches the user follows — either the match itself or one of its
   * teams. Includes games happening right now (LIVE) plus those scheduled for
   * the next 8 days (enough to cover the rest of any Mon–Sun week; the caller
   * trims to the current week in the user's timezone) so the payload stays
   * small. Includes the relations the home card renders.
   */
  async listUpcoming(userId: string): Promise<FollowedUpcomingMatch[]> {
    const [teams, matchFollows] = await Promise.all([
      this.prisma.followedTeam.findMany({ where: { userId }, select: { teamId: true } }),
      this.prisma.followedMatch.findMany({ where: { userId }, select: { matchId: true } }),
    ]);
    const teamIds = teams.map((t) => t.teamId);
    const matchIds = matchFollows.map((m) => m.matchId);
    if (!teamIds.length && !matchIds.length) return [];

    const now = Date.now();
    return this.prisma.match.findMany({
      where: {
        AND: [
          {
            OR: [
              // Em andamento agora — sobe pro topo de "Seus jogos".
              { status: 'LIVE' },
              // Próximos agendados, até +8 dias.
              {
                status: 'SCHEDULED',
                kickoffAt: { gt: new Date(now), lte: new Date(now + 8 * 24 * 60 * 60 * 1000) },
              },
            ],
          },
          {
            OR: [
              { id: { in: matchIds } },
              { homeTeamId: { in: teamIds } },
              { awayTeamId: { in: teamIds } },
            ],
          },
        ],
      },
      include: UPCOMING_INCLUDE,
      orderBy: { kickoffAt: 'asc' },
      take: 50,
    });
  }

  /**
   * "Seus jogos" agrupado por time: para cada time seguido, os 2 próximos jogos
   * (LIVE ou agendados no futuro), independente de data. Mais as partidas que o
   * usuário segue avulso (que não caírem em nenhum grupo). `followedTeamCount`
   * cobre todos os times seguidos (mesmo os sem jogo) p/ o estado vazio da home.
   */
  async listFollowing(userId: string): Promise<FollowingView> {
    const [teamRows, matchFollows] = await Promise.all([
      this.prisma.followedTeam.findMany({
        where: { userId },
        include: { team: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.followedMatch.findMany({ where: { userId }, select: { matchId: true } }),
    ]);
    const teams = teamRows.map((r) => r.team);
    const matchIds = matchFollows.map((m) => m.matchId);
    const followedTeamCount = teams.length;
    if (!teams.length && !matchIds.length) return { teams: [], others: [], followedTeamCount };

    // LIVE agora, ou agendado no futuro — sem teto de data (next 2 por time).
    const now = new Date();
    const upcomingOr: Prisma.MatchWhereInput['OR'] = [
      { status: 'LIVE' },
      { status: 'SCHEDULED', kickoffAt: { gt: now } },
    ];

    const perTeam = await Promise.all(
      teams.map(async (team) => ({
        team,
        matches: await this.prisma.match.findMany({
          where: {
            AND: [
              { OR: upcomingOr },
              { OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
            ],
          },
          include: UPCOMING_INCLUDE,
          orderBy: { kickoffAt: 'asc' },
          take: 2,
        }),
      })),
    );

    // Só times com jogo, ordenados pelo próximo kickoff (quem joga antes primeiro).
    const groups = perTeam
      .filter((g) => g.matches.length > 0)
      .sort((a, b) => a.matches[0].kickoffAt.getTime() - b.matches[0].kickoffAt.getTime());

    // Partidas seguidas avulsas que ainda não apareceram em nenhum grupo de time.
    const shown = new Set(groups.flatMap((g) => g.matches.map((m) => m.id)));
    let others: FollowedUpcomingMatch[] = [];
    if (matchIds.length) {
      const followed = await this.prisma.match.findMany({
        where: { AND: [{ OR: upcomingOr }, { id: { in: matchIds } }] },
        include: UPCOMING_INCLUDE,
        orderBy: { kickoffAt: 'asc' },
      });
      others = followed.filter((m) => !shown.has(m.id));
    }

    return { teams: groups, others, followedTeamCount };
  }
}
