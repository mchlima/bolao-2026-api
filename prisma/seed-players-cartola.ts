/**
 * Enriches Brasileirão players (already seeded from ESPN) with the Cartola FC
 * feed: idiomatic apelido, availability status and pt position. Matches Cartola
 * clubs → our teams by name, then players within a club by normalized full name
 * (conservative — only confident matches are touched). Photos are adopted only
 * when Cartola has a real one (it serves silhouettes off-season).
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-players-cartola.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient();
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const norm = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

interface Mercado {
  clubes: Record<string, { id: number; nome: string; abreviacao: string; nome_fantasia?: string }>;
  posicoes: Record<string, { nome: string }>;
  status: Record<string, { nome: string }>;
  atletas: Array<{ atleta_id: number; apelido: string; nome: string; foto?: string; posicao_id: number; clube_id: number; status_id: number }>;
}

async function main() {
  const res = await fetch('https://api.cartola.globo.com/atletas/mercado', { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Cartola ${res.status}`);
  const mkt = (await res.json()) as Mercado;

  // Our Brasileirão teams (those with players in the bra.1 competition).
  const teams = await prisma.$queryRawUnsafe<{ id: string; name: string; shortName: string }[]>(`
    select distinct t.id, t.name, t."shortName"
    from teams t
    join matches m on m."homeTeamId" = t.id or m."awayTeamId" = t.id
    join seasons s on s.id = m."seasonId"
    join competitions c on c.id = s."competitionId"
    where c."externalIds"->'espn'->>'slug' = 'bra.1'
  `);
  const teamByNorm = new Map<string, string>();
  for (const t of teams) {
    teamByNorm.set(norm(t.name), t.id);
    teamByNorm.set(norm(t.shortName), t.id);
    // also the last distinctive word, so "Red Bull Bragantino" ↔ "Bragantino".
    const last = norm(t.name).split(' ').at(-1) ?? '';
    if (last.length > 4 && !teamByNorm.has(last)) teamByNorm.set(last, t.id);
  }

  // Cartola clube_id → our teamId (match by fantasy name / full name).
  const clubToTeam = new Map<number, string>();
  for (const c of Object.values(mkt.clubes)) {
    const id = teamByNorm.get(norm(c.nome_fantasia || '')) ?? teamByNorm.get(norm(c.nome));
    if (id) clubToTeam.set(c.id, id);
  }
  console.log(`matched ${clubToTeam.size}/${Object.keys(mkt.clubes).length} Cartola clubs to our teams`);

  // Index our players per team by normalized full name + display name.
  const playersByTeam = new Map<string, { id: string; keys: Set<string> }[]>();
  for (const teamId of new Set(clubToTeam.values())) {
    const ps = await prisma.player.findMany({ where: { teamId }, select: { id: true, name: true, fullName: true } });
    playersByTeam.set(
      teamId,
      ps.map((p) => ({ id: p.id, keys: new Set([norm(p.fullName ?? ''), norm(p.name)].filter(Boolean)) })),
    );
  }

  // Reset prior cartola links on the target teams so re-runs don't trip the
  // unique constraint when an earlier imperfect match held an atleta_id.
  await prisma.player.updateMany({
    where: { teamId: { in: [...new Set(clubToTeam.values())] }, cartolaId: { not: null } },
    data: { cartolaId: null },
  });

  let enriched = 0;
  let unmatched = 0;
  for (const a of mkt.atletas) {
    const teamId = clubToTeam.get(a.clube_id);
    if (!teamId) continue;
    const keyFull = norm(a.nome);
    const keyApe = norm(a.apelido);
    const pool = playersByTeam.get(teamId) ?? [];
    const hit = pool.find((p) => (keyFull && p.keys.has(keyFull)) || (keyApe && p.keys.has(keyApe)));
    if (!hit) {
      unmatched++;
      continue;
    }
    const realPhoto = a.foto && !a.foto.includes('/silhuetas/') ? a.foto.replace('FORMATO', '140x140') : undefined;
    await prisma.player.update({
      where: { id: hit.id },
      data: {
        name: a.apelido || undefined,
        position: mkt.posicoes[String(a.posicao_id)]?.nome ?? undefined,
        status: mkt.status[String(a.status_id)]?.nome ?? undefined,
        cartolaId: String(a.atleta_id),
        ...(realPhoto ? { photoUrl: realPhoto } : {}),
      },
    });
    enriched++;
  }
  console.log(`done — enriched ${enriched} players, ${unmatched} Cartola players unmatched (kept ESPN data)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
