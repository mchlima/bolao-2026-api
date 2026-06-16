import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { MatchSummaryService } from './match-summary/match-summary.service';

// One-off backfill: re-ingest every FINISHED match's ESPN summary so the new
// PERIOD_END (whistle) events — and any other parser fixes — land on matches
// ingested before the parser change. Throttled to stay gentle on ESPN.
// Run inside the container: `node dist/backfill-summaries.js`.
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const summary = app.get(MatchSummaryService);

  const matches = await prisma.match.findMany({
    where: { status: 'FINISHED' },
    select: { id: true },
    orderBy: { kickoffAt: 'asc' },
  });
  // eslint-disable-next-line no-console
  console.log(`[backfill] ${matches.length} finished matches`);

  let ok = 0;
  let fail = 0;
  for (const m of matches) {
    try {
      await summary.ingest(m.id);
      ok++;
    } catch (e) {
      fail++;
      // eslint-disable-next-line no-console
      console.warn(`[backfill] ${m.id} failed: ${(e as Error).message.split('\n')[0]}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // throttle ESPN
    if ((ok + fail) % 25 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[backfill] ${ok + fail}/${matches.length} (ok=${ok} fail=${fail})`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[backfill] done: ok=${ok} fail=${fail}`);
  await app.close();
  process.exit(0);
}

void main();
