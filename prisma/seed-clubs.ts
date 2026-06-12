/**
 * Seeds CLUB teams from ESPN's public API, by region, into the `teams` table.
 * Idempotent by `espnId` (re-runs upsert; crests are only fetched when missing).
 * Crests (default + dark variant) are optimized to WebP and stored in our R2.
 *
 * Run one region at a time (phased rollout):
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-clubs.ts south-america
 *   ...europe | central-north-america
 *
 * National teams are seeded elsewhere (seed.ts) and are untouched here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, TeamType } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

// ts-node doesn't auto-load .env (unlike `prisma db seed`) — load it ourselves.
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
  },
  forcePathStyle: true,
});
const BUCKET = process.env.STORAGE_BUCKET ?? '';
const PUBLIC = (process.env.STORAGE_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

/** Country (pt-BR, matching the national-team naming) → ESPN league slugs (all tiers). */
const REGIONS: Record<string, { country: string; slugs: string[] }[]> = {
  'south-america': [
    { country: 'Argentina', slugs: ['arg.1', 'arg.2', 'arg.3', 'arg.4'] },
    { country: 'Brazil', slugs: ['bra.1', 'bra.2', 'bra.3'] },
    { country: 'Chile', slugs: ['chi.1', 'chi.2'] },
    { country: 'Colombia', slugs: ['col.1', 'col.2'] },
    { country: 'Ecuador', slugs: ['ecu.1'] },
    { country: 'Peru', slugs: ['per.1'] },
    { country: 'Paraguay', slugs: ['par.1'] },
    { country: 'Bolivia', slugs: ['bol.1'] },
    { country: 'Uruguay', slugs: ['uru.1', 'uru.2'] },
    { country: 'Venezuela', slugs: ['ven.1'] },
  ],
  'central-north-america': [
    { country: 'United States', slugs: ['usa.1', 'usa.usl.1', 'usa.usl.l1'] },
    { country: 'Mexico', slugs: ['mex.1', 'mex.2'] },
    { country: 'Costa Rica', slugs: ['crc.1'] },
    { country: 'Honduras', slugs: ['hon.1'] },
    { country: 'El Salvador', slugs: ['slv.1'] },
    { country: 'Guatemala', slugs: ['gua.1'] },
  ],
  europe: [
    { country: 'England', slugs: ['eng.1', 'eng.2', 'eng.3', 'eng.4', 'eng.5'] },
    { country: 'Spain', slugs: ['esp.1', 'esp.2'] },
    { country: 'Italy', slugs: ['ita.1', 'ita.2'] },
    { country: 'Germany', slugs: ['ger.1', 'ger.2'] },
    { country: 'France', slugs: ['fra.1', 'fra.2'] },
    { country: 'Portugal', slugs: ['por.1'] },
    { country: 'Netherlands', slugs: ['ned.1', 'ned.2', 'ned.3'] },
    { country: 'Belgium', slugs: ['bel.1'] },
    { country: 'Scotland', slugs: ['sco.1', 'sco.2'] },
    { country: 'Turkey', slugs: ['tur.1'] },
    { country: 'Greece', slugs: ['gre.1'] },
    { country: 'Russia', slugs: ['rus.1'] },
    { country: 'Switzerland', slugs: ['sui.1'] },
    { country: 'Austria', slugs: ['aut.1'] },
    { country: 'Denmark', slugs: ['den.1'] },
    { country: 'Norway', slugs: ['nor.1'] },
    { country: 'Sweden', slugs: ['swe.1'] },
    { country: 'Czechia', slugs: ['cze.1'] },
    { country: 'Romania', slugs: ['rou.1'] },
    { country: 'Cyprus', slugs: ['cyp.1'] },
    { country: 'Israel', slugs: ['isr.1'] },
    { country: 'Finland', slugs: ['fin.1'] },
    { country: 'Ireland', slugs: ['irl.1'] },
    { country: 'Wales', slugs: ['wal.1'] },
  ],
  asia: [
    { country: 'Saudi Arabia', slugs: ['ksa.1'] },
    { country: 'Japan', slugs: ['jpn.1'] },
    { country: 'China', slugs: ['chn.1'] },
    { country: 'Australia', slugs: ['aus.1'] },
    { country: 'Indonesia', slugs: ['idn.1'] },
    { country: 'India', slugs: ['ind.1', 'ind.2'] },
    { country: 'Thailand', slugs: ['tha.1'] },
    { country: 'Malaysia', slugs: ['mys.1'] },
    { country: 'Singapore', slugs: ['sgp.1'] },
  ],
  africa: [
    { country: 'South Africa', slugs: ['rsa.1', 'rsa.2'] },
    { country: 'Nigeria', slugs: ['nga.1'] },
    { country: 'Ghana', slugs: ['gha.1'] },
    { country: 'Kenya', slugs: ['ken.1'] },
    { country: 'Uganda', slugs: ['uga.1'] },
    { country: 'Zambia', slugs: ['zam.1'] },
    { country: 'Zimbabwe', slugs: ['zim.1'] },
  ],
};

