import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

/**
 * Keeps fixture DATES fresh from ge.globo for ongoing seasons. ge.globo is our
 * structure source but it publishes some dates late (postponed games — clubs in
 * continental cups — come back as `data_realizacao: null`, seeded as POSTPONED
 * with a placeholder kickoff). Once the date is published, this job picks it up
 * and flips the match back to SCHEDULED so the live robot can track it (the robot
 * only polls matches with a kickoff near now, so a stale/placeholder date would
 * make a postponed game invisible forever). Daily; production only (dev shares
 * the DB). Never touches FINISHED/LIVE/CANCELLED matches.
 */
@Injectable()
export class SeasonRefreshService {
  private readonly logger = new Logger(SeasonRefreshService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // Daily at 06:00. Dates change at most a few times a day, so this cadence is plenty.
  @Cron('0 6 * * *')
  async tick(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (e) {
      this.logger.warn(`refresh failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<void> {
    const seasons = await this.prisma.season.findMany({
      where: { status: 'ONGOING' },
      select: { id: true, competition: { select: { externalIds: true } } },
    });
    for (const s of seasons) {
      const ge = (s.competition.externalIds as { ge?: { championshipId?: string; phase?: string } } | null)?.ge;
      if (ge?.championshipId && ge?.phase) {
        await this.refreshSeason(s.id, ge.championshipId, ge.phase);
      }
    }
  }

  /** Naive BRT → UTC (Brazil is a fixed -03:00 since DST was abolished). */
  private brtToUtc(naive: string): Date {
    return new Date(`${naive}:00-03:00`);
  }

  private async refreshSeason(seasonId: string, championshipId: string, phase: string): Promise<void> {
    const matches = await this.prisma.match.findMany({
      where: { seasonId },
      select: { id: true, externalIds: true, status: true, kickoffAt: true },
    });
    // Index our matches by their ge.globo game id.
    const byGe = new Map<string, (typeof matches)[number]>();
    for (const m of matches) {
      const gid = (m.externalIds as { ge?: { id?: string } } | null)?.ge?.id;
      if (gid) byGe.set(gid, m);
    }
    const numbers = [
      ...new Set(
        (
          await this.prisma.round.findMany({
            where: { stage: { seasonId } },
            select: { number: true },
          })
        )
          .map((r) => r.number)
          .filter((n): n is number => n != null),
      ),
    ];
    if (!byGe.size || !numbers.length) return;

    const base = `https://api.globoesporte.globo.com/tabela/${championshipId}/fase/${phase}`;
    let updated = 0;
    for (const n of numbers) {
      let games: GeGame[];
      try {
        const res = await fetch(`${base}/rodada/${n}/jogos/`, {
          headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        games = (await res.json()) as GeGame[];
      } catch {
        continue; // a flaky round fetch shouldn't abort the whole refresh
      }
      for (const g of games) {
        const m = byGe.get(String(g.id));
        if (!m) continue;
        // Never override a played/decided match — ESPN owns those.
        if (m.status === 'FINISHED' || m.status === 'LIVE' || m.status === 'CANCELLED') continue;

        if (g.data_realizacao) {
          const kickoff = this.brtToUtc(g.data_realizacao);
          // New date published, or a reschedule moved it: adopt it and (re)open as SCHEDULED.
          if (m.status === 'POSTPONED' || m.kickoffAt.getTime() !== kickoff.getTime()) {
            await this.prisma.match.update({
              where: { id: m.id },
              data: { kickoffAt: kickoff, status: 'SCHEDULED' },
            });
            updated++;
          }
        } else if (m.status !== 'POSTPONED') {
          // Date pulled back to TBD (re-postponed) — reflect it.
          await this.prisma.match.update({ where: { id: m.id }, data: { status: 'POSTPONED' } });
          updated++;
        }
      }
    }
    if (updated) {
      this.events.emit(`tournament:${seasonId}`);
      this.logger.log(`season ${seasonId}: ${updated} fixture date(s) refreshed from ge.globo`);
    }
  }
}

interface GeGame {
  id: number;
  data_realizacao: string | null;
}
