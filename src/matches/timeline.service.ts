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

// A delay with no specific reason — the generic half of an ESPN stoppage pair.
const isGenericDelay = (detail: string | null): boolean => !detail || detail === 'Jogo paralisado';

/**
 * Sort weight from the displayed minute. ESPN caps clock.value at 5400 (90:00)
 * for EVERY stoppage-time event, so ordering by it ties all "90'+x" events and a
 * late-ingested goal can land after the final whistle. Derive the order from the
 * minute string instead: base*100 + added time ("90'+8'" → 9008, "90'+9'" →
 * 9009). Falls back to the (capped) clockValue mapped to the same scale.
 */
function minuteOrder(minute: string | null, clockValue: number): number {
  const m = minute?.match(/(\d+)\s*'?\s*(?:\+\s*(\d+))?/);
  if (m) return Number(m[1]) * 100 + (m[2] ? Number(m[2]) : 0);
  return Math.floor(clockValue / 60) * 100;
}
// Within a period the whistle (PERIOD_END) always sorts last — even versus an
// event sharing its minute.
const endLast = (type: string): number => (type === 'PERIOD_END' ? 1 : 0);

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
            clockValue: true,
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

    // Re-order in JS: the DB sort by clockValue can't separate stoppage-time
    // events (ESPN caps it at 5400), so derive the order from the minute and pin
    // each period's whistle last. See minuteOrder().
    const ordered = [...match.events].sort(
      (a, b) =>
        a.period - b.period ||
        endLast(a.type) - endLast(b.type) ||
        minuteOrder(a.minute, a.clockValue) - minuteOrder(b.minute, b.clockValue) ||
        a.clockValue - b.clockValue,
    );

    const byPeriod = new Map<number, TimelineEvent[]>();
    for (const e of ordered) {
      const side = e.teamId === match.homeTeamId ? 'home' : e.teamId === match.awayTeamId ? 'away' : null;
      const arr = byPeriod.get(e.period) ?? byPeriod.set(e.period, []).get(e.period)!;
      // ESPN emits each stoppage as a PAIR of Start Delay entries — one carrying
      // the reason, one generic ("Jogo paralisado"). Collapse delays sharing a
      // minute into a single row, keeping the most specific reason.
      if (e.type === 'DELAY') {
        const dup = arr.find((x) => x.type === 'DELAY' && x.minute === e.minute);
        if (dup) {
          if (isGenericDelay(dup.detail) && !isGenericDelay(e.detail)) dup.detail = e.detail;
          continue;
        }
      }
      arr.push({
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
