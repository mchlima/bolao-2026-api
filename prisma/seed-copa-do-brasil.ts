/**
 * Seeds the Copa do Brasil 2026 knockout (oitavas → final) from the ESPN public
 * scoreboard: Competition (bra.copa_do_brazil) → Season → Stage "Mata-mata"
 * (KNOCKOUT) → Rounds (Oitavas/Quartas/Semis/Final) → Ties → Matches.
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-copa-do-brasil.ts
 *   DRY_RUN=1 ts-node ... prisma/seed-copa-do-brasil.ts   # fetch + map, NO DB writes
 *
 * Scope: the round of 16 onward. The earlier phases (1ª–5ª) involve ~74 minor clubs
 * not in our catalog and are finished; like the Libertadores seed (which starts at
 * the group stage, skipping qualifiers), we launch the pool at the business end.
 * All 16 round-of-16 clubs are already seeded; a missing one is reported, not
 * created. Idempotent: matches keyed by ESPN event id; ties keyed by (round, order)
 * so the quarter/semi/final placeholders upgrade in place once ESPN schedules them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

// ts-node doesn't auto-load .env — load it ourselves (same as the other seeds).
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DRY = process.env.DRY_RUN === '1';
const prisma = new PrismaClient();

// R2, for mirroring the competition crest (same convention as seed-libertadores).
// PUBLIC must be the CDN base (cdn.cravei.app) — in prod that's STORAGE_PUBLIC_BASE_URL;
// from a dev .env, pass it explicitly.
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

const ESPN_SLUG = 'bra.copa_do_brazil';
const SCOREBOARD = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SLUG}/scoreboard`;

// Knockout phases we ingest (event.season.slug). Order is the bracket order. Early
// phases (1ª–4ª) are single-leg (jogo único, penalty if drawn); 5ª onward are
// two-legged (ida e volta), including the Copa do Brasil final. Many clubs of the
// early rounds (Série C/D, estaduais) aren't in our catalog and are auto-created.
const KNOCKOUT: Record<string, { name: string; legs: number; order: number; ties: number }> = {
  'first-round': { name: '1ª fase', legs: 1, order: 1, ties: 0 },
  'second-round': { name: '2ª fase', legs: 1, order: 2, ties: 0 },
  'third-round': { name: '3ª fase', legs: 1, order: 3, ties: 0 },
  'fourth-round': { name: '4ª fase', legs: 1, order: 4, ties: 0 },
  'fifth-round': { name: '5ª fase', legs: 2, order: 5, ties: 0 },
  'round-of-16': { name: 'Oitavas de final', legs: 2, order: 6, ties: 8 },
  quarterfinals: { name: 'Quartas de final', legs: 2, order: 7, ties: 4 },
  semifinals: { name: 'Semifinais', legs: 2, order: 8, ties: 2 },
  final: { name: 'Final', legs: 2, order: 9, ties: 1 },
};
const KO_ORDER = [
  'first-round',
  'second-round',
  'third-round',
  'fourth-round',
  'fifth-round',
  'round-of-16',
  'quarterfinals',
  'semifinals',
  'final',
];
const SOURCE_LABEL: Record<string, string> = {
  quarterfinals: 'Classificado das oitavas',
  semifinals: 'Classificado das quartas',
  final: 'Classificado das semifinais',
};

// ── ESPN scoreboard shapes (only the bits we read) ──
interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  team?: { id?: string; displayName?: string; abbreviation?: string; logo?: string };
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

/** Download a crest (ESPN scoreboard logo or the by-id CDN), to WebP, into R2.
 * Many minor clubs have no ESPN logo → returns null (rendered as a placeholder). */
