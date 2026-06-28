/**
 * Seeds the CONMEBOL Libertadores 2026 from the ESPN public scoreboard:
 * Competition (conmebol.libertadores) → Season → Stage "Fase de Grupos" (GROUPS) +
 * Stage "Mata-mata" (KNOCKOUT) → Rounds (Oitavas/Quartas/Semis/Final) → Matches.
 * Idempotent: matches are keyed by their ESPN event id, so re-runs update in place
 * and pick up newly-published fixtures (e.g. quarterfinals once the R16 resolves).
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-libertadores.ts
 *   DRY_RUN=1 ts-node ... prisma/seed-libertadores.ts   # fetch + map, NO DB writes
 *
 * Source: ESPN owns BOTH structure and live scores for this competition (the live
 * robot already polls by the Competition's espn.slug). Unlike the Brasileirão seed
 * (ge.globo), there's no round-number gap — phases come from event.season.slug and
 * the knockout round from the same. Clubs must already exist (seed-clubs.ts
 * south-america) — verified all 32 group+R16 clubs are present; a missing one is
 * reported rather than created (it would lack ESPN keys and break live ingestion).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// ts-node doesn't auto-load .env — load it ourselves (same as the other seeds).
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DRY = process.env.DRY_RUN === '1';
const prisma = new PrismaClient();

const ESPN_SLUG = 'conmebol.libertadores';
const SCOREBOARD = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SLUG}/scoreboard`;

// Phases we ingest (event.season.slug). The qualifying rounds (first/second/third
// stage) involve clubs outside the main draw and are skipped.
const GROUP_SLUG = 'group-stage';
const KNOCKOUT: Record<string, { name: string; legs: number; order: number }> = {
  'round-of-16': { name: 'Oitavas de final', legs: 2, order: 1 },
  quarterfinals: { name: 'Quartas de final', legs: 2, order: 2 },
  semifinals: { name: 'Semifinais', legs: 2, order: 3 },
  final: { name: 'Final', legs: 1, order: 4 },
};

// ── ESPN scoreboard shapes (only the bits we read) ──
interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  team?: { id?: string; displayName?: string };
}
interface EspnEvent {
  id: string;
  date: string; // ISO UTC
  season?: { slug?: string };
  status?: { type?: { name?: string } };
  competitions: {
    venue?: { fullName?: string; address?: { city?: string; country?: string } };
    competitors: EspnCompetitor[];
  }[];
}

// ESPN caps the number of events per scoreboard call, so a wide range silently
// truncates — fetch ONE MONTH at a time (?dates=YYYYMM) and dedupe by event id.
async function fetchMonth(yyyymm: string): Promise<EspnEvent[]> {
  const res = await fetch(`${SCOREBOARD}?dates=${yyyymm}`, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${yyyymm}`);
  const json = (await res.json()) as { events?: EspnEvent[] };
  return json.events ?? [];
}

const STATUS_MAP: Record<string, 'FINISHED' | 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'CANCELLED'> = {
  STATUS_FULL_TIME: 'FINISHED',
  STATUS_FINAL: 'FINISHED',
  STATUS_SCHEDULED: 'SCHEDULED',
  STATUS_POSTPONED: 'POSTPONED',
  STATUS_CANCELED: 'CANCELLED',
  STATUS_FIRST_HALF: 'LIVE',
  STATUS_SECOND_HALF: 'LIVE',
  STATUS_HALFTIME: 'LIVE',
  STATUS_IN_PROGRESS: 'LIVE',
};

function pick(c: EspnEvent['competitions'][0], side: 'home' | 'away'): EspnCompetitor | undefined {
  return c.competitors.find((x) => x.homeAway === side);
}

const isKnockout = (slug?: string): slug is string => !!slug && slug in KNOCKOUT;

async function run(): Promise<void> {
  console.log(`Seeding CONMEBOL Libertadores 2026 (ESPN)${DRY ? ' — DRY RUN' : ''}…`);

  // 1. Pull the whole season in quarter-ish ranges and dedupe by event id. Keep only
  //    the group stage + knockout (skip qualifiers).
  const months = ['202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609', '202610', '202611', '202612'];
  const byId = new Map<string, EspnEvent>();
  for (const ym of months) for (const ev of await fetchMonth(ym)) byId.set(ev.id, ev);
  const events = [...byId.values()]
    .filter((e) => e.season?.slug === GROUP_SLUG || isKnockout(e.season?.slug))
    .sort((a, b) => a.date.localeCompare(b.date));
  const groupEvents = events.filter((e) => e.season?.slug === GROUP_SLUG);
  const koEvents = events.filter((e) => isKnockout(e.season?.slug));
  console.log(`  ESPN: ${groupEvents.length} jogos de grupo + ${koEvents.length} de mata-mata`);

  // 2. Resolve every ESPN team id → our Team. Prisma can't filter a JSON path by a
  //    list, so pull all clubs once and index by espn id in JS. Error on any miss
  //    (clubs are pre-seeded; a missing one would lack ESPN keys).
  const espnIds = [
    ...new Set(events.flatMap((e) => e.competitions[0].competitors.map((c) => c.team?.id).filter(Boolean) as string[])),
  ];
  const allClubs = await prisma.team.findMany({ where: { type: 'CLUB' }, select: { id: true, externalIds: true } });
  const teamByEspn = new Map<string, string>();
  for (const t of allClubs) {
    const id = (t.externalIds as { espn?: { id?: string } })?.espn?.id;
    if (id) teamByEspn.set(id, t.id);
  }
  const missing = espnIds.filter((i) => !teamByEspn.has(i));
  if (missing.length) {
    const names = new Map(events.flatMap((e) => e.competitions[0].competitors.map((c) => [c.team?.id, c.team?.displayName])));
    throw new Error(
      `Clubes não encontrados (rode seed-clubs.ts south-america antes): ${missing.map((i) => `${names.get(i)} (espn ${i})`).join(', ')}`,
    );
  }
  console.log(`  ${espnIds.length} clubes nos confrontos (todos presentes ✓)`);

  if (DRY) {
    // Mostra o que SERIA criado, sem escrever. Distribuição por fase + amostra.
    const byRound: Record<string, number> = {};
    for (const e of koEvents) {
      const r = KNOCKOUT[e.season!.slug!].name;
      byRound[r] = (byRound[r] ?? 0) + 1;
    }
    console.log('  Mata-mata por rodada:', JSON.stringify(byRound));
    console.log('  Amostra de oitavas:');
    for (const e of koEvents.slice(0, 8)) {
      const c = e.competitions[0];
      console.log(
        `    ${e.date.slice(0, 10)}  ${pick(c, 'home')?.team?.displayName} x ${pick(c, 'away')?.team?.displayName}  [${e.status?.type?.name}]`,
      );
    }
    console.log('DRY RUN — nada gravado.');
    return;
  }

  // 3. Competition (idempotent by sport+slug).
  const sport = await prisma.sport.findFirstOrThrow({ where: { slug: 'futebol' } });
  const competition = await prisma.competition.upsert({
    where: { sportId_slug: { sportId: sport.id, slug: ESPN_SLUG } },
    update: { externalIds: { espn: { slug: ESPN_SLUG } } },
    create: {
      sportId: sport.id,
      name: 'CONMEBOL Libertadores',
      slug: ESPN_SLUG,
      urlSlug: 'libertadores',
      type: 'LEAGUE_CUP',
      confederation: 'CONMEBOL',
      externalIds: { espn: { slug: ESPN_SLUG } },
    },
  });

  // 4. Season 2026 (idempotent by name).
  const seasonData = {
    competitionId: competition.id,
    name: 'CONMEBOL Libertadores 2026',
    slug: 'libertadores-2026',
    seasonLabel: '2026',
    format: 'GROUPS_KNOCKOUT' as const,
    status: 'ONGOING' as const,
  };
  const existingSeason = await prisma.season.findFirst({ where: { name: seasonData.name } });
  const season = existingSeason
    ? await prisma.season.update({ where: { id: existingSeason.id }, data: seasonData })
    : await prisma.season.create({ data: seasonData });

  // 5. Stages: Grupos (order 1) + Mata-mata (order 2).
  const groupStage =
    (await prisma.stage.findFirst({ where: { seasonId: season.id, order: 1 } })) ??
    (await prisma.stage.create({
      data: { seasonId: season.id, name: 'Fase de Grupos', format: 'GROUP', order: 1, tiebreakPreset: 'CONMEBOL' },
    }));
  const koStage =
    (await prisma.stage.findFirst({ where: { seasonId: season.id, order: 2 } })) ??
    (await prisma.stage.create({
      data: { seasonId: season.id, name: 'Mata-mata', format: 'KNOCKOUT', order: 2 },
    }));

  // Knockout rounds (created on demand, cached).
  const roundCache = new Map<string, string>();
  async function knockoutRound(slug: string): Promise<string> {
    if (roundCache.has(slug)) return roundCache.get(slug)!;
    const def = KNOCKOUT[slug];
    const round =
      (await prisma.round.findFirst({ where: { stageId: koStage.id, name: def.name } })) ??
      (await prisma.round.create({
        data: { stageId: koStage.id, name: def.name, legs: def.legs, order: def.order },
      }));
    roundCache.set(slug, round.id);
    return round.id;
  }

  // 6. Stadiums (upsert by name+city) from ESPN venues.
  const stadiumByKey = new Map<string, string | null>();
  async function stadiumId(v: EspnEvent['competitions'][0]['venue']): Promise<string | null> {
    const name = v?.fullName;
    const city = v?.address?.city;
    if (!name || !city) return null;
    const key = `${name}|${city}`;
    if (stadiumByKey.has(key)) return stadiumByKey.get(key)!;
    const row = await prisma.stadium.upsert({
      where: { name_city: { name, city } },
      update: { country: v?.address?.country ?? undefined },
      create: { name, city, country: v?.address?.country ?? 'América do Sul' },
    });
    stadiumByKey.set(key, row.id);
    return row.id;
  }

  // 7. Matches — keyed by ESPN event id (stable across re-runs / new fixtures).
  const existing = await prisma.match.findMany({
    where: { seasonId: season.id },
    select: { id: true, matchNumber: true, externalIds: true },
  });
  const matchByEspn = new Map<string, { id: string; matchNumber: number | null; externalIds: unknown }>();
  let maxNum = 0;
  for (const m of existing) {
    if (m.matchNumber != null) maxNum = Math.max(maxNum, m.matchNumber);
    const eid = (m.externalIds as { espn?: { id?: string } })?.espn?.id;
    if (eid) matchByEspn.set(eid, m);
  }

  // Leg derivation for two-legged knockout ties: pair the (≤2) matches of the same
  // round + team-set, order by date → leg 1 (ida) / 2 (volta).
  const legOf = new Map<string, number>();
  {
    const ties = new Map<string, EspnEvent[]>();
    for (const e of koEvents) {
      if (KNOCKOUT[e.season!.slug!].legs < 2) continue;
      const c = e.competitions[0];
      const ids = [pick(c, 'home')?.team?.id, pick(c, 'away')?.team?.id].filter(Boolean).sort();
      ties.set(`${e.season!.slug}:${ids.join('-')}`, [...(ties.get(`${e.season!.slug}:${ids.join('-')}`) ?? []), e]);
    }
    for (const list of ties.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date)).forEach((e, i) => legOf.set(e.id, i + 1));
    }
  }

  let created = 0;
  let updated = 0;
  let played = 0;
  for (const e of events) {
    const slug = e.season!.slug!;
    const isGroup = slug === GROUP_SLUG;
    const c = e.competitions[0];
    const home = pick(c, 'home');
    const away = pick(c, 'away');
    const homeTeamId = home?.team?.id ? (teamByEspn.get(home.team.id) ?? null) : null;
    const awayTeamId = away?.team?.id ? (teamByEspn.get(away.team.id) ?? null) : null;

    const status = STATUS_MAP[e.status?.type?.name ?? ''] ?? 'SCHEDULED';
    const finished = status === 'FINISHED';
    const hs = finished ? Number(home?.score ?? 0) : 0;
    const as = finished ? Number(away?.score ?? 0) : 0;
    if (finished) played++;
    const winner = finished ? (hs > as ? 'HOME' : hs < as ? 'AWAY' : 'DRAW') : null;

    const prevExt = (matchByEspn.get(e.id)?.externalIds as Record<string, unknown>) ?? {};
    const data = {
      seasonId: season.id,
      stageId: isGroup ? groupStage.id : koStage.id,
      roundId: isGroup ? null : await knockoutRound(slug),
      leg: isGroup ? null : (legOf.get(e.id) ?? 1),
      kickoffAt: new Date(e.date),
      stadiumId: await stadiumId(c.venue),
      homeTeamId,
      awayTeamId,
      status: status as 'FINISHED' | 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'CANCELLED',
      homeScore: hs,
      awayScore: as,
      winner: winner as 'HOME' | 'AWAY' | 'DRAW' | null,
      externalIds: { ...prevExt, espn: { id: e.id } },
    };

    const hit = matchByEspn.get(e.id);
    if (hit) {
      await prisma.match.update({ where: { id: hit.id }, data });
      updated++;
    } else {
      await prisma.match.create({ data: { ...data, matchNumber: ++maxNum } });
      created++;
    }
  }

  console.log(
    `✓ ${competition.name} 2026 — ${teamByEspn.size} clubes, ${events.length} jogos (${created} criados, ${updated} atualizados, ${played} encerrados).`,
  );
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
