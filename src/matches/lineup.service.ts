import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EspnLineupTeam, EspnService } from '../live-ingest/espn.service';
import { espnCode, espnExternalId, espnSlug } from '../common/external-ids';

export interface MatchLineup {
  available: boolean;
  reason?: 'pending'; // lineups not published yet / no ESPN event
  home?: EspnLineupTeam;
  away?: EspnLineupTeam;
}

const UNAVAILABLE: MatchLineup = { available: false, reason: 'pending' };
const CACHE_TTL_MS = 30_000;

/**
 * Live lineups for a match, sourced from the ESPN summary feed (the same public
 * API the live robot already uses). The match usually carries its ESPN event id
 * (`externalIds.espn`) once the robot links it near kickoff; before that we
 * resolve the id on demand from the scoreboard by matching team codes, so
 * pre-match lineups (published ~1h ahead) still show. Cached briefly per event
 * to avoid hammering ESPN under the realtime refetches.
 */
@Injectable()
export class LineupService {
  private readonly cache = new Map<string, { at: number; data: MatchLineup }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly espn: EspnService,
  ) {}

  async forMatch(id: string): Promise<MatchLineup> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: {
        externalIds: true,
        kickoffAt: true,
        homeTeam: { select: { externalIds: true } },
        awayTeam: { select: { externalIds: true } },
        season: { select: { competition: { select: { externalIds: true } } } },
      },
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }

    const slug = espnSlug(match.season.competition.externalIds) ?? 'fifa.world';
    const eventId =
      espnExternalId(match.externalIds) ?? (await this.resolveEventId(match, slug));
    if (!eventId) return UNAVAILABLE;

    const hit = this.cache.get(eventId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

    const teams = await this.espn.fetchSummary(slug, eventId);
    const data = this.toLineup(teams);
    this.cache.set(eventId, { at: Date.now(), data });
    return data;
  }

  private toLineup(teams: EspnLineupTeam[] | null): MatchLineup {
    const home = teams?.find((t) => t.homeAway === 'home');
    const away = teams?.find((t) => t.homeAway === 'away');
    if (!home?.players.length && !away?.players.length) return UNAVAILABLE;
    return { available: true, home, away };
  }

  /** Find the ESPN event id from the scoreboard when not yet linked on the match. */
  private async resolveEventId(
    match: {
      kickoffAt: Date;
      homeTeam: { externalIds: unknown } | null;
      awayTeam: { externalIds: unknown } | null;
    },
    slug: string,
  ): Promise<string | undefined> {
    const home = espnCode(match.homeTeam?.externalIds ?? null);
    const away = espnCode(match.awayTeam?.externalIds ?? null);
    if (!home || !away) return undefined;
    const day = match.kickoffAt.toISOString().slice(0, 10).replace(/-/g, '');
    const events = await this.espn.fetchScoreboard(slug, day);
    const ev = events.find(
      (e) => e.abbrs.includes(home) && e.abbrs.includes(away),
    );
    return ev?.id;
  }
}
