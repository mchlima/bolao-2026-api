import { Injectable } from '@nestjs/common';
import { NewsFeed } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchFactPackService, PackBlocks } from '../match-fact-pack.service';
import { DiscoveredItem, SourceConnector } from './types';

// Janela de retroatividade padrão ao ligar a fonte (h): evita gerar matéria de jogo
// antigo de uma vez só. Sobrescrevível por NewsFeed.maxAgeHours.
const DEFAULT_LOOKBACK_HOURS = 72;
// Atraso padrão após o apito antes de gerar (min): dá tempo de dados atrasados
// (stats/escalação tardias) chegarem — e, na fase 2, de inserção manual.
const DEFAULT_DELAY_MINUTES = 20;
// Fallback de "fim do jogo" quando não há evento PERIOD_END (jogo retroativo/seed).
const FALLBACK_DURATION_MS = 135 * 60_000;

interface MatchReportConfig {
  seasonIds?: string[]; // escopo: quais temporadas a fonte cobre (obrigatório)
  teamId?: string; // opcional: só jogos deste time
  blocks?: Partial<PackBlocks>; // quais blocos de dado entram (default: tudo)
  notableCap?: number; // teto de lances notáveis nomeados
  delayMinutes?: number; // atraso após o apito
}

/**
 * Fonte GENERATIVA "resumo da partida": não busca na web — varre o NOSSO banco por
 * jogos encerrados no escopo e entrega os fatos já montados (MatchFactPackService).
 * Elegível só quando `fim do jogo + delayMinutes <= agora`; dedup por (feed, jogo)
 * via sourceGuid `match:<id>`; o lookback (maxAgeHours) evita varrer o histórico.
 */
@Injectable()
export class MatchReportConnector implements SourceConnector {
  readonly type = 'MATCH_REPORT';

  constructor(
    private readonly prisma: PrismaService,
    private readonly pack: MatchFactPackService,
  ) {}

  async discover(feed: NewsFeed): Promise<DiscoveredItem[]> {
    const cfg = (feed.config ?? {}) as MatchReportConfig;
    const seasonIds = Array.isArray(cfg.seasonIds) ? cfg.seasonIds.filter(Boolean) : [];
    if (!seasonIds.length) return []; // sem escopo definido, não gera nada (evita surpresa)

    const delayMs = Math.min(Math.max(cfg.delayMinutes ?? DEFAULT_DELAY_MINUTES, 0), 1440) * 60_000;
    const lookbackMs = (feed.maxAgeHours ?? DEFAULT_LOOKBACK_HOURS) * 3_600_000;
    const now = Date.now();

    const candidates = await this.prisma.match.findMany({
      where: {
        seasonId: { in: seasonIds },
        status: 'FINISHED',
        kickoffAt: { gte: new Date(now - lookbackMs - FALLBACK_DURATION_MS) },
        ...(cfg.teamId
          ? { OR: [{ homeTeamId: cfg.teamId }, { awayTeamId: cfg.teamId }] }
          : {}),
      },
      select: {
        id: true,
        kickoffAt: true,
        events: { where: { type: 'PERIOD_END' }, select: { createdAt: true } },
      },
    });

    const out: DiscoveredItem[] = [];
    for (const m of candidates) {
      const lastWhistle = m.events.reduce<number>(
        (max, e) => Math.max(max, e.createdAt.getTime()),
        0,
      );
      const endedAt = lastWhistle || m.kickoffAt.getTime() + FALLBACK_DURATION_MS;
      // Ainda no período de carência, ou já fora da janela de lookback → ignora.
      if (endedAt + delayMs > now) continue;
      if (endedAt < now - lookbackMs) continue;

      const built = await this.pack.build(m.id, { blocks: cfg.blocks, notableCap: cfg.notableCap });
      if (!built) continue;

      out.push({
        sourceGuid: `match:${m.id}`, // @@unique([feedId, sourceGuid]) → cobre o jogo uma vez
        sourceUrl: `match:${m.id}`,
        sourceTitle: built.title,
        sourceSummary: null,
        sourceText: null,
        publishedAt: new Date(endedAt),
        facts: built.facts,
        matchId: m.id,
      });
    }
    return out;
  }
}
