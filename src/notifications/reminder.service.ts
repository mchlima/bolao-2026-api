import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { PhaseWeightService } from '../scoring/phase-weight.service';
import { NotificationsService } from './notifications.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const MATCH_SELECT = {
  id: true,
  seasonId: true,
  homeTeamId: true,
  awayTeamId: true,
  homeTeam: { select: { name: true, shortName: true } },
  awayTeam: { select: { name: true, shortName: true } },
} satisfies Prisma.MatchSelect;

type ReminderMatch = Prisma.MatchGetPayload<{ select: typeof MATCH_SELECT }>;

/**
 * Match notifications for followed teams. Each type fires once per user+match
 * (unique key user+type+match — the minutely run never double-sends):
 *  - MATCH_REMINDER_1D: between 1h and 24h before kickoff (day-ahead heads-up)
 *  - MATCH_REMINDER_1H: the final hour before kickoff
 *  - MATCH_STARTED: when the match goes live (kickoff)
 *
 * Plus a full-time result (MATCH_FINISHED) sent ONLY to users who predicted the
 * match, with each user's own points — see notifyFinished.
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly scoring: ScoringService,
    private readonly phaseWeight: PhaseWeightService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    try {
      await this.remindWindow(
        'MATCH_REMINDER_1D',
        HOUR_MS,
        DAY_MS,
        'É daqui a 1 dia — prepare o seu palpite!',
      );
      await this.remindWindow(
        'MATCH_REMINDER_1H',
        0,
        HOUR_MS,
        'Começa daqui a pouco — não esqueça o seu palpite!',
      );
      await this.notifyStarted();
      await this.notifyFinished();
    } catch (err) {
      this.logger.error(`Falha no tick de lembretes: ${(err as Error).message}`);
    }
  }

  /** Pre-kickoff reminder: matches with kickoff within (now+fromMs, now+toMs]. */
  private async remindWindow(type: string, fromMs: number, toMs: number, body: string): Promise<void> {
    const now = Date.now();
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        kickoffAt: { gt: new Date(now + fromMs), lte: new Date(now + toMs) },
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
      select: MATCH_SELECT,
    });
    await this.fanOut(matches, type, body);
  }

  /** Kickoff: a followed team's match just went live. */
  private async notifyStarted(): Promise<void> {
    const now = Date.now();
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'LIVE',
        // recency guard so a match stuck LIVE doesn't notify hours later
        kickoffAt: { gte: new Date(now - 3 * HOUR_MS), lte: new Date(now + 5 * 60 * 1000) },
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
      select: MATCH_SELECT,
    });
    await this.fanOut(matches, 'MATCH_STARTED', 'Bola rolando! Acompanhe ao vivo.');
  }

  /**
   * Full-time: a match just finished. Unlike the reminders (which target team
   * followers), this goes ONLY to users who predicted the match, and each gets a
   * personal body with their own points. Idempotent per user+match, and bounded
   * to recently-finished matches so a deploy never back-blasts old results.
   */
  private async notifyFinished(): Promise<void> {
    const now = Date.now();
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        // only games that finished recently (kickoff in the last 6h) — avoids
        // alerting historical results when the feature first ships
        kickoffAt: { gte: new Date(now - 6 * HOUR_MS) },
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
      select: {
        id: true,
        seasonId: true,
        roundId: true,
        homeScore: true,
        awayScore: true,
        homeTeam: { select: { name: true, shortName: true } },
        awayTeam: { select: { name: true, shortName: true } },
      },
    });
    if (!matches.length) return;

    const seasonIds = [...new Set(matches.map((m) => m.seasonId))];
    const weightByRound = await this.phaseWeight.byRound(seasonIds);

    for (const m of matches) {
      const predictions = await this.prisma.prediction.findMany({
        where: { matchId: m.id },
        select: { userId: true, homeScore: true, awayScore: true },
      });
      if (!predictions.length) continue;

      const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Casa';
      const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Fora';
      const weight = (m.roundId && weightByRound.get(m.roundId)) || 1;
      const result = `${home} ${m.homeScore} x ${m.awayScore} ${away}`;
      const title = `Fim de jogo: ${home} x ${away}`;
      const url = `/futebol/torneios/${m.seasonId}/matches/${m.id}`;

      const entries = predictions.map((p) => {
        const { points } = this.scoring.score(
          { home: p.homeScore, away: p.awayScore },
          { home: m.homeScore, away: m.awayScore },
          weight,
        );
        const palpite = `${p.homeScore} x ${p.awayScore}`;
        const body =
          points === 0
            ? `${result}. Seu palpite (${palpite}) não pontuou desta vez.`
            : `${result}. Seu palpite (${palpite}) valeu ${points} ${points === 1 ? 'ponto' : 'pontos'}!`;
        return { userId: p.userId, payload: { title, body, url } };
      });

      const fresh = await this.notifications.createMissingPerUser(
        'MATCH_FINISHED',
        m.id,
        entries,
      );
      if (fresh.length) {
        this.logger.log(`MATCH_FINISHED ${home} x ${away}: ${fresh.length} palpiteiro(s).`);
      }
    }
  }

  /** Notify everyone who follows either side OR the match itself (idempotent per type). */
  private async fanOut(matches: ReminderMatch[], type: string, body: string): Promise<void> {
    if (!matches.length) return;
    for (const m of matches) {
      const userIds = await this.audienceFor(m.id, m.homeTeamId!, m.awayTeamId!);
      if (!userIds.length) continue;

      const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Casa';
      const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Fora';
      const fresh = await this.notifications.createMissing(
        type,
        m.id,
        { title: `${home} x ${away}`, body, url: `/futebol/torneios/${m.seasonId}/matches/${m.id}` },
        userIds,
      );
      if (fresh.length) {
        this.logger.log(`${type} ${home} x ${away}: ${fresh.length} usuário(s).`);
      }
    }
  }

  /**
   * Who to notify about a match: everyone who follows either team, UNION everyone
   * who opted into this specific match (FollowedMatch) — deduplicated.
   */
  private async audienceFor(
    matchId: string,
    homeTeamId: string,
    awayTeamId: string,
  ): Promise<string[]> {
    const [teamFollowers, matchFollowers] = await Promise.all([
      this.prisma.followedTeam.findMany({
        where: { teamId: { in: [homeTeamId, awayTeamId] } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.followedMatch.findMany({
        where: { matchId },
        select: { userId: true },
      }),
    ]);
    return [
      ...new Set([
        ...teamFollowers.map((f) => f.userId),
        ...matchFollowers.map((f) => f.userId),
      ]),
    ];
  }
}
