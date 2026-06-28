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

// ESPN standings → the 8 groups (A–H) with their team ids. The scoreboard events
// don't carry the group, so group membership comes from here (needed for tables).
interface EspnStandings {
  children?: { name?: string; displayName?: string; standings?: { entries?: { team?: { id?: string } }[] } }[];
}
async function fetchGroups(): Promise<{ letter: string; order: number; espnTeamIds: string[] }[]> {
  const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${ESPN_SLUG}/standings`, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`ESPN standings ${res.status}`);
  const json = (await res.json()) as EspnStandings;
  return (json.children ?? []).map((g, i) => ({
    letter: (g.name ?? g.displayName ?? '').replace(/^Group\s+/i, '').trim() || String.fromCharCode(65 + i),
    order: i + 1,
    espnTeamIds: (g.standings?.entries ?? []).map((e) => e.team?.id).filter(Boolean) as string[],
  }));
}

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

  // Groups A–H + their teams (from ESPN standings) so the group tables can be built.
  const groups = await fetchGroups();
  const groupIdByEspnTeam = new Map<string, string>();
  const groupLetterByEspnTeam = new Map<string, string>();
  for (const g of groups) {
    const row =
      (await prisma.group.findFirst({ where: { stageId: groupStage.id, name: g.letter } })) ??
      (await prisma.group.create({ data: { stageId: groupStage.id, name: g.letter, order: g.order } }));
    for (const espnId of g.espnTeamIds) {
      const teamId = teamByEspn.get(espnId);
      if (!teamId) continue;
      await prisma.groupTeam.upsert({
        where: { groupId_teamId: { groupId: row.id, teamId } },
        update: {},
        create: { groupId: row.id, teamId },
      });
      groupIdByEspnTeam.set(espnId, row.id);
      groupLetterByEspnTeam.set(espnId, g.letter);
    }
  }
  // Top 2 of each group advance to the knockout (classification band for the table).
  await prisma.stage.update({
    where: { id: groupStage.id },
    data: { zones: [{ from: 1, to: 2, label: 'Classificados às oitavas', tone: 'green' }] },
  });

  const koStage =
    (await prisma.stage.findFirst({ where: { seasonId: season.id, order: 2 } })) ??
    (await prisma.stage.create({
      data: { seasonId: season.id, name: 'Mata-mata', format: 'KNOCKOUT', order: 2 },
    }));

  // Knockout rounds — ALL phases up front (Oitavas..Final) so a chave mostra o caminho
  // inteiro mesmo antes de existirem os jogos das fases seguintes. (Libertadores não
  // tem disputa de 3º lugar.)
  const KO_ORDER = ['round-of-16', 'quarterfinals', 'semifinals', 'final'];
  const roundIdBySlug = new Map<string, string>();
  for (const slug of KO_ORDER) {
    const def = KNOCKOUT[slug];
    const r =
      (await prisma.round.findFirst({ where: { stageId: koStage.id, name: def.name } })) ??
      (await prisma.round.create({
        data: { stageId: koStage.id, name: def.name, legs: def.legs, order: def.order },
      }));
    roundIdBySlug.set(slug, r.id);
  }

  // Ties (nós do bracket). Oitavas: concretas — agrupa os 2 jogos de cada confronto num
  // tie com seus times. Fases seguintes: ties placeholder com rótulo "a definir" pra a
  // chave renderizar o caminho todo. tieId/leg são setados nos jogos no loop abaixo.
  const tieIdByEvent = new Map<string, string>();
  const legByEvent = new Map<string, number>();
  const r16 = koEvents.filter((e) => e.season!.slug === 'round-of-16');
  const pairs = new Map<string, EspnEvent[]>();
  for (const e of r16) {
    const c = e.competitions[0];
    const ids = [pick(c, 'home')?.team?.id, pick(c, 'away')?.team?.id].filter(Boolean).sort();
    pairs.set(ids.join('-'), [...(pairs.get(ids.join('-')) ?? []), e]);
  }
  let tieOrder = 1;
  for (const list of [...pairs.values()].sort((a, b) => a[0].date.localeCompare(b[0].date))) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const c = list[0].competitions[0];
    const he = pick(c, 'home')?.team?.id;
    const ae = pick(c, 'away')?.team?.id;
    const homeTeamId = he ? (teamByEspn.get(he) ?? null) : null;
    const awayTeamId = ae ? (teamByEspn.get(ae) ?? null) : null;
    const round16 = roundIdBySlug.get('round-of-16')!;
    const tie =
      (await prisma.tie.findFirst({ where: { roundId: round16, order: tieOrder } })) ??
      (await prisma.tie.create({ data: { roundId: round16, order: tieOrder, homeTeamId, awayTeamId } }));
    await prisma.tie.update({ where: { id: tie.id }, data: { homeTeamId, awayTeamId } });
    list.forEach((e, i) => {
      tieIdByEvent.set(e.id, tie.id);
      legByEvent.set(e.id, i + 1);
    });
    tieOrder++;
  }
  // Placeholder ties pras rodadas cujos jogos ainda não existem (TBD via rótulo).
  const PLACEHOLDERS: [string, number, string][] = [
    ['quarterfinals', 4, 'Classificado das oitavas'],
    ['semifinals', 2, 'Classificado das quartas'],
    ['final', 1, 'Classificado das semifinais'],
  ];
  for (const [slug, count, label] of PLACEHOLDERS) {
    const roundId = roundIdBySlug.get(slug)!;
    for (let i = 0; i < count; i++) {
      const exists = await prisma.tie.findFirst({ where: { roundId, order: tieOrder } });
      if (!exists)
        await prisma.tie.create({
          data: { roundId, order: tieOrder, homeSourceLabel: label, awaySourceLabel: label },
        });
      tieOrder++;
    }
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
      groupId: isGroup && home?.team?.id ? (groupIdByEspnTeam.get(home.team.id) ?? null) : null,
      groupName: isGroup && home?.team?.id ? (groupLetterByEspnTeam.get(home.team.id) ?? null) : null,
      roundId: isGroup ? null : (roundIdBySlug.get(slug) ?? null),
      tieId: isGroup ? null : (tieIdByEvent.get(e.id) ?? null),
      leg: isGroup ? null : (legByEvent.get(e.id) ?? 1),
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
