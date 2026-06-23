import { PrismaService } from '../prisma/prisma.service';

/** Data YYYY-MM-DD no fuso de Brasília (en-CA formata nesse padrão). */
function isoDateSP(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

/** Slug canônico: sem acento, minúsculo, só [a-z0-9-]. Mantém o "x" do confronto. */
function slugifyText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug de jogo no padrão SEO: "brasil-x-franca-2026-06-22" (times + data). Null quando
 * algum lado ainda não tem time (slot de mata-mata não resolvido). A data desambigua
 * turno/returno e edições; a unicidade fina é garantida por ensureMatchSlug.
 */
export function buildMatchSlug(
  homeName: string | null | undefined,
  awayName: string | null | undefined,
  kickoffAt: Date,
): string | null {
  if (!homeName || !awayName) return null;
  const teams = slugifyText(`${homeName} x ${awayName}`);
  if (!teams) return null;
  return `${teams}-${isoDateSP(kickoffAt)}`;
}

/**
 * Garante o slug de um jogo (best-effort): recalcula a partir dos times+data e persiste
 * se mudou. Resolve colisão raríssima (mesmos times/mesmo dia) com sufixo numérico.
 * Standalone (recebe prisma) p/ ser chamado tanto pelo MatchesService quanto pelo
 * SlotResolver sem criar ciclo de injeção. Erros são responsabilidade do chamador.
 */
export async function ensureMatchSlug(prisma: PrismaService, matchId: string): Promise<void> {
  const m = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      slug: true,
      kickoffAt: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  if (!m?.homeTeam || !m?.awayTeam) return;
  const desired = buildMatchSlug(m.homeTeam.name, m.awayTeam.name, m.kickoffAt);
  if (!desired || desired === m.slug) return;

  let candidate = desired;
  for (let i = 2; i <= 9; i++) {
    const clash = await prisma.match.findFirst({
      where: { slug: candidate, NOT: { id: m.id } },
      select: { id: true },
    });
    if (!clash) break;
    candidate = `${desired}-${i}`;
  }
  await prisma.match.update({ where: { id: m.id }, data: { slug: candidate } });
}