async function uploadCrest(href: string): Promise<string | null> {
  if (!BUCKET || !PUBLIC || !href) return null;
  try {
    const res = await fetch(href);
    if (!res.ok) return null;
    const webp = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const key = `teams/${randomUUID()}.webp`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: webp,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${PUBLIC}/${key}`;
  } catch {
    return null;
  }
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
  STATUS_FINAL_PEN: 'FINISHED',
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
  console.log(`Seeding Copa do Brasil 2026 (ESPN)${DRY ? ' — DRY RUN' : ''}…`);

  // 1. Pull the season month-by-month (ESPN caps per call), dedupe, keep all the
  //    knockout phases (1ª fase → final) for the full history.
  const months = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609', '202610', '202611', '202612'];
  const byId = new Map<string, EspnEvent>();
  for (const ym of months) for (const ev of await fetchMonth(ym)) byId.set(ev.id, ev);
  const events = [...byId.values()]
    .filter((e) => isKnockout(e.season?.slug))
    .sort((a, b) => a.date.localeCompare(b.date));
  console.log(`  ESPN: ${events.length} jogos de mata-mata (1ª fase → final)`);

  // 2. Resolve every ESPN team id → our Team. The early rounds bring minor clubs
  //    (Série C/D, estaduais) not yet in the catalog — auto-create them (country
  //    Brasil; logo from the scoreboard or the ESPN by-id CDN, else placeholder).
  const teamObjById = new Map<string, NonNullable<EspnCompetitor['team']>>();
  for (const e of events) for (const c of e.competitions[0].competitors) if (c.team?.id) teamObjById.set(c.team.id, c.team);
  const espnIds = [...teamObjById.keys()];

  const sport = await prisma.sport.findFirstOrThrow({ where: { slug: 'futebol' } });
  const allClubs = await prisma.team.findMany({ where: { type: 'CLUB' }, select: { id: true, externalIds: true } });
  const teamByEspn = new Map<string, string>();
  for (const t of allClubs) {
    const id = (t.externalIds as { espn?: { id?: string } })?.espn?.id;
    if (id) teamByEspn.set(id, t.id);
  }
  const missing = espnIds.filter((i) => !teamByEspn.has(i));
  console.log(`  ${espnIds.length} clubes nos confrontos (${espnIds.length - missing.length} já no banco, ${missing.length} a criar)`);

  if (DRY) {
    const byRound: Record<string, number> = {};
    for (const e of events) byRound[KNOCKOUT[e.season!.slug!].name] = (byRound[KNOCKOUT[e.season!.slug!].name] ?? 0) + 1;
    console.log('  Mata-mata por rodada:', JSON.stringify(byRound));
    console.log('  Clubes a criar (amostra):', missing.slice(0, 20).map((i) => teamObjById.get(i)?.displayName).join(', '));
    console.log('DRY RUN — nada gravado.');
    return;
  }

  // Auto-create the missing clubs before anything references them.
  let clubsCreated = 0;
  for (const espnId of missing) {
    const t = teamObjById.get(espnId)!;
    const name = t.displayName ?? `Clube ${espnId}`;
    const sigla = (t.abbreviation || name.slice(0, 3)).toUpperCase();
    const logoSrc = t.logo || `https://a.espncdn.com/i/teamlogos/soccer/500/${espnId}.png`;
    const logoUrl = await uploadCrest(logoSrc);
    const club = await prisma.team.create({
      data: {
        sportId: sport.id,
        name,
        shortName: sigla,
        type: 'CLUB',
        country: 'Brasil',
        logoUrl,
        externalIds: { espn: { id: espnId, code: sigla } },
      },
    });
    teamByEspn.set(espnId, club.id);
    clubsCreated++;
  }
  if (clubsCreated) console.log(`  ✓ ${clubsCreated} clubes criados`);

  // 3. Competition (idempotent by sport+slug). Crest mirrored from ESPN into R2.
  const { logoUrl, logoUrlDark } = await competitionLogos();
  const competition = await prisma.competition.upsert({
    where: { sportId_slug: { sportId: sport.id, slug: ESPN_SLUG } },
    update: { externalIds: { espn: { slug: ESPN_SLUG } }, ...(logoUrl ? { logoUrl, logoUrlDark } : {}) },
    create: {
      sportId: sport.id,
      name: 'Copa do Brasil',
      slug: ESPN_SLUG,
      urlSlug: 'copa-do-brasil',
      type: 'CUP',
      confederation: 'CBF',
      externalIds: { espn: { slug: ESPN_SLUG } },
      logoUrl,
      logoUrlDark,
    },
  });

  // Período = min/max dos jogos semeados (truncado ao dia). Estende sozinho quando
  // quartas/semis/final ganharem data num re-seed.
  const dayUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const startDate = events.length ? dayUtc(events[0].date) : null;
  const endDate = events.length ? dayUtc(events[events.length - 1].date) : null;

  // 4. Season 2026.
  const seasonData = {
    competitionId: competition.id,
    name: 'Copa do Brasil 2026',
    slug: 'copa-do-brasil-2026',
    seasonLabel: '2026',
    format: 'KNOCKOUT' as const,
    status: 'ONGOING' as const,
    startDate,
    endDate,
  };
  const existingSeason = await prisma.season.findFirst({ where: { name: seasonData.name } });
  const season = existingSeason
    ? await prisma.season.update({ where: { id: existingSeason.id }, data: seasonData })
    : await prisma.season.create({ data: seasonData });

  // 5. Single knockout stage.
  const koStage =
    (await prisma.stage.findFirst({ where: { seasonId: season.id, order: 1 } })) ??
    (await prisma.stage.create({ data: { seasonId: season.id, name: 'Mata-mata', format: 'KNOCKOUT', order: 1 } }));

  // 6. Rounds (all four up front so a chave mostra o caminho inteiro).
  const roundIdBySlug = new Map<string, string>();
  for (const slug of KO_ORDER) {
    const def = KNOCKOUT[slug];
    const r =
      (await prisma.round.findFirst({ where: { stageId: koStage.id, name: def.name } })) ??
      (await prisma.round.create({ data: { stageId: koStage.id, name: def.name, legs: def.legs, order: def.order } }));
    // Atualiza ordem/legs em re-run (o escopo cresceu de oitavas-only p/ 1ª fase→final).
    if (r.order !== def.order || r.legs !== def.legs)
      await prisma.round.update({ where: { id: r.id }, data: { order: def.order, legs: def.legs } });
    roundIdBySlug.set(slug, r.id);
  }

  // 7. Ties (nós do bracket), per round, keyed by (roundId, order). Where ESPN has
  //    the games, ties are concrete (paired by team, two legs); otherwise placeholders
  //    "a definir". Concrete upgrades a placeholder in place on re-seed (same key).
  const tieIdByEvent = new Map<string, string>();
  const legByEvent = new Map<string, number>();
  for (const slug of KO_ORDER) {
    const roundId = roundIdBySlug.get(slug)!;
    const def = KNOCKOUT[slug];
    const roundEvents = events.filter((e) => e.season!.slug === slug);

    if (roundEvents.length) {
      // group the legs of each confronto by the (unordered) team pair
      const pairs = new Map<string, EspnEvent[]>();
      for (const e of roundEvents) {
        const c = e.competitions[0];
        const ids = [pick(c, 'home')?.team?.id, pick(c, 'away')?.team?.id].filter(Boolean).sort();
        pairs.set(ids.join('-'), [...(pairs.get(ids.join('-')) ?? []), e]);
      }
      let order = 1;
      for (const list of [...pairs.values()].sort((a, b) => a[0].date.localeCompare(b[0].date))) {
        list.sort((a, b) => a.date.localeCompare(b.date));
        const c = list[0].competitions[0]; // leg 1 defines tie home/away
        const he = pick(c, 'home')?.team?.id;
        const ae = pick(c, 'away')?.team?.id;
        const homeTeamId = he ? (teamByEspn.get(he) ?? null) : null;
        const awayTeamId = ae ? (teamByEspn.get(ae) ?? null) : null;
        const tie =
          (await prisma.tie.findFirst({ where: { roundId, order } })) ??
          (await prisma.tie.create({ data: { roundId, order, homeTeamId, awayTeamId } }));
        await prisma.tie.update({ where: { id: tie.id }, data: { homeTeamId, awayTeamId } });
        list.forEach((e, i) => {
          tieIdByEvent.set(e.id, tie.id);
          legByEvent.set(e.id, i + 1);
        });
        order++;
      }
    } else {
      // placeholders so the bracket renders the path before the games exist
      const label = SOURCE_LABEL[slug];
      for (let order = 1; order <= def.ties; order++) {
        const exists = await prisma.tie.findFirst({ where: { roundId, order } });
        if (!exists)
          await prisma.tie.create({ data: { roundId, order, homeSourceLabel: label, awaySourceLabel: label } });
      }
    }
  }

  // 8. Stadiums (upsert by name+city) from ESPN venues.
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

  // 9. Matches — keyed by ESPN event id (stable across re-runs / new fixtures).
  const existing = await prisma.match.findMany({
    where: { seasonId: season.id },
    select: { id: true, matchNumber: true, externalIds: true },
  });
  const matchByEspn = new Map<string, { id: string; matchNumber: number | null }>();
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

    const hit = matchByEspn.get(e.id);
    const data = {
      seasonId: season.id,
      stageId: koStage.id,
      roundId: roundIdBySlug.get(slug) ?? null,
      tieId: tieIdByEvent.get(e.id) ?? null,
      leg: legByEvent.get(e.id) ?? 1,
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

    if (hit) {
      await prisma.match.update({ where: { id: hit.id }, data });
      updated++;
    } else {
      await prisma.match.create({ data: { ...data, matchNumber: ++maxNum } });
      created++;
    }
  }

  console.log(
    `✓ Copa do Brasil 2026 — ${espnIds.length} clubes, ${events.length} jogos (${created} criados, ${updated} atualizados, ${played} encerrados).`,
  );
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
