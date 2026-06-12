import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EspnEvent, EspnService } from './espn.service';
import { EventsService } from '../events/events.service';

const STATE_TO_STATUS: Record<EspnEvent['state'], MatchStatus> = {
  pre: 'SCHEDULED',
  in: 'LIVE',
  post: 'FINISHED',
};
const RANK: Record<string, number> = { SCHEDULED: 0, LIVE: 1, FINISHED: 2 };

const START_WINDOW_MIN = 15; // start polling this many minutes before kickoff
const END_WINDOW_HOURS = 3; // ...until this long after kickoff
// Keep reconciling a just-FINISHED match this long after its last change, to
// catch an immediate official/VAR score correction — then it goes idle again.
const POST_FINISH_RECONCILE_MIN = 5;

// Tick cadence (6-field cron, with seconds). 15s gives ~15s worst-case
// detection of a kickoff or goal while staying gentle on ESPN's unofficial
// endpoint. A tick with no match in window costs just one indexed query.
const TICK_CRON = '*/15 * * * * *';

/**
 * ESPN robot: every 15s it reconciles any match inside its window (15 min before
 * kickoff until 3h after) against the ESPN scoreboard — auto-advancing status
 * (SCHEDULED → LIVE → FINISHED) and live score. Because it polls through the
 * whole window (not only once a match is already LIVE), a kickoff or goal is
 * reflected within ~15s. When no match is near, a tick is a single indexed query
 * and makes no ESPN call. Skips matches an admin took over (autoManaged=false),
 * cancelled ones, and knockout slots without both teams. ESPN is the truth.
 */
@Injectable()
export class LiveIngestService {
  private readonly logger = new Logger(LiveIngestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly espn: EspnService,
    private readonly events: EventsService,
  ) {}

  @Cron(TICK_CRON)
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
    // One indexed query every tick: the matches in their window (LIVE, or
    // SCHEDULED and near kickoff). Empty in-window set ⇒ return before any ESPN
    // call, so an idle tick is cheap and a kickoff is still caught within ~15s.
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
          {
            // Recently finished: catch a late official correction, then go idle.
            status: 'FINISHED',
            updatedAt: {
              gte: new Date(now.getTime() - POST_FINISH_RECONCILE_MIN * 60_000),
            },
          },
        ],
      },
      select: {
        id: true,
        tournamentId: true,
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
        this.events.emit(`match:${m.id}`, `tournament:${m.tournamentId}`);
        this.logger.log(
          `auto-update ${m.homeTeam!.shortName}x${m.awayTeam!.shortName}: ${JSON.stringify(data)}`,
        );
      }
    }
  }

  /**
   * Link an ESPN event to a local match: by stored id first, else by BOTH team
   * codes — a fixture's home+away pair is unique in the tournament. The kickoff
   * instant is only a tiebreaker for the (essentially impossible) case of the
   * same pair appearing twice in the feed. Matching by team pair + instant,
   * NEVER by local calendar day, avoids the midnight-UTC boundary bug.
   */
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
    const pairMatches = events.filter(
      (e) => e.abbrs.includes(home) && e.abbrs.includes(away),
    );
    if (pairMatches.length <= 1) return pairMatches[0];
    const kickoff = m.kickoffAt.getTime();
    return pairMatches.reduce((best, e) =>
      Math.abs(new Date(e.dateIso).getTime() - kickoff) <
      Math.abs(new Date(best.dateIso).getTime() - kickoff)
        ? e
        : best,
    );
  }
}
