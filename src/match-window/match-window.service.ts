import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

// Tick cadence (6-field cron, with seconds). 10s keeps the prediction lock and
// the cross-instance sync within ~10s, costing two indexed queries per tick.
const TICK_CRON = '*/10 * * * * *';

/**
 * Emits realtime events that the in-process writers can't, for the SSE clients
 * connected to THIS instance:
 *
 *  1. Prediction window closing at kickoff — a purely time-based edge
 *     (`acceptsPredictions` flips at kickoff) that writes nothing to the DB, so
 *     the admin/upsert/ESPN-robot emitters never fire for it. Without this, a
 *     screen still showing a bet form keeps it open past kickoff.
 *
 *  2. Cross-instance changes — the event bus is in-process and the ESPN robot
 *     only runs in production, so a second instance sharing the same DB (e.g.
 *     dev) never sees the robot's score/status writes. We poll `updatedAt` and
 *     re-emit so every instance notifies its own clients no matter who wrote.
 *
 * Runs in all environments. A server restart resets the cursors to "now" (no
 * backfill storm) and dropped SSE clients resync on reconnect, so a restart that
 * lands exactly on a kickoff is self-healing rather than a missed edge.
 */
@Injectable()
export class MatchWindowService {
  private readonly logger = new Logger(MatchWindowService.name);
  private lastTick = new Date();
  private lastSeenUpdate = new Date();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  @Cron(TICK_CRON)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const since = this.lastTick;
    const now = new Date();
    try {
      await this.emitKickoffCloses(since, now);
      await this.emitExternalUpdates();
    } catch (e) {
      this.logger.warn(`tick failed: ${(e as Error).message}`);
    } finally {
      this.lastTick = now;
      this.running = false;
    }
  }

  /** (1) Matches whose auto window closed in (since, now]: SCHEDULED, not closed
   * early by an admin (predictionsOpen null or true), both teams set. */
  private async emitKickoffCloses(since: Date, now: Date): Promise<void> {
    const closed = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        OR: [{ predictionsOpen: null }, { predictionsOpen: true }],
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        kickoffAt: { gt: since, lte: now },
      },
      select: { id: true, tournamentId: true },
    });
    for (const m of closed) {
      this.events.emit(`match:${m.id}`, `tournament:${m.tournamentId}`);
    }
    if (closed.length > 0) {
      this.logger.log(
        `predictions closed at kickoff for ${closed.length} match(es)`,
      );
    }
  }

  /** (2) Matches written since we last looked (by any instance) — re-emit so
   * this instance's SSE clients refetch even when another process did the write. */
  private async emitExternalUpdates(): Promise<void> {
    const updated = await this.prisma.match.findMany({
      where: { updatedAt: { gt: this.lastSeenUpdate } },
      select: { id: true, tournamentId: true, updatedAt: true },
    });
    for (const m of updated) {
      this.events.emit(`match:${m.id}`, `tournament:${m.tournamentId}`);
      if (m.updatedAt > this.lastSeenUpdate) this.lastSeenUpdate = m.updatedAt;
    }
  }
}
