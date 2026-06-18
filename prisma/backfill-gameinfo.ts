/**
 * Backfill crowd (attendance) + main referee from ESPN's per-match `summary`
 * feed (gameInfo) for already-played matches — the live robot only fills these
 * going forward, so past fixtures need a one-off sweep.
 *
 * Usage:
 *   ts-node --project prisma/tsconfig.seed.json prisma/backfill-gameinfo.ts [--season=<seasonId>] [--all]
 *
 * Matches are looked up by their stored ESPN event id (externalIds.espn.id).
 * By default only fills matches missing attendance AND referee; --all re-reads
 * every match with an event id (refreshes values). Idempotent.
 */
import { PrismaClient } from '@prisma/client';
import { normalizeRefereeName } from '../src/common/referee';

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const espnId = (v: unknown): string | undefined =>
  (v as { espn?: { id?: string } } | null)?.espn?.id;
const espnSlug = (v: unknown): string | undefined =>
  (v as { espn?: { slug?: string } } | null)?.espn?.slug;

interface SummaryGameInfo {
  gameInfo?: {
    attendance?: number;
    officials?: Array<{
      displayName?: string;
      fullName?: string;
      position?: { displayName?: string };
    }>;
  };
}

function parseGameInfo(d: SummaryGameInfo): {
  attendance: number | null;
  referee: string | null;
} {
  const gi = d.gameInfo;
  const attendance =
    typeof gi?.attendance === 'number' && gi.attendance > 0 ? gi.attendance : null;
  let referee: string | null = null;
  for (const o of gi?.officials ?? []) {
    if ((o.position?.displayName ?? '').toLowerCase() === 'referee') {
      referee = normalizeRefereeName(o.displayName ?? o.fullName);
      break;
    }
  }
  return { attendance, referee };
}

async function main() {
  const args = process.argv.slice(2);
  const seasonArg = args.find((a) => a.startsWith('--season='))?.split('=')[1];
  const all = args.includes('--all');

  const matches = await prisma.match.findMany({
    where: {
      ...(seasonArg ? { seasonId: seasonArg } : {}),
      status: { in: ['LIVE', 'FINISHED'] },
      ...(all ? {} : { AND: [{ attendance: null }, { referee: null }] }),
    },
    select: {
      id: true,
      externalIds: true,
      attendance: true,
      referee: true,
      homeTeam: { select: { shortName: true } },
      awayTeam: { select: { shortName: true } },
      season: { select: { competition: { select: { externalIds: true } } } },
    },
    orderBy: { kickoffAt: 'asc' },
  });

  console.log(`${matches.length} match(es) to check`);
  let filled = 0,
    skipped = 0,
    failed = 0;

  for (const m of matches) {
    const id = espnId(m.externalIds);
    if (!id) {
      skipped++;
      continue;
    }
    const slug = espnSlug(m.season.competition.externalIds) ?? 'fifa.world';
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${id}`;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
      });
      if (!res.ok) {
        failed++;
        console.warn(`  ! ${m.homeTeam?.shortName}x${m.awayTeam?.shortName}: HTTP ${res.status}`);
        if (res.status === 429) await sleep(5000);
        continue;
      }
      const data = (await res.json()) as SummaryGameInfo;
      const { attendance, referee } = parseGameInfo(data);

      const data2: { attendance?: number; referee?: string } = {};
      if (attendance != null && attendance !== m.attendance) data2.attendance = attendance;
      if (referee && referee !== m.referee) data2.referee = referee;
      if (Object.keys(data2).length === 0) {
        skipped++;
      } else {
        await prisma.match.update({ where: { id: m.id }, data: data2 });
        filled++;
        console.log(
          `  ✓ ${m.homeTeam?.shortName}x${m.awayTeam?.shortName}: ` +
            `${data2.attendance != null ? `público ${data2.attendance}` : ''} ${data2.referee ?? ''}`.trim(),
        );
      }
    } catch (e) {
      failed++;
      console.warn(`  ! ${m.homeTeam?.shortName}x${m.awayTeam?.shortName}: ${(e as Error).message}`);
    }
    await sleep(300); // be gentle with ESPN
  }

  console.log(`\nDone. filled=${filled} skipped=${skipped} failed=${failed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
