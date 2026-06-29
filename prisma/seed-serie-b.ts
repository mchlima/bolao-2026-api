/**
 * Seeds the Campeonato Brasileiro Série B 2026 from the ESPN public scoreboard:
 * Competition (bra.2) → Season → Stage (Pontos Corridos, LEAGUE) → Group "Série B" →
 * 20 GroupTeams → 38 Rounds → 380 Matches. Idempotent (matches keyed by ESPN id).
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-serie-b.ts
 *   DRY_RUN=1 ts-node ... prisma/seed-serie-b.ts   # fetch + derive, NO DB writes
 *
 * Unlike the Série A seed (ge.globo), ESPN is the source here: the Série B clubs are
 * already seeded from ESPN (seed-clubs south-america, bra.2) so no manual ge→espn map
 * is needed. ESPN doesn't expose the round number for leagues, so we DERIVE it: with
 * the games sorted by date, a new round starts whenever a club would play twice — a
 * 20-team double round-robin yields exactly 38 rounds of 10. The live robot owns
 * scores going forward (Competition.espn.slug = bra.2).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// ts-node doesn't auto-load .env — load it ourselves (same as the other seeds).
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DRY = process.env.DRY_RUN === '1';
const prisma = new PrismaClient();

const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
  },
});
const BUCKET = process.env.STORAGE_BUCKET ?? '';
const PUBLIC = (process.env.STORAGE_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

const ESPN_SLUG = 'bra.2';
const SCOREBOARD = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SLUG}/scoreboard`;

interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  team?: { id?: string; displayName?: string };
}
interface EspnEvent {
  id: string;
  date: string;
  status?: { type?: { name?: string } };
  competitions: {
    venue?: { fullName?: string; address?: { city?: string; country?: string } };
    competitors: EspnCompetitor[];
  }[];
}

async function competitionLogos(): Promise<{ logoUrl: string | null; logoUrlDark: string | null }> {
  if (!BUCKET || !PUBLIC) return { logoUrl: null, logoUrlDark: null };
  const res = await fetch(SCOREBOARD);
  if (!res.ok) return { logoUrl: null, logoUrlDark: null };
  const logos = ((await res.json()) as { leagues?: { logos?: { href?: string; rel?: string[] }[] }[] })
    ?.leagues?.[0]?.logos ?? [];
  const def = logos.find((l) => l.rel?.includes('default'))?.href;
  const dark = logos.find((l) => l.rel?.includes('dark'))?.href;
  const upload = async (href: string, key: string): Promise<string> => {
    const r = await fetch(href);
    if (!r.ok) throw new Error(`download ${href}: ${r.status}`);
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: Buffer.from(await r.arrayBuffer()),
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${PUBLIC}/${key}`;
  };
  return {
    logoUrl: def ? await upload(def, `competitions/${ESPN_SLUG}/logo.png`) : null,
    logoUrlDark: dark ? await upload(dark, `competitions/${ESPN_SLUG}/logo-dark.png`) : null,
  };
}

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

/** Derive the matchday for each event. Games sorted by date; a new round starts as
 *  soon as a club would appear twice in the running round. Returns roundByEvent. */
function deriveRounds(events: EspnEvent[]): Map<string, number> {
  const roundByEvent = new Map<string, number>();
  let round = 1;
  let seen = new Set<string>();
  for (const e of events) {
    const ids = e.competitions[0].competitors.map((c) => c.team?.id).filter(Boolean) as string[];
    if (ids.some((id) => seen.has(id))) {
      round++;
      seen = new Set();
    }
    roundByEvent.set(e.id, round);
    ids.forEach((id) => seen.add(id));
  }
  return roundByEvent;
}

