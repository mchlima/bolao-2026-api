/**
 * Retroactive discipline backfill from ESPN for already-played matches of a
 * season seeded from another source (e.g. the Brasileirão from ge.globo, which
 * doesn't expose cards). ge.globo gives scores but no cards; ESPN's scoreboard
 * DOES return card events for past dates, so we read them here and fill the
 * disciplinary tiebreak inputs the live robot would have captured.
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/backfill-espn-cards.ts
 *
 * Idempotent: re-runs overwrite the same counts. Matches ESPN events to our
 * matches by the ESPN abbreviation pair (Team.externalIds.espn.code), the same
 * key the live robot uses, disambiguated by kickoff proximity. Also stamps
 * externalIds.espn.id (the event link), preserving the ge ref.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient();
// Parametrizável (default = Brasileirão). Ex.: Libertadores →
//   BACKFILL_SEASON='CONMEBOL Libertadores 2026' BACKFILL_SLUG='conmebol.libertadores'
const SEASON_NAME = process.env.BACKFILL_SEASON ?? 'Campeonato Brasileiro Série A 2026';
const ESPN_SLUG = process.env.BACKFILL_SLUG ?? 'bra.1';

/** FIFA fair-play points for ONE player (single yellow −1; 2nd yellow −3; red −4). */
function playerFairPlay(yellows: number, reds: number): number {
  if (reds === 0) return yellows >= 2 ? -3 : yellows === 1 ? -1 : 0;
  return yellows >= 1 ? -3 : -4;
}

interface EspnDetail {
  yellowCard?: boolean;
  redCard?: boolean;
  team?: { id?: string | number };
  athletesInvolved?: Array<{ id?: string | number }>;
}
interface EspnEvent {
  id: string;
  dateIso: string;
  abbrs: string[];
  cards: Record<string, { yellow: number; red: number }>;
  fairPlay: Record<string, number>;
}

function parseEvent(ev: any): EspnEvent | null {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const idToAbbr: Record<string, string> = {};
  for (const c of comp.competitors ?? []) {
    if (c.team?.abbreviation && c.team?.id) idToAbbr[String(c.team.id)] = c.team.abbreviation;
  }
  const cards: Record<string, { yellow: number; red: number }> = {};
  const perAthlete = new Map<string, { abbr: string; y: number; r: number }>();
  (comp.details ?? []).forEach((d: EspnDetail, i: number) => {
    if (!d.yellowCard && !d.redCard) return;
    const abbr = d.team?.id != null ? idToAbbr[String(d.team.id)] : undefined;
    if (!abbr) return;
    const c = (cards[abbr] ??= { yellow: 0, red: 0 });
    if (d.yellowCard) c.yellow++;
    if (d.redCard) c.red++;
    const athId = d.athletesInvolved?.[0]?.id;
    const key = athId != null ? `${abbr}:${athId}` : `${abbr}:#${i}`;
    const a = perAthlete.get(key) ?? { abbr, y: 0, r: 0 };
    if (d.yellowCard) a.y++;
    if (d.redCard) a.r++;
    perAthlete.set(key, a);
  });
  const fairPlay: Record<string, number> = {};
  for (const abbr of Object.keys(cards)) fairPlay[abbr] = 0;
  for (const { abbr, y, r } of perAthlete.values()) fairPlay[abbr] = (fairPlay[abbr] ?? 0) + playerFairPlay(y, r);
  return { id: String(ev.id), dateIso: ev.date, abbrs: Object.keys(idToAbbr).map((id) => idToAbbr[id]), cards, fairPlay };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

async function run(): Promise<void> {
  const season = await prisma.season.findFirst({ where: { name: SEASON_NAME } });
  if (!season) throw new Error(`Season não encontrada: ${SEASON_NAME}`);

  const matches = await prisma.match.findMany({
    where: { seasonId: season.id, status: 'FINISHED' },
    select: {
      id: true,
      kickoffAt: true,
      externalIds: true,
      homeYellow: true,
      homeRed: true,
      awayYellow: true,
      awayRed: true,
      homeFairPlay: true,
      awayFairPlay: true,
      homeTeam: { select: { externalIds: true } },
      awayTeam: { select: { externalIds: true } },
    },
  });
  console.log(`${matches.length} jogos FINISHED para backfill.`);
  if (!matches.length) return;

  // One scoreboard fetch over the whole played span (±1 day padding).
  const times = matches.map((m) => m.kickoffAt.getTime());
  const from = ymd(new Date(Math.min(...times) - 86_400_000));
  const to = ymd(new Date(Math.max(...times) + 86_400_000));
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SLUG}/scoreboard?dates=${from}-${to}&limit=600`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const data = (await res.json()) as { events?: any[] };
  const events = (data.events ?? []).map(parseEvent).filter((e): e is EspnEvent => !!e);
  console.log(`ESPN: ${events.length} eventos no período ${from}-${to}.`);

  const espnCode = (v: unknown): string | undefined =>
    (v as { espn?: { code?: string } } | null)?.espn?.code;

  let updated = 0,
    unmatched = 0,
    withCards = 0;
  for (const m of matches) {
    const home = espnCode(m.homeTeam?.externalIds);
    const away = espnCode(m.awayTeam?.externalIds);
    if (!home || !away) continue;
    const cands = events.filter((e) => e.abbrs.includes(home) && e.abbrs.includes(away));
    const ev =
      cands.length <= 1
        ? cands[0]
        : cands.reduce((best, e) =>
            Math.abs(new Date(e.dateIso).getTime() - m.kickoffAt.getTime()) <
            Math.abs(new Date(best.dateIso).getTime() - m.kickoffAt.getTime())
              ? e
              : best,
          );
    if (!ev) {
      unmatched++;
      continue;
    }
    const hc = ev.cards[home] ?? { yellow: 0, red: 0 };
    const ac = ev.cards[away] ?? { yellow: 0, red: 0 };
    const hfp = ev.fairPlay[home] ?? 0;
    const afp = ev.fairPlay[away] ?? 0;
    if (hc.yellow || hc.red || ac.yellow || ac.red) withCards++;

    const prev = (m.externalIds as Record<string, unknown>) ?? {};
    await prisma.match.update({
      where: { id: m.id },
      data: {
        homeYellow: hc.yellow,
        homeRed: hc.red,
        awayYellow: ac.yellow,
        awayRed: ac.red,
        homeFairPlay: hfp,
        awayFairPlay: afp,
        externalIds: { ...prev, espn: { ...((prev.espn as object) ?? {}), id: ev.id } },
      },
    });
    updated++;
  }
  console.log(`✓ backfill: ${updated} jogos atualizados (${withCards} com cartões), ${unmatched} sem evento ESPN.`);
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
