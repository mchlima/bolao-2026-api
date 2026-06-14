import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EspnEvent, EspnService } from './espn.service';
import { EventsService } from '../events/events.service';
import { SlotResolverService } from '../structure/slot-resolver.service';

const DAY_MS = 86_400_000;
const ymdUtc = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * The ESPN `dates` query (YYYYMMDD or YYYYMMDD-YYYYMMDD) covering a group of
 * in-window matches, so each fixture is fetched by its own kickoff date instead
 * of ESPN's lagging default day (which omits the next day's first match). Padded
 * ±1 day to absorb any drift between our stored kickoff and ESPN's event date at
 * the UTC boundary; extra events are harmless (findEvent filters by id/abbrs).
 */
function scoreboardDates(group: Array<{ kickoffAt: Date }>): string {
  const times = group.map((m) => m.kickoffAt.getTime());
  const from = ymdUtc(Math.min(...times) - DAY_MS);
  const to = ymdUtc(Math.max(...times) + DAY_MS);
  return from === to ? from : `${from}-${to}`;
}

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
    private readonly resolver: SlotResolverService,
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
        seasonId: true,
        status: true,
        homeScore: true,
        awayScore: true,
        homeYellow: true,
        homeRed: true,
        awayYellow: true,
        awayRed: true,
        homeFairPlay: true,
        awayFairPlay: true,
        kickoffAt: true,
        externalId: true,
        homeTeam: { select: { shortName: true, espnAbbr: true } },
        awayTeam: { select: { shortName: true, espnAbbr: true } },
        season: {
          select: { competition: { select: { espnLeagueSlug: true } } },
        },
      },
    });
    if (candidates.length === 0) return;

    // Group by ESPN league slug (from the Competition) so one fetch per league
    // serves every match of that tournament in the window.
    const bySlug = new Map<string, typeof candidates>();
    for (const m of candidates) {
      const slug = m.season.competition.espnLeagueSlug ?? 'fifa.world';
      (bySlug.get(slug) ?? bySlug.set(slug, []).get(slug)!).push(m);
    }

    // Seasons where a match transitioned to FINISHED this tick → resolve brackets.
    const finishedSeasons = new Set<string>();

    for (const [slug, group] of bySlug) {
      const events = await this.espn.fetchScoreboard(slug, scoreboardDates(group));
      if (events.length === 0) continue;

      for (const m of group) {
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
            // Match scores by ESPN abbreviation (espnAbbr), NOT the display
            // shortName — shortName may be localized (pt-BR). Fallback for safety.
            const home =
              ev.scores[m.homeTeam!.espnAbbr ?? m.homeTeam!.shortName];
            const away =
              ev.scores[m.awayTeam!.espnAbbr ?? m.awayTeam!.shortName];
            if (home !== undefined && home !== m.homeScore)
              data.homeScore = home;
            if (away !== undefined && away !== m.awayScore)
              data.awayScore = away;

            // Discipline (cards + fair-play) from the same feed — keyed by espnAbbr.
            const homeAbbr = m.homeTeam!.espnAbbr ?? m.homeTeam!.shortName;
            const awayAbbr = m.awayTeam!.espnAbbr ?? m.awayTeam!.shortName;
            const hc = ev.cards[homeAbbr] ?? { yellow: 0, red: 0 };
            const ac = ev.cards[awayAbbr] ?? { yellow: 0, red: 0 };
            const hfp = ev.fairPlay[homeAbbr] ?? 0;
            const afp = ev.fairPlay[awayAbbr] ?? 0;
            if (hc.yellow !== m.homeYellow) data.homeYellow = hc.yellow;
            if (hc.red !== m.homeRed) data.homeRed = hc.red;
            if (ac.yellow !== m.awayYellow) data.awayYellow = ac.yellow;
            if (ac.red !== m.awayRed) data.awayRed = ac.red;
            if (hfp !== m.homeFairPlay) data.homeFairPlay = hfp;
            if (afp !== m.awayFairPlay) data.awayFairPlay = afp;
          }
        }

        if (Object.keys(data).length > 0) {
          await this.prisma.match.update({ where: { id: m.id }, data });
          this.events.emit(`match:${m.id}`, `tournament:${m.seasonId}`);
          this.logger.log(
            `auto-update ${m.homeTeam!.shortName}x${m.awayTeam!.shortName}: ${JSON.stringify(data)}`,
          );
          if (data.status === 'FINISHED') finishedSeasons.add(m.seasonId);
        }
      }
    }

    // A finished match may decide a group or feed a knockout slot — re-resolve.
    for (const seasonId of finishedSeasons) {
      try {
        await this.resolver.resolveSeason(seasonId);
      } catch (e) {
        this.logger.warn(
          `slot resolve failed for season ${seasonId}: ${(e as Error).message}`,
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
      homeTeam: { shortName: string; espnAbbr: string | null } | null;
      awayTeam: { shortName: string; espnAbbr: string | null } | null;
    },
  ): EspnEvent | undefined {
    if (m.externalId) {
      const byId = events.find((e) => e.id === m.externalId);
      if (byId) return byId;
    }
    // Match by ESPN abbreviation (espnAbbr), not the localizable shortName.
    const home = m.homeTeam?.espnAbbr ?? m.homeTeam?.shortName;
    const away = m.awayTeam?.espnAbbr ?? m.awayTeam?.shortName;
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