interface EspnTeam {
  id: string;
  displayName: string;
  abbreviation?: string;
  color?: string;
  alternateColor?: string;
  logos?: { rel: string[]; href: string }[];
}

async function fetchTeams(slug: string): Promise<EspnTeam[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams?limit=500`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const d: any = await res.json();
    return (d.sports?.[0]?.leagues?.[0]?.teams ?? []).map((x: any) => x.team);
  } catch {
    return [];
  }
}

function pickLogo(logos: EspnTeam['logos'], dark: boolean): string | undefined {
  if (!logos?.length) return undefined;
  const hit = logos.find((l) => l.rel?.includes(dark ? 'dark' : 'default'));
  return hit?.href ?? (dark ? undefined : logos[0].href);
}

/** Download a crest, optimize to WebP (mirrors StorageService), upload to R2. */
async function uploadCrest(href: string): Promise<string | null> {
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

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  const q = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, q.length) }, async () => {
      let it: T | undefined;
      while ((it = q.shift())) await fn(it);
    }),
  );
}

async function run(): Promise<void> {
  const region = process.argv[2] ?? 'south-america';
  const groups = REGIONS[region];
  if (!groups) {
    throw new Error(`unknown region "${region}" (use: ${Object.keys(REGIONS).join(' | ')})`);
  }
  console.log(`Seeding clubs — region: ${region}`);
  let created = 0,
    updated = 0,
    crests = 0,
    failed = 0;

  for (const { country, slugs } of groups) {
    // Dedup a club that appears in more than one tier (rare) by ESPN id.
    const byId = new Map<string, EspnTeam>();
    for (const slug of slugs) {
      for (const t of await fetchTeams(slug)) {
        if (t?.id && !byId.has(t.id)) byId.set(t.id, t);
      }
    }
    await pool([...byId.values()], 5, async (t) => {
      try {
        const existing = await prisma.team.findUnique({ where: { espnId: t.id } });
        let logoUrl = existing?.logoUrl ?? null;
        let logoDarkUrl = existing?.logoDarkUrl ?? null;
        const def = pickLogo(t.logos, false);
        const dark = pickLogo(t.logos, true);
        if (!logoUrl && def) {
          logoUrl = await uploadCrest(def);
          if (logoUrl) crests++;
        }
        if (!logoDarkUrl && dark) {
          logoDarkUrl = await uploadCrest(dark);
          if (logoDarkUrl) crests++;
        }
        const data = {
          name: t.displayName,
          shortName: (t.abbreviation || t.displayName.slice(0, 3)).toUpperCase(),
          type: TeamType.CLUB,
          country,
          color: t.color ?? null,
          colorAlt: t.alternateColor ?? null,
          logoUrl,
          logoDarkUrl,
        };
        if (existing) {
          await prisma.team.update({ where: { espnId: t.id }, data });
          updated++;
        } else {
          await prisma.team.create({ data: { ...data, espnId: t.id } });
          created++;
        }
      } catch (e) {
        failed++;
        console.warn(`  ! ${country} ${t.displayName}: ${(e as Error).message}`);
      }
    });
    console.log(`✓ ${country}: ${byId.size} clubes`);
  }
  console.log(`\nDone. created=${created} updated=${updated} crests=${crests} failed=${failed}`);
}

run()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
