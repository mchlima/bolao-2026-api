// Copy ESPN league logos (light + dark variants) into our R2 object storage and
// set competition.logoUrl / logoUrlDark. Idempotent — keyed by the espn slug, so
// re-running just overwrites the same objects. Run: node --env-file=.env <this>.
import { PrismaClient } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.STORAGE_BUCKET;
const PUBLIC = process.env.STORAGE_PUBLIC_BASE_URL;

async function espnLogos(slug) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`);
  if (!r.ok) return {};
  const d = await r.json();
  const logos = d?.leagues?.[0]?.logos || [];
  return {
    def: logos.find((l) => (l.rel || []).includes('default'))?.href,
    dark: logos.find((l) => (l.rel || []).includes('dark'))?.href,
  };
}
async function upload(url, key) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${PUBLIC}/${key}`;
}

const comps = await prisma.competition.findMany();
for (const c of comps) {
  const slug = c.externalIds?.espn?.slug;
  if (!slug) { console.log('skip (no espn slug):', c.name); continue; }
  const { def, dark } = await espnLogos(slug);
  if (!def) { console.log('skip (no espn logo):', c.name, slug); continue; }
  const logoUrl = await upload(def, `competitions/${slug}/logo.png`);
  const logoUrlDark = dark ? await upload(dark, `competitions/${slug}/logo-dark.png`) : null;
  await prisma.competition.update({ where: { id: c.id }, data: { logoUrl, logoUrlDark } });
  console.log('OK', c.name, '\n   light:', logoUrl, '\n   dark :', logoUrlDark);
}
await prisma.$disconnect();