async function run(): Promise<void> {
  console.log(`Seeding Campeonato Brasileiro Série B 2026 (ESPN)${DRY ? ' — DRY RUN' : ''}…`);

  // 1. Pull the whole season month-by-month and dedupe; sort by date for round derivation.
  const months = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609', '202610', '202611', '202612'];
  const byId = new Map<string, EspnEvent>();
  for (const ym of months) for (const ev of await fetchMonth(ym)) byId.set(ev.id, ev);
  const events = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  const roundByEvent = deriveRounds(events);
  const numRounds = Math.max(0, ...roundByEvent.values());
  console.log(`  ESPN: ${events.length} jogos, ${numRounds} rodadas derivadas`);

  // 2. Resolve every ESPN team id → our Team (clubs pre-seeded from bra.2; error on miss).
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
    throw new Error(`Clubes não encontrados (rode seed-clubs.ts south-america antes): ${missing.map((i) => `${names.get(i)} (espn ${i})`).join(', ')}`);
  }
  console.log(`  ${espnIds.length} clubes (todos presentes ✓)`);

  if (DRY) {
    const dist: Record<number, number> = {};
    for (const n of roundByEvent.values()) dist[n] = (dist[n] ?? 0) + 1;
    const bad = Object.entries(dist).filter(([, c]) => c !== 10);
    console.log(`  rodadas: ${numRounds} | tamanhos != 10: ${bad.length ? JSON.stringify(bad) : 'nenhum ✓'}`);
    console.log('DRY RUN — nada gravado.');
    return;
  }

  // 3. Competition (idempotent by sport+slug). Crest mirrored from ESPN into R2.
  const sport = await prisma.sport.findFirstOrThrow({ where: { slug: 'futebol' } });
  const { logoUrl, logoUrlDark } = await competitionLogos();
  const competition = await prisma.competition.upsert({
    where: { sportId_slug: { sportId: sport.id, slug: ESPN_SLUG } },
    update: { externalIds: { espn: { slug: ESPN_SLUG } }, ...(logoUrl ? { logoUrl, logoUrlDark } : {}) },
    create: {
      sportId: sport.id,
      name: 'Brasileirão Série B',
      slug: ESPN_SLUG,
      urlSlug: 'brasileirao-serie-b',
      type: 'LEAGUE',
      country: 'Brasil',
      confederation: 'CBF',
      externalIds: { espn: { slug: ESPN_SLUG } },
      logoUrl,
      logoUrlDark,
    },
  });

  // Período = min/max das datas dos jogos (truncado ao dia, UTC).
  const dayUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const startDate = events.length ? dayUtc(events[0].date) : null;
  const endDate = events.length ? dayUtc(events[events.length - 1].date) : null;

  // 4. Season 2026 (idempotent by name).
  const seasonData = {
    competitionId: competition.id,
    name: 'Brasileirão Série B 2026',
    slug: 'brasileirao-serie-b-2026',
    seasonLabel: '2026',
    format: 'LEAGUE' as const,
    status: 'ONGOING' as const,
    startDate,
    endDate,
  };
  const existingSeason = await prisma.season.findFirst({ where: { name: seasonData.name } });
  const season = existingSeason
    ? await prisma.season.update({ where: { id: existingSeason.id }, data: seasonData })
    : await prisma.season.create({ data: seasonData });

  // 5. Stage (Pontos Corridos) + single Group (the league table) + 20 GroupTeams.
  const stage =
    (await prisma.stage.findFirst({ where: { seasonId: season.id, order: 1 } })) ??
    (await prisma.stage.create({
      data: { seasonId: season.id, name: 'Pontos Corridos', format: 'LEAGUE', order: 1, tiebreakPreset: 'BRASILEIRAO' },
    }));
  const group =
    (await prisma.group.findFirst({ where: { stageId: stage.id, order: 1 } })) ??
    (await prisma.group.create({ data: { stageId: stage.id, name: 'Série B', order: 1 } }));
  // Top 4 promoted to Série A; bottom 4 relegated to Série C.
  await prisma.stage.update({
    where: { id: stage.id },
    data: {
      zones: [
        { from: 1, to: 4, label: 'Acesso à Série A', tone: 'green' },
        { from: 17, to: 20, label: 'Rebaixamento à Série C', tone: 'red' },
      ],
    },
  });
  for (const espnId of espnIds) {
    const teamId = teamByEspn.get(espnId);
    if (!teamId) continue;
    await prisma.groupTeam.upsert({
      where: { groupId_teamId: { groupId: group.id, teamId } },
      update: {},
      create: { groupId: group.id, teamId },
    });
  }

  // 6. Rounds (1..N).
  const roundIdByNumber = new Map<number, string>();
  for (let n = 1; n <= numRounds; n++) {
    const r =
      (await prisma.round.findFirst({ where: { stageId: stage.id, number: n } })) ??
      (await prisma.round.create({ data: { stageId: stage.id, number: n, legs: 1, order: n } }));
    roundIdByNumber.set(n, r.id);
  }

  // 7. Stadiums (upsert by name+city) from ESPN venues.
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
      create: { name, city, country: v?.address?.country ?? 'Brasil' },
    });
    stadiumByKey.set(key, row.id);
    return row.id;
  }

  // 8. Matches — keyed by ESPN event id.
  const existing = await prisma.match.findMany({
    where: { seasonId: season.id },
    select: { id: true, matchNumber: true, externalIds: true },
  });
  const matchByEspn = new Map<string, { id: string }>();
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

    const data = {
      seasonId: season.id,
      stageId: stage.id,
      groupId: group.id,
      groupName: group.name, // drives the match page's classification + round card
      roundId: roundIdByNumber.get(roundByEvent.get(e.id) ?? 0) ?? null,
      kickoffAt: new Date(e.date),
      stadiumId: await stadiumId(c.venue),
      homeTeamId,
      awayTeamId,
      status: status as 'FINISHED' | 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'CANCELLED',
      homeScore: hs,
      awayScore: as,
      winner: winner as 'HOME' | 'AWAY' | 'DRAW' | null,
      externalIds: { espn: { id: e.id } },
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
    `✓ Série B 2026 — ${espnIds.length} clubes, ${numRounds} rodadas, ${events.length} jogos (${created} criados, ${updated} atualizados, ${played} encerrados).`,
  );
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
