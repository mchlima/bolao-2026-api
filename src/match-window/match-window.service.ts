import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

// Tick cadence (6-field cron, with seconds). 20s keeps the prediction lock
// within ~20s of kickoff while costing just one indexed query per tick.
const TICK_CRON = '*/20 * * * * *';

/**
 * Emits realtime events at the *time-based* edges that no DB write produces.
 *
 * A match's prediction window closes automatically at kickoff —
 * `PredictionsService.acceptsPredictions` returns false once `now >= kickoffAt`
 * for a SCHEDULED match with no admin override. That edge is pure time: nothing
 * mutates the row, so the admin/robot/upsert emitters never fire for it, and
 * every screen still showing a bet form (home "próximas partidas", tournament,
 * match detail) keeps it open until some unrelated event happens to refetch.
 *
 * This cron watches for matches crossing that boundary since the previous tick
 * and emits their match + tournament rooms, so every subscribed screen refetches
 * and locks the form. Runs in all environments (predictions close in dev too,
 * which shares the same DB) — each instance only notifies its own SSE clients.
 *
 * The actual LIVE/FINISHED + score transitions already emit (ESPN robot in prod,
 * admin edits elsewhere), so this only fills the open→closed gap.
 */
@Injectable()
export class MatchWindowService {
  private readonly logger = new Logger(MatchWindowService.name);
  private lastTick = new Date();
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
      // Matches whose auto prediction window closed in (since, now]: SCHEDULED,
      // no admin override (predictionsOpen wins when set), both teams known.
      const closed = await this.prisma.match.findMany({
        where: {
          status: 'SCHEDULED',
          predictionsOpen: null,
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
    } catch (e) {
      this.logger.warn(`tick failed: ${(e as Error).message}`);
    } finally {
      this.lastTick = now;
      this.running = false;
    }
  }
}
