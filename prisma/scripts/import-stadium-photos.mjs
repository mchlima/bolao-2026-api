// Fetch stadium photos from Wikidata (P18 → Wikimedia Commons), mirror them to
// our R2, and set stadium.photoUrl + the required CC attribution
// (photoCredit / photoSourceUrl). Idempotent — keyed by stadium id.
//
// Wikidata P18 points at the building's own photo (more reliable than a
// Wikipedia "lead image", which is sometimes a club crest/logo).
//
// Run (DRY-RUN, no writes — just prints what it found, for review):
//   node --env-file=.env prisma/scripts/import-stadium-photos.mjs
// Apply (download + upload to R2 + DB write):
//   node --env-file=.env prisma/scripts/import-stadium-photos.mjs --apply
// Flags:
//   --apply          actually download/upload/write (default is dry-run)
//   --force          re-process stadiums that already have a photoUrl
//   --only=<text>    only stadiums whose name contains <text> (case-insensitive)
//   --width=<px>     Commons thumbnail width (default 1600)
import { PrismaClient } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// R2 rejects the default flexible checksums — restrict to when_required.
process.env.AWS_REQUEST_CHECKSUM_CALCULATION ||= 'when_required';
process.env.AWS_RESPONSE_CHECKSUM_VALIDATION ||= 'when_required';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const WIDTH = Number((args.find((a) => a.startsWith('--width=')) || '').slice(8)) || 1600;

const UA = 'cravei-bolao/1.0 (https://cravei.app; contato@cravei.app)';

// Nome → QID explícito, p/ casos onde a busca cai num homônimo que NÃO é o
// estádio (jogador, santo, etc). Resolvido manualmente no Wikidata.
const OVERRIDES = {
  'Mané Garrincha': 'Q336088', // Estádio Nacional de Brasília (não o jogador Garrincha)
  'São Januário': 'Q721419', // Estádio Vasco da Gama (não o santo)
  Canindé: 'Q1343230', // Estádio do Canindé / Portuguesa (não o município de Canindé/CE)
  Maião: 'Q10277233', // Estádio Municipal José Maria de Campos Maia / Mirassol (busca caía em Chichén Itzá)
};
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function wjson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// name → { qid, title, lang } using a direct title hit first, then a search
// fallback, trying pt.wikipedia then en.wikipedia (covers international venues).
async function resolveQid(name) {
  if (OVERRIDES[name]) return { qid: OVERRIDES[name], title: `${name} (override)`, lang: 'pt' };
  for (const lang of ['pt', 'en']) {
    const base = `https://${lang}.wikipedia.org/w/api.php`;
    // 1) exact-ish title (follows redirects)
    const direct = await wjson(
      `${base}?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&titles=${encodeURIComponent(name)}`,
    );
    const pages = Object.values(direct?.query?.pages || {});
    const hit = pages.find((p) => p.pageprops?.wikibase_item && !('missing' in p));
    if (hit) return { qid: hit.pageprops.wikibase_item, title: hit.title, lang };
    // 2) search fallback (top result)
    const search = await wjson(
      `${base}?action=query&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=1&prop=pageprops&ppprop=wikibase_item&format=json`,
    );
    const sp = Object.values(search?.query?.pages || {})[0];
    if (sp?.pageprops?.wikibase_item) return { qid: sp.pageprops.wikibase_item, title: sp.title, lang };
  }
  return null;
}

// QID → P18 Commons filename (or null when the entity has no image).
async function p18File(qid) {
  const d = await wjson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const claims = d?.entities?.[qid]?.claims?.P18;
  return claims?.[0]?.mainsnak?.datavalue?.value || null;
}

// Fallback when the entity has no P18: the Wikipedia page's lead image
// (pageimages). Tries the given languages until one has an image.
async function leadImageFile(title, langs) {
  for (const lang of langs) {
    const d = await wjson(
      `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=name&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
    );
    const p = Object.values(d?.query?.pages || {})[0];
    if (p?.pageimage) return p.pageimage;
  }
  return null;
}

// Commons file → { artist, license, pageUrl } for attribution.
async function commonsMeta(file) {
  const d = await wjson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata|url&titles=${encodeURIComponent('File:' + file)}`,
  );
  const page = Object.values(d?.query?.pages || {})[0];
  const ii = page?.imageinfo?.[0];
  const em = ii?.extmetadata || {};
  return {
    artist: stripHtml(em.Artist?.value) || 'Autor desconhecido',
    license: stripHtml(em.LicenseShortName?.value) || '',
    pageUrl: ii?.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
  };
}

function filePathUrl(file) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${WIDTH}`;
}

async function uploadToR2(srcUrl, key) {
  const res = await fetch(srcUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`download ${res.status} ${srcUrl}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const body = Buffer.from(await res.arrayBuffer());
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return `${PUBLIC}/${key}`;
}

const stadiums = await prisma.stadium.findMany({ orderBy: { name: 'asc' } });
let found = 0;
let missing = 0;
let wrote = 0;

console.log(
  `${APPLY ? 'APPLY' : 'DRY-RUN'} · ${stadiums.length} estádios${ONLY ? ` · filtro "${ONLY}"` : ''}${FORCE ? ' · force' : ''}\n`,
);

for (const st of stadiums) {
  if (ONLY && !st.name.toLowerCase().includes(ONLY)) continue;
  if (st.photoUrl && !FORCE) {
    console.log(`= ${st.name} — já tem foto (use --force p/ refazer)`);
    continue;
  }
  try {
    const r = await resolveQid(st.name);
    if (!r) {
      missing++;
      console.log(`✗ ${st.name} — sem página na Wikipedia`);
      continue;
    }
    let file = await p18File(r.qid);
    let via = 'P18';
    if (!file) {
      file = await leadImageFile(r.title, [...new Set([r.lang, 'pt', 'en'])]);
      via = 'lead';
    }
    if (!file) {
      missing++;
      console.log(`✗ ${st.name} — ${r.qid} (${r.title}) sem foto`);
      continue;
    }
    const meta = await commonsMeta(file);
    found++;
    const credit = [meta.artist, meta.license].filter(Boolean).join(' / ');
    console.log(`✓ ${st.name}  [${r.lang}:${r.title} · ${r.qid} · ${via}]`);
    console.log(`    url: ${filePathUrl(file)}`);
    console.log(`    crédito: ${credit}`);
    if (APPLY) {
      const ext = (file.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'jpg').toLowerCase();
      const url = await uploadToR2(filePathUrl(file), `stadiums/${st.id}.${ext}`);
      await prisma.stadium.update({
        where: { id: st.id },
        data: { photoUrl: url, photoCredit: credit, photoSourceUrl: meta.pageUrl },
      });
      wrote++;
      console.log(`    → R2: ${url}`);
    }
  } catch (e) {
    missing++;
    console.log(`✗ ${st.name} — erro: ${e.message}`);
  }
  await sleep(250); // be polite to the Wikimedia APIs
}

console.log(`\nresumo: ${found} com foto · ${missing} sem/erro${APPLY ? ` · ${wrote} gravados` : ' · (dry-run, nada gravado)'}`);
await prisma.$disconnect();
