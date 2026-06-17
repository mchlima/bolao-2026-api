import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';

// How often the watchdog evaluates robot heartbeats + DB health. 30s gives
// quick detection while a single check is just one tiny SQL round trip.
const WATCHDOG_CRON = '*/30 * * * * *';

// A registered robot must complete a tick at least this often or it's considered
// stuck. 3 min comfortably absorbs a transient DB/ESPN blip on a 10–20s robot
// (a few failed ticks) without crying wolf — only a real hang or sustained
// failure keeps a robot silent this long.
const DEFAULT_STALE_MS = 180_000;

// DB connection saturation, as a fraction of Postgres `max_connections`. Alert
// at ≥ HIGH, clear once back under LOW — the gap is hysteresis so a count
// hovering at the threshold can't flap the alert on and off.
const CONN_HIGH = 0.85;
const CONN_LOW = 0.7;

// The DB probe may take this long before we declare the bank unreachable. Short
// so the watchdog never hangs on a wedged connection.
const DB_PROBE_MS = 3000;

interface Beat {
  last: number; // epoch ms of the last successful tick
  staleAfterMs: number;
  stuck: boolean; // currently inside a stuck episode (de-dups the alert)
}

/**
 * Operational watchdog. Two jobs, one cron (production only — the robots it
 * watches also run only in production):
 *
 *  1. Robot heartbeats — each ingestion robot calls `beat()` at the end of a
 *     successful tick. If a robot goes silent past its threshold (a hung tick
 *     leaves its `running` guard stuck true, or every tick is failing), we fire
 *     one "Robô travado" alert and an all-clear when it beats again.
 *
 *  2. Database health — a `SELECT 1`-style probe that also reads the live
 *     connection count. A failed/timed-out probe means the bank is unreachable
 *     ("fora do ar"); a connection count near `max_connections` means it's
 *     about to refuse new ones ("perto do limite") — the exact shape of the
 *     522 incident. Each fires once on the way in and an all-clear on recovery.
 *
 * Every alert is gated on a state transition, so a multi-minute outage sends one
 * heads-up, not a flood. Alerts are fire-and-forget (AlertsService never throws).
 */
@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);
  private readonly beats = new Map<string, Beat>();
  private dbDown = false;
  private connHigh = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Record a successful tick for `robot` (registers it on first call). A beat
   * arriving after the robot was flagged stuck fires the all-clear. `staleAfterMs`
   * is read on first registration; later calls just refresh the timestamp.
   */
  beat(robot: string, staleAfterMs: number = DEFAULT_STALE_MS): void {
    const b = this.beats.get(robot);
    if (!b) {
      this.beats.set(robot, { last: Date.now(), staleAfterMs, stuck: false });
      return;
    }
    b.last = Date.now();
    if (b.stuck) {
      b.stuck = false;
      this.logger.log(`robot ${robot} recovered`);
      void this.alerts.notify('Robô normalizado', `${robot} voltou a responder. ✅`);
    }
  }

  @Cron(WATCHDOG_CRON)
  async watchdog(): Promise<void> {
    // Only the production instance watches — dev shares the DB but its robots are
    // idle (NODE_ENV-gated), so it has nothing to report and no webhook to spam.
    if (process.env.NODE_ENV !== 'production') return;
    // DB first: a down bank starves every robot of its heartbeat, so knowing the
    // bank's state lets checkRobots suppress the redundant "robô travado" flood.
    await this.checkDb();
    this.checkRobots();
  }

  private checkRobots(): void {
    // While the bank is down the robots can't beat (their queries fail) — that's
    // expected and already alerted as "Banco fora do ar"; don't double-page.
    if (this.dbDown) return;
    const now = Date.now();
    for (const [robot, b] of this.beats) {
      const staleFor = now - b.last;
      if (!b.stuck && staleFor > b.staleAfterMs) {
        b.stuck = true;
        const secs = Math.round(staleFor / 1000);
        this.logger.warn(`robot ${robot} stuck — no heartbeat for ${secs}s`);
        void this.alerts.notify(
          'Robô travado',
          `${robot} sem heartbeat há ${secs}s — provável tick travado ou falhando. ⚠️`,
          'high',
        );
      }
    }
  }

  private async checkDb(): Promise<void> {
    let row: { used: number; max: number } | undefined;
    try {
      const rows = await this.withTimeout(
        this.prisma.$queryRaw<Array<{ used: number; max: number }>>`
          SELECT
            (SELECT count(*)::int FROM pg_stat_activity
               WHERE datname = current_database()) AS used,
            (SELECT setting::int FROM pg_settings
               WHERE name = 'max_connections') AS max`,
        DB_PROBE_MS,
        'db probe',
      );
      row = rows[0];
      if (this.dbDown) {
        this.dbDown = false;
        this.logger.log('database recovered');
        void this.alerts.notify('Banco normalizado', 'Voltou a responder. ✅');
        // Give the robots a fresh window to resume beating — their lastBeat went
        // stale during the outage and they only tick again seconds from now, so
        // without this checkRobots would false-flag them in the recovery gap.
        const now = Date.now();
        for (const b of this.beats.values()) b.last = now;
      }
    } catch (e) {
      if (!this.dbDown) {
        this.dbDown = true;
        const msg = (e as Error).message.split('\n')[0];
        this.logger.warn(`database unreachable: ${msg}`);
        void this.alerts.notify('Banco fora do ar', `Sem resposta: ${msg}. 🔴`, 'high');
      }
      return; // can't assess connection count while it's down
    }

    if (!row || !row.max) return;
    const ratio = row.used / row.max;
    if (!this.connHigh && ratio >= CONN_HIGH) {
      this.connHigh = true;
      const pct = Math.round(ratio * 100);
      this.logger.warn(`db connections near limit: ${row.used}/${row.max} (${pct}%)`);
      void this.alerts.notify(
        'Banco perto do limite',
        `${row.used}/${row.max} conexões (${pct}%) — risco de recusar novas. ⚠️`,
        'high',
      );
    } else if (this.connHigh && ratio < CONN_LOW) {
      this.connHigh = false;
      const pct = Math.round(ratio * 100);
      this.logger.log(`db connections back to normal: ${row.used}/${row.max} (${pct}%)`);
      void this.alerts.notify('Banco normalizado', `Conexões em ${row.used}/${row.max} (${pct}%). ✅`);
    }
  }

  /** Race a promise against a timeout, always clearing the timer (so a winning
   * query can't leave a dangling reject → unhandled rejection). */
  private async withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
