/**
 * Backfill dos slugs de SEO dos jogos ("brasil-x-franca-2026-06-22").
 * Roda uma vez após a migração 20260623020000_match_slug. Idempotente: só escreve
 * onde o slug está vazio/diferente; mantém o mesmo dedup do ensureMatchSlug.
 *
 *   node -r dotenv/config scripts/backfill-match-slugs.cjs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function isoDateSP(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
function slugifyText(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function buildMatchSlug(home, away, kickoffAt) {
  if (!home || !away) return null;
  const teams = slugifyText(`${home} x ${away}`);
  if (!teams) return null;
  return `${teams}-${isoDateSP(kickoffAt)}`;
}

(async () => {
  const matches = await prisma.match.findMany({
    where: { homeTeamId: { not: null }, awayTeamId: { not: null } },
    select: {
      id: true,
      slug: true,
      kickoffAt: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
    orderBy: { kickoffAt: 'asc' },
  });

  const used = new Set(
    (await prisma.match.findMany({ where: { slug: { not: null } }, select: { slug: true } }))
      .map((m) => m.slug)
      .filter(Boolean),
  );

  let updated = 0;
  let skipped = 0;
  for (const m of matches) {
    const desired = buildMatchSlug(m.homeTeam?.name, m.awayTeam?.name, m.kickoffAt);
    if (!desired) { skipped++; continue; }
    if (m.slug === desired) { skipped++; continue; }

    let candidate = desired;
    for (let i = 2; i <= 9; i++) {
      // livre se ninguém usa, ou se quem usa é este próprio jogo
      if (!used.has(candidate)) break;
      candidate = `${desired}-${i}`;
    }
    if (m.slug) used.delete(m.slug);
    used.add(candidate);
    await prisma.match.update({ where: { id: m.id }, data: { slug: candidate } });
    updated++;
  }

  console.log(`Backfill concluído: ${updated} atualizados, ${skipped} sem mudança, ${matches.length} elegíveis.`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
