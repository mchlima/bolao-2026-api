/**
 * One-off backfill: persist lineups for already-played matches (the live robot
 * only ingests inside the match window, so historical games need this once).
 * Idempotent — re-runs upsert. Auto-heals any unseen player.
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/backfill-lineups.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
import { EspnService } from '../src/live-ingest/espn.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { EventsService } from '../src/events/events.service';
import { MonitorService } from '../src/monitor/monitor.service';
import { MatchSummaryService } from '../src/match-summary/match-summary.service';
import { SlotResolverService } from '../src/structure/slot-resolver.service';
import { StandingsService } from '../src/structure/standings.service';

for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(
  '\n',
)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined)
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const prisma = new PrismaService();
  const svc = new MatchSummaryService(
    prisma,
    new EspnService(new AlertsService()),
    new EventsService(),
    new MonitorService(prisma, new AlertsService()),
    new SlotResolverService(prisma, new StandingsService(prisma)),
  );

  // Matches that have been played and carry an ESPN event id.
  const matches = await prisma.match.findMany({
    where: {
      status: { in: ['FINISHED', 'LIVE'] },
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    select: {
      id: true,
      externalIds: true,
      homeTeam: { select: { shortName: true } },
      awayTeam: { select: { shortName: true } },
    },
    orderBy: { kickoffAt: 'asc' },
  });
  console.log(`backfilling ${matches.length} played match(es)`);

  let withLineup = 0;
  let empty = 0;
  for (const [i, m] of matches.entries()) {
    try {
      const n = await svc.ingest(m.id);
      if (n) withLineup++;
      else empty++;
      if ((i + 1) % 10 === 0 || n)
        console.log(
          `  [${i + 1}/${matches.length}] ${m.homeTeam?.shortName}x${m.awayTeam?.shortName}: ${n} entries`,
        );
    } catch (e) {
      console.warn(
        `  [${i + 1}/${matches.length}] failed: ${(e as Error).message.split('\n')[0]}`,
      );
    }
    await sleep(120);
  }
  console.log(
    `done — ${withLineup} with lineup, ${empty} without (no ESPN lineup published)`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
