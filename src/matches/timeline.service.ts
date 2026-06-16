import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TimelineEvent {
  type: string; // GOAL / OWN_GOAL / PENALTY_GOAL / PENALTY_MISSED / YELLOW / RED / SECOND_YELLOW / SUBSTITUTION / VAR / DELAY / PERIOD_END
  minute: string | null;
  side: 'home' | 'away' | null;
  player: string | null; // scorer / booked / subbed-in
  related: string | null; // assist / subbed-off
  detail: string | null; // goal method, VAR decision, delay reason, penalty miss/save
}
export interface TimelinePeriod {
  period: number;
  label: string;
  events: TimelineEvent[];
}
export interface MatchTimeline {
  available: boolean;
  periods: TimelinePeriod[];
}

const periodLabel = (p: number): string =>
  p === 1
    ? '1º tempo'
    : p === 2
      ? '2º tempo'
      : p === 3
        ? 'Prorrogação · 1º tempo'
        : p === 4
          ? 'Prorrogação · 2º tempo'
          : p === 5
            ? 'Disputa de pênaltis'
            : `Período ${p}`;

/**
 * Serves a match's event timeline from OUR database (persisted by the robot's
 * MatchSummaryService). Grouped by period, ordered by clock. Names come off the
 * linked Player. Empty until the robot has ingested events.
 */
@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async forMatch(id: string): Promise<MatchTimeline> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        events: {
          orderBy: [{ period: 'asc' }, { clockValue: 'asc' }],
          select: {
            type: true,
            minute: true,
            period: true,
            teamId: true,
            detail: true,
            player: { select: { name: true } },
            related: { select: { name: true } },
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    }
    if (!match.events.length) return { available: false, periods: [] };

    const byPeriod = new Map<number, TimelineEvent[]>();
    for (const e of match.events) {
      const side = e.teamId === match.homeTeamId ? 'home' : e.teamId === match.awayTeamId ? 'away' : null;
      (byPeriod.get(e.period) ?? byPeriod.set(e.period, []).get(e.period)!).push({
        type: e.type,
        minute: e.minute,
        side,
        player: e.player?.name ?? null,
        related: e.related?.name ?? null,
        detail: e.detail,
      });
    }
    const periods = [...byPeriod.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([period, events]) => ({ period, label: periodLabel(period), events }));
    return { available: true, periods };
  }
}
