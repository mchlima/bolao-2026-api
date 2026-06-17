/**
 * Dev helper: re-ingest the ESPN summary for a SINGLE match by id, so a change to
 * the event parser surfaces on an already-played game without a full backfill.
 *   npx ts-node src/scripts/reingest-one.ts <matchId>
 */
import { PrismaService } from '../prisma/prisma.service';
import { EspnService } from '../live-ingest/espn.service';
import { AlertsService } from '../alerts/alerts.service';
import { EventsService } from '../events/events.service';
import { MonitorService } from '../monitor/monitor.service';
import { MatchSummaryService } from '../match-summary/match-summary.service';
import { SlotResolverService } from '../structure/slot-resolver.service';
import { StandingsService } from '../structure/standings.service';

async function main(): Promise<void> {
  const matchId = process.argv[2];
  if (!matchId) throw new Error('uso: reingest-one.ts <matchId>');
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
  await summary.ingest(matchId);
  const byType = await prisma.matchEvent.groupBy({
    by: ['type'],
    where: { matchId },
    _count: { _all: true },
  });
  console.log(
    'eventos por tipo:',
    JSON.stringify(byType.map((b) => ({ type: b.type, n: b._count._all }))),
  );
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
