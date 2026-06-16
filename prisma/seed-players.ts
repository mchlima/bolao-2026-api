/**
 * Seeds the Player catalog from ESPN team rosters — the universal base + the
 * live robot's athlete match key (espnId). One roster fetch per team (in its
 * competition's league slug). Idempotent by espnId. Photos are constructed from
 * the athlete id (ESPN's headshot CDN); the front falls back to initials on 404.
 *
 * Cartola enrichment (Brasileirão apelido/status) runs separately — see
 * seed-players-cartola.ts.
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-players.ts [slug]
 *
 * With no arg, seeds every team that has an espnId and a competition slug.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// ts-node doesn't auto-load .env (unlike `prisma db seed`) — load it ourselves.
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const prisma = new PrismaClient();
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const headshot = (espnId: string) =>
  `https://a.espncdn.com/i/headshots/soccer/players/full/${espnId}.png`;

interface RosterAthlete {
  id?: string;
  displayName?: string;
  fullName?: string;
  position?: { abbreviation?: string; name?: string };
}

async function fetchRoster(slug: string, teamId: string): Promise<RosterAthlete[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${teamId}/roster`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`ESPN roster ${res.status} (${slug}/${teamId})`);
  const data = (await res.json()) as { athletes?: RosterAthlete[] };
  return data.athletes ?? [];
}

async function main() {
  const only = process.argv[2]; // optional league slug filter
  // One (team, slug) per team — distinct, so each squad is fetched once.
  const rows = await prisma.$queryRawUnsafe<
    { teamId: string; espnId: string; slug: string; name: string }[]
  >(`
    select distinct on (t.id) t.id as "teamId", t.name as "name",
      t."externalIds"->'espn'->>'id' as "espnId",
      c."externalIds"->'espn'->>'slug' as "slug"
    from teams t
    join matches m on m."homeTeamId" = t.id or m."awayTeamId" = t.id
    join seasons s on s.id = m."seasonId"
    join competitions c on c.id = s."competitionId"
    where t."externalIds"->'espn'->>'id' is not null
      and c."externalIds"->'espn'->>'slug' is not null
    order by t.id
  `);

  const teams = only ? rows.filter((r) => r.slug === only) : rows;
  console.log(`seeding players for ${teams.length} team(s)${only ? ` (slug=${only})` : ''}`);

  let upserted = 0;
  let failed = 0;
  for (const [i, t] of teams.entries()) {
    try {
      const athletes = await fetchRoster(t.slug, t.espnId);
      let n = 0;
      for (const a of athletes) {
        if (!a.id || !a.displayName) continue;
        const position = a.position?.abbreviation ?? a.position?.name ?? null;
        await prisma.player.upsert({
          where: { espnId: a.id },
          update: { teamId: t.teamId, name: a.displayName, fullName: a.fullName ?? null, position, photoUrl: headshot(a.id) },
          create: { espnId: a.id, teamId: t.teamId, name: a.displayName, fullName: a.fullName ?? null, position, photoUrl: headshot(a.id) },
        });
        n++;
      }
      upserted += n;
      console.log(`  [${i + 1}/${teams.length}] ${t.name}: ${n} players`);
    } catch (e) {
      failed++;
      console.warn(`  [${i + 1}/${teams.length}] ${t.name} FAILED: ${(e as Error).message}`);
    }
    await sleep(150); // be gentle on ESPN
  }

  const total = await prisma.player.count();
  console.log(`done — ${upserted} upserts, ${failed} team(s) failed. players in DB: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
