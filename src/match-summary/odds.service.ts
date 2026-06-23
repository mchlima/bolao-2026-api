import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EspnEvent, EspnService } from '../live-ingest/espn.service';
import { scoreboardDates } from '../live-ingest/live-ingest.service';
import { espnCode, espnExternalId, espnSlug } from '../common/external-ids';

const ODDS_CRON = '0 */20 * * * *'; // a cada 20 min (odds mudam devagar; 1 fetch/liga)
const WINDOW_DAYS = 7; // jogos agendados nos próximos N dias
const ODDS_LEAGUE_FALLBACK = 'fifa.world';

/**
 * Robô de ODDS pré-jogo (probabilidade 1X2 do mercado). Diferente do robô ao vivo
 * (MatchSummaryService, janela de 75min antes do apito), este roda raramente e cobre
 * uma janela LARGA (próximos 7 dias) — porque a prévia precisa do favorito/probabilidade
 * já dias antes. Lê as odds do SCOREBOARD da ESPN (1 fetch por liga), converte moneyline
 * → probabilidade implícita de-vigada e grava nas colunas odds* do Match. A página serve
 * do nosso banco (visitas nunca batem na ESPN), como todo o resto. Cada falha é isolada;
 * nunca derruba o tick.
 */
@Injectable()
export class OddsService {
  private readonly logger = new Logger(OddsService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly espn: EspnService,
  ) {}

  @Cron(ODDS_CRON)
  async tick(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    if (this.running) return;
    this.running = true;
    try {
      await this.refresh();
    } catch (e) {
      this.logger.warn(`odds tick failed: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      this.running = false;
    }
  }

  /** Atualiza as odds dos jogos agendados na janela. Retorna quantos foram alterados. */
  async refresh(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        kickoffAt: { gte: now, lte: new Date(now.getTime() + WINDOW_DAYS * 86_400_000) },
      },
      select: {
        id: true,
        kickoffAt: true,
        externalIds: true,
        oddsHomePct: true,
        oddsDrawPct: true,
        oddsAwayPct: true,
        oddsProvider: true,
        homeTeam: { select: { shortName: true, externalIds: true } },
        awayTeam: { select: { shortName: true, externalIds: true } },
        season: { select: { competition: { select: { externalIds: true } } } },
      },
    });
    if (!candidates.length) return 0;

    // 1 fetch de scoreboard por liga serve todos os jogos dela na janela.
    const bySlug = new Map<string, typeof candidates>();
    for (const m of candidates) {
      const slug = espnSlug(m.season.competition.externalIds) ?? ODDS_LEAGUE_FALLBACK;
      (bySlug.get(slug) ?? bySlug.set(slug, []).get(slug)!).push(m);
    }

    let updated = 0;
    for (const [slug, group] of bySlug) {
      let events: EspnEvent[] = [];
      try {
        events = await this.espn.fetchScoreboard(slug, scoreboardDates(group));
      } catch (e) {
        this.logger.warn(`odds scoreboard ${slug} failed: ${(e as Error).message.split('\n')[0]}`);
        continue;
      }
      const byId = new Map(events.map((e) => [e.id, e]));
      for (const m of group) {
        try {
          if (await this.applyOdds(m, events, byId)) updated++;
        } catch {
          // best-effort por jogo
        }
      }
    }
    if (updated) this.logger.log(`odds atualizadas em ${updated} jogo(s)`);
    return updated;
  }

  /** Casa o evento da ESPN (id, senão par de siglas), lê as odds e grava se mudou. */
  private async applyOdds(
    m: {
      id: string;
      kickoffAt: Date;
      externalIds: Prisma.JsonValue;
      oddsHomePct: number | null;
      oddsDrawPct: number | null;
      oddsAwayPct: number | null;
      oddsProvider: string | null;
      homeTeam: { shortName: string; externalIds: Prisma.JsonValue } | null;
      awayTeam: { shortName: string; externalIds: Prisma.JsonValue } | null;
    },
    events: EspnEvent[],
    byId: Map<string, EspnEvent>,
  ): Promise<boolean> {
    const homeAbbr = espnCode(m.homeTeam?.externalIds) ?? m.homeTeam?.shortName;
    const awayAbbr = espnCode(m.awayTeam?.externalIds) ?? m.awayTeam?.shortName;
    if (!homeAbbr || !awayAbbr) return false;

    const extId = espnExternalId(m.externalIds);
    const ev =
      (extId ? byId.get(extId) : undefined) ??
      events.find((e) => e.odds && e.abbrs.includes(homeAbbr) && e.abbrs.includes(awayAbbr));
    if (!ev?.odds) return false;

    const home = ev.odds.byAbbr[homeAbbr];
    const away = ev.odds.byAbbr[awayAbbr];
    const draw = ev.odds.draw;
    if (home == null || away == null || draw == null) return false;

    const pct = (x: number) => Math.round(x * 1000) / 10; // fração 0–1 → percent c/ 1 casa
    const homePct = pct(home);
    const drawPct = pct(draw);
    const awayPct = pct(away);

    // No-op se nada mudou (evita churn e bump inútil de oddsUpdatedAt).
    if (
      m.oddsHomePct === homePct &&
      m.oddsDrawPct === drawPct &&
      m.oddsAwayPct === awayPct &&
      m.oddsProvider === ev.odds.provider
    ) {
      return false;
    }

    await this.prisma.match.update({
      where: { id: m.id },
      data: {
        oddsHomePct: homePct,
        oddsDrawPct: drawPct,
        oddsAwayPct: awayPct,
        oddsProvider: ev.odds.provider,
        oddsUpdatedAt: new Date(),
      },
    });
    return true;
  }
}
