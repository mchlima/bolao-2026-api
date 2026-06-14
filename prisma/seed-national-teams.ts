/**
 * Enriches NATIONAL_TEAM rows with ESPN data: espnId, brand colors, a pt-BR
 * localized name and ESPN abbreviation, and the crest (default + dark) stored in
 * R2. National teams are aggregated from the WC-qualifier and continental
 * competitions (dedup by ESPN id). Idempotent: crests are only fetched when
 * missing. Existing rows are matched by abbreviation, with a small reconciliation
 * map for nations whose FIFA code differs from ESPN's (so we UPDATE, not
 * duplicate). Genuinely new nations are created; nations ESPN no longer lists
 * (e.g. Russia, suspended) are left untouched.
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-national-teams.ts
 *
 * Names are localized to pt-BR (see ptBrName) from the ISO country code via ICU,
 * not taken from ESPN's English displayName — so re-running keeps Portuguese names.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, TeamType } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
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

// pt-BR national-team names: ICU (Intl.DisplayNames) keyed by the ISO country
// code, with football-convention overrides for cases ICU gets wrong or names
// differently (UK home nations, Chinese Taipei, Czechia, the two Congos, …).
const PT_REGION = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const NAME_OVERRIDE: Record<string, string> = {
  ENG: 'Inglaterra', SCO: 'Escócia', WAL: 'País de Gales', NIR: 'Irlanda do Norte',
  TPE: 'Taipé Chinesa', CZE: 'República Tcheca', KOS: 'Kosovo',
  CIV: 'Costa do Marfim', COD: 'República Democrática do Congo', CGO: 'República do Congo',
  KOR: 'Coreia do Sul', PRK: 'Coreia do Norte', NED: 'Países Baixos', GUA: 'Guam',
};
// Display sigla in pt-BR (Brazilian-TV convention) where it differs from ESPN's
// abbreviation. Keyed by ESPN abbreviation; absent = keep ESPN's code. The ESPN
// code itself lives on espnAbbr (the robot's match key), so this is display-only.
const SIGLA_PT: Record<string, string> = {
  USA: 'EUA', GER: 'ALE', NED: 'HOL', ENG: 'ING', SCO: 'ESC', WAL: 'GAL',
  KOR: 'COR', PRK: 'CRN', CZE: 'TCH', RSA: 'AFS', KSA: 'ARA', UAE: 'EAU',
  CIV: 'CDM', JPN: 'JAP', EGY: 'EGI', DEN: 'DIN', SWE: 'SUE', ECU: 'EQU',
  UKR: 'UCR', SRB: 'SER', ROU: 'ROM', QAT: 'CAT', IRN: 'IRA',
};
function ptBrName(abbr: string, countryCode: string | null, fallback: string): string {
  if (NAME_OVERRIDE[abbr]) return NAME_OVERRIDE[abbr];
  if (countryCode) {
    try {
      const r = PT_REGION.of(countryCode);
      if (r && r !== countryCode) return r;
    } catch {
      /* non-ISO code (e.g. GB-ENG) — fall through to the English fallback */
    }
  }
  return fallback;
}

// Aggregate every national team across these competitions (dedup by ESPN id).
const COMPETITIONS = [
  'fifa.worldq.uefa', 'fifa.worldq.conmebol', 'fifa.worldq.concacaf',
  'fifa.worldq.afc', 'fifa.worldq.caf', 'fifa.worldq.ofc',
  'uefa.nations', 'uefa.euro', 'conmebol.america', 'caf.nations',
  'afc.asian.cup', 'concacaf.gold', 'fifa.world',
];

// ESPN abbreviation -> our existing countryCode, for nations whose FIFA code
// differs from ESPN's (match the existing row by nation instead of duplicating).
const RECONCILE: Record<string, string> = {
  KOS: 'XK', BVI: 'VG', USVI: 'VI', MGL: 'MN', BKA: 'BF', SUD: 'SD', NCD: 'NC',
};
// Genuinely-new nations: ESPN abbreviation -> ISO alpha-2 (so the flag works).
const NEW_CC: Record<string, string> = { GDL: 'GP' };

interface EspnTeam {
  id: string;
  displayName: string;
  abbreviation?: string;
  color?: string;
  alternateColor?: string;
  logos?: { rel: string[]; href: string }[];
}

async function fetchTeams(slug: string): Promise<EspnTeam[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams?limit=500`,
      { headers: { accept: 'application/json' } },
    );
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
        Bucket: BUCKET, Key: key, Body: webp,
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
  const byId = new Map<string, EspnTeam>();
  for (const c of COMPETITIONS) {
    for (const t of await fetchTeams(c)) if (t?.id && !byId.has(t.id)) byId.set(t.id, t);
  }
  const espn = [...byId.values()];
  console.log(`ESPN national teams aggregated: ${espn.length}`);

  const sportId = (await prisma.sport.findFirstOrThrow({ where: { slug: 'futebol' } })).id;
  const ours = await prisma.team.findMany({
    where: { type: TeamType.NATIONAL_TEAM, sportId },
    select: { id: true, shortName: true, externalIds: true, countryCode: true, logoUrl: true, logoDarkUrl: true },
  });
  // Match ESPN abbreviation against our espn code (shortName may be localized pt-BR).
  const espnCodeOf = (o: { externalIds: unknown }): string | undefined =>
    (o.externalIds as { espn?: { code?: string } } | null)?.espn?.code;
  const byAbbr = new Map(ours.map((o) => [(espnCodeOf(o) ?? o.shortName).toUpperCase(), o]));
  const byCC = new Map(ours.filter((o) => o.countryCode).map((o) => [o.countryCode!, o]));

  let updated = 0, created = 0, crests = 0, failed = 0;
  await pool(espn, 5, async (t) => {
    try {
      const abbr = (t.abbreviation || '').toUpperCase();
      const row = byAbbr.get(abbr) ?? (RECONCILE[abbr] ? byCC.get(RECONCILE[abbr]) : undefined);

      let logoUrl = row?.logoUrl ?? null;
      let logoDarkUrl = row?.logoDarkUrl ?? null;
      const def = pickLogo(t.logos, false);
      const dark = pickLogo(t.logos, true);
      if (!logoUrl && def) { logoUrl = await uploadCrest(def); if (logoUrl) crests++; }
      if (!logoDarkUrl && dark) { logoDarkUrl = await uploadCrest(dark); if (logoDarkUrl) crests++; }

      const cc = row?.countryCode ?? NEW_CC[abbr] ?? null;
      const data = {
        name: ptBrName(abbr, cc, t.displayName), // pt-BR via ICU + overrides
        shortName: SIGLA_PT[abbr] ?? abbr, // pt-BR display sigla (fallback ESPN)
        // espn.code = robot's stable match key; preserve any other provider refs.
        externalIds: {
          ...((row?.externalIds as Record<string, unknown>) ?? {}),
          espn: { id: t.id, code: abbr },
        },
        color: t.color ?? null,
        colorAlt: t.alternateColor ?? null,
        logoUrl,
        logoDarkUrl,
      };
      if (row) {
        await prisma.team.update({ where: { id: row.id }, data });
        updated++;
      } else {
        await prisma.team.create({
          data: { ...data, sportId, type: TeamType.NATIONAL_TEAM, countryCode: NEW_CC[abbr] ?? null },
        });
        created++;
      }
    } catch (e) {
      failed++;
      console.warn(`  ! ${t.displayName} (${t.abbreviation}): ${(e as Error).message}`);
    }
  });
  console.log(`\nDone. updated=${updated} created=${created} crests=${crests} failed=${failed}`);
}

run()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
