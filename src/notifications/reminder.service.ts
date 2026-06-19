import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
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

  /** Notify everyone who follows either side of each match (idempotent per type). */
  private async fanOut(matches: ReminderMatch[], type: string, body: string): Promise<void> {
    if (!matches.length) return;
    for (const m of matches) {
      const followers = await this.prisma.followedTeam.findMany({
        where: { teamId: { in: [m.homeTeamId!, m.awayTeamId!] } },
        select: { userId: true },
        distinct: ['userId'], // following both sides → one notification
      });
      if (!followers.length) continue;

      const home = m.homeTeam?.name || m.homeTeam?.shortName || 'Casa';
      const away = m.awayTeam?.name || m.awayTeam?.shortName || 'Fora';
      const fresh = await this.notifications.createMissing(
        type,
        m.id,
        { title: `${home} x ${away}`, body, url: `/futebol/torneios/${m.seasonId}/matches/${m.id}` },
        followers.map((f) => f.userId),
      );
      if (fresh.length) {
        this.logger.log(`${type} ${home} x ${away}: ${fresh.length} usuário(s).`);
      }
    }
  }
}
