// Backfill: ties de mata-mata TRAVADOS (sem vencedor apesar de todos os jogos
// FINISHED) por falta do placar de pênaltis. Busca o shootoutScore real na ESPN
// (summary) por jogo, grava homePenalties/awayPenalties com guarda de orientação
// (confere o placar 90'/prorrogação antes de mapear home/away) e roda o resolver
// por temporada afetada. DRY_RUN=1 só mostra o que faria. Rodar com DATABASE_URL
// apontando pra PROD. Idempotente.
import { PrismaClient } from '@prisma/client';
import { StandingsService } from '../src/structure/standings.service';
import { SlotResolverService } from '../src/structure/slot-resolver.service';

const DRY = process.env.DRY_RUN === '1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Side {
  score: number;
  shootout: number | null;
}
async function espnSummary(
  slug: string,
  eventId: string,
): Promise<{ home: Side | null; away: Side | null; status?: string } | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const d: any = await r.json();
  const comp = d?.header?.competitions?.[0];
  if (!comp) return null;
  let home: Side | null = null;
  let away: Side | null = null;
  for (const c of comp.competitors ?? []) {
    const rec: Side = {
      score: Number.parseInt(String(c.score ?? '0'), 10) || 0,
      shootout: c.shootoutScore != null && c.shootoutScore !== '' ? Number.parseInt(String(c.shootoutScore), 10) : null,
    };
    if (c.homeAway === 'home') home = rec;
    else if (c.homeAway === 'away') away = rec;
  }
  return { home, away, status: comp.status?.type?.name };
}

async function main() {
  const prisma = new PrismaClient();
  const standings = new StandingsService(prisma as never);
  const resolver = new SlotResolverService(prisma as never, standings);

  const ties = await prisma.tie.findMany({
    where: { winnerTeamId: null, homeTeamId: { not: null }, awayTeamId: { not: null } },
    include: {
      matches: {
        select: {
          id: true, leg: true, homeScore: true, awayScore: true,
          homePenalties: true, awayPenalties: true, status: true, externalIds: true,
        },
        orderBy: { leg: 'asc' },
      },
      round: { select: { stage: { select: { season: { select: { id: true, name: true, competition: { select: { name: true, externalIds: true } } } } } } } },
    },
  });

  // Só ties com TODOS os jogos FINISHED (de fato "decididos").
  const stuck = ties.filter((t) => t.matches.length > 0 && t.matches.every((m) => m.status === 'FINISHED'));
  console.log(`Ties travados: ${stuck.length}${DRY ? '  (DRY_RUN — nada será gravado)' : ''}`);

  const affectedSeasons = new Set<string>();
  // Toda temporada com tie travado precisa do resolver (muitos só nunca foram
  // resolvidos após o seed; outros dependem do pênalti que vamos gravar).
  for (const t of stuck) affectedSeasons.add(t.round.stage.season.id);
  let patched = 0;
  let noPen = 0;

  for (const t of stuck) {
    const slug = (t.round.stage.season.competition.externalIds as any)?.espn?.slug as string | undefined;
    const compName = t.round.stage.season.competition.name;
    if (!slug) { console.log(`  [sem slug ESPN] ${compName} tie ${t.id}`); continue; }

    for (const m of t.matches) {
      if (m.homePenalties != null && m.awayPenalties != null) continue; // já tem
      const espnId = (m.externalIds as any)?.espn?.id as string | undefined;
      if (!espnId) continue;

      const s = await espnSummary(slug, espnId);
      await sleep(150);
      if (!s?.home || !s?.away || s.home.shootout == null || s.away.shootout == null) continue;

      // Guarda de orientação: casa o placar do ESPN com o nosso (90'/prorrogação).
      let hp: number, ap: number;
      if (s.home.score === m.homeScore && s.away.score === m.awayScore) {
        hp = s.home.shootout; ap = s.away.shootout;
      } else if (s.home.score === m.awayScore && s.away.score === m.homeScore) {
        hp = s.away.shootout; ap = s.home.shootout; // orientação invertida
      } else {
        console.log(`  [placar não bate, pulado] ${compName} match ${m.id} nosso ${m.homeScore}-${m.awayScore} vs espn ${s.home.score}-${s.away.score}`);
        continue;
      }

      console.log(`  ${DRY ? 'SETARIA' : 'SET'} pênaltis ${compName} match ${m.id} (leg ${m.leg ?? '-'}): home=${hp} away=${ap}`);
      if (!DRY) {
        await prisma.match.update({ where: { id: m.id }, data: { homePenalties: hp, awayPenalties: ap } });
      }
      patched++;
    }
    if (!t.matches.some((m) => (m.externalIds as any)?.espn?.id)) noPen++;
  }

  console.log(`\nJogos com pênalti ${DRY ? 'a gravar' : 'gravados'}: ${patched} | ties sem id ESPN: ${noPen}`);

  if (!DRY && affectedSeasons.size) {
    for (const sid of affectedSeasons) {
      await resolver.resolveSeason(sid);
      console.log(`resolveSeason ${sid} OK`);
    }
  }

  // Re-checa quantos ties seguem travados.
  const after = await prisma.tie.findMany({
    where: { winnerTeamId: null, homeTeamId: { not: null }, awayTeamId: { not: null } },
    include: { matches: { select: { status: true } } },
  });
  const stillStuck = after.filter((t) => t.matches.length > 0 && t.matches.every((m) => m.status === 'FINISHED')).length;
  console.log(`Ties ainda travados após backfill: ${stillStuck}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
