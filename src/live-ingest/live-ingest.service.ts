import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EspnEvent, EspnService } from './espn.service';

const STATE_TO_STATUS: Record<EspnEvent['state'], MatchStatus> = {
  pre: 'SCHEDULED',
  in: 'LIVE',
  post: 'FINISHED',
};
const RANK: Record<string, number> = { SCHEDULED: 0, LIVE: 1, FINISHED: 2 };

const START_WINDOW_MIN = 15; // start polling this many minutes before kickoff
const END_WINDOW_HOURS = 3; // ...until this long after kickoff

/**
 * ESPN robot: every minute it auto-advances match status (SCHEDULED → LIVE →
 * FINISHED) and live score from the ESPN scoreboard. Polls only inside a match
 * window; runs every minute while a match is LIVE, else scans every 5 minutes.
 * Skips matches an admin took over (autoManaged=false), cancelled ones, and
 * knockout slots without both teams. ESPN status is the source of truth.
 */
@Injectable()
export class LiveIngestService {
  private readonly logger = new Logger(LiveIngestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly espn: EspnService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    // Only the production instance drives the robot (dev shares the same DB).
    if (process.env.NODE_ENV !== 'production') return;
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (e) {
      this.logger.warn(`tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const now = new Date();
    const liveCount = await this.prisma.match.count({
      where: { status: 'LIVE', autoManaged: true },
    });
    // Every minute while something is live; otherwise only every 5 minutes.
    if (liveCount === 0 && now.getMinutes() % 5 !== 0) return;

    const candidates = await this.prisma.match.findMany({
      where: {
        autoManaged: true,
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        OR: [
          { status: 'LIVE' },
          {
            status: 'SCHEDULED',
            kickoffAt: {
              gte: new Date(now.getTime() - START_WINDOW_MIN * 60_000),
              lte: new Date(now.getTime() + END_WINDOW_HOURS * 3_600_000),
            },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        homeScore: true,
        awayScore: true,
        kickoffAt: true,
        externalId: true,
        homeTeam: { select: { shortName: true } },
        awayTeam: { select: { shortName: true } },
      },
    });
    if (candidates.length === 0) return;

    const events = await this.espn.fetchScoreboard();
    if (events.length === 0) return;

    for (const m of candidates) {
      const ev = this.findEvent(events, m);
      if (!ev) continue;

      const data: Prisma.MatchUpdateInput = {};
      if (!m.externalId) data.externalId = ev.id;

      if (/POSTPONED|CANCEL|SUSPEND/i.test(ev.statusName)) {
        // Decision: leave postponed/cancelled to the admin — just log it once.
        this.logger.log(
          `ESPN marks ${m.homeTeam!.shortName}x${m.awayTeam!.shortName} as ${ev.statusName} — left for admin`,
        );
      } else {
        const target = STATE_TO_STATUS[ev.state];
        if (RANK[target] > RANK[m.status]) data.status = target;
        if (ev.state === 'in' || ev.state === 'post') {
          const home = ev.scores[m.homeTeam!.shortName];
          const away = ev.scores[m.awayTeam!.shortName];
          if (home !== undefined && home !== m.homeScore) data.homeScore = home;
          if (away !== undefined && away !== m.awayScore) data.awayScore = away;
        }
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.match.update({ where: { id: m.id }, data });
        this.logger.log(
          `auto-update ${m.homeTeam!.shortName}x${m.awayTeam!.shortName}: ${JSON.stringify(data)}`,
        );
      }
    }
  }

  /** Link an ESPN event to a local match by stored id, else by date + both team codes. */
  private findEvent(
    events: EspnEvent[],
    m: {
      externalId: string | null;
      kickoffAt: Date;
      homeTeam: { shortName: string } | null;
      awayTeam: { shortName: string } | null;
    },
  ): EspnEvent | undefined {
    if (m.externalId) {
      const byId = events.find((e) => e.id === m.externalId);
      if (byId) return byId;
    }
    const home = m.homeTeam?.shortName;
    const away = m.awayTeam?.shortName;
    if (!home || !away) return undefined;
    const day = m.kickoffAt.toISOString().slice(0, 10);
    return events.find(
      (e) =>
        e.dateIso.slice(0, 10) === day &&
        e.abbrs.includes(home) &&
        e.abbrs.includes(away),
    );
  }
}
