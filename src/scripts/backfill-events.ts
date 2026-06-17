/**
 * One-off backfill: re-ingest the ESPN summary (lineup + events + stats) for every
 * FINISHED match, so already-played games gain the timeline event kinds and the
 * `detail` field added after they were first ingested (penalty miss/save, VAR,
 * second yellow, delays, goal method). Idempotent — safe to re-run; it upserts.
 *
 * Standalone on purpose: it wires MatchSummaryService by hand instead of booting
 * AppModule, so NO cron robots start alongside it, and its realtime emit() is
 * inert (no SSE subscribers in this process). Connects via DATABASE_URL.
 *
 * Run inside the API container (shares the prod DATABASE_URL):
 *   docker compose exec api node dist/scripts/backfill-events.js [limit]
 * An optional positional `limit` ingests only the first N (oldest) matches — handy
 * for a smoke test before the full run.
 */
import { PrismaService } from '../prisma/prisma.service';
import { EspnService } from '../live-ingest/espn.service';
import { AlertsService } from '../alerts/alerts.service';
import { EventsService } from '../events/events.service';
import { MonitorService } from '../monitor/monitor.service';
import { MatchSummaryService } from '../match-summary/match-summary.service';
import { SlotResolverService } from '../structure/slot-resolver.service';
import { StandingsService } from '../structure/standings.service';

const PACING_MS = 1500; // gap between matches — be gentle on ESPN's public API
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const limit = Number(process.argv[2]) || undefined;
  const prisma = new PrismaService();
  const espn = new EspnService(new AlertsService());
  const events = new EventsService();
  const summary = new MatchSummaryService(
    prisma,
    espn,
    events,
    new MonitorService(prisma, new AlertsService()),
    new SlotResolverService(prisma, new StandingsService(prisma)),
  );

  const matches = await prisma.match.findMany({
    where: {
      status: 'FINISHED',
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    orderBy: { kickoffAt: 'asc' },
    take: limit,
    select: {
      id: true,
      homeTeam: { select: { shortName: true } },
      awayTeam: { select: { shortName: true } },
    },
  });

  console.log(
    `[backfill] ${matches.length} finished match(es)${limit ? ` (limited to ${limit})` : ''}`,
  );
  let ok = 0;
  let fail = 0;
  let withEvents = 0;
  let totalEvents = 0;

  for (const m of matches) {
    const label = `${m.homeTeam?.shortName ?? '?'}x${m.awayTeam?.shortName ?? '?'}`;
    try {
      await summary.ingest(m.id);
      const n = await prisma.matchEvent.count({ where: { matchId: m.id } });
      ok++;
      if (n > 0) withEvents++;
      totalEvents += n;
      console.log(`[${ok + fail}/${matches.length}] ${label} → ${n} event(s)`);
    } catch (e) {
      fail++;
      console.warn(
        `[${ok + fail}/${matches.length}] FAIL ${label}: ${(e as Error).message.split('\n')[0]}`,
      );
    }
    await sleep(PACING_MS);
  }

  console.log(
    `[backfill] done — ok=${ok} fail=${fail}; ${withEvents} match(es) have events, ${totalEvents} events total`,
  );
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
